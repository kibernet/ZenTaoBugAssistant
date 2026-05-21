import * as vscode from "vscode";
import {
  buildBugFixPrompt,
  type AiEngine,
  type BugAssigneeScope,
  type BugWorkflowAction,
  type BugWorkflowRequest,
  LoginExpiredError,
  ZenTaoClient,
  type ZenTaoBugDetail,
  type ZenTaoBugSummary,
  type ZenTaoMember,
  type ZenTaoProject,
  type ZenTaoSession
} from "./core";

const debugEndpoint = "http://127.0.0.1:7837/ingest/16d23de6-52c7-4de0-86a3-b3263b8c05ca";
const debugSessionId = "4538d4";

interface ViewState {
  loggedIn: boolean;
  account?: string;
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
  autoLoginEnabled: boolean;
  status: string;
  loading: boolean;
}

export class ZenTaoBugAssistantViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "zentaoBugAssistant.view";

  private view?: vscode.WebviewView;
  private client?: ZenTaoClient;
  private previewPanel?: vscode.WebviewPanel;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private state: ViewState = {
    loggedIn: false,
    account: undefined,
    bugs: [],
    projects: [],
    selectedProjectId: undefined,
    assigneeScope: "member",
    assignee: undefined,
    teamMembers: [],
    members: [],
    bugCategoryFilters: ["assignedToMe", "unresolved", "resolved", "closed"],
    selectedIds: [],
    aiEngine: "auto",
    autoLoginEnabled: true,
    status: "就绪",
    loading: false
  };

  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.subscriptions.push(new vscode.Disposable(() => this.stopSessionKeepAlive()));
  }

  async activateAutoLogin(): Promise<void> {
    this.restorePreferences();
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
    void this.restoreClient();
    this.postState();
    void this.refreshOnViewOpen();
  }

  private async refreshOnViewOpen(): Promise<void> {
    // #region agent log
    debugLog("O1,O2", "vscode-plugin/src/zentaoViewProvider.ts:85", "view open auto refresh starting", {
      selectedProjectId: this.state.selectedProjectId,
      assigneeScope: this.state.assigneeScope,
      bugCategoryFilters: this.state.bugCategoryFilters
    });
    // #endregion
    await this.refresh();
  }

  async login(): Promise<void> {
    const savedAccount = await this.context.secrets.get("zentao.account");
    const account = await vscode.window.showInputBox({
      prompt: "禅道用户名",
      value: savedAccount,
      ignoreFocusOut: true
    });
    if (!account) {
      return;
    }

    const password = await vscode.window.showInputBox({
      prompt: "禅道密码",
      password: true,
      ignoreFocusOut: true
    });
    if (!password) {
      return;
    }

    await this.run("正在登录禅道...", async () => {
      this.client = new ZenTaoClient({ baseUrl: this.serverUrl });
      const session = await this.client.login({ account, password });
      this.state.loggedIn = true;
      this.state.account = session.account;
      this.state.status = `已登录：${session.account}`;
      await this.context.secrets.store("zentao.session", JSON.stringify(session));
      await this.context.secrets.store("zentao.account", account);
      await this.context.secrets.store("zentao.password", password);
      this.startSessionKeepAlive("manual-login");
      await this.loadProjects();
      await this.refresh();
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
      if (!this.state.projects.length) {
        await this.loadProjects(false);
      }
      // #region agent log
      debugLog("B1,B2,B5", "vscode-plugin/src/zentaoViewProvider.ts:124", "refresh bug list starting", {
        projectCount: this.state.projects.length,
        selectedProjectId: this.state.selectedProjectId,
        assigneeScope: this.state.assigneeScope,
        assignee: this.state.assignee,
        teamMemberCount: this.state.teamMembers.length
      });
      // #endregion
      const bugs = await this.withAutoLoginRetry(() => this.client!.listBugs({
        projectId: this.state.selectedProjectId,
        assigneeScope: "all",
        teamMembers: []
      }));
      this.state.bugs = bugs;
      // #region agent log
      debugLog("B2,B5", "vscode-plugin/src/zentaoViewProvider.ts:137", "refresh bug list completed", {
        bugCount: this.state.bugs.length,
        firstBugId: this.state.bugs[0]?.id,
        firstBugTitle: this.state.bugs[0]?.title
      });
      // #endregion
      this.state.selectedIds = [];
      this.state.status = `共 ${this.state.bugs.length} 个 Bug`;
      if (!this.state.bugs.length) {
        await this.crawlCurrentBugAccess();
      }
    });
  }

  async crawlCurrentBugAccess(): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }

    const debugInfo = await this.withAutoLoginRetry(() => this.client!.crawlBugAccessDebugInfo(this.state.selectedProjectId));
    // #region agent log
    debugLog("C1,C2,C3,C4", "vscode-plugin/src/zentaoViewProvider.ts:159", "automatic bug access crawl completed", {
      selectedProjectId: this.state.selectedProjectId,
      debugInfo
    });
    // #endregion
  }

  private async loadProjects(forceRefresh = false): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      return;
    }

    if (this.state.projects.length && !forceRefresh) {
      this.reconcileSelectedProject();
      // #region agent log
      debugLog("P3,P4,P5", "vscode-plugin/src/zentaoViewProvider.ts:165", "cached projects reused", {
        selectedProjectId: this.state.selectedProjectId,
        projectCount: this.state.projects.length
      });
      // #endregion
      return;
    }

    this.state.projects = await this.withAutoLoginRetry(() => this.client!.listProjects());
    this.reconcileSelectedProject();
    await this.savePreferences();
    // #region agent log
    debugLog("P3,P4,P5", "vscode-plugin/src/zentaoViewProvider.ts:177", "projects fetched and cached", {
      forceRefresh,
      selectedProjectId: this.state.selectedProjectId,
      projectCount: this.state.projects.length
    });
    // #endregion
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

    if (this.state.members.length && !forceRefresh) {
      this.reconcileSelectedMember();
      // #region agent log
      debugLog("M4,M5", "vscode-plugin/src/zentaoViewProvider.ts:212", "cached members reused", {
        selectedProjectId: this.state.selectedProjectId,
        memberCount: this.state.members.length,
        assignee: this.state.assignee
      });
      // #endregion
      return;
    }

    this.state.members = await this.withAutoLoginRetry(() => this.client!.listMembers(this.state.selectedProjectId));
    this.reconcileSelectedMember();
    await this.savePreferences();
    // #region agent log
    debugLog("M1,M4,M5", "vscode-plugin/src/zentaoViewProvider.ts:226", "members fetched and cached", {
      forceRefresh,
      selectedProjectId: this.state.selectedProjectId,
      memberCount: this.state.members.length,
      assignee: this.state.assignee
    });
    // #endregion
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

    for (const id of ids) {
      await this.fixBug(id);
    }
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
      const detail = await this.withAutoLoginRetry(() => this.client!.getBugDetail(id));
      const prompt = buildBugFixPrompt(detail);
      await sendPromptToAi(prompt, this.aiEngine);
      this.state.status = `Bug #${id} 已发送给 AI`;
      if (this.config.get<boolean>("autoSyncAfterFix")) {
        await this.askAndSyncWorkflow(id);
      }
    });
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
    // #region agent log
    debugLog("PV1,PV2,PV3", "vscode-plugin/src/zentaoViewProvider.ts:365", "bug preview rendered", {
      bugId: detail.id,
      hasTitle: Boolean(detail.title),
      hasDescription: Boolean(detail.description),
      hasReproduceSteps: Boolean(detail.reproduceSteps),
      hasExpectedResult: Boolean(detail.expectedResult),
      hasActualResult: Boolean(detail.actualResult),
      attachmentCount: detail.attachments.length,
      commentCount: detail.comments.length
    });
    // #endregion
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
    autoLoginEnabled?: boolean;
    action?: BugWorkflowAction;
  }): Promise<void> {
    if (message.type === "login") {
      await this.login();
    }
    if (message.type === "refresh") {
      await this.refresh();
    }
    if (message.type === "select") {
      this.state.selectedIds = message.ids ?? [];
      this.postState();
    }
    if (message.type === "selectProject") {
      this.state.selectedProjectId = message.projectId || undefined;
      await this.savePreferences();
      // #region agent log
      debugLog("P3,P4", "vscode-plugin/src/zentaoViewProvider.ts:305", "project preference saved", {
        selectedProjectId: this.state.selectedProjectId,
        projectCount: this.state.projects.length
      });
      // #endregion
      await this.refresh();
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
      // #region agent log
      debugLog("P1,P2", "vscode-plugin/src/zentaoViewProvider.ts:310", "assignee preference saved", {
        assigneeScope: this.state.assigneeScope,
        hasAssignee: Boolean(this.state.assignee)
      });
      // #endregion
      this.postState();
    }
    if (message.type === "setBugCategoryFilters") {
      this.state.bugCategoryFilters = normalizeBugCategoryFilters(message.bugCategoryFilters);
      await this.savePreferences();
      // #region agent log
      debugLog("F1,F2", "vscode-plugin/src/zentaoViewProvider.ts:574", "bug category filters saved", {
        bugCategoryFilters: this.state.bugCategoryFilters
      });
      // #endregion
      this.postState();
    }
    if (message.type === "setAutoLogin") {
      this.state.autoLoginEnabled = Boolean(message.autoLoginEnabled);
      await this.config.update("autoLogin", this.state.autoLoginEnabled, vscode.ConfigurationTarget.Global);
      this.postState();
    }
    if (message.type === "setAiEngine") {
      this.state.aiEngine = normalizeAiEngine(message.aiEngine);
      await this.config.update("aiEngine", this.state.aiEngine, vscode.ConfigurationTarget.Global);
      // #region agent log
      debugLog("AI1,AI2", "vscode-plugin/src/zentaoViewProvider.ts:589", "ai engine preference saved", {
        aiEngine: this.state.aiEngine
      });
      // #endregion
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
    const comment = await vscode.window.showInputBox({
      prompt: action === "assign" ? "填写指派备注/修改日志" : "填写操作备注/修改日志",
      value: action === "resolve" ? "已修复，请验证。" : action === "activate" ? "重新激活，请继续处理。" : "",
      ignoreFocusOut: true
    });
    if (comment === undefined) {
      return undefined;
    }

    if (action === "assign") {
      const assignedTo = await vscode.window.showInputBox({
        prompt: "指派给哪个禅道账号？",
        ignoreFocusOut: true
      });
      if (!assignedTo) {
        return undefined;
      }
      return { bugId, action, assignedTo, comment };
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

  private async run(status: string, action: () => Promise<void>): Promise<void> {
    try {
      this.state.loading = true;
      this.state.status = status;
      this.postState();
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.status = `失败：${message}`;
      vscode.window.showErrorMessage(this.state.status);
    } finally {
      this.state.loading = false;
      this.postState();
    }
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
        // #region agent log
        debugLog("H4,H7,H14", "vscode-plugin/src/zentaoViewProvider.ts:392", "restored session rejected", {
          account: this.state.account
        });
        // #endregion
      } catch (error) {
        // #region agent log
        debugLog("H4,H7,H14", "vscode-plugin/src/zentaoViewProvider.ts:397", "restored session validation failed", {
          account: this.state.account,
          message: error instanceof Error ? error.message : String(error)
        });
        // #endregion
      }
      await this.clearSessionState();
    }

    return this.autoLoginFromSavedCredentials("session-invalid-or-missing");
  }

  private async autoLoginFromSavedCredentials(reason: string): Promise<boolean> {
    const account = await this.context.secrets.get("zentao.account");
    const password = await this.context.secrets.get("zentao.password");
    // #region agent log
    debugLog("H6,H7", "vscode-plugin/src/zentaoViewProvider.ts:370", "auto login considered", {
      reason,
      hasAccount: Boolean(account),
      hasPassword: Boolean(password)
    });
    // #endregion
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
      // #region agent log
      debugLog("H7", "vscode-plugin/src/zentaoViewProvider.ts:389", "auto login succeeded", {
        account: session.account
      });
      // #endregion
      return true;
    } catch (error) {
      // #region agent log
      debugLog("H7", "vscode-plugin/src/zentaoViewProvider.ts:397", "auto login failed", {
        message: error instanceof Error ? error.message : String(error)
      });
      // #endregion
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
    // #region agent log
    debugLog("H8,H9", "vscode-plugin/src/zentaoViewProvider.ts:438", "session keepalive started", {
      reason,
      intervalMs,
      account: this.state.account
    });
    // #endregion
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
      // #region agent log
      debugLog("H8,H10", "vscode-plugin/src/zentaoViewProvider.ts:464", "session keepalive checked", {
        reason,
        valid,
        account: this.state.account
      });
      // #endregion
      if (!valid) {
        await this.autoLoginFromSavedCredentials(`keepalive:${reason}`);
      }
    } catch (error) {
      // #region agent log
      debugLog("H8,H10", "vscode-plugin/src/zentaoViewProvider.ts:476", "session keepalive check failed", {
        reason,
        message: error instanceof Error ? error.message : String(error)
      });
      // #endregion
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

  private restorePreferences(): void {
    this.state.selectedProjectId = this.context.globalState.get<string>("zentao.selectedProjectId");
    this.state.projects = normalizeProjects(this.context.globalState.get<ZenTaoProject[]>("zentao.projects"));
    this.reconcileSelectedProject();
    this.state.assigneeScope = "member";
    this.state.assignee = this.context.globalState.get<string>("zentao.assignee");
    this.state.teamMembers = this.config.get<string[]>("teamMembers") ?? [];
    this.state.members = normalizeMembers(this.context.globalState.get<ZenTaoMember[]>("zentao.members"));
    this.reconcileSelectedMember();
    this.state.bugCategoryFilters = normalizeBugCategoryFilters(this.context.globalState.get<string[]>("zentao.bugCategoryFilters"));
    this.state.aiEngine = normalizeAiEngine(this.config.get<AiEngine>("aiEngine"));
    this.state.autoLoginEnabled = this.config.get<boolean>("autoLogin") ?? true;
    // #region agent log
    debugLog("P1,P2", "vscode-plugin/src/zentaoViewProvider.ts:568", "preferences restored", {
      selectedProjectId: this.state.selectedProjectId,
      cachedProjectCount: this.state.projects.length,
      cachedMemberCount: this.state.members.length,
      assigneeScope: this.state.assigneeScope,
      hasAssignee: Boolean(this.state.assignee),
      bugCategoryFilters: this.state.bugCategoryFilters,
      aiEngine: this.state.aiEngine,
      autoLoginEnabled: this.state.autoLoginEnabled
    });
    // #endregion
  }

  private async savePreferences(): Promise<void> {
    await this.context.globalState.update("zentao.selectedProjectId", this.state.selectedProjectId);
    await this.context.globalState.update("zentao.projects", this.state.projects);
    await this.context.globalState.update("zentao.members", this.state.members);
    await this.context.globalState.update("zentao.assigneeScope", this.state.assigneeScope);
    await this.context.globalState.update("zentao.assignee", this.state.assignee);
    await this.context.globalState.update("zentao.bugCategoryFilters", this.state.bugCategoryFilters);
  }

  private postState(): void {
    this.view?.webview.postMessage({ type: "state", state: this.state });
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css"));
    const headerLogoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "header-logo.png"));
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
    <div class="login-row">
      <label class="auto-login">
        <input id="autoLogin" type="checkbox" />
        <span>自动登录</span>
      </label>
      <button id="login">登录</button>
      <div id="loginState" class="login-state logged-out">未登录</div>
    </div>
  </header>
  <section class="filters">
    <label>项目
      <div class="project-row">
        <select id="project"></select>
        <button id="refreshProjects" title="重新抓取项目列表">刷新</button>
      </div>
    </label>
    <label class="member-field">成员
      <div class="member-row">
        <input id="assignee" list="assigneeOptions" placeholder="搜索成员姓名或账号，留空显示全部成员" />
        <datalist id="assigneeOptions"></datalist>
        <button id="refreshMembers" title="重新抓取成员列表">刷新</button>
      </div>
    </label>
  </section>
  <section id="status">就绪</section>
  <section id="bugCategoryFilters" class="bug-category-filters" aria-label="Bug 分类"></section>
  <section class="bug-bar">
    <span id="bugCount">共 0 个 Bug</span>
    <div class="bug-actions">
      <button id="refresh">刷新</button>
      <div class="ai-fix-group">
        <button id="fixSelected" class="ai-fix-button">AI一键修复</button>
        <select id="aiEngine" title="选择修复使用的 AI">
          <option value="auto">自动选择</option>
          <option value="cursor">Cursor</option>
          <option value="claudeCode">Claude Code</option>
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
    return this.config.get<string>("serverUrl") ?? "http://zentao.yuwan-game.com:8088/";
  }

  private get aiEngine(): AiEngine {
    return this.state.aiEngine;
  }

  private get keepAliveIntervalMinutes(): number {
    return this.config.get<number>("sessionKeepAliveIntervalMinutes") ?? 5;
  }
}

async function sendPromptToAi(prompt: string, engine: AiEngine): Promise<void> {
  await vscode.env.clipboard.writeText(prompt);

  const commandCandidates =
    engine === "cursor"
      ? ["cursor.openChat", "workbench.action.chat.open", "workbench.action.chat.openEditSession"]
      : engine === "claudeCode"
        ? ["claude-code.open", "claudeCode.open", "claude-code.chat", "claudeCode.chat", "workbench.action.chat.open"]
        : [
            "cursor.openChat",
            "workbench.action.chat.open",
            "workbench.action.chat.openEditSession",
            "claude-code.open",
            "claudeCode.open",
            "claude-code.chat",
            "claudeCode.chat"
          ];

  const commands = await vscode.commands.getCommands(true);
  const command = commandCandidates.find((candidate) => commands.includes(candidate));
  if (command) {
    const result = await executeAiCommand(command, prompt);
    // #region agent log
    debugLog("AI3,AI4", "vscode-plugin/src/zentaoViewProvider.ts:966", "ai command executed", {
      engine,
      command,
      result,
      promptLength: prompt.length,
      availableAiCommandSamples: commands.filter((item) => /cursor|claude|chat/i.test(item)).slice(0, 30)
    });
    // #endregion
    vscode.window.showInformationMessage(
      result === "failed"
        ? "AI 面板打开失败，修复提示词已复制到剪贴板。"
        : result === "opened-with-clipboard"
          ? "AI 面板已打开，修复提示词已复制到剪贴板。"
          : "修复提示词已发送到 AI 面板。"
    );
    return;
  }

  // #region agent log
  debugLog("AI3,AI5", "vscode-plugin/src/zentaoViewProvider.ts:980", "ai command not found", {
    engine,
    promptLength: prompt.length,
    availableAiCommandSamples: commands.filter((item) => /cursor|claude|chat/i.test(item)).slice(0, 30)
  });
  // #endregion
  vscode.window.showInformationMessage("修复提示词已复制到剪贴板，请粘贴到 Cursor 或 Claude Code。");
}

async function executeAiCommand(command: string, prompt: string): Promise<"sent-with-query" | "sent-with-prompt" | "sent-as-string" | "opened-with-clipboard" | "failed"> {
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
      // Some AI extensions do not accept command arguments; try the next shape.
    }
  }
  return "failed";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function previewSection(title: string, htmlValue: string | undefined, textValue: string | undefined): string {
  const body = htmlValue || escapeHtml(textValue || "未提供");
  return `<section class="section">
    <div class="section-title">${escapeHtml(title)}</div>
    <div class="section-body ${htmlValue || textValue ? "" : "empty"}">${body}</div>
  </section>`;
}

function normalizeAssigneeScope(value: BugAssigneeScope | undefined): BugAssigneeScope {
  return value === "all" || value === "team" || value === "member" ? value : "mine";
}

function normalizeAiEngine(value: AiEngine | undefined): AiEngine {
  return value === "cursor" || value === "claudeCode" ? value : "auto";
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

function normalizeBugCategoryFilters(value: string[] | undefined): string[] {
  const allowed = ["assignedToMe", "unresolved", "resolved", "closed"];
  if (!Array.isArray(value)) {
    return allowed;
  }
  const selected = value.filter((item) => allowed.includes(item));
  return [...new Set(selected)];
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

function debugLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
  fetch(debugEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": debugSessionId },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId: "post-fix",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
}
