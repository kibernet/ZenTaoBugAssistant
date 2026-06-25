import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  buildBatchBugFixPrompt,
  buildBugFixPrompt,
  type AiEngine,
  type AiRepairMode,
  type BugAssigneeScope,
  type BugWorkflowAction,
  type BugWorkflowRequest,
  LoginExpiredError,
  DEFAULT_ZENTAO_SERVER_URL,
  resolveServerUrl,
  describeErrorChain,
  ZenTaoClient,
  type ZenTaoBugDetail,
  type ZenTaoBugSummary,
  type ZenTaoMember,
  type ZenTaoProject,
  type ZenTaoSession
} from "./core";

const execFileAsync = promisify(execFile);

interface ViewState {
  loggedIn: boolean;
  account?: string;
  loginAccount: string;
  serverUrl: string;
  bugs: ZenTaoBugSummary[];
  projects: ZenTaoProject[];
  selectedProjectId?: string;
  assigneeScope: BugAssigneeScope;
  assignee?: string;
  teamMembers: string[];
  members: ZenTaoMember[];
  bugCategoryFilters: string[];
  selectedIds: string[];
  aiEngine: AiEngine;
  repairMode: AiRepairMode;
  autoLoginEnabled: boolean;
  hasSavedPassword: boolean;
  status: string;
  loading: boolean;
}

export class ZenTaoBugAssistantViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "zentaoBugAssistant.view";
  static readonly savedPasswordMask = "********";
  private static readonly suppressErrorPopupKey = "zentao.suppressErrorPopup";

  private view?: vscode.WebviewView;
  private client?: ZenTaoClient;
  private previewPanel?: vscode.WebviewPanel;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private membersLoadedForProjectId?: string;
  private membersByProject: Record<string, ZenTaoMember[]> = {};
  private state: ViewState = {
    loggedIn: false,
    account: undefined,
    loginAccount: "",
    serverUrl: "",
    bugs: [],
    projects: [],
    selectedProjectId: undefined,
    assigneeScope: "member",
    assignee: undefined,
    teamMembers: [],
    members: [],
    bugCategoryFilters: ["unresolved", "resolved", "closed"],
    selectedIds: [],
    aiEngine: "claudeCode",
    repairMode: "chat",
    autoLoginEnabled: true,
    hasSavedPassword: false,
    status: "就绪",
    loading: false
  };

  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.subscriptions.push(new vscode.Disposable(() => this.stopSessionKeepAlive()));
    this.context.subscriptions.push(vscode.commands.registerCommand("zentaoBugAssistant.enableErrorPopup", async () => {
      await this.context.globalState.update(ZenTaoBugAssistantViewProvider.suppressErrorPopupKey, false);
      vscode.window.showInformationMessage("已恢复失败弹窗提示。");
    }));
    void this.cleanupImageCacheOncePerDay();
  }

  async activateAutoLogin(): Promise<void> {
    this.restorePreferences();
    await this.restoreLoginFields();
    await this.enforcePasswordPreference();
    if (!this.state.autoLoginEnabled) {
      this.postState();
      return;
    }
    await this.autoLoginFromSavedCredentials("extension-activate");
    this.postState();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.restorePreferences();
    void this.restoreLoginFields()
      .then(() => this.enforcePasswordPreference())
      .then(() => this.postState());
    void this.restoreClient();
    this.postState();
    void this.refreshOnViewOpen();
  }

  private async refreshOnViewOpen(): Promise<void> {
    await this.refresh();
  }

  private imageCacheRoot(): string {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "bug-image-cache").fsPath;
  }

  private async clearImageCache(showMessage = true): Promise<void> {
    await this.client?.clearImageCache(this.imageCacheRoot());
    this.state.status = "本地图片缓存已清理";
    this.postState();
    if (showMessage) {
      vscode.window.showInformationMessage("禅道助手本地图片缓存已清理。");
    }
  }

  private async cleanupImageCacheOncePerDay(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.context.globalState.get<string>("zentaoBugAssistant.lastImageCacheCleanup") === today) {
      return;
    }
    await fs.rm(this.imageCacheRoot(), { recursive: true, force: true }).catch(() => undefined);
    await this.context.globalState.update("zentaoBugAssistant.lastImageCacheCleanup", today);
  }

  async login(credentials?: { account?: string; password?: string }): Promise<void> {
    const account = credentials?.account?.trim() || this.state.loginAccount.trim();
    const password = await this.resolveLoginPassword(credentials?.password ?? "");
    if (!account || !password) {
      this.state.status = "请输入禅道账号和密码";
      this.postState();
      return;
    }

    await this.run("正在登录禅道...", async () => {
      this.state.loginAccount = account;
      this.client = new ZenTaoClient({ baseUrl: this.serverUrl });
      const session = await this.client.login({ account, password });
      this.state.loggedIn = true;
      this.state.account = session.account;
      this.state.assigneeScope = "all";
      this.state.assignee = undefined;
      this.state.status = `已登录：${session.account}`;
      await this.context.secrets.store("zentao.session", JSON.stringify(session));
      await this.context.secrets.store("zentao.account", account);
      if (this.config.get<boolean>("rememberPassword") ?? false) {
        await this.context.secrets.store("zentao.password", password);
        this.state.hasSavedPassword = true;
      } else {
        await this.context.secrets.delete("zentao.password");
        this.state.hasSavedPassword = false;
      }
      this.startSessionKeepAlive("manual-login");
      await this.loadProjects();
      await this.loadMembers(false);
      this.state.bugs = [];
      this.state.selectedIds = [];
      this.state.status = `已登录：${session.account}，已加载 ${this.state.projects.length} 个项目、${this.state.members.length} 个成员`;
      this.postState();
    });
  }

  async refresh(): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      this.state.loggedIn = false;
      this.state.account = undefined;
      this.postState();
      vscode.window.showWarningMessage("请先登录禅道。");
      return;
    }

    await this.run("正在获取 Bug 列表...", async () => {
      await this.fetchBugList();
    });
  }

  private async fetchBugList(): Promise<void> {
    if (!this.state.projects.length) {
      this.updateStatus("正在加载项目列表...");
      await this.loadProjects(false);
    }
    this.updateStatus(`正在拉取 Bug 列表（项目：${this.state.selectedProjectId ?? "全部"}）...`);
    const bugs = await this.withAutoLoginRetry(() => this.client!.listBugs({
      projectId: this.state.selectedProjectId,
      assigneeScope: "all",
      teamMembers: []
    }));
    this.updateStatus(`已拉取 ${bugs.length} 个 Bug，正在补全附件状态...`);
    this.state.bugs = await this.withAutoLoginRetry(() => this.client!.enrichVideoFlags(bugs));
    this.state.selectedIds = [];
    this.state.status = `共 ${this.state.bugs.length} 个 Bug`;
    if (!this.state.bugs.length) {
      this.updateStatus("未拉取到 Bug，正在自动诊断入口权限...");
      await this.crawlCurrentBugAccess();
      this.updateStatus("未发现 Bug，请先登录/刷新或检查筛选条件。");
    }
  }

  async crawlCurrentBugAccess(): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }

    await this.withAutoLoginRetry(() => this.client!.crawlBugAccessDebugInfo(this.state.selectedProjectId));
  }

  private async loadProjects(forceRefresh = false): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }

    if (this.state.projects.length && !forceRefresh) {
      this.reconcileSelectedProject();
      return;
    }

    this.state.projects = await this.withAutoLoginRetry(() => this.client!.listProjects());
    this.reconcileSelectedProject();
    await this.savePreferences();
  }

  private reconcileSelectedProject(): void {
    if (!this.state.projects.length) {
      this.state.selectedProjectId = undefined;
      return;
    }

    if (!this.state.selectedProjectId) {
      this.state.selectedProjectId = this.state.projects[0].id;
      return;
    }

    if (!this.state.projects.some((project) => project.id === this.state.selectedProjectId)) {
      this.state.selectedProjectId = this.state.projects[0].id;
    }
  }

  private async refreshProjects(): Promise<void> {
    await this.run("正在刷新项目列表...", async () => {
      await this.loadProjects(true);
      this.state.status = `项目列表已刷新：${this.state.projects.length} 个项目`;
    });
  }

  private async loadMembers(forceRefresh = false): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }

    const projectId = this.state.selectedProjectId;
    const cacheKey = projectCacheKey(projectId);
    if (!forceRefresh && this.membersLoadedForProjectId === projectId && this.state.members.length) {
      this.reconcileSelectedMember();
      return;
    }

    const cached = this.membersByProject[cacheKey];
    if (!forceRefresh && cached?.length) {
      this.state.members = [...cached];
      this.membersLoadedForProjectId = projectId;
      this.reconcileSelectedMember();
      await this.savePreferences();
      return;
    }

    this.state.members = await this.withAutoLoginRetry(() => this.client!.listMembers(projectId));
    this.membersLoadedForProjectId = projectId;
    this.membersByProject[cacheKey] = this.state.members;
    this.reconcileSelectedMember();
    await this.savePreferences();
  }

  private applyMembersCacheForProject(projectId?: string): void {
    const cacheKey = projectCacheKey(projectId);
    const cached = this.membersByProject[cacheKey];
    this.state.members = cached ? [...cached] : [];
    this.membersLoadedForProjectId = projectId;
    this.reconcileSelectedMember();
  }

  private reconcileSelectedMember(): void {
    if (this.state.assignee && this.state.members.some((member) => member.account === this.state.assignee)) {
      return;
    }
    this.state.assignee = undefined;
  }

  private async refreshMembers(): Promise<void> {
    await this.run("正在刷新成员列表...", async () => {
      await this.loadMembers(true);
      this.state.status = `成员列表已刷新：${this.state.members.length} 个成员`;
    });
  }

  async fixSelected(ids = this.state.selectedIds): Promise<void> {
    if (!ids.length) {
      vscode.window.showInformationMessage("请先选择要修复的 Bug。");
      return;
    }

    await this.fixBugsInOneChat(ids);
  }

  async copyProjectDebugInfo(): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      vscode.window.showWarningMessage("请先登录禅道。");
      return;
    }

    await this.run("正在抓取项目调试信息...", async () => {
      const debugInfo = await this.withAutoLoginRetry(() => this.client!.collectProjectDebugInfo());
      await vscode.env.clipboard.writeText(debugInfo);
      this.state.status = "项目调试信息已复制到剪贴板";
      vscode.window.showInformationMessage("项目调试信息已复制到剪贴板，请粘贴给我继续分析。");
    });
  }

  private async fixBug(id: string): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      vscode.window.showWarningMessage("请先登录禅道。");
      return;
    }

    await this.run(`正在构建 Bug #${id} 修复提示词...`, async () => {
      const detail = await this.withAutoLoginRetry(async () => {
        const bugDetail = await this.client!.getBugDetail(id);
        return this.client!.preparePromptImages(bugDetail, this.imageCacheRoot());
      });
      const basePrompt = buildBugFixPrompt(detail);
      const diagnosticPackage = await this.collectWorkspaceDiagnosticPackage([detail]);
      const prompt = this.combinePromptWithDiagnostics(basePrompt, diagnosticPackage);
      const sessionUri = await this.sendPromptForRepair(prompt, [id]);
      this.state.status = this.repairMode === "cli"
        ? `Bug #${id} 已发送到 CLI；会话包：${sessionUri.fsPath}`
        : `Bug #${id} 已发送给 AI；会话包：${sessionUri.fsPath}`;
      if (this.config.get<boolean>("autoSyncAfterFix")) {
        await this.askAndSyncWorkflow(id);
      }
    });
  }

  private async fixBugsInOneChat(ids: string[]): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      vscode.window.showWarningMessage("请先登录禅道。");
      return;
    }

    await this.run(`正在构建 ${ids.length} 个 Bug 的批量修复提示词...`, async () => {
      const details = [];
      for (const id of ids) {
        details.push(await this.withAutoLoginRetry(async () => {
          const detail = await this.client!.getBugDetail(id);
          return this.client!.preparePromptImages(detail, this.imageCacheRoot());
        }));
      }
      const basePrompt = details.length === 1 ? buildBugFixPrompt(details[0]) : buildBatchBugFixPrompt(details);
      const diagnosticPackage = await this.collectWorkspaceDiagnosticPackage(details);
      const prompt = this.combinePromptWithDiagnostics(basePrompt, diagnosticPackage);
      const sessionUri = await this.sendPromptForRepair(prompt, details.map((detail) => detail.id));
      if (this.repairMode === "cli") {
        this.state.status = details.length === 1
          ? `Bug #${details[0].id} 已发送到 CLI；会话包：${sessionUri.fsPath}`
          : `${details.length} 个 Bug 已合并发送到 CLI；会话包：${sessionUri.fsPath}`;
      } else {
        this.state.status = details.length === 1
          ? `Bug #${details[0].id} 已发送给 AI；会话包：${sessionUri.fsPath}`
          : `${details.length} 个 Bug 已合并发送给 AI；会话包：${sessionUri.fsPath}`;
      }
    });
  }

  private combinePromptWithDiagnostics(basePrompt: string, diagnosticPackage: string): string {
    if (this.repairMode === "cli") {
      return [
        buildCliFastExecutionProtocol(),
        "",
        diagnosticPackage,
        "",
        "---",
        "",
        basePrompt
      ].join("\n");
    }
    return `${basePrompt}\n\n---\n\n${diagnosticPackage}`;
  }

  private async collectWorkspaceDiagnosticPackage(details: ZenTaoBugDetail[]): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const bugIds = details.map((detail) => `#${detail.id}`).join(", ");
    const imageCount = details.reduce((total, detail) => total + (detail.promptImages?.length ?? 0), 0);
    const heading = [
      "【AI诊断包】",
      `Bug 范围：${bugIds || "未提供"}`,
      `本地截图数量：${imageCount}`,
      "目标：请先用本诊断包判断可能影响范围，再改代码；不要只根据 Bug 文本猜测。"
    ];

    if (!workspaceFolder) {
      const contextReview = buildAiContextReview({
        workspaceAttached: false,
        imageCount,
        activeEditorContext: [],
        relevantFiles: [],
        codeEvidence: [],
        verificationCommands: [],
        recentCommits: []
      });
      return `${heading.join("\n")}\n\nAI 上下文质量：\n${formatAiContextReview(contextReview)}\n\n工作区：未打开 VS Code / Cursor 工作区，无法附加仓库上下文。\n\n建议验证：\n- 根据项目实际技术栈运行相关单元测试、构建或冒烟流程。`;
    }

    const cwd = workspaceFolder.uri.fsPath;
    const [branch, status, recentCommits, editorWorkspaceFiles] = await Promise.all([
      this.git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
      this.git(["status", "--short"], cwd),
      this.git(["log", "-5", "--oneline", "--decorate"], cwd),
      this.collectEditorWorkspaceFiles(cwd)
    ]);
    const fallbackWorkspaceFiles = editorWorkspaceFiles.length === 0 || editorWorkspaceFiles.length >= MAX_EDITOR_WORKSPACE_FILES
      ? await this.collectWorkspaceFiles(cwd)
      : "";
    const trackedFiles = uniqueStrings([...editorWorkspaceFiles, ...splitLines(fallbackWorkspaceFiles)]).join("\n");
    const changedFiles = (await this.collectChangedFiles(cwd, status)).slice(0, 24);
    const relevantFiles = rankRelevantFiles(trackedFiles, details, changedFiles).slice(0, 16);
    const codeEvidence = await this.collectCodeEvidence(cwd, [...collectBugSearchTerms(details)].slice(0, 8), relevantFiles);
    const verificationCommands = await this.collectVerificationCommands(cwd);
    const activeEditorContext = this.collectActiveEditorContext(cwd);
    const contextReview = buildAiContextReview({
      workspaceAttached: true,
      imageCount,
      activeEditorContext,
      relevantFiles,
      codeEvidence,
      verificationCommands,
      recentCommits: splitLines(recentCommits)
    });

    return [
      ...heading,
      "",
      "AI 上下文质量：",
      formatAiContextReview(contextReview),
      "",
      "仓库上下文：",
      `- 工作区：${cwd}`,
      `- Git 分支：${oneLine(branch) || "未知"}`,
      `- 文件候选来源：${editorWorkspaceFiles.length ? (fallbackWorkspaceFiles ? "编辑器工作区搜索 + Git/rg 补全" : "编辑器工作区搜索") : "Git/rg 回退搜索"}`,
      "",
      "当前改动文件：",
      formatBulletList(changedFiles, "工作区暂无未提交文件"),
      "",
      "当前编辑器上下文：",
      formatBlockList(activeEditorContext, "未检测到当前工作区内的活动代码文件或选区"),
      "",
      "最近提交：",
      formatBulletList(splitLines(recentCommits).slice(0, 5), "无法读取最近提交"),
      "",
      "疑似相关文件候选：",
      formatBulletList(relevantFiles, "未能从 Bug 文本匹配到候选文件，请先用全文搜索定位模块"),
      "",
      "代码命中证据：",
      formatBulletList(codeEvidence, "未从仓库内容命中 Bug 关键词，建议 AI 先使用全文搜索定位"),
      "",
      "推荐验证命令：",
      formatBulletList(verificationCommands, "未识别到项目验证命令，请根据项目技术栈补充"),
      "",
      "建议验证清单：",
      "- 优先运行与候选文件/模块相关的最小测试。",
      "- 若没有测试，至少运行项目构建或类型检查。",
      "- 修复后说明根因、关键改动、验证命令和剩余风险。",
      "- 如果需要回写禅道备注，请包含根因、改动文件、验证结果和风险说明。"
    ].join("\n");
  }

  private collectActiveEditorContext(cwd: string): string[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      return [];
    }

    const root = path.resolve(cwd);
    const filePath = path.resolve(editor.document.uri.fsPath);
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return [];
    }

    const document = editor.document;
    const lineCount = document.lineCount;
    const hasSelection = !editor.selection.isEmpty;
    const startLine = hasSelection ? editor.selection.start.line : Math.max(0, editor.selection.active.line - 40);
    const endLine = hasSelection
      ? editor.selection.end.line
      : Math.min(lineCount - 1, editor.selection.active.line + 40);
    const cappedEndLine = Math.min(endLine, startLine + 119);
    const snippet = formatDocumentLines(document, startLine, cappedEndLine);
    if (!snippet.trim()) {
      return [];
    }

    const language = document.languageId && document.languageId !== "plaintext" ? document.languageId : languageFromFile(relativePath);
    return [
      `文件：${normalizePathForPrompt(relativePath)}`,
      `${hasSelection ? "选区" : "光标附近"}：第 ${startLine + 1}-${cappedEndLine + 1} 行`,
      `\`\`\`${language}`,
      snippet,
      "```"
    ];
  }

  private async collectCodeEvidence(cwd: string, terms: string[], candidateFiles: string[] = []): Promise<string[]> {
    const evidence: string[] = [];
    for (const term of terms) {
      if (evidence.length >= 20) {
        break;
      }
      if (!isUsefulSearchTerm(term) || commonBugTerms.has(term)) {
        continue;
      }
      const candidateEvidence = await this.collectCandidateCodeEvidence(cwd, term, candidateFiles);
      for (const line of candidateEvidence) {
        evidence.push(line);
        if (evidence.length >= 20) {
          break;
        }
      }
      if (candidateEvidence.length) {
        continue;
      }
      let result = await this.git(["grep", "-n", "-I", "-i", "-e", term, "--", "."], cwd);
      if (!result) {
        result = await this.execText("rg", [
          "--line-number",
          "--ignore-case",
          "--fixed-strings",
          "--glob",
          "!{.git,.svn,Library,Temp,UserSettings,workspace,writable,simulator,obj,Logs,AssetBundles,AssetBundles_Back}/**",
          term
        ], cwd, 8_000);
      }
      for (const line of splitLines(result).slice(0, 4)) {
        const normalized = line.length > 220 ? `${line.slice(0, 217)}...` : line;
        evidence.push(`${term}: ${normalized}`);
        if (evidence.length >= 20) {
          break;
        }
      }
    }
    return uniqueStrings(evidence);
  }

  private async collectCandidateCodeEvidence(cwd: string, term: string, candidateFiles: string[]): Promise<string[]> {
    const evidence: string[] = [];
    const lowerTerm = term.toLocaleLowerCase();
    for (const file of candidateFiles.slice(0, MAX_CANDIDATE_EVIDENCE_FILES)) {
      if (evidence.length >= 4 || !isTextEvidenceFile(file)) {
        continue;
      }
      const absolutePath = path.resolve(cwd, file);
      if (!isPathInside(cwd, absolutePath)) {
        continue;
      }
      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile() || stat.size > MAX_CANDIDATE_EVIDENCE_BYTES) {
          continue;
        }
        const text = await fs.readFile(absolutePath, "utf8");
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length && evidence.length < 4; index++) {
          const line = lines[index];
          if (line.toLocaleLowerCase().includes(lowerTerm)) {
            const normalized = line.trim().length > 180 ? `${line.trim().slice(0, 177)}...` : line.trim();
            evidence.push(`${term}: ${normalizePathForPrompt(file)}:${index + 1}:${normalized}`);
          }
        }
      } catch {
        // Ignore unreadable candidate files.
      }
    }
    return evidence;
  }

  private async collectVerificationCommands(cwd: string): Promise<string[]> {
    const commands: string[] = [];
    const hasFile = async (relativePath: string) => {
      try {
        await fs.access(path.join(cwd, relativePath));
        return true;
      } catch {
        return false;
      }
    };

    if (await hasFile("package.json")) {
      try {
        const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8")) as {
          scripts?: Record<string, string>;
        };
        const scripts = packageJson.scripts ?? {};
        const run = await packageManagerCommand(cwd);
        if (scripts.test) commands.push(run("test"));
        if (scripts.typecheck) commands.push(run("typecheck"));
        if (scripts.check) commands.push(run("check"));
        if (scripts.lint) commands.push(run("lint"));
        if (scripts.build) commands.push(run("build"));
      } catch {
        commands.push("npm test");
      }
    }

    if (await hasFile("build.bat")) commands.push("build.bat");
    if (await hasFile("gradlew.bat")) commands.push("gradlew.bat test");
    if (await hasFile("gradlew")) commands.push("./gradlew test");
    if (await hasFile("pom.xml")) commands.push("mvn test");
    if (await hasFile("go.mod")) commands.push("go test ./...");
    if (await hasFile("Cargo.toml")) commands.push("cargo test");
    if (await hasFile("pyproject.toml") || await hasFile("pytest.ini")) commands.push("pytest");
    if (await hasFile("ProjectSettings/ProjectVersion.txt")) commands.push("Unity Test Runner: EditMode/PlayMode tests");

    try {
      const entries = await fs.readdir(cwd);
      if (entries.some((entry) => entry.toLowerCase().endsWith(".sln"))) {
        commands.push("dotnet test");
      }
    } catch {
      // Ignore unreadable workspace roots.
    }

    return uniqueStrings(commands).slice(0, 8);
  }

  private async git(args: string[], cwd: string): Promise<string> {
    return this.execText("git", args, cwd, 5_000);
  }

  private async execText(command: string, args: string[], cwd: string, timeout = 5_000): Promise<string> {
    try {
      const { stdout } = await execFileAsync(command, args, {
        cwd,
        timeout,
        maxBuffer: 4 * 1024 * 1024
      });
      return String(stdout).trim();
    } catch {
      return "";
    }
  }

  private async collectWorkspaceFiles(cwd: string): Promise<string> {
    const gitFiles = await this.git(["ls-files"], cwd);
    if (splitLines(gitFiles).length) {
      return gitFiles;
    }
    return this.execText("rg", [
      "--files",
      "--hidden",
      "--glob",
      "!{.git,.svn,Library,Temp,UserSettings,workspace,writable,simulator,obj,Logs,AssetBundles,AssetBundles_Back}/**"
    ], cwd, 12_000);
  }

  private async collectEditorWorkspaceFiles(cwd: string): Promise<string[]> {
    const folder = vscode.workspace.workspaceFolders?.find(
      (item) => path.resolve(item.uri.fsPath).toLocaleLowerCase() === path.resolve(cwd).toLocaleLowerCase()
    ) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return [];
    }
    try {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*"),
        EDITOR_WORKSPACE_EXCLUDE_GLOB,
        MAX_EDITOR_WORKSPACE_FILES
      );
      return uniqueStrings(uris
        .map((uri) => normalizePathForPrompt(path.relative(cwd, uri.fsPath)))
        .filter((file) => file && file !== "." && !file.startsWith("..") && !path.isAbsolute(file)));
    } catch {
      return [];
    }
  }

  private async collectChangedFiles(cwd: string, gitStatus: string): Promise<string[]> {
    const gitFiles = parseGitStatusFiles(gitStatus);
    if (gitFiles.length) {
      return gitFiles;
    }
    const svnStatus = await this.execText("svn", ["status"], cwd, 8_000);
    return parseSvnStatusFiles(svnStatus);
  }

  private async buildWorkflowCommentDraft(bugId: string, action: BugWorkflowAction): Promise<string> {
    if (action === "activate") {
      return "重新激活，请继续处理。";
    }
    if (action !== "resolve" && action !== "close") {
      return "";
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return action === "resolve" ? "已修复，请验证。" : "已验证，关闭。";
    }

    const cwd = workspaceFolder.uri.fsPath;
    const [branch, diffNames, shortstat, status, sessionPath, verificationCommands] = await Promise.all([
      this.git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
      this.git(["diff", "--name-only", "HEAD", "--"], cwd),
      this.git(["diff", "--shortstat", "HEAD", "--"], cwd),
      this.git(["status", "--short"], cwd),
      this.findLatestRepairSessionForBug(bugId),
      this.collectVerificationCommands(cwd)
    ]);
    const files = uniqueStrings([
      ...splitLines(diffNames),
      ...parseGitStatusFiles(status)
    ]).slice(0, 8);
    const fileText = files.length ? files.join(", ") : "请补充改动文件";
    const statText = oneLine(shortstat) || (files.length ? `${files.length} 个文件有改动` : "未检测到 Git 改动");
    const actionText = action === "resolve" ? "已修复，请验证" : "已验证，关闭";
    const verificationText = verificationCommands.length ? verificationCommands.slice(0, 3).join(" / ") : "请补充已执行命令/结果";
    const sessionText = sessionPath ? `；AI会话包：${sessionPath}` : "";
    return `【AI修复回写】Bug #${bugId} ${actionText}；分支：${oneLine(branch) || "未知"}；改动文件：${fileText}；变更统计：${statText}；验证建议：${verificationText}；验证结果：请补充已执行命令/结果；风险：请补充剩余风险${sessionText}。`;
  }

  private async findLatestRepairSessionForBug(bugId: string): Promise<string> {
    const candidates: Array<{ file: string; mtimeMs: number }> = [];
    for (const sessionDir of this.repairSessionSearchDirs()) {
      try {
        const entries = await fs.readdir(sessionDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
          }
          const file = path.join(sessionDir, entry.name);
          const safeId = safeFilePart(bugId);
          let matched = entry.name.includes(`bug-${safeId}`) || entry.name.includes(`bugs-${safeId}`);
          if (!matched) {
            const preview = await fs.readFile(file, "utf8").then((value) => value.slice(0, 4096)).catch(() => "");
            matched = preview.includes(`#${bugId}`) || preview.includes(`Bug编号：${bugId}`);
          }
          if (matched) {
            const stat = await fs.stat(file);
            candidates.push({ file, mtimeMs: stat.mtimeMs });
          }
        }
      } catch {
        // ignore missing or unreadable session directories
      }
    }
    return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.file ?? "";
  }

  private async sendPromptForRepair(prompt: string, bugIds: string[]): Promise<vscode.Uri> {
    const sessionUri = await this.writeRepairSessionPackage(prompt, bugIds);
    if (this.repairMode === "cli") {
      await this.sendPromptToCli(prompt, bugIds, sessionUri);
      return sessionUri;
    }
    await sendPromptToAi(prompt, this.aiEngine);
    return sessionUri;
  }

  private async sendPromptToCli(prompt: string, bugIds: string[], promptUri: vscode.Uri): Promise<void> {
    const configuredTemplate = this.config.get<string>("cliCommandTemplate")?.trim();
    const runnerFile = !configuredTemplate && process.platform === "win32"
      ? await this.writeCliRunner()
      : undefined;
    const command = buildCliCommand({
      configuredTemplate,
      engine: this.aiEngine,
      promptFile: promptUri.fsPath,
      bugIds,
      runnerFile
    });
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminalOptions: vscode.TerminalOptions = {
      name: "ZenTao AI Fix CLI",
      cwd
    };
    const terminal = vscode.window.createTerminal(terminalOptions);
    terminal.show();
    terminal.sendText(command, true);
    await vscode.env.clipboard.writeText(prompt);
  }

  private async writeRepairSessionPackage(prompt: string, bugIds: string[]): Promise<vscode.Uri> {
    const promptDir = await this.repairSessionWriteDir();
    await fs.mkdir(promptDir.fsPath, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const idPart = bugIds.length ? bugIds.map(safeFilePart).join("-").slice(0, 80) : "unknown";
    const bugPart = bugIds.length === 1 ? `bug-${safeFilePart(bugIds[0])}` : `bugs-${idPart}`;
    const promptUri = vscode.Uri.joinPath(promptDir, `${timestamp}-${bugPart}-session.md`);
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "未打开工作区";
    const target = this.repairMode === "cli" ? "CLI" : `${this.aiEngine === "cursor" ? "Cursor" : "Claude"} Chat`;
    const content = [
      "# ZenTao AI Repair Session",
      "",
      `- Created: ${new Date().toISOString()}`,
      `- Bugs: ${bugIds.map((id) => `#${id}`).join(", ") || "unknown"}`,
      `- Target: ${target}`,
      `- Engine: ${this.aiEngine}`,
      `- Repair Mode: ${this.repairMode}`,
      `- Workspace: ${workspacePath}`,
      "",
      "---",
      "",
      "## Prompt",
      "",
      prompt
    ].join("\n");
    await fs.writeFile(promptUri.fsPath, content, "utf8");
    return promptUri;
  }

  private workspaceRepairTempRoot(): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder ? vscode.Uri.joinPath(workspaceFolder.uri, "zentao_bug_assistant") : undefined;
  }

  private workspaceRepairSessionDir(): vscode.Uri | undefined {
    const tempRoot = this.workspaceRepairTempRoot();
    return tempRoot ? vscode.Uri.joinPath(tempRoot, "repair-sessions") : undefined;
  }

  private globalRepairSessionDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "repair-sessions");
  }

  private repairSessionSearchDirs(): string[] {
    return uniqueStrings([
      this.workspaceRepairSessionDir()?.fsPath,
      this.globalRepairSessionDir().fsPath
    ].filter((value): value is string => Boolean(value)));
  }

  private async repairSessionWriteDir(): Promise<vscode.Uri> {
    const workspaceDir = this.workspaceRepairSessionDir();
    if (workspaceDir) {
      await this.ensureRepairTempReady();
      return workspaceDir;
    }
    return this.globalRepairSessionDir();
  }

  private async writeCliRunner(): Promise<string> {
    const tempRoot = this.workspaceRepairTempRoot();
    const fileName = this.aiEngine === "cursor" ? "run-cursor-agent.ps1" : "run-claude-agent.ps1";
    const runnerUri = tempRoot
      ? vscode.Uri.joinPath(tempRoot, fileName)
      : vscode.Uri.joinPath(this.context.globalStorageUri, fileName);
    if (tempRoot) {
      await this.ensureRepairTempReady();
    }
    await fs.mkdir(path.dirname(runnerUri.fsPath), { recursive: true });
    const content = this.aiEngine === "cursor" ? cursorAgentRunnerPowerShell() : claudeAgentRunnerPowerShell();
    await fs.writeFile(runnerUri.fsPath, `\uFEFF${content}`, "utf8");
    return runnerUri.fsPath;
  }

  private async ensureRepairTempReady(): Promise<void> {
    const tempRoot = this.workspaceRepairTempRoot();
    if (!tempRoot) {
      return;
    }
    await fs.mkdir(tempRoot.fsPath, { recursive: true });
  }

  private async syncWorkflow(request: BugWorkflowRequest): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      vscode.window.showWarningMessage("请先登录禅道。");
      return;
    }

    await this.run(`正在同步 Bug #${request.bugId} 到禅道...`, async () => {
      await this.withAutoLoginRetry(() => this.client!.updateBugWorkflow(request));
      this.state.status = `Bug #${request.bugId} 已同步到禅道`;
      await this.refresh();
    });
  }

  private async askAndSyncWorkflow(bugId: string): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "解决 Bug", action: "resolve" as const },
        { label: "关闭 Bug", action: "close" as const },
        { label: "指派给别人", action: "assign" as const },
        { label: "暂不同步", action: undefined }
      ],
      { placeHolder: "是否把本次处理结果同步到禅道？" }
    );
    if (!choice?.action) {
      return;
    }

    const request = await this.collectWorkflowRequest(bugId, choice.action);
    if (request) {
      await this.syncWorkflow(request);
    }
  }

  private async previewBug(id: string): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }

    await this.run(`正在加载 Bug #${id} 详情...`, async () => {
      const detail = await this.withAutoLoginRetry(() => this.client!.getBugDetail(id));
      this.showPreview(detail);
    });
  }

  private showPreview(detail: ZenTaoBugDetail): void {
    let panel = this.previewPanel;
    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        "zentaoBugPreview",
        `Bug #${detail.id}`,
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      );
      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "tab-icon.png");
      this.previewPanel = panel;
      panel.onDidDispose(() => {
        if (this.previewPanel === panel) {
          this.previewPanel = undefined;
        }
      });
    }
    panel.title = `Bug #${detail.id}`;
    panel.reveal(vscode.ViewColumn.Beside);
    const previewTitle = detail.description || detail.title || `Bug #${detail.id}`;
    panel.webview.html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bug #${escapeHtml(detail.id)}</title>
  <style>
    :root {
      color-scheme: dark light;
    }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      line-height: 1.65;
      margin: 0;
      padding: 18px;
    }
    .page {
      display: grid;
      gap: 14px;
      margin: 0 auto;
      max-width: 980px;
    }
    .hero,
    .section,
    .history {
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-button-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
    }
    .hero {
      padding: 16px 18px;
    }
    .title-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    h1 {
      font-size: 18px;
      line-height: 1.4;
      margin: 0;
    }
    .bug-id {
      color: var(--vscode-textLink-foreground);
      font-weight: 700;
    }
    .tag {
      border-radius: 999px;
      color: #fff;
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      padding: 1px 8px;
    }
    .status-active { background: #b42318; }
    .status-resolved { background: #1f7a3a; }
    .status-closed { background: #5f6368; }
    .status-unknown { background: #a15c00; }
    .priority { background: #4b647a; }
    .section {
      overflow: hidden;
    }
    .section-title {
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-button-background));
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 13px;
      font-weight: 700;
      padding: 8px 12px;
    }
    .section-body {
      min-height: 28px;
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .section-body img {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      display: block;
      height: auto;
      margin: 8px 0;
      max-width: 100%;
    }
    .video-list {
      display: grid;
      gap: 10px;
    }
    .video-link {
      align-items: center;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      color: var(--vscode-textLink-foreground);
      display: inline-flex;
      font-weight: 700;
      gap: 8px;
      padding: 10px 12px;
      text-decoration: none;
      width: fit-content;
    }
    .video-link::before {
      content: "▶";
      border: 1px solid currentColor;
      border-radius: 999px;
      display: inline-grid;
      height: 26px;
      place-items: center;
      width: 26px;
    }
    .section-body p {
      margin: 0 0 8px;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="title-row">
        <span class="bug-id">#${escapeHtml(detail.id)}</span>
      </div>
      <h1>${escapeHtml(previewTitle)}</h1>
    </section>
    ${previewSection("重现步骤", detail.reproduceStepsHtml, detail.reproduceSteps)}
    ${previewSection("期望", detail.expectedResultHtml, detail.expectedResult)}
    ${videoSection(detail.videos)}
  </main>
</body>
</html>`;
  }

  private async handleMessage(message: {
    type: string;
    id?: string;
    ids?: string[];
    projectId?: string;
    assigneeScope?: BugAssigneeScope;
    assignee?: string;
    bugCategoryFilters?: string[];
    aiEngine?: AiEngine;
    repairMode?: AiRepairMode;
    autoLoginEnabled?: boolean;
    serverUrl?: string;
    loginAccount?: string;
    account?: string;
    password?: string;
    action?: BugWorkflowAction;
  }): Promise<void> {
    if (message.type === "login") {
      if (message.serverUrl !== undefined) {
        await this.updateServerUrl(message.serverUrl);
      }
      if (message.account !== undefined) {
        this.state.loginAccount = message.account.trim();
        await this.context.secrets.store("zentao.account", this.state.loginAccount);
      }
      if (message.autoLoginEnabled !== undefined) {
        this.state.autoLoginEnabled = Boolean(message.autoLoginEnabled);
        await this.config.update("autoLogin", this.state.autoLoginEnabled, vscode.ConfigurationTarget.Global);
      }
      await this.login({ account: message.account, password: message.password });
    }
    if (message.type === "refresh") {
      await this.refresh();
    }
    if (message.type === "clearImageCache") {
      await this.clearImageCache();
    }
    if (message.type === "select") {
      this.state.selectedIds = message.ids ?? [];
      this.postState();
    }
    if (message.type === "selectProject") {
      this.state.selectedProjectId = message.projectId || undefined;
      this.state.bugs = [];
      this.state.selectedIds = [];
      this.state.assignee = undefined;
      this.applyMembersCacheForProject(this.state.selectedProjectId);
      await this.savePreferences();
      if (!(await this.ensureAuthenticated())) {
        this.postState();
        return;
      }
      await this.run("正在切换项目...", async () => {
        this.updateStatus("正在加载成员列表...");
        await this.loadMembers(false);
        this.updateStatus(`成员列表已加载：${this.state.members.length} 个成员，正在刷新 Bug 列表...`);
        await this.fetchBugList();
      });
    }
    if (message.type === "refreshProjects") {
      await this.refreshProjects();
    }
    if (message.type === "refreshMembers") {
      await this.refreshMembers();
    }
    if (message.type === "setAssigneeScope") {
      this.state.assigneeScope = normalizeAssigneeScope(message.assigneeScope);
      this.state.assignee = message.assignee;
      if (this.state.assigneeScope === "member") {
        await this.loadMembers(false);
      }
      await this.savePreferences();
      this.postState();
    }
    if (message.type === "setBugCategoryFilters") {
      this.state.bugCategoryFilters = normalizeBugCategoryFilters(message.bugCategoryFilters);
      await this.savePreferences();
      this.postState();
    }
    if (message.type === "setAutoLogin") {
      this.state.autoLoginEnabled = Boolean(message.autoLoginEnabled);
      await this.config.update("autoLogin", this.state.autoLoginEnabled, vscode.ConfigurationTarget.Global);
      this.postState();
    }
    if (message.type === "setServerUrl") {
      await this.updateServerUrl(message.serverUrl ?? "");
    }
    if (message.type === "setLoginAccount") {
      this.state.loginAccount = message.loginAccount?.trim() ?? "";
      await this.context.secrets.store("zentao.account", this.state.loginAccount);
      this.postState();
    }
    if (message.type === "setAiEngine") {
      this.state.aiEngine = normalizeAiEngine(message.aiEngine);
      await this.config.update("aiEngine", this.state.aiEngine, vscode.ConfigurationTarget.Global);
      this.postState();
    }
    if (message.type === "setRepairMode") {
      this.state.repairMode = normalizeRepairMode(message.repairMode);
      await this.config.update("repairMode", this.state.repairMode, vscode.ConfigurationTarget.Global);
      this.postState();
    }
    if (message.type === "preview" && message.id) {
      await this.previewBug(message.id);
    }
    if (message.type === "fix" && message.id) {
      await this.fixSelected([message.id]);
    }
    if (message.type === "fixSelected") {
      await this.fixSelected(message.ids);
    }
    if (message.type === "copyProjectDebugInfo") {
      await this.copyProjectDebugInfo();
    }
    if (message.type === "workflow" && message.id && message.action) {
      const request = await this.collectWorkflowRequest(message.id, message.action);
      if (request) {
        await this.syncWorkflow(request);
      }
    }
  }

  private async collectWorkflowRequest(
    bugId: string,
    action: BugWorkflowAction
  ): Promise<BugWorkflowRequest | undefined> {
    if (action === "assign") {
      await this.ensureMembersReadyForAssign();
      const assignedTo = await this.pickAssigneeAccount();
      if (!assignedTo) {
        return undefined;
      }
      const comment = await vscode.window.showInputBox({
        prompt: "填写指派备注/修改日志",
        ignoreFocusOut: true
      });
      if (comment === undefined) {
        return undefined;
      }
      return { bugId, action, assignedTo, comment, members: this.state.members };
    }

    const defaultComment = await this.buildWorkflowCommentDraft(bugId, action);
    const comment = await vscode.window.showInputBox({
      prompt: "填写操作备注/修改日志",
      value: defaultComment,
      ignoreFocusOut: true
    });
    if (comment === undefined) {
      return undefined;
    }

    if (action === "resolve") {
      const solution = await vscode.window.showQuickPick(
        [
          { label: "设计如此", value: "byDesign" as const },
          { label: "重复 Bug", value: "duplicate" as const },
          { label: "外部原因", value: "external" as const },
          { label: "已解决", value: "fixed" as const },
          { label: "无法重现", value: "notReproducible" as const },
          { label: "延期处理", value: "postponed" as const },
          { label: "不予解决", value: "willNotFix" as const }
        ],
        { placeHolder: "选择解决方案" }
      );
      if (!solution) {
        return undefined;
      }
      return { bugId, action, solution: solution.value, comment };
    }

    return { bugId, action, comment };
  }

  private async ensureMembersReadyForAssign(): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }
    await this.loadMembers(false);
    if (!this.state.members.length) {
      await this.loadMembers(true);
    }
  }

  private async pickAssigneeAccount(): Promise<string | undefined> {
    const members = this.state.members ?? [];
    if (!members.length) {
      return vscode.window.showInputBox({
        prompt: "指派给哪个禅道账号？",
        ignoreFocusOut: true
      });
    }
    const picks: Array<vscode.QuickPickItem & { account?: string; manual?: boolean }> = members.map((member) => ({
      label: member.name || member.account,
      description: member.account,
      account: member.account
    }));
    picks.unshift({
      label: "$(edit) 手动输入账号",
      description: "不在列表中时使用",
      manual: true
    });
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: "选择指派成员（或手动输入）",
      ignoreFocusOut: true
    });
    if (!selected) {
      return undefined;
    }
    if (selected.manual) {
      return vscode.window.showInputBox({
        prompt: "请输入要指派的禅道账号",
        ignoreFocusOut: true
      });
    }
    return selected.account;
  }

  private async run(status: string, action: () => Promise<void>): Promise<void> {
    try {
      this.state.loading = true;
      this.state.status = status;
      this.postState();
      await action();
    } catch (error) {
      const message = describeErrorChain(error);
      this.state.status = "失败：操作未完成，请查看弹窗详情";
      if (!this.context.globalState.get<boolean>(ZenTaoBugAssistantViewProvider.suppressErrorPopupKey, false)) {
        const brief = briefErrorMessage(message);
        const choice = await vscode.window.showErrorMessage(
          `禅道助手操作失败：${brief}`,
          "查看详情",
          "不再弹出"
        );
        if (choice === "查看详情") {
          await vscode.window.showErrorMessage(`禅道助手详细错误：${formatErrorDetail(message)}`, { modal: true });
        } else if (choice === "不再弹出") {
          await this.context.globalState.update(ZenTaoBugAssistantViewProvider.suppressErrorPopupKey, true);
          vscode.window.showInformationMessage("已关闭失败弹窗提示，可在命令面板执行“ZenTao: 启用失败弹窗”恢复。");
        }
      }
    } finally {
      this.state.loading = false;
      this.postState();
    }
  }

  private updateStatus(status: string): void {
    this.state.status = status;
    this.postState();
  }

  private async restoreClient(): Promise<void> {
    if (this.client) {
      return;
    }

    const value = await this.context.secrets.get("zentao.session");
    if (!value) {
      return;
    }
    const session = JSON.parse(value) as ZenTaoSession;
    this.client = new ZenTaoClient({ baseUrl: this.serverUrl, session });
    this.state.loggedIn = false;
    this.state.account = session.account;
    this.state.status = `正在验证禅道会话：${session.account}`;
  }

  private async ensureAuthenticated(): Promise<boolean> {
    await this.restoreClient();
    if (this.client) {
      try {
        if (await this.client.isSessionValid()) {
          this.state.loggedIn = true;
          this.state.account = this.client.currentSession?.account ?? this.state.account;
          this.state.status = `已登录：${this.state.account}`;
          this.startSessionKeepAlive("validated-session");
          return true;
        }
      } catch (error) {
      }
      await this.clearSessionState();
    }

    return this.autoLoginFromSavedCredentials("session-invalid-or-missing");
  }

  private async autoLoginFromSavedCredentials(reason: string): Promise<boolean> {
    const account = await this.context.secrets.get("zentao.account");
    const password = await this.context.secrets.get("zentao.password");
    if (!account || !password) {
      return false;
    }

    try {
      const client = new ZenTaoClient({ baseUrl: this.serverUrl });
      const session = await client.login({ account, password });
      this.client = client;
      this.state.loggedIn = true;
      this.state.account = session.account;
      this.state.status = `已自动登录：${session.account}`;
      await this.context.secrets.store("zentao.session", JSON.stringify(session));
      this.startSessionKeepAlive(`auto-login:${reason}`);
      return true;
    } catch (error) {
      this.client = undefined;
      await this.clearSessionState();
      this.stopSessionKeepAlive();
      return false;
    }
  }

  private async clearSessionState(): Promise<void> {
    this.client = undefined;
    this.state.loggedIn = false;
    this.state.account = undefined;
    await this.context.secrets.delete("zentao.session");
  }

  private startSessionKeepAlive(reason: string): void {
    this.stopSessionKeepAlive();
    const intervalMs = Math.max(1, this.keepAliveIntervalMinutes) * 60_000;
    void this.runSessionKeepAlive(`start:${reason}`);
    this.keepAliveTimer = setInterval(() => {
      void this.runSessionKeepAlive("interval");
    }, intervalMs);
  }

  private stopSessionKeepAlive(): void {
    if (!this.keepAliveTimer) {
      return;
    }
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
  }

  private async runSessionKeepAlive(reason: string): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      const valid = await this.client.isSessionValid();
      if (!valid) {
        await this.autoLoginFromSavedCredentials(`keepalive:${reason}`);
      }
    } catch (error) {
    }
  }

  private async withAutoLoginRetry<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof LoginExpiredError)) {
        throw error;
      }
      if (!(await this.autoLoginFromSavedCredentials("operation-login-expired"))) {
        throw error;
      }
      return action();
    }
  }

  private async restoreLoginFields(): Promise<void> {
    this.state.loginAccount = (await this.context.secrets.get("zentao.account")) ?? "";
    const savedPassword = await this.context.secrets.get("zentao.password");
    this.state.hasSavedPassword = Boolean(savedPassword);
    this.postState();
  }

  private async enforcePasswordPreference(): Promise<void> {
    if (this.config.get<boolean>("rememberPassword") ?? false) {
      return;
    }
    await this.context.secrets.delete("zentao.password");
    this.state.hasSavedPassword = false;
  }

  private async resolveLoginPassword(inputPassword: string): Promise<string | undefined> {
    const trimmed = inputPassword.trim();
    if (!trimmed || trimmed === ZenTaoBugAssistantViewProvider.savedPasswordMask) {
      return (await this.context.secrets.get("zentao.password")) ?? undefined;
    }
    return trimmed;
  }

  private restorePreferences(): void {
    this.state.selectedProjectId = this.context.globalState.get<string>("zentao.selectedProjectId");
    this.state.projects = normalizeProjects(this.context.globalState.get<ZenTaoProject[]>("zentao.projects"));
    this.reconcileSelectedProject();
    this.state.assigneeScope = "all";
    this.state.assignee = undefined;
    this.state.teamMembers = this.config.get<string[]>("teamMembers") ?? [];
    this.membersByProject = normalizeMembersByProject(this.context.globalState.get<Record<string, ZenTaoMember[]>>("zentao.membersByProject"));
    const legacyMembers = normalizeMembers(this.context.globalState.get<ZenTaoMember[]>("zentao.members"));
    const legacyProjectId = this.context.globalState.get<string>("zentao.membersProjectId");
    if (legacyMembers.length) {
      const legacyKey = projectCacheKey(legacyProjectId || this.state.selectedProjectId);
      if (!this.membersByProject[legacyKey]?.length) {
        this.membersByProject[legacyKey] = legacyMembers;
      }
    }
    this.applyMembersCacheForProject(this.state.selectedProjectId);
    this.state.bugCategoryFilters = normalizeBugCategoryFilters(this.context.globalState.get<string[]>("zentao.bugCategoryFilters"), true);
    this.state.aiEngine = normalizeAiEngine(this.config.get<AiEngine>("aiEngine"));
    this.state.repairMode = normalizeRepairMode(this.config.get<AiRepairMode>("repairMode"));
    this.state.autoLoginEnabled = this.config.get<boolean>("autoLogin") ?? true;
    this.state.serverUrl = this.config.get<string>("serverUrl") ?? "";
    if (!this.state.serverUrl.trim() || resolveServerUrl(this.state.serverUrl) === DEFAULT_ZENTAO_SERVER_URL) {
      this.state.serverUrl = DEFAULT_ZENTAO_SERVER_URL;
    }
  }

  private async updateServerUrl(raw: string): Promise<void> {
    const trimmed = raw.trim();
    const previousResolved = this.serverUrl;
    await this.config.update("serverUrl", trimmed, vscode.ConfigurationTarget.Global);
    this.state.serverUrl = trimmed;
    const nextResolved = this.serverUrl;
    if (previousResolved !== nextResolved) {
      this.client = undefined;
      await this.clearSessionState();
      this.state.bugs = [];
      this.state.selectedIds = [];
      this.state.projects = [];
      this.state.members = [];
      this.membersByProject = {};
      this.membersLoadedForProjectId = undefined;
    }
    this.state.status = `禅道地址：${nextResolved}`;
    this.postState();
  }

  private async savePreferences(): Promise<void> {
    const cacheKey = projectCacheKey(this.membersLoadedForProjectId ?? this.state.selectedProjectId);
    if (this.state.members.length) {
      this.membersByProject[cacheKey] = this.state.members;
    }
    await this.context.globalState.update("zentao.selectedProjectId", this.state.selectedProjectId);
    await this.context.globalState.update("zentao.projects", this.state.projects);
    await this.context.globalState.update("zentao.membersByProject", this.membersByProject);
    await this.context.globalState.update("zentao.assigneeScope", undefined);
    await this.context.globalState.update("zentao.assignee", undefined);
    await this.context.globalState.update("zentao.bugCategoryFilters", persistedBugCategoryFilters(this.state.bugCategoryFilters));
  }

  private postState(): void {
    this.view?.webview.postMessage({
      type: "state",
      state: {
        ...this.state,
        serverUrl: resolveServerUrl(this.state.serverUrl || this.config.get<string>("serverUrl"))
      }
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css"));
    const headerLogoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "header-logo.png"));
    const defaultServerUrl = escapeHtml(DEFAULT_ZENTAO_SERVER_URL);
    const nonce = String(Date.now());

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>禅道 Bug 修复助手</title>
</head>
<body>
  <header>
    <img class="header-logo" src="${headerLogoUri}" alt="云禅道" />
    <label class="field-row">禅道地址
      <input id="serverUrl" type="url" value="${defaultServerUrl}" placeholder="${defaultServerUrl}" />
    </label>
    <div class="credential-row">
      <span class="credential-label">禅道账号</span>
      <input id="account" class="credential-input" type="text" autocomplete="username" />
      <span class="credential-label">禅道密码</span>
      <input id="password" class="credential-input" type="password" autocomplete="current-password" />
    </div>
    <div class="login-row">
      <label class="auto-login" hidden>
        <input id="autoLogin" type="checkbox" />
        <span>自动登录</span>
      </label>
      <button id="login">登录</button>
      <div id="loginState" class="login-state logged-in" hidden>已登录</div>
    </div>
  </header>
  <section class="filters">
    <div class="filter-field-row">
      <span class="filter-label">项目</span>
      <div class="project-row">
        <select id="project"></select>
        <button id="refreshProjects" title="重新抓取项目列表">刷新</button>
      </div>
    </div>
    <div class="filter-field-row">
      <span class="filter-label">成员</span>
      <div class="member-row">
        <div class="member-picker">
          <input id="assignee" type="text" placeholder="留空显示全部成员" autocomplete="off" />
          <button id="memberDropdownToggle" type="button" class="member-dropdown-toggle" title="展开成员列表" aria-label="展开成员列表" aria-expanded="false" aria-controls="memberDropdown"></button>
          <div id="memberDropdown" class="member-dropdown" hidden></div>
        </div>
        <button id="refreshMembers" title="重新抓取成员列表">刷新</button>
      </div>
    </div>
  </section>
  <section id="status">就绪</section>
  <section id="bugCategoryFilters" class="bug-category-filters" aria-label="Bug 分类"></section>
  <section class="bug-bar">
    <div class="bug-actions">
      <button id="refresh">刷新</button>
      <div class="ai-fix-group">
        <button id="fixSelected" class="ai-fix-button">AI一键修复</button>
        <button id="clearImageCache" title="清理本地缓存图片">清理缓存</button>
        <select id="aiEngine" title="选择修复使用的 AI">
          <option value="cursor">Cursor</option>
          <option value="claudeCode">Claude</option>
        </select>
        <select id="repairMode" title="选择 AI 修复方式">
          <option value="chat">Chat</option>
          <option value="cli">CLI</option>
        </select>
      </div>
    </div>
  </section>
  <main id="bugs"></main>
  <nav id="pagination" class="pagination" aria-label="Bug 分页"></nav>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("zentaoBugAssistant");
  }

  private get serverUrl(): string {
    return resolveServerUrl(this.state.serverUrl || this.config.get<string>("serverUrl"));
  }

  private get aiEngine(): AiEngine {
    return this.state.aiEngine;
  }

  private get repairMode(): AiRepairMode {
    return this.state.repairMode;
  }

  private get keepAliveIntervalMinutes(): number {
    return this.config.get<number>("sessionKeepAliveIntervalMinutes") ?? 5;
  }
}

function briefErrorMessage(value: string): string {
  const text = formatErrorDetail(value).replace(/\s+/g, " ").trim();
  if (!text) {
    return "未知错误";
  }
  const shortened = text
    .replace(/响应摘要：.*$/i, "")
    .trim();
  if (shortened.length <= 120) {
    return shortened;
  }
  return `${shortened.slice(0, 117)}...`;
}

function formatErrorDetail(value: string): string {
  const alertMatch = value.match(/alert\s*\(\s*['"]([^'"]+)['"]/i);
  if (alertMatch?.[1]) {
    return alertMatch[1].replace(/\\n/g, "\n").trim();
  }
  const cleaned = (value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "未知错误";
  }
  return cleaned.length > 800 ? `${cleaned.slice(0, 797)}...` : cleaned;
}

function buildCliFastExecutionProtocol(): string {
  return [
    "【CLI快速修复协议】",
    "你正在 Cursor Agent CLI/headless 模式中修复禅道 Bug。CLI 比聊天窗口更容易过度搜索，所以必须按以下策略执行：",
    "1. 先阅读本文件里的【AI诊断包】，优先使用“疑似相关文件候选”“代码命中证据”“当前编辑器上下文”和本地截图路径。",
    "2. 首轮定位最多读取 6 个候选文件，最多追加 8 次 grep/glob；不要先做全仓库泛搜索。",
    "3. 不要重复搜索同一组关键词；不要搜索 button/page/bug/error/null/http/image/video 等泛词。",
    "4. 如果诊断包已经给出足够候选文件，直接在这些文件里做最小修复，不要继续扩大搜索范围。",
    "5. 只有候选文件全部无法解释 Bug 时，才追加小范围搜索，并在输出里说明为什么需要扩大范围。",
    "6. 目标是快速完成最小可信修复：定位根因、改最少文件、给出验证方式和剩余风险。"
  ].join("\n");
}

async function sendPromptToAi(prompt: string, engine: AiEngine): Promise<void> {
  await vscode.env.clipboard.writeText(prompt);

  const allCommands = await vscode.commands.getCommands(true);

  if (engine === "claudeCode") {
    // claude-vscode.editor.open(sessionId, initialPrompt, viewColumn) — second arg is the prompt
    // auto-submitted when the panel opens (data-initial-prompt mechanism in the extension webview)
    const claudeOpenCmd = ["claude-vscode.editor.open", "claude-vscode.primaryEditor.open"].find((c) => allCommands.includes(c));
    if (claudeOpenCmd) {
      try {
        await vscode.commands.executeCommand(claudeOpenCmd, undefined, prompt);
        return;
      } catch {
        // fall through to clipboard fallback
      }
    }
    vscode.window.showInformationMessage("未找到 Claude 扩展，修复提示词已复制到剪贴板，请手动粘贴。");
    return;
  }

  const cursorCandidates = ["cursor.openChat", "workbench.action.chat.open", "workbench.action.chat.openEditSession"];
  const command = cursorCandidates.find((c) => allCommands.includes(c));
  if (command) {
    const result = await executeCursorCommand(command, prompt);
    if (result === "failed") {
      vscode.window.showInformationMessage("AI 面板打开失败，修复提示词已复制到剪贴板。");
    } else if (result === "opened-with-clipboard") {
      vscode.window.showInformationMessage("AI 面板已打开，修复提示词已复制到剪贴板。");
    }
    return;
  }

  vscode.window.showInformationMessage("修复提示词已复制到剪贴板，请粘贴到 Cursor 或 Claude。");
}

async function executeCursorCommand(command: string, prompt: string): Promise<"sent-with-query" | "sent-with-prompt" | "sent-as-string" | "opened-with-clipboard" | "failed"> {
  const argumentShapes = [
    { args: { query: prompt, isPartialQuery: false }, result: "sent-with-query" as const },
    { args: { prompt }, result: "sent-with-prompt" as const },
    { args: prompt, result: "sent-as-string" as const },
    { args: undefined, result: "opened-with-clipboard" as const }
  ];
  for (const { args, result } of argumentShapes) {
    try {
      if (args === undefined) {
        await vscode.commands.executeCommand(command);
      } else {
        await vscode.commands.executeCommand(command, args);
      }
      return result;
    } catch {
      // try next argument shape
    }
  }
  return "failed";
}

interface CliCommandOptions {
  configuredTemplate?: string;
  engine: AiEngine;
  promptFile: string;
  bugIds: string[];
  runnerFile?: string;
}

interface AiContextReviewInput {
  workspaceAttached: boolean;
  imageCount: number;
  activeEditorContext: string[];
  relevantFiles: string[];
  codeEvidence: string[];
  verificationCommands: string[];
  recentCommits: string[];
}

interface AiContextReview {
  score: number;
  label: string;
  signals: string[];
  gaps: string[];
}

function buildCliCommand(options: CliCommandOptions): string {
  const template = options.configuredTemplate?.trim();
  if (!template) {
    return defaultCliCommand(options);
  }
  return template
    .replaceAll("{promptFileRaw}", options.promptFile)
    .replaceAll("{promptFile}", shellQuote(options.promptFile))
    .replaceAll("{bugIds}", shellQuote(options.bugIds.join(",")))
    .replaceAll("{engine}", options.engine);
}

function defaultCliCommand(options: CliCommandOptions): string {
  if (process.platform === "win32") {
    if (options.runnerFile) {
      return `powershell -NoProfile -ExecutionPolicy Bypass -File ${shellQuote(options.runnerFile)} -PromptFile ${shellQuote(options.promptFile)}`;
    }
    return options.engine === "cursor"
      ? `powershell -NoProfile -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand ${encodePowerShellCommand(buildCursorAgentPowerShell(options.promptFile))}`
      : `powershell -NoProfile -ExecutionPolicy Bypass -Command "$__ztPrompt = [string](Get-Content -Raw -LiteralPath ${shellQuote(options.promptFile)}); claude -p --verbose --output-format stream-json --include-partial-messages $__ztPrompt"`;
  }
  return options.engine === "cursor"
    ? `__zt_prompt_file=${shellQuote(options.promptFile)}; cursor-agent -p --trust --workspace "$PWD" "Read this exact UTF-8 Markdown file and execute the ZenTao bug-fix task described in it. File: $__zt_prompt_file. If this exact file cannot be read, print CANNOT_READ and stop; do not use any other repair-session file." || { echo 'Cursor Agent failed; retrying once...' >&2; sleep 2; cursor-agent -p --trust --workspace "$PWD" "Read this exact UTF-8 Markdown file and execute the ZenTao bug-fix task described in it. File: $__zt_prompt_file. If this exact file cannot be read, print CANNOT_READ and stop; do not use any other repair-session file."; }`
    : `claude -p --verbose --output-format stream-json --include-partial-messages < ${shellQuote(options.promptFile)}`;
}

function buildCursorAgentPowerShell(promptFile: string): string {
  const promptPath = quotePowerShellString(promptFile);
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    `$__ztPromptFile = ${promptPath}`,
    "$__ztWorkspace = (Get-Location).Path",
    '$__ztInstruction = "Read this exact UTF-8 Markdown file and execute the ZenTao bug-fix task described in it. File: $__ztPromptFile. If this exact file cannot be read, print CANNOT_READ and stop; do not use any other repair-session file."',
    "cursor-agent -p --trust --workspace $__ztWorkspace $__ztInstruction",
    "if ($LASTEXITCODE -ne 0) {",
    "  Write-Host 'Cursor Agent failed; retrying once...' -ForegroundColor Yellow",
    "  Start-Sleep -Seconds 2",
    "  cursor-agent -p --trust --workspace $__ztWorkspace $__ztInstruction",
    "}"
  ].join("; ");
}

function cursorAgentRunnerPowerShell(): string {
  return [
    "param(",
    "  [Parameter(Mandatory=$true)]",
    "  [string]$PromptFile",
    ")",
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $__ztUtf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false",
    "  [Console]::InputEncoding = $__ztUtf8",
    "  [Console]::OutputEncoding = $__ztUtf8",
    "  $OutputEncoding = $__ztUtf8",
    "  chcp 65001 > $null 2>$null",
    "} catch {",
    "  # Keep going even if the host refuses encoding changes.",
    "}",
    "$__ztPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path",
    "$__ztWorkspace = (Get-Location).Path",
    '$__ztInstruction = "Read this exact UTF-8 Markdown file and execute the ZenTao bug-fix task described in it. File: $__ztPromptFile. If this exact file cannot be read, print CANNOT_READ and stop; do not use any other repair-session file."',
    "function Invoke-ZenTaoCursorAgent {",
    "  param([string]$Instruction)",
    "  $state = @{ printed = $false; openLine = $false; busyLine = $false; busyFlag = ''; busyProcess = $null; lastText = ''; streamedText = ''; toolTotal = 0; toolStarted = 0; toolCounts = @{}; toolSeen = @{} }",
    "  function Clear-BusyLine {",
    "    if (-not $state.busyLine) { return }",
    "    if ($state.busyFlag) { Remove-Item -LiteralPath $state.busyFlag -Force -ErrorAction SilentlyContinue }",
    "    if ($state.busyProcess) {",
    "      try {",
    "        [void]$state.busyProcess.WaitForExit(1000)",
    "        if (-not $state.busyProcess.HasExited) { $state.busyProcess.Kill() }",
    "      } catch {}",
    "      $state.busyProcess = $null",
    "    }",
    "    $state.busyFlag = ''",
    "    $width = 120",
    "    try { $width = [Math]::Max(80, [Console]::BufferWidth - 1) } catch {}",
    "    [Console]::Write([char]13 + (' ' * $width) + [char]13)",
    "    $state.busyLine = $false",
    "  }",
    "  function Show-BusyLine {",
    "    param([string]$Text = 'AI working')",
    "    if ($state.openLine -or $state.busyLine) { return }",
    "    $state.busyLine = $true",
    "    $state.busyFlag = [System.IO.Path]::GetTempFileName()",
    "    $safeFlag = $state.busyFlag.Replace(\"'\", \"''\")",
    "    $safeText = $Text.Replace(\"'\", \"''\")",
    "    $script = \"`$ProgressPreference='SilentlyContinue'; `$flag='$safeFlag'; `$text='$safeText'; `$start=Get-Date; `$i=0; while(Test-Path -LiteralPath `$flag){ `$elapsed=[int]((Get-Date)-`$start).TotalSeconds; `$dots='.' * ((`$i % 3)+1); [Console]::Write(([char]13 + ('{0} {1}s {2}   ' -f `$text, `$elapsed, `$dots))); Start-Sleep -Milliseconds 220; `$i++ }; try { `$width=[Math]::Max(80,[Console]::BufferWidth-1) } catch { `$width=120 }; [Console]::Write(([char]13 + (' ' * `$width) + [char]13))\"",
    "    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))",
    "    try {",
    "      $state.busyProcess = Start-Process powershell -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-OutputFormat','Text','-EncodedCommand',$encoded) -NoNewWindow -PassThru",
    "    } catch {",
    "      [Console]::Write($Text + ' ... ')",
    "    }",
    "  }",
    "  function Format-ToolCounts {",
    "    $items = @()",
    "    foreach ($key in $state.toolCounts.Keys) { $items += ($key + '=' + $state.toolCounts[$key]) }",
    "    if ($items.Count -eq 0) { return '' }",
    "    return ($items | Sort-Object) -join ', '",
    "  }",
    "  function Shorten-Text {",
    "    param([string]$Value, [int]$Max = 120)",
    "    if (-not $Value) { return '' }",
    "    $text = ($Value -replace '\\s+', ' ').Trim()",
    "    if ($text.Length -le $Max) { return $text }",
    "    return $text.Substring(0, $Max - 3) + '...'",
    "  }",
    "  function Shorten-Path {",
    "    param([string]$Value)",
    "    if (-not $Value) { return '' }",
    "    $path = $Value",
    "    if ($path.StartsWith($__ztWorkspace, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "      $path = $path.Substring($__ztWorkspace.Length).TrimStart('\\', '/')",
    "    }",
    "    return Shorten-Text $path 140",
    "  }",
    "  function Tool-Summary {",
    "    param($ToolCall, [string]$RawName)",
    "    $name = $RawName",
    "    if ($name.EndsWith('ToolCall')) { $name = $name.Substring(0, $name.Length - 8) }",
    "    $args = $ToolCall.args",
    "    $pattern = ''",
    "    if ($args -and $args.PSObject.Properties.Name -contains 'pattern') { $pattern = [string]$args.pattern }",
    "    if (-not $pattern -and $args -and $args.PSObject.Properties.Name -contains 'query') { $pattern = [string]$args.query }",
    "    if (-not $pattern -and $args -and $args.PSObject.Properties.Name -contains 'regex') { $pattern = [string]$args.regex }",
    "    if (-not $pattern -and $args -and $args.PSObject.Properties.Name -contains 'glob') { $pattern = [string]$args.glob }",
    "    $command = ''",
    "    if ($args -and $args.PSObject.Properties.Name -contains 'command') { $command = [string]$args.command }",
    "    if (-not $command -and $args -and $args.PSObject.Properties.Name -contains 'cmd') { $command = [string]$args.cmd }",
    "    if ($name -eq 'read') { return 'Read ' + (Shorten-Path ([string]$args.path)) }",
    "    if ($name -eq 'grep') { return 'Grepped ' + (Shorten-Text $pattern 120) }",
    "    if ($name -eq 'glob') { return 'Searched files ' + (Shorten-Text $pattern 120) }",
    "    if ($name -eq 'edit' -or $name -eq 'write') { return ($name.Substring(0,1).ToUpper() + $name.Substring(1)) + ' ' + (Shorten-Path ([string]$args.path)) }",
    "    if ($name -eq 'shell' -or $name -eq 'run') { return 'Ran ' + (Shorten-Text $command 120) }",
    "    return ($name.Substring(0,1).ToUpper() + $name.Substring(1))",
    "  }",
    "  function Read-CursorAgentError {",
    "    param([string]$Path)",
    "    $err = ''",
    "    try { $err = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).Trim() } catch {}",
    "    if (-not $err) { return @() }",
    "    $items = New-Object System.Collections.ArrayList",
    "    foreach ($raw in @($err -split '\\r?\\n')) {",
    "      $line = ([string]$raw).Trim()",
    "      if (-not $line) { continue }",
    "      $line = $line -replace '^.*cursor-agent\\.ps1\\s*:\\s*', ''",
    "      $line = $line -replace '^node\\.exe\\s*:\\s*', ''",
    "      if ($line -match '^\\s*\\+ ' -or $line -match '^\\s*~' -or $line -match '^\\s*CategoryInfo' -or $line -match '^\\s*FullyQualifiedErrorId') { continue }",
    "      if ($line -match 'cursor-agent\\.ps1:\\d+' -or $line -match 'run-cursor-agent\\.ps1:\\d+' -or $line -match '^\\s*At line:' -or $line -match '^\\s*At .*\\.ps1:\\d+') { continue }",
    "      if ($line -match '^\\s*\\&\\s*\"\\$nodePath\"' -or $line -match '^\\s*NativeCommandError') { continue }",
    "      if ($line -match '\\$nodePath' -or $line -match '\\$scriptPath' -or $line -match '\\$versionName' -or $line -match '\\$args' -or $line -match 'scriptPath\\\\versions' -or $line -match 'index\\.js') { continue }",
    "      if ($line -match 'NotSpecified:' -or $line -match 'RemoteException' -or $line -match 'CategoryInfo' -or $line -match 'FullyQualifiedErrorId' -or $line -match 'NativeCommandError' -or $line -match 'edErrorId') { continue }",
    "      if ($line -match '^\\s*:') { continue }",
    "      if ($line -eq 'Error:') { continue }",
    "      if (-not $items.Contains($line)) { [void]$items.Add($line) }",
    "      if ($items.Count -ge 6) { break }",
    "    }",
    "    return @($items)",
    "  }",
    "  $__ztErrFile = [System.IO.Path]::GetTempFileName()",
    "  try {",
    "  $__ztOldErrorActionPreference = $ErrorActionPreference",
    "  $ErrorActionPreference = 'Continue'",
    "  try {",
    "  cursor-agent -p --trust --workspace $__ztWorkspace --output-format stream-json --stream-partial-output $Instruction 2> $__ztErrFile | ForEach-Object {",
    "    $line = [string]$_",
    "    try {",
    "      $event = $line | ConvertFrom-Json -ErrorAction Stop",
    "      if ($event.type -eq 'system' -and $event.subtype -eq 'init') {",
    "        Clear-BusyLine",
    "        Write-Host ('[Cursor Agent] model=' + $event.model + ' workspace=' + $event.cwd) -ForegroundColor DarkGray",
    "        Show-BusyLine 'AI starting'",
    "      } elseif ($event.type -eq 'tool_call') {",
    "        $toolName = ''",
    "        if ($event.tool_call) { $toolName = @($event.tool_call.PSObject.Properties.Name)[0] }",
    "        if (-not $toolName) { $toolName = 'tool' }",
    "        $toolCall = $null",
    "        if ($event.tool_call -and $event.tool_call.PSObject.Properties[$toolName]) { $toolCall = $event.tool_call.PSObject.Properties[$toolName].Value }",
    "        $displayName = $toolName",
    "        if ($displayName.EndsWith('ToolCall')) { $displayName = $displayName.Substring(0, $displayName.Length - 8) }",
    "        if ($event.subtype -eq 'started') {",
    "          $callId = [string]$event.call_id",
    "          if (-not $callId) { $callId = $toolName + ':' + $state.toolStarted }",
    "          if (-not $state.toolSeen.ContainsKey($callId)) {",
    "            $state.toolSeen[$callId] = $true",
    "            $state.toolStarted = [int]$state.toolStarted + 1",
    "            Clear-BusyLine",
    "            if ($state.openLine) { Write-Host ''; $state.openLine = $false }",
    "            if ($state.toolStarted -le 80) {",
    "              Write-Host (Tool-Summary $toolCall $toolName) -ForegroundColor DarkGray",
    "            } elseif (($state.toolStarted % 20) -eq 0) {",
    "              Write-Host ('Working... ' + $state.toolStarted + ' tool calls started') -ForegroundColor DarkGray",
    "            }",
    "            Show-BusyLine",
    "          }",
    "        } elseif ($event.subtype -eq 'completed') {",
    "          if (-not $state.toolCounts.ContainsKey($displayName)) { $state.toolCounts[$displayName] = 0 }",
    "          $state.toolCounts[$displayName] = [int]$state.toolCounts[$displayName] + 1",
    "          $state.toolTotal = [int]$state.toolTotal + 1",
    "          if ($state.toolTotal -gt 0 -and ($state.toolTotal % 24) -eq 0) {",
    "            Clear-BusyLine",
    "            if ($state.openLine) { Write-Host ''; $state.openLine = $false }",
    "            Write-Host ('Tools: ' + $state.toolTotal + ' calls (' + (Format-ToolCounts) + ')') -ForegroundColor DarkGray",
    "            Show-BusyLine",
    "          }",
    "        }",
    "      } elseif ($event.type -eq 'assistant') {",
    "        $text = ''",
    "        foreach ($part in @($event.message.content)) {",
    "          if ($part.type -eq 'text' -and $part.text) { $text += $part.text }",
    "        }",
    "        if ($text) {",
    "          Clear-BusyLine",
    "          $shouldBreakBeforeDelta = $false",
    "          if ($state.lastText -and $text.StartsWith($state.lastText)) {",
    "            $delta = $text.Substring($state.lastText.Length)",
    "          } elseif ($state.streamedText -and $text.StartsWith($state.streamedText)) {",
    "            $delta = $text.Substring($state.streamedText.Length)",
    "          } elseif ($text -eq $state.lastText) {",
    "            $delta = ''",
    "          } elseif ($state.streamedText -and $state.streamedText.EndsWith($text)) {",
    "            $delta = ''",
    "          } elseif ($text.Length -le 120 -and -not $text.Contains(\"`n\")) {",
    "            $delta = $text",
    "          } else {",
    "            $shouldBreakBeforeDelta = $true",
    "            $delta = $text",
    "          }",
    "          if ($state.openLine -and $delta -match '^[\\r\\n\\s]+\\p{P}') {",
    "            $delta = $delta -replace '^[\\r\\n\\s]+', ''",
    "            $shouldBreakBeforeDelta = $false",
    "          }",
    "          if ($shouldBreakBeforeDelta -and $state.openLine) {",
    "            [Console]::WriteLine()",
    "            $state.openLine = $false",
    "          }",
    "          if ($delta) {",
    "            [Console]::Write($delta)",
    "            $state.printed = $true",
    "            $state.openLine = -not ($delta -match '[\\r\\n]$')",
    "            $state.streamedText += $delta",
    "            if (-not $state.openLine) { Show-BusyLine }",
    "          }",
    "          $state.lastText = $text",
    "        }",
    "      } elseif ($event.type -eq 'result') {",
    "        Clear-BusyLine",
    "        if ($state.openLine) { Write-Host ''; $state.openLine = $false }",
    "        if (-not $state.printed -and $event.result) { Write-Host $event.result }",
    "        if ($state.toolTotal -gt 0) { Write-Host ('Tools total: ' + $state.toolTotal + ' calls (' + (Format-ToolCounts) + ')') -ForegroundColor DarkGray }",
    "        if ($event.is_error) {",
    "          Write-Host ('[Cursor Agent] failed duration=' + $event.duration_ms + 'ms') -ForegroundColor Red",
    "        } else {",
    "          Write-Host ('[Cursor Agent] done duration=' + $event.duration_ms + 'ms') -ForegroundColor DarkGray",
    "        }",
    "      }",
    "    } catch {",
    "      if ($line -and -not $line.TrimStart().StartsWith('{')) {",
    "        Clear-BusyLine",
    "        if ($state.openLine) { Write-Host ''; $state.openLine = $false }",
    "        Write-Host $line",
    "      }",
    "    }",
    "  }",
    "  } catch {",
    "    try { [string]$_.Exception.Message | Out-File -LiteralPath $__ztErrFile -Append -Encoding UTF8 } catch {}",
    "  } finally {",
    "    $ErrorActionPreference = $__ztOldErrorActionPreference",
    "  }",
    "  Clear-BusyLine",
    "  if ($state.openLine) { Write-Host '' }",
    "  $__ztExit = $LASTEXITCODE",
    "  if ($__ztExit -eq $null) { $__ztExit = 1 }",
    "  if ($__ztExit -ne 0) {",
    "    $lines = @(Read-CursorAgentError $__ztErrFile)",
    "    if ($lines.Count -gt 0) {",
    "      Write-Host '[Cursor Agent] error:' -ForegroundColor Red",
    "      Write-Host ($lines -join \"`n\") -ForegroundColor Red",
    "    }",
    "  }",
    "  return $__ztExit",
    "  } finally {",
    "    Remove-Item -LiteralPath $__ztErrFile -Force -ErrorAction SilentlyContinue",
    "  }",
    "}",
    "$__ztExitCode = Invoke-ZenTaoCursorAgent $__ztInstruction",
    "if ($__ztExitCode -ne 0) {",
    "  Write-Host 'Cursor Agent failed; retrying once...' -ForegroundColor Yellow",
    "  Start-Sleep -Seconds 2",
    "  $__ztExitCode = Invoke-ZenTaoCursorAgent $__ztInstruction",
    "}",
    "exit $__ztExitCode"
  ].join("\n");
}

function claudeAgentRunnerPowerShell(): string {
  return [
    "param(",
    "  [Parameter(Mandatory=$true)]",
    "  [string]$PromptFile",
    ")",
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $__ztUtf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false",
    "  [Console]::InputEncoding = $__ztUtf8",
    "  [Console]::OutputEncoding = $__ztUtf8",
    "  $OutputEncoding = $__ztUtf8",
    "  chcp 65001 > $null 2>$null",
    "} catch {",
    "}",
    "$__ztPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path",
    "$__ztWorkspace = (Get-Location).Path",
    '$__ztInstruction = "Read this exact UTF-8 Markdown file and execute the ZenTao bug-fix task described in it. File: $__ztPromptFile. If this exact file cannot be read, print CANNOT_READ and stop; do not use any other repair-session file."',
    "function Invoke-ZenTaoClaudeAgent {",
    "  param([string]$Instruction)",
    "  $state = @{ printed = $false; openLine = $false; busyLine = $false; busyFlag = ''; busyProcess = $null; lastText = ''; streamedText = ''; toolTotal = 0; toolSeen = @{}; toolParts = @{}; thinkingChars = 0; lastThinkingLog = 0 }",
    "  function Clear-BusyLine {",
    "    if (-not $state.busyLine) { return }",
    "    if ($state.busyFlag) { Remove-Item -LiteralPath $state.busyFlag -Force -ErrorAction SilentlyContinue }",
    "    if ($state.busyProcess) {",
    "      try {",
    "        [void]$state.busyProcess.WaitForExit(1000)",
    "        if (-not $state.busyProcess.HasExited) { $state.busyProcess.Kill() }",
    "      } catch {}",
    "      $state.busyProcess = $null",
    "    }",
    "    $state.busyFlag = ''",
    "    $width = 120",
    "    try { $width = [Math]::Max(80, [Console]::BufferWidth - 1) } catch {}",
    "    [Console]::Write([char]13 + (' ' * $width) + [char]13)",
    "    $state.busyLine = $false",
    "  }",
    "  function Show-BusyLine {",
    "    param([string]$Text = 'AI working')",
    "    if ($state.openLine -or $state.busyLine) { return }",
    "    $state.busyLine = $true",
    "    $state.busyFlag = [System.IO.Path]::GetTempFileName()",
    "    $safeFlag = $state.busyFlag.Replace(\"'\", \"''\")",
    "    $safeText = $Text.Replace(\"'\", \"''\")",
    "    $script = \"`$ProgressPreference='SilentlyContinue'; `$flag='$safeFlag'; `$text='$safeText'; `$start=Get-Date; `$i=0; while(Test-Path -LiteralPath `$flag){ `$elapsed=[int]((Get-Date)-`$start).TotalSeconds; `$dots='.' * ((`$i % 3)+1); [Console]::Write(([char]13 + ('{0} {1}s {2}   ' -f `$text, `$elapsed, `$dots))); Start-Sleep -Milliseconds 220; `$i++ }; try { `$width=[Math]::Max(80,[Console]::BufferWidth-1) } catch { `$width=120 }; [Console]::Write(([char]13 + (' ' * `$width) + [char]13))\"",
    "    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))",
    "    try {",
    "      $state.busyProcess = Start-Process powershell -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-OutputFormat','Text','-EncodedCommand',$encoded) -NoNewWindow -PassThru",
    "    } catch {",
    "      [Console]::Write($Text + ' ... ')",
    "    }",
    "  }",
    "  function Shorten-Text {",
    "    param([string]$Value, [int]$Max = 120)",
    "    if (-not $Value) { return '' }",
    "    $text = ($Value -replace '\\s+', ' ').Trim()",
    "    if ($text.Length -le $Max) { return $text }",
    "    return $text.Substring(0, $Max - 3) + '...'",
    "  }",
    "  function Shorten-Path {",
    "    param([string]$Value)",
    "    if (-not $Value) { return '' }",
    "    $path = $Value",
    "    if ($path.StartsWith($__ztWorkspace, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "      $path = $path.Substring($__ztWorkspace.Length).TrimStart('\\', '/')",
    "    }",
    "    return Shorten-Text $path 140",
    "  }",
    "  function Input-Value {",
    "    param($InputObject, [string[]]$Names)",
    "    if (-not $InputObject) { return '' }",
    "    foreach ($name in $Names) {",
    "      if ($InputObject.PSObject.Properties.Name -contains $name) { return [string]$InputObject.PSObject.Properties[$name].Value }",
    "    }",
    "    return ''",
    "  }",
    "  function Tool-Summary {",
    "    param($Part)",
    "    $name = [string]$Part.name",
    "    $input = $Part.input",
    "    $path = Input-Value $input @('file_path', 'path')",
    "    $pattern = Input-Value $input @('pattern', 'query', 'glob', 'regex')",
    "    $command = Input-Value $input @('command', 'cmd')",
    "    if ($name -eq 'Read') { if ($path) { return 'Read ' + (Shorten-Path $path) }; return 'Read pending' }",
    "    if ($name -eq 'Grep') { if ($pattern) { return 'Grepped ' + (Shorten-Text $pattern 120) }; return 'Grepped pending' }",
    "    if ($name -eq 'Glob') { if ($pattern) { return 'Searched files ' + (Shorten-Text $pattern 120) }; return 'Searched files pending' }",
    "    if ($name -eq 'Edit' -or $name -eq 'MultiEdit' -or $name -eq 'Write') { return $name + ' ' + (Shorten-Path $path) }",
    "    if ($name -eq 'Bash') { return 'Ran ' + (Shorten-Text $command 120) }",
    "    if ($name) { return $name }",
    "    return 'Tool'",
    "  }",
    "  function Write-AssistantText {",
    "    param([string]$Text)",
    "    if (-not $Text) { return }",
    "    Clear-BusyLine",
    "    $shouldBreakBeforeDelta = $false",
    "    if ($state.lastText -and $Text.StartsWith($state.lastText)) {",
    "      $delta = $Text.Substring($state.lastText.Length)",
    "    } elseif ($state.streamedText -and $Text.StartsWith($state.streamedText)) {",
    "      $delta = $Text.Substring($state.streamedText.Length)",
    "    } elseif ($Text -eq $state.lastText) {",
    "      $delta = ''",
    "    } elseif ($state.streamedText -and $state.streamedText.EndsWith($Text)) {",
    "      $delta = ''",
    "    } elseif ($Text.Length -le 120 -and -not $Text.Contains(\"`n\")) {",
    "      $delta = $Text",
    "    } else {",
    "      $shouldBreakBeforeDelta = $true",
    "      $delta = $Text",
    "    }",
    "    if ($state.openLine -and $delta -match '^[\\r\\n\\s]+\\p{P}') {",
    "      $delta = $delta -replace '^[\\r\\n\\s]+', ''",
    "      $shouldBreakBeforeDelta = $false",
    "    }",
    "    if ($shouldBreakBeforeDelta -and $state.openLine) {",
    "      [Console]::WriteLine()",
    "      $state.openLine = $false",
    "    }",
    "    if ($delta) {",
    "      [Console]::Write($delta)",
    "      $state.printed = $true",
    "      $state.openLine = -not ($delta -match '[\\r\\n]$')",
    "      $state.streamedText += $delta",
    "      if (-not $state.openLine) { Show-BusyLine }",
    "    }",
    "    $state.lastText = $Text",
    "  }",
    "  function Write-ActivityLog {",
    "    param([string]$Text)",
    "    if (-not $Text) { return }",
    "    Clear-BusyLine",
    "    if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
    "    Write-Host $Text -ForegroundColor DarkGray",
    "    Show-BusyLine",
    "  }",
    "  $__ztErrFile = [System.IO.Path]::GetTempFileName()",
    "  try {",
    "  Show-BusyLine 'Claude starting'",
    "  claude -p --verbose --permission-mode acceptEdits --output-format stream-json --include-partial-messages $Instruction 2> $__ztErrFile | ForEach-Object {",
    "    $line = [string]$_",
    "    try {",
    "      $event = $line | ConvertFrom-Json -ErrorAction Stop",
    "      if ($event.type -eq 'system' -and $event.subtype -eq 'init') {",
    "        Clear-BusyLine",
    "        Write-Host ('[Claude] model=' + $event.model + ' cwd=' + $event.cwd) -ForegroundColor DarkGray",
    "        Show-BusyLine 'Claude thinking'",
    "      } elseif ($event.type -eq 'system' -and $event.subtype -eq 'status') {",
    "        if (-not $state.openLine) { Show-BusyLine 'Claude requesting model' }",
    "      } elseif ($event.type -eq 'stream_event') {",
    "        $inner = $event.event",
    "        if ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'text_delta') {",
    "          Write-AssistantText ([string]$inner.delta.text)",
    "        } elseif ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'thinking_delta') {",
    "          $state.thinkingChars = [int]$state.thinkingChars + ([string]$inner.delta.thinking).Length",
    "          if (($state.thinkingChars - [int]$state.lastThinkingLog) -ge 120) {",
    "            $state.lastThinkingLog = $state.thinkingChars",
    "            Write-ActivityLog ('Thinking... ' + $state.thinkingChars + ' chars')",
    "          }",
    "        } elseif ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'input_json_delta') {",
    "          $indexKey = [string]$inner.index",
    "          if ($state.toolParts.ContainsKey($indexKey)) {",
    "            $tool = $state.toolParts[$indexKey]",
    "            $tool.inputJson = [string]$tool.inputJson + [string]$inner.delta.partial_json",
    "            try {",
    "              $input = $tool.inputJson | ConvertFrom-Json -ErrorAction Stop",
    "              $partObject = [pscustomobject]@{ name = $tool.name; input = $input }",
    "              $detailKey = $tool.id + ':detail'",
    "              $detailSummary = Tool-Summary $partObject",
    "              if (-not $state.toolSeen.ContainsKey($detailKey)) {",
    "                if ($detailSummary -notmatch 'pending$') {",
    "                  Write-ActivityLog $detailSummary",
    "                  $state.toolSeen[$detailKey] = $true",
    "                }",
    "              }",
    "            } catch {}",
    "          }",
    "        } elseif ($inner.type -eq 'content_block_start' -and $inner.content_block -and $inner.content_block.type -eq 'tool_use') {",
    "          $indexKey = [string]$inner.index",
    "          $toolId = [string]$inner.content_block.id",
    "          if (-not $toolId) { $toolId = ([string]$inner.content_block.name) + ':' + $state.toolTotal }",
    "          $state.toolParts[$indexKey] = @{ id = $toolId; name = [string]$inner.content_block.name; inputJson = '' }",
    "          if (-not $state.toolSeen.ContainsKey($toolId)) {",
    "            $state.toolSeen[$toolId] = $true",
    "            $state.toolTotal = [int]$state.toolTotal + 1",
    "            Clear-BusyLine",
    "            if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
    "            $busyText = 'Tool ' + [string]$inner.content_block.name",
    "            if (-not [string]$inner.content_block.name) { $busyText = 'AI working' }",
    "            Show-BusyLine $busyText",
    "          }",
    "        } elseif ($inner.type -eq 'message_start') {",
    "          if (-not $state.openLine) { Show-BusyLine 'Claude generating' }",
    "        }",
    "      } elseif ($event.type -eq 'assistant') {",
    "        foreach ($part in @($event.message.content)) {",
    "          if ($part.type -eq 'text' -and $part.text) {",
    "            Write-AssistantText ([string]$part.text)",
    "          } elseif ($part.type -eq 'tool_use') {",
    "            $toolId = [string]$part.id",
    "            if (-not $toolId) { $toolId = ([string]$part.name) + ':' + $state.toolTotal }",
    "            $summary = Tool-Summary $part",
    "            if (-not $state.toolSeen.ContainsKey($toolId)) {",
    "              $state.toolSeen[$toolId] = $true",
    "              $state.toolTotal = [int]$state.toolTotal + 1",
    "              if ($summary -notmatch 'pending$') { Write-ActivityLog $summary }",
    "            } elseif ($part.input) {",
    "              $detailKey = $toolId + ':detail'",
    "              if (-not $state.toolSeen.ContainsKey($detailKey)) {",
    "                if ($summary -notmatch 'pending$') { Write-ActivityLog $summary }",
    "                $state.toolSeen[$detailKey] = $true",
    "              }",
    "            }",
    "          }",
    "        }",
    "      } elseif ($event.type -eq 'result') {",
    "        Clear-BusyLine",
    "        if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
    "        if (-not $state.printed -and $event.result) { Write-Host $event.result }",
    "        if ($state.toolTotal -gt 0) { Write-Host ('Tools total: ' + $state.toolTotal + ' calls') -ForegroundColor DarkGray }",
    "        if ($event.is_error) {",
    "          Write-Host ('[Claude] failed duration=' + $event.duration_ms + 'ms') -ForegroundColor Red",
    "        } else {",
    "          Write-Host ('[Claude] done duration=' + $event.duration_ms + 'ms') -ForegroundColor DarkGray",
    "        }",
    "      }",
    "    } catch {",
    "      if ($line -and -not $line.TrimStart().StartsWith('{')) {",
    "        Clear-BusyLine",
    "        if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
    "        Write-Host $line",
    "      }",
    "    }",
    "  }",
    "  Clear-BusyLine",
    "  if ($state.openLine) { [Console]::WriteLine() }",
    "  $__ztExit = $LASTEXITCODE",
    "  if ($__ztExit -ne 0) {",
    "    $err = ''",
    "    try { $err = [System.IO.File]::ReadAllText($__ztErrFile, [System.Text.Encoding]::UTF8).Trim() } catch {}",
    "    if ($err) {",
    "      $lines = @($err -split '\\r?\\n' | Where-Object { $_ -and $_ -notmatch '^\\s*\\+ ' -and $_ -notmatch '^\\s*~' -and $_ -notmatch '^\\s*CategoryInfo' -and $_ -notmatch '^\\s*FullyQualifiedErrorId' } | Select-Object -First 8)",
    "      Write-Host '[Claude] error:' -ForegroundColor Red",
    "      Write-Host ($lines -join \"`n\") -ForegroundColor Red",
    "    }",
    "  }",
    "  return $__ztExit",
    "  } finally {",
    "    Remove-Item -LiteralPath $__ztErrFile -Force -ErrorAction SilentlyContinue",
    "  }",
    "}",
    "$__ztExitCode = Invoke-ZenTaoClaudeAgent $__ztInstruction",
    "if ($__ztExitCode -ne 0) {",
    "  Write-Host 'Claude failed; retrying once...' -ForegroundColor Yellow",
    "  Start-Sleep -Seconds 2",
    "  $__ztExitCode = Invoke-ZenTaoClaudeAgent $__ztInstruction",
    "}",
    "exit $__ztExitCode"
  ].join("\n");
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, "utf16le").toString("base64");
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseGitStatusFiles(status: string): string[] {
  return splitLines(status)
    .map((line) => line.slice(3).trim())
    .map((file) => file.includes(" -> ") ? file.split(" -> ").pop()?.trim() ?? file : file)
    .filter(Boolean);
}

function parseSvnStatusFiles(status: string): string[] {
  return splitLines(status)
    .map((line) => line.length > 8 ? line.slice(8).trim() : "")
    .filter((file) => file && !file.startsWith(".cursor") && !file.startsWith("UserSettings"))
    .map((file) => normalizePathForPrompt(file));
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTextEvidenceFile(file: string): boolean {
  return /\.(ts|tsx|js|jsx|java|kt|cs|lua|py|go|rs|cpp|c|h|hpp|json|xml|md|txt|yml|yaml|ini|cfg|shader|cginc)$/i.test(file);
}

function rankRelevantFiles(trackedFiles: string, details: ZenTaoBugDetail[], changedFiles: string[]): string[] {
  const files = splitLines(trackedFiles);
  const terms = collectBugSearchTerms(details);
  const changed = new Set(changedFiles);
  return files
    .map((file) => ({ file, score: scoreFile(file, terms, changed.has(file)) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))
    .map((item) => item.file);
}

function collectBugSearchTerms(details: ZenTaoBugDetail[]): Set<string> {
  const source = details
    .map((detail) => [
      detail.id,
      detail.title,
      detail.description,
      detail.reproduceSteps,
      detail.expectedResult,
      detail.actualResult
    ].filter(Boolean).join(" "))
    .join(" ");
  const terms = new Set<string>();
  for (const match of source.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/g)) {
    const value = match[0].toLowerCase();
    if (!commonBugTerms.has(value)) {
      terms.add(value);
    }
  }
  for (const match of source.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const value = match[0];
    if (!commonBugTerms.has(value)) {
      terms.add(value.length <= 10 ? value : value.slice(0, 10));
    }
    for (let size = 2; size <= Math.min(4, value.length); size++) {
      for (let index = 0; index + size <= value.length; index++) {
        const token = value.slice(index, index + size);
        if (!commonBugTerms.has(token)) {
          terms.add(token);
        }
        if (terms.size >= 40) {
          return terms;
        }
      }
    }
  }
  return terms;
}

function isUsefulSearchTerm(term: string): boolean {
  if (/[\p{Script=Han}]/u.test(term)) {
    return term.length >= 2;
  }
  return term.length >= 4;
}

function scoreFile(file: string, terms: Set<string>, changed: boolean): number {
  const normalized = file.toLowerCase();
  let score = changed ? 20 : 0;
  for (const term of terms) {
    if (normalized.includes(term)) {
      score += term.length > 5 ? 8 : 4;
    }
  }
  if (/\.(ts|tsx|js|jsx|java|kt|cs|lua|py|go|rs|cpp|h|hpp)$/i.test(file)) {
    score += 2;
  }
  if (/(test|spec|__tests__|tests?)/i.test(file)) {
    score += 1;
  }
  return score;
}

function splitLines(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatBulletList(items: string[], fallback: string): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function formatBlockList(items: string[], fallback: string): string {
  return items.length ? items.join("\n") : `- ${fallback}`;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function formatDocumentLines(document: vscode.TextDocument, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (let index = startLine; index <= endLine; index++) {
    const lineNumber = String(index + 1).padStart(4, " ");
    lines.push(`${lineNumber}: ${document.lineAt(index).text}`);
  }
  const value = lines.join("\n");
  return value.length > 12_000 ? `${value.slice(0, 12_000)}\n...` : value;
}

function languageFromFile(file: string): string {
  const ext = path.extname(file).replace(".", "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    java: "java",
    kt: "kotlin",
    cs: "csharp",
    lua: "lua",
    py: "python",
    go: "go",
    rs: "rust",
    cpp: "cpp",
    h: "cpp",
    hpp: "cpp",
    json: "json",
    xml: "xml",
    md: "markdown"
  };
  return map[ext] ?? "";
}

function normalizePathForPrompt(value: string): string {
  return value.replace(/\\/g, "/");
}

function buildAiContextReview(input: AiContextReviewInput): AiContextReview {
  let score = 0;
  const signals: string[] = [];
  const gaps: string[] = [];

  if (input.workspaceAttached) {
    score += 20;
    signals.push("已附加当前工程路径和 Git 分支");
  } else {
    gaps.push("未打开工程目录，AI 无法获得仓库上下文");
  }

  if (input.relevantFiles.length) {
    score += 20;
    signals.push(`已给出 ${input.relevantFiles.length} 个疑似相关文件候选`);
  } else {
    gaps.push("缺少疑似相关文件，建议先用全文搜索定位模块");
  }

  if (input.activeEditorContext.length) {
    score += 10;
    signals.push("已附加当前编辑器文件/选区上下文");
  } else {
    gaps.push("未附加当前编辑器上下文；若已打开相关代码，可选中关键片段后再发送");
  }

  if (input.codeEvidence.length) {
    score += 25;
    signals.push(`已命中 ${input.codeEvidence.length} 条代码证据`);
  } else {
    gaps.push("缺少代码命中证据，AI 需要先自行搜索再判断改动点");
  }

  if (input.verificationCommands.length) {
    score += 15;
    signals.push(`已识别 ${input.verificationCommands.length} 条可运行验证命令`);
  } else {
    gaps.push("未识别验证命令，建议补充构建、测试或冒烟入口");
  }

  if (input.imageCount > 0) {
    score += 10;
    signals.push(`已附加 ${input.imageCount} 张本地截图`);
  } else {
    gaps.push("禅道未提供截图，AI 将主要依赖文本和代码证据");
  }

  if (input.recentCommits.length) {
    score += 10;
    signals.push("已附加最近提交，便于判断近期改动影响");
  } else {
    gaps.push("无法读取最近提交，缺少近期变更背景");
  }

  const normalizedScore = Math.min(score, 100);
  const label = normalizedScore >= 85 ? "高可信" : normalizedScore >= 65 ? "可用" : normalizedScore >= 45 ? "偏弱" : "不足";
  return {
    score: normalizedScore,
    label,
    signals: signals.length ? signals : ["暂无强上下文信号"],
    gaps: gaps.length ? gaps : ["暂无明显缺口"]
  };
}

function formatAiContextReview(review: AiContextReview): string {
  return [
    `- 评分：${review.score}/100（${review.label}）`,
    `- 已具备：${review.signals.join("；")}`,
    `- 待补强：${review.gaps.join("；")}`
  ].join("\n");
}

async function packageManagerCommand(cwd: string): Promise<(scriptName: string) => string> {
  const exists = async (file: string) => {
    try {
      await fs.access(path.join(cwd, file));
      return true;
    } catch {
      return false;
    }
  };
  if (await exists("pnpm-lock.yaml")) {
    return (scriptName) => `pnpm ${scriptName}`;
  }
  if (await exists("yarn.lock")) {
    return (scriptName) => `yarn ${scriptName}`;
  }
  return (scriptName) => scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
}

function oneLine(value: string | undefined): string {
  return splitLines(value)[0] ?? "";
}

const commonBugTerms = new Set([
  "bug",
  "issue",
  "error",
  "null",
  "undefined",
  "true",
  "false",
  "http",
  "https",
  "image",
  "video",
  "button",
  "click",
  "page",
  "测试",
  "测试用",
  "显示",
  "问题",
  "页面",
  "时候",
  "没有",
  "需要",
  "后台",
  "回来"
]);

const EDITOR_WORKSPACE_EXCLUDE_GLOB = "{**/.git/**,**/.svn/**,**/Library/**,**/Temp/**,**/UserSettings/**,**/workspace/**,**/writable/**,**/simulator/**,**/obj/**,**/Logs/**,**/AssetBundles/**,**/AssetBundles_Back/**}";
const MAX_EDITOR_WORKSPACE_FILES = 20_000;
const MAX_CANDIDATE_EVIDENCE_FILES = 48;
const MAX_CANDIDATE_EVIDENCE_BYTES = 512 * 1024;

function previewSection(title: string, htmlValue: string | undefined, textValue: string | undefined): string {
  const body = htmlValue || escapeHtml(textValue || "未提供");
  return `<section class="section">
    <div class="section-title">${escapeHtml(title)}</div>
    <div class="section-body ${htmlValue || textValue ? "" : "empty"}">${body}</div>
  </section>`;
}

function videoSection(videos: ZenTaoBugDetail["videos"]): string {
  if (!videos?.length) {
    return "";
  }
  return `<section class="section">
    <div class="section-title">视频附件</div>
    <div class="section-body video-list">
      ${videos.map((video, index) => `<a class="video-link" href="${escapeHtml(video.url || "")}">播放视频 ${index + 1}${video.name ? `：${escapeHtml(video.name)}` : ""}</a>`).join("")}
    </div>
  </section>`;
}

function normalizeAssigneeScope(value: BugAssigneeScope | undefined): BugAssigneeScope {
  return value === "all" || value === "team" || value === "member" ? value : "mine";
}

function normalizeAiEngine(value: AiEngine | undefined): AiEngine {
  return value === "cursor" || value === "claudeCode" ? value : "claudeCode";
}

function normalizeRepairMode(value: AiRepairMode | undefined): AiRepairMode {
  return value === "cli" || value === "chat" ? value : "chat";
}

function normalizeProjects(value: ZenTaoProject[] | undefined): ZenTaoProject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((project) => ({
      id: typeof project.id === "string" ? project.id : "",
      name: typeof project.name === "string" ? project.name : ""
    }))
    .filter((project) => project.id && project.name);
}

function normalizeMembers(value: ZenTaoMember[] | undefined): ZenTaoMember[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((member) => ({
      account: typeof member.account === "string" ? member.account : "",
      name: typeof member.name === "string" ? member.name : ""
    }))
    .filter((member) => member.account && member.name);
}

function projectCacheKey(projectId?: string): string {
  return projectId ?? "";
}

function normalizeMembersByProject(value: Record<string, ZenTaoMember[]> | undefined): Record<string, ZenTaoMember[]> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: Record<string, ZenTaoMember[]> = {};
  for (const [projectId, members] of Object.entries(value)) {
    const normalized = normalizeMembers(members);
    if (normalized.length) {
      result[projectCacheKey(projectId)] = normalized;
    }
  }
  return result;
}

function normalizeBugCategoryFilters(value: string[] | undefined, persisted = false): string[] {
  const allowed = ["assignedToMe", "unresolved", "resolved", "closed"];
  const defaults = ["unresolved", "resolved", "closed"];
  if (!Array.isArray(value)) {
    return defaults;
  }
  const selected = value.filter((item) => allowed.includes(item) && (!persisted || item !== "assignedToMe"));
  return selected.length ? [...new Set(selected)] : defaults;
}

function persistedBugCategoryFilters(value: string[] | undefined): string[] {
  return normalizeBugCategoryFilters(value).filter((item) => item !== "assignedToMe");
}

function memberFilterCandidates(account: string | undefined, member: ZenTaoMember | undefined): string[] {
  return [...new Set([
    ...personAliases(account),
    ...personAliases(member?.name),
    ...personAliases(member?.account)
  ])].filter(Boolean);
}

function personAliases(value: string | undefined): string[] {
  const text = (value ?? "").trim();
  if (!text) {
    return [];
  }
  const aliases = [text];
  for (const part of text.split(/[|/／,，;；]/)) {
    aliases.push(part.trim());
  }
  const beforeParen = text.replace(/\s*[（(].*?[）)]\s*/g, "").trim();
  if (beforeParen) {
    aliases.push(beforeParen);
  }
  for (const match of text.matchAll(/[（(]([^）)]+)[）)]/g)) {
    aliases.push(match[1].trim());
  }
  return aliases.map((item) => item.toLowerCase()).filter(Boolean);
}

