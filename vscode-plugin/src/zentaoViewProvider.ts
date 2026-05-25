import * as vscode from "vscode";
import * as fs from "fs/promises";
import {
  buildBatchBugFixPrompt,
  buildBugFixPrompt,
  type AiEngine,
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
    bugCategoryFilters: ["assignedToMe", "unresolved", "resolved", "closed"],
    selectedIds: [],
    aiEngine: "claudeCode",
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
    void this.restoreLoginFields();
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
      this.state.hasSavedPassword = true;
      this.state.status = `已登录：${session.account}`;
      await this.context.secrets.store("zentao.session", JSON.stringify(session));
      await this.context.secrets.store("zentao.account", account);
      await this.context.secrets.store("zentao.password", password);
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

    const debugInfo = await this.withAutoLoginRetry(() => this.client!.crawlBugAccessDebugInfo(this.state.selectedProjectId));
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
      const prompt = buildBugFixPrompt(detail);
      await sendPromptToAi(prompt, this.aiEngine);
      this.state.status = `Bug #${id} 已发送给 AI`;
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
      const prompt = details.length === 1 ? buildBugFixPrompt(details[0]) : buildBatchBugFixPrompt(details);
      await sendPromptToAi(prompt, this.aiEngine);
      this.state.status = details.length === 1 ? `Bug #${details[0].id} 已发送给 AI` : `${details.length} 个 Bug 已合并发送给 AI`;
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
    autoLoginEnabled?: boolean;
    serverUrl?: string;
    loginAccount?: string;
    account?: string;
    password?: string;
    action?: BugWorkflowAction;
  }): Promise<void> {
    if (message.type === "login") {
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

    const comment = await vscode.window.showInputBox({
      prompt: "填写操作备注/修改日志",
      value: action === "resolve" ? "已修复，请验证。" : action === "activate" ? "重新激活，请继续处理。" : "",
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
    this.state.assigneeScope = "member";
    this.state.assignee = this.context.globalState.get<string>("zentao.assignee");
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
    this.state.bugCategoryFilters = normalizeBugCategoryFilters(this.context.globalState.get<string[]>("zentao.bugCategoryFilters"));
    this.state.aiEngine = normalizeAiEngine(this.config.get<AiEngine>("aiEngine"));
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
    await this.context.globalState.update("zentao.assigneeScope", this.state.assigneeScope);
    await this.context.globalState.update("zentao.assignee", this.state.assignee);
    await this.context.globalState.update("zentao.bugCategoryFilters", this.state.bugCategoryFilters);
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
      <input id="serverUrl" type="url" value="http://zentao.yuwan-game.com:8088/" placeholder="http://zentao.yuwan-game.com:8088/" />
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
    return resolveServerUrl(this.state.serverUrl || this.config.get<string>("serverUrl"));
  }

  private get aiEngine(): AiEngine {
    return this.state.aiEngine;
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
        vscode.window.showInformationMessage("修复提示词已发送到 Claude Code。");
        return;
      } catch {
        // fall through to clipboard fallback
      }
    }
    vscode.window.showInformationMessage("未找到 Claude Code 扩展，修复提示词已复制到剪贴板，请手动粘贴。");
    return;
  }

  const cursorCandidates = ["cursor.openChat", "workbench.action.chat.open", "workbench.action.chat.openEditSession"];
  const command = cursorCandidates.find((c) => allCommands.includes(c));
  if (command) {
    const result = await executeCursorCommand(command, prompt);
    vscode.window.showInformationMessage(
      result === "failed"
        ? "AI 面板打开失败，修复提示词已复制到剪贴板。"
        : result === "opened-with-clipboard"
          ? "AI 面板已打开，修复提示词已复制到剪贴板。"
          : "修复提示词已发送到 AI 面板。"
    );
    return;
  }

  vscode.window.showInformationMessage("修复提示词已复制到剪贴板，请粘贴到 Cursor 或 Claude Code。");
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

function normalizeBugCategoryFilters(value: string[] | undefined): string[] {
  const allowed = ["assignedToMe", "unresolved", "resolved", "closed"];
  if (!Array.isArray(value)) {
    return allowed;
  }
  const selected = value.filter((item) => allowed.includes(item));
  return selected.length ? [...new Set(selected)] : allowed;
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

