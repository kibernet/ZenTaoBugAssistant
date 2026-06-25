import { createHash } from "crypto";
import type {
  BugListQuery,
  BugWorkflowRequest,
  LoginCredentials,
  ZenTaoBugDetail,
  ZenTaoBugSummary,
  ZenTaoClientOptions,
  ZenTaoMember,
  ZenTaoProject,
  ZenTaoSession
} from "./types";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

const defaultTimeoutMs = 10_000;
const defaultBugRecPerPage = 20;
export const DEFAULT_ZENTAO_SERVER_URL = "http://zentao.yuwan-game.com:8088/";
const PLACEHOLDER_SERVER_URLS = new Set([
  "",
  DEFAULT_ZENTAO_SERVER_URL,
  "http://your-zentao-server/",
  "http://your-zentao-server"
]);

export class LoginExpiredError extends Error {
  constructor() {
    super("禅道登录已超时，请重新登录。");
    this.name = "LoginExpiredError";
  }
}

class BugListParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BugListParseError";
  }
}

export class ZenTaoClient {
  private session?: ZenTaoSession;
  private readonly cookieJar = new Map<string, string>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ZenTaoClientOptions) {
    this.session = options.session;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    mergeCookieString(this.cookieJar, options.session?.cookie);
  }

  get currentSession(): ZenTaoSession | undefined {
    return this.session;
  }

  async login(credentials: LoginCredentials): Promise<ZenTaoSession> {
    // #region agent log
    debugLog("H1,H3", "vscode-plugin/src/core/zentaoClient.ts:32", "login request starting", {
      baseUrl: this.baseUrl,
      accountProvided: Boolean(credentials.account),
      passwordProvided: Boolean(credentials.password)
    });
    // #endregion
    const loginPage = await this.request("index.php?m=user&f=login", { method: "GET", ajax: false });
    const loginHtml = await loginPage.text();
    const formFields = parseFormFields(loginHtml);
    const verifyRandResponse = await this.request("index.php", {
      method: "GET",
      params: { m: "user", f: "refreshRandom" }
    });
    const verifyRand = compactText(await verifyRandResponse.text());
    const encryptedPassword = verifyRand ? md5(`${md5(credentials.password)}${verifyRand}`) : credentials.password;
    // #region agent log
    debugLog("H15,H16", "vscode-plugin/src/core/zentaoClient.ts:58", "login encrypted payload prepared", {
      formFieldNames: Object.keys(formFields),
      verifyRandReceived: Boolean(verifyRand),
      verifyRandLength: verifyRand.length,
      cookieNamesBeforeLoginPost: cookieNamesFromCookieString(this.cookieHeader)
    });
    // #endregion

    const response = await this.request("index.php?m=user&f=login", {
      method: "POST",
      body: new URLSearchParams({
        account: credentials.account,
        password: encryptedPassword,
        passwordStrength: String(computePasswordStrength(credentials.password)),
        referer: formFields.referer ?? "/",
        verifyRand,
        keepLogin: "1",
        captcha: ""
      }),
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: this.baseUrl.replace(/\/$/, ""),
        Referer: this.buildUrl("index.php?m=user&f=login").toString()
      },
      redirect: "manual"
    });

    const setCookieHeader = response.headers.get("set-cookie");
    const loginBody = await response.clone().text().catch(() => "");
    // #region agent log
    debugLog("H1,H2,H3", "vscode-plugin/src/core/zentaoClient.ts:51", "login response received", {
      status: response.status,
      redirected: response.redirected,
      setCookieNames: cookieNamesFromSetCookie(setCookieHeader),
      bodyPreview: compactText(loginBody).slice(0, 220)
    });
    // #endregion
    const loginResult = parseLoginResult(loginBody);
    if (loginResult?.result === "fail" || loginResult?.result === false) {
      const message = loginResult.message ? htmlText(loginResult.message) : "禅道拒绝了本次登录。";
      throw new Error(`登录失败：${message}`);
    }

    const cookie = this.cookieHeader || extractCookie(setCookieHeader);
    if (!cookie) {
      throw new Error("登录失败：禅道未返回有效会话 Cookie。");
    }

    this.session = {
      account: credentials.account,
      cookie,
      createdAt: new Date().toISOString()
    };

    if (!(await this.isSessionValid())) {
      // #region agent log
      debugLog("H1,H2,H3", "vscode-plugin/src/core/zentaoClient.ts:88", "login rejected after validation", {
        cookieNames: cookieNamesFromCookieString(this.session.cookie),
        formFieldNames: Object.keys(formFields),
        verifyRandReceived: Boolean(verifyRand),
        loginResult: loginResult?.result,
        loginMessage: loginResult?.message
      });
      // #endregion
      this.session = undefined;
      throw new Error("登录失败：禅道未接受当前账号密码，请重新登录。");
    }

    return this.session;
  }

  async listProjects(): Promise<ZenTaoProject[]> {
    this.ensureSession();
    const pages = await this.fetchProjectPages();
    return parseProjectList(pages.join("\n"));
  }

  async listMembers(projectId?: string): Promise<ZenTaoMember[]> {
    this.ensureSession();
    const selectNames = projectId
      ? ["assignedTo", "assignedTo[]"]
      : ["assignedTo", "assignedTo[]", "openedBy", "resolvedBy", "closedBy", "confirmedBy", "lastEditedBy"];
    const result = new Map<string, ZenTaoMember>();
    const sources = memberSources(projectId);
    const pages = await Promise.all(sources.map((source) => this.getText(source.path, source.params, source.ajax)));

    for (const html of pages) {
      for (const member of parseMembersFromSelects(html, selectNames)) {
        result.set(member.account, member);
      }
      for (const member of parseMembersFromTeamTable(html)) {
        result.set(member.account, member);
      }
    }

    if (projectId) {
      const bugs = await this.listBugs({ projectId, assigneeScope: "all", teamMembers: [] });
      for (const bug of bugs) {
        const account = bug.assignedTo?.trim();
        if (account && !isIgnoredMember(account, account)) {
          if (!result.has(account)) {
            result.set(account, { account, name: account });
          }
        }
      }
    }

    const members = dedupeMembers([...result.values()]);
    // #region agent log
    debugLog("M1,M2,M3", "vscode-plugin/src/core/zentaoClient.ts:139", "member list parsed", {
      projectId,
      sourceCount: sources.length,
      memberCount: members.length,
      sampleAccounts: members.slice(0, 8).map((member) => member.account)
    });
    // #endregion
    return members;
  }

  async crawlBugAccessDebugInfo(projectId?: string): Promise<Record<string, unknown>> {
    this.ensureSession();
    const baseParams = buildBugBrowseParams(projectId);
    const requestParams = bugDiagnosticParams(baseParams);
    const attempts = [];

    for (const params of requestParams) {
      try {
        const page = await this.getBugListText(params);
        const html = page.html;
        const bugs = parseBugList(html);
        const members = parseMemberList(html);
        attempts.push({
          params: redactParams(params),
          requestMode: page.ajax ? "ajax-body" : "full-page",
          summary: summarizeBugHtml(html),
          parsedBugCount: bugs.length,
          bugSamples: bugs.slice(0, 5).map((bug) => ({ id: bug.id, title: bug.title, assignedTo: bug.assignedTo })),
          parsedMemberCount: members.length,
          memberSamples: members.slice(0, 8)
        });
      } catch (error) {
        attempts.push({
          params: redactParams(params),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      projectId,
      requestCount: attempts.length,
      attempts
    };
  }

  async collectProjectDebugInfo(): Promise<string> {
    this.ensureSession();
    // #region agent log
    debugLog("H2,H4", "vscode-plugin/src/core/zentaoClient.ts:99", "project debug collection starting", {
      sessionCookieNames: cookieNamesFromCookieString(this.session?.cookie),
      hasSessionCookie: Boolean(this.session?.cookie)
    });
    // #endregion
    const results: ProjectPageResult[] = [];
    const pages = await this.fetchProjectPages(results);
    const projects = parseProjectList(pages.join("\n"));
    // #region agent log
    debugLog("H4,H5", "vscode-plugin/src/core/zentaoClient.ts:107", "project debug collection completed", {
      parsedProjectCount: projects.length,
      requestCount: results.length,
      timedOutResponses: results.filter((result) => /登录已超时|重新登入|login/i.test(result.body)).length,
      firstPreview: compactText(results[0]?.body ?? "").slice(0, 220)
    });
    // #endregion
    return JSON.stringify(
      {
        account: this.session?.account,
        hasSessionCookie: Boolean(this.session?.cookie),
        sessionCookieNames: cookieNamesFromCookieString(this.session?.cookie),
        parsedProjects: projects,
        requests: results.map((result) => ({
          label: result.label,
          url: result.url,
          ok: result.ok,
          status: result.status,
          length: result.body.length,
          preview: compactText(result.body).slice(0, 800)
        }))
      },
      null,
      2
    );
  }

  async isSessionValid(): Promise<boolean> {
    this.ensureSession();
    try {
      await this.getText("index.php", { m: "bug", f: "browse" });
      return true;
    } catch (error) {
      if (error instanceof LoginExpiredError) {
        return false;
      }
      throw error;
    }
  }

  async listAssignedBugs(account = this.session?.account): Promise<ZenTaoBugSummary[]> {
    return this.listBugs({ assigneeScope: "member", assignee: account });
  }

  async listBugs(query: BugListQuery = {}): Promise<ZenTaoBugSummary[]> {
    this.ensureSession();
    const assignees = resolveAssignees(query, this.session?.account);
    // #region agent log
    debugLog("B1,B2,B3", "vscode-plugin/src/core/zentaoClient.ts:196", "bug list request starting", {
      projectId: query.projectId,
      assigneeScope: query.assigneeScope,
      assigneeCount: assignees.length,
      assignees: assignees.map((assignee) => assignee ?? "<all>")
    });
    // #endregion
    const bugGroups = await Promise.all(
      assignees.map(async (assignee) => {
        const params = buildBugBrowseParams(query.projectId, assignee);
        const bugs = await this.fetchBugListFromCandidates(params, assignee);
        // #region agent log
        debugLog("B1,B2,B3,B4", "vscode-plugin/src/core/zentaoClient.ts:208", "bug list response parsed", {
          params: redactParams(params),
          assignee: assignee ?? "<all>",
          parsedBugCount: bugs.length
        });
        // #endregion
        return bugs;
      })
    );

    const deduped = dedupeById(bugGroups.flat());
    // #region agent log
    debugLog("B1,B2,B3,B4", "vscode-plugin/src/core/zentaoClient.ts:226", "bug list request completed", {
      groupCounts: bugGroups.map((group) => group.length),
      dedupedCount: deduped.length
    });
    // #endregion
    return deduped;
  }

  private async fetchBugListFromCandidates(baseParams: Record<string, string>, assignee?: string): Promise<ZenTaoBugSummary[]> {
    const attempts: Array<Record<string, unknown>> = [];
    let parseFailure: Error | undefined;
    for (const params of bugBrowseParamSetsFromBase(baseParams)) {
      try {
        const bugs = await this.fetchBugListAllPages(params, assignee);
        attempts.push({ params: redactParams(params), parsedBugCount: bugs.length });
        if (bugs.length) {
          return bugs;
        }
      } catch (error) {
        attempts.push({
          params: redactParams(params),
          error: error instanceof Error ? error.message : String(error)
        });
        if (error instanceof BugListParseError) {
          parseFailure = error;
        }
      }
    }

    // #region agent log
    debugLog("B6,B7,B8,B9", "vscode-plugin/src/core/zentaoClient.ts:fetchBugListFromCandidates", "bug list candidates empty", {
      baseParams: redactParams(baseParams),
      assignee: assignee ?? "<all>",
      attempts
    });
    // #endregion
    if (parseFailure) {
      throw parseFailure;
    }
    return [];
  }

  private async fetchBugListAllPages(baseParams: Record<string, string>, assignee?: string): Promise<ZenTaoBugSummary[]> {
    const firstParams = { ...baseParams };
    const firstPage = await this.getBugListText(firstParams, assignee);
    const firstHtml = firstPage.html;
    const firstBugs = parseBugList(firstHtml, assignee);
    const pager = parseBugListPager(firstHtml);
    // #region agent log
    debugLog("B1,B2,B3,B4", "vscode-plugin/src/core/zentaoClient.ts:fetchBugListAllPages", "bug list first page parsed", {
      params: redactParams(firstParams),
      requestMode: firstPage.ajax ? "ajax-body" : "full-page",
      assignee: assignee ?? "<all>",
      ...summarizeBugHtml(firstHtml),
      parsedBugCount: firstBugs.length,
      pager,
      hasLoginExpiredText: isLoginExpiredText(firstHtml) || isLoginExpiredText(decodeJsonHtml(firstHtml)),
      hasLicenseExpiredText: /license is expired|版本已经过期/i.test(firstHtml),
      preview: compactText(firstHtml).slice(0, 300)
    });
    // #endregion
    assertBugListParseHealthy(firstHtml, firstBugs, firstParams);
    if (!pager || pager.pageTotal <= 1) {
      return firstBugs;
    }

    const openOnlyBySearchFallback = isBySearchFallbackParams(baseParams) && firstBugs.length > 0 && firstBugs.every(isOpenBug);
    const allBugs = openOnlyBySearchFallback ? firstBugs.filter(isOpenBug) : [...firstBugs];
    for (let page = 2; page <= pager.pageTotal; page++) {
      const pageParams = {
        ...baseParams,
        recTotal: String(pager.recTotal),
        recPerPage: String(pager.recPerPage),
        pageID: String(page)
      };
      try {
        let html = (await this.getBugListText(pageParams, assignee, firstPage.ajax)).html;
        let pageBugs = parseBugList(html, assignee);
        if (firstPage.ajax && hasSameBugIds(pageBugs, firstBugs)) {
          html = (await this.getBugListText(pageParams, assignee, false)).html;
          pageBugs = parseBugList(html, assignee);
          if (hasSameBugIds(pageBugs, firstBugs)) {
            break;
          }
        }
        const bugsToAdd = openOnlyBySearchFallback ? pageBugs.filter(isOpenBug) : pageBugs;
        if (!bugsToAdd.length && allBugs.length) {
          break;
        }
        allBugs.push(...bugsToAdd);
        if (openOnlyBySearchFallback && pageBugs.some((bug) => !isOpenBug(bug))) {
          break;
        }
      } catch (error) {
        if (allBugs.length) {
          break;
        }
        throw error;
      }
    }
    return dedupeById(allBugs);
  }

  private async getBugListText(
    params: Record<string, string>,
    assignee?: string,
    preferredAjax?: boolean
  ): Promise<{ html: string; ajax: boolean }> {
    const modes = preferredAjax === undefined ? [true, false] : [preferredAjax, !preferredAjax];
    let fallback: { html: string; ajax: boolean } | undefined;
    let parseFailure: Error | undefined;

    for (const ajax of [...new Set(modes)]) {
      const html = await this.getText("index.php", params, ajax);
      const bugs = parseBugList(html, assignee);
      try {
        assertBugListParseHealthy(html, bugs, params);
      } catch (error) {
        if (error instanceof BugListParseError) {
          parseFailure = error;
          continue;
        }
        throw error;
      }
      const page = { html, ajax };
      if (bugs.length || hasBugListPageEvidence(html)) {
        return page;
      }
      fallback ??= page;
    }

    if (parseFailure) {
      throw parseFailure;
    }
    return fallback ?? { html: "", ajax: preferredAjax ?? true };
  }

  async getBugDetail(bugId: string): Promise<ZenTaoBugDetail> {
    this.ensureSession();
    const html = await this.getText("index.php?m=bug&f=view", { bugID: bugId }, false);
    return this.inlinePreviewImages(await parseBugDetail(html, bugId, this.baseUrl));
  }

  async enrichVideoFlags(bugs: ZenTaoBugSummary[]): Promise<ZenTaoBugSummary[]> {
    const result: ZenTaoBugSummary[] = [];
    for (const bug of bugs) {
      try {
        const html = await this.getText("index.php?m=bug&f=view", { bugID: bug.id }, false);
        const detail = parseBugDetail(html, bug.id, this.baseUrl);
        result.push({ ...bug, hasVideo: Boolean(detail.hasVideo) });
      } catch {
        result.push(bug);
      }
    }
    return result;
  }

  async preparePromptImages(detail: ZenTaoBugDetail, cacheRoot: string): Promise<ZenTaoBugDetail> {
    const sources = extractImageSources(detail);
    const promptImages: string[] = [];
    for (const source of sources.slice(0, 32)) {
      try {
        promptImages.push(await this.downloadPromptImage(detail.id, source, cacheRoot));
      } catch {
        // Keep the prompt usable even if a single image cannot be downloaded.
      }
    }
    return { ...detail, promptImages };
  }

  async clearImageCache(cacheRoot: string): Promise<void> {
    const imageDir = path.join(cacheRoot, "bug-images");
    await fs.rm(imageDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async downloadPromptImage(bugId: string, source: string, cacheRoot: string): Promise<string> {
    const normalizedSource = source.replace(/&amp;/g, "&");
    const uri = new URL(normalizedSource, this.baseUrl).toString();
    const imageDir = path.join(cacheRoot, "bug-images");
    await fs.mkdir(imageDir, { recursive: true });
    const digest = crypto.createHash("sha1").update(uri).digest("hex").slice(0, 16);
    const metaPath = path.join(imageDir, `bug-${safeFilePart(bugId)}-${digest}.json`);
    const existing = await readImageMeta(metaPath);
    if (existing?.source === uri && existing.path) {
      const stat = await fs.stat(existing.path).catch(() => undefined);
      if (stat && stat.size > 0) {
        return existing.path;
      }
    }
    const response = await this.request(uri, { method: "GET", ajax: false, headers: { Accept: "image/*" } });
    const contentType = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`不是图片响应：${contentType}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(imageDir, `bug-${safeFilePart(bugId)}-${digest}${imageExtension(contentType)}`);
    await fs.writeFile(filePath, bytes);
    await fs.writeFile(metaPath, JSON.stringify({ source: uri, contentType, path: filePath, savedAt: new Date().toISOString() }, null, 2), "utf8");
    return filePath;
  }

  private async inlinePreviewImages(detail: ZenTaoBugDetail): Promise<ZenTaoBugDetail> {
    const inlineHtml = async (value: string | undefined): Promise<string | undefined> => {
      if (!value) {
        return value;
      }
      let result = value;
      const images = [...value.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)];
      for (const match of images) {
        const src = match[1];
        if (!src || /^data:/i.test(src)) {
          continue;
        }
        try {
          const response = await this.request(src, { method: "GET", ajax: false, headers: { Accept: "image/*,*/*;q=0.8" } });
          const contentType = response.headers.get("content-type") || "image/png";
          const bytes = Buffer.from(await response.arrayBuffer());
          const dataUri = `data:${contentType};base64,${bytes.toString("base64")}`;
          const imageTag = match[0];
          const inlinedTag = imageTag
            .replace(src, dataUri)
            .replace(/<img\b(?![^>]*\bdata-original-src=)/i, `<img data-original-src="${src}"`);
          result = result.replace(imageTag, inlinedTag);
        } catch (error) {
          // Keep the preview usable even if an individual image cannot be embedded.
        }
      }
      return result;
    };

    detail.descriptionHtml = await inlineHtml(detail.descriptionHtml);
    detail.reproduceStepsHtml = await inlineHtml(detail.reproduceStepsHtml);
    detail.expectedResultHtml = await inlineHtml(detail.expectedResultHtml);
    return detail;
  }

  async updateBugWorkflow(request: BugWorkflowRequest): Promise<void> {
    this.ensureSession();
    const actionEndpoint = {
      activate: "activate",
      confirm: "confirmBug",
      resolve: "resolve",
      close: "close",
      assign: "assignTo"
    }[request.action];
    const params = {
      m: "bug",
      f: actionEndpoint,
      bugID: request.bugId
    };
    const formParams = { ...params, onlybody: "yes" };

    const formResponse = await this.request("index.php", {
      method: "GET",
      params: formParams
    });
    const formHtml = await formResponse.text();
    const form = readWorkflowFormFields(formHtml);
    let submitForm = form;
    if (request.action === "assign") {
      submitForm = buildAssignWorkflowForm(form, request);
    } else if (request.action === "confirm") {
      submitForm = buildConfirmWorkflowForm(form, request);
    } else if (request.action === "resolve") {
      submitForm = buildResolveWorkflowForm(form, request, formHtml);
    } else if (request.action === "activate") {
      submitForm = buildActivateWorkflowForm(form, request);
    } else {
      for (const [key, value] of buildWorkflowForm(request)) {
        submitForm.set(key, value);
      }
    }
    const submitPath = readFormAction(formHtml) ?? "index.php";
    // #region agent log
    debugLog("W1,W2,W3,W4", "vscode-plugin/src/core/zentaoClient.ts:296", "workflow form inspected", {
      action: request.action,
      bugId: request.bugId,
      endpoint: actionEndpoint,
      submitPath,
      formSummary: summarizeWorkflowForm(formHtml),
      preview: compactText(formHtml).slice(0, 300)
    });
    // #endregion

    const submitParams = submitPath === "index.php" ? formParams : undefined;
    const response = await this.request(submitPath, {
      method: "POST",
      body: submitForm,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.buildUrl("index.php", formParams).toString(),
        Origin: this.buildUrl("/").origin
      },
      params: submitParams,
      ajax: request.action === "assign" || request.action === "confirm" || request.action === "resolve" || request.action === "activate" ? false : undefined
    });
    const responseText = await response.text().catch(() => "");
    // #region agent log
    debugLog("W1,W2,W3,W4", "vscode-plugin/src/core/zentaoClient.ts:329", "workflow post completed", {
      action: request.action,
      bugId: request.bugId,
      endpoint: actionEndpoint,
      submittedFields: [...submitForm.keys()],
      responseSummary: summarizeWorkflowResponse(responseText),
      preview: compactText(responseText).slice(0, 300)
    });
    // #endregion
    const responseError = extractWorkflowResponseError(responseText);
    if (responseError) {
      throw new Error(`禅道未接受该工作流提交：${responseError}`);
    }
    await this.verifyWorkflowEffect(request, responseText);
  }

  private async verifyWorkflowEffect(request: BugWorkflowRequest, responseText: string): Promise<void> {
    const html = await this.getText("index.php?m=bug&f=view", { bugID: request.bugId }, false);
    const detail = parseBugDetail(html, request.bugId, this.baseUrl);
    const ok =
      (request.action === "assign" && matchesAssignee(detail.assignedTo, request.assignedTo, request.members)) ||
      (request.action === "resolve" && detail.status === "resolved") ||
      (request.action === "close" && detail.status === "closed") ||
      (request.action === "activate" && detail.status === "active") ||
      (request.action === "confirm" && detail.confirmed === true);
    if (!ok) {
      const hint = extractWorkflowResponseError(responseText);
      throw new Error(`禅道${workflowActionName(request.action)}后校验未生效。当前状态：${detail.status || "未知"}，当前指派：${detail.assignedTo || "未知"}${hint ? `。${hint}` : ""}`);
    }
  }

  private ensureSession(): void {
    if (!this.session?.cookie) {
      throw new Error("尚未登录禅道，请先登录。");
    }
  }

  private authHeaders(): Record<string, string> {
    return this.cookieHeader ? { Cookie: this.cookieHeader } : {};
  }

  private get cookieHeader(): string {
    return [...this.cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private async getText(path: string, params?: Record<string, string>, ajax = true): Promise<string> {
    const response = await this.request(path, { params, ajax });
    const text = await response.text();
    const decodedText = decodeJsonHtml(text);
    if (isLoginExpiredText(text) || isLoginExpiredText(decodedText)) {
      // #region agent log
      debugLog("H4,H6", "vscode-plugin/src/core/zentaoClient.ts:194", "zentao response indicates login expired", {
        path,
        params: redactParams(params),
        preview: compactText(text).slice(0, 220),
        decodedPreview: compactText(decodedText).slice(0, 220),
        requestCookieNames: cookieNamesFromCookieString(this.session?.cookie)
      });
      // #endregion
      throw new LoginExpiredError();
    }
    return decodedText;
  }

  private async tryGetText(path: string, params?: Record<string, string>): Promise<string | undefined> {
    try {
      return await this.getText(path, params);
    } catch {
      return undefined;
    }
  }

  private async fetchProjectPages(results?: ProjectPageResult[]): Promise<string[]> {
    const pages: string[] = [];
    const seedRequests: Array<ProjectRequest> = [
      { label: "bug browse", path: "index.php?m=bug&f=browse" },
      { label: "bug browse product 0", path: "index.php", params: { m: "bug", f: "browse", productID: "0" } },
      { label: "product browse", path: "index.php", params: { m: "product", f: "browse" } },
      { label: "product all", path: "index.php", params: { m: "product", f: "all" } }
    ];

    for (const request of seedRequests) {
      const body = await this.tryGetProjectPage(request, results);
      if (body) {
        pages.push(body);
      }
    }

    const productIds = ["0", ...pages.flatMap(extractProductIds)];
    for (const productId of [...new Set(productIds)]) {
      const dropdownRequests: Array<ProjectRequest> = [
        {
          label: `product drop menu ${productId}`,
          path: "index.php",
          params: { m: "product", f: "ajaxGetDropMenu", objectID: productId, module: "bug", method: "browse" }
        },
        {
          label: `product drop menu extra ${productId}`,
          path: "index.php",
          params: { m: "product", f: "ajaxGetDropMenu", objectID: productId, module: "bug", method: "browse", extra: "" }
        },
        {
          label: `project drop menu ${productId}`,
          path: "index.php",
          params: { m: "project", f: "ajaxGetDropMenu", objectID: productId, module: "bug", method: "browse" }
        },
        {
          label: `program drop menu ${productId}`,
          path: "index.php",
          params: { m: "program", f: "ajaxGetDropMenu", objectID: productId, module: "bug", method: "browse" }
        }
      ];
      for (const request of dropdownRequests) {
        const body = await this.tryGetProjectPage(request, results);
        if (body) {
          pages.push(body);
        }
      }
    }

    return pages;
  }

  private async tryGetProjectPage(request: ProjectRequest, results?: ProjectPageResult[]): Promise<string | undefined> {
    const url = this.buildUrl(request.path, request.params).toString();
    try {
      const body = await this.getText(request.path, request.params);
      results?.push({ ...request, url, ok: true, status: 200, body });
      return body;
    } catch (error) {
      results?.push({
        ...request,
        url,
        ok: false,
        status: undefined,
        body: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private async request(
    path: string,
    init: RequestInit & { params?: Record<string, string>; ajax?: boolean } = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = this.buildUrl(path, init.params);
    try {
      const { params: _params, ajax: _ajax, ...fetchInit } = init;
      const sentCookieHeader = this.cookieHeader;
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          "User-Agent": "ZenTaoBugAssistant/1.1.0",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          ...(init.ajax === false ? {} : { "X-Requested-With": "XMLHttpRequest" }),
          ...this.authHeaders(),
          ...init.headers
        }
      });
      if (response.status < 200 || response.status >= 400) {
        throw new Error(`禅道请求失败：HTTP ${response.status}`);
      }
      mergeSetCookieHeader(this.cookieJar, response.headers.get("set-cookie"));
      if (this.session && this.cookieHeader) {
        this.session.cookie = this.cookieHeader;
      }
      const preview = await response.clone().text().catch(() => "");
      // #region agent log
      debugLog("H2,H4", "vscode-plugin/src/core/zentaoClient.ts:210", "zentao request response", {
        path,
        params: redactParams(init.params),
        method: init.method ?? "GET",
        ajax: init.ajax !== false,
        status: response.status,
        contentType: response.headers.get("content-type"),
        sentCookieNames: cookieNamesFromCookieString(sentCookieHeader),
        outgoingCookieNames: cookieNamesFromCookieString(this.cookieHeader),
        setCookieNames: cookieNamesFromSetCookie(response.headers.get("set-cookie")),
        responsePreview: compactText(preview).slice(0, 220)
      });
      // #endregion
      return response;
    } catch (error) {
      throw formatZenTaoRequestError(url.toString(), error, this.timeoutMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string, params?: Record<string, string>): URL {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    return url;
  }
}

interface ProjectRequest {
  label: string;
  path: string;
  params?: Record<string, string>;
}

interface ProjectPageResult extends ProjectRequest {
  url: string;
  ok: boolean;
  status?: number;
  body: string;
}

function debugLog(
  _hypothesisId: string,
  _location: string,
  _message: string,
  _data: Record<string, unknown>
): void {
  // Debug telemetry is intentionally disabled in production builds.
}

function cookieNamesFromSetCookie(value: string | null): string[] {
  return (value?.split(/,(?=\s*[^;,]+=)/) ?? [])
    .map((cookie) => cookie.split("=")[0]?.trim())
    .filter(Boolean);
}

function cookieNamesFromCookieString(value: string | undefined): string[] {
  return (value?.split(";") ?? [])
    .map((cookie) => cookie.split("=")[0]?.trim())
    .filter(Boolean);
}

function redactParams(params: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!params) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      /pass|pwd|token|key|cookie/i.test(key) ? "<redacted>" : value
    ])
  );
}

function buildBugBrowseParams(projectId?: string, assignee?: string): Record<string, string> {
  const params: Record<string, string> = {
    m: "bug",
    f: "browse"
  };
  if (projectId) {
    params.productID = projectId;
  }
  if (assignee) {
    params.assignedTo = assignee;
  }
  return params;
}

function bugDiagnosticParams(baseParams: Record<string, string>): Array<Record<string, string>> {
  return bugBrowseParamSetsFromBase(baseParams);
}

function bugBrowseParamSetsFromBase(baseParams: Record<string, string>): Array<Record<string, string>> {
  return dedupeParamSets(
    bugScopeParamVariants(baseParams).flatMap((params) => {
      const lowercaseProductParams = withLowercaseProductId(params);
      return [
        { ...params, branch: "all", browseType: "unclosed", param: "0", orderBy: "" },
        { ...lowercaseProductParams, branch: "all", browseType: "unclosed", param: "0", orderBy: "" },
        { ...lowercaseProductParams, branch: "all", browseType: "unresolved" },
        { ...params, branch: "all", browseType: "unresolved" },
        params,
        { ...params, branch: "all", browseType: "bySearch", param: "0", orderBy: "" },
        { ...lowercaseProductParams, branch: "all", browseType: "bySearch", param: "0", orderBy: "" },
        { ...lowercaseProductParams, branch: "all", browseType: "bySearch" },
        { ...params, browseType: "unresolved" },
        { ...params, browseType: "bySearch" },
        { ...params, browseType: "all" },
        { ...params, browseType: "unclosed" },
        { ...params, browseType: "assigntome" },
        { ...params, browseType: "all", param: "0", orderBy: "id_desc" }
      ];
    })
  );
}

function memberSources(projectId?: string): Array<{ path: string; params: Record<string, string>; ajax: boolean }> {
  const sources: Array<{ path: string; params: Record<string, string>; ajax: boolean }> = [];
  for (const params of bugBrowseParamSets(projectId)) {
    sources.push({ path: "index.php", params, ajax: false });
    if (params.productID) {
      sources.push({
        path: "index.php",
        params: { ...withLowercaseProductId(params), branch: "all", browseType: "unresolved" },
        ajax: false
      });
    }
  }
  if (projectId) {
    sources.push(
      { path: "index.php", params: { m: "bug", f: "create", productID: projectId }, ajax: false },
      { path: "index.php", params: { m: "bug", f: "create", productID: projectId, branch: "0", moduleID: "0" }, ajax: false },
      { path: "index.php", params: { m: "product", f: "team", productID: projectId }, ajax: false },
      { path: "index.php", params: { m: "project", f: "team", projectID: projectId }, ajax: false },
      { path: "index.php", params: { m: "execution", f: "team", executionID: projectId }, ajax: false }
    );
  }
  return dedupeMemberSources(sources);
}

function bugBrowseParamSets(projectId?: string, assignee?: string): Array<Record<string, string>> {
  const bases = bugScopeParamVariants(buildBugBrowseParams(projectId, assignee));
  const result: Array<Record<string, string>> = [];
  for (const base of bases) {
    result.push(
      { ...base, branch: "all", browseType: "unclosed", param: "0", orderBy: "" },
      { ...withLowercaseProductId(base), branch: "all", browseType: "unclosed", param: "0", orderBy: "" },
      { ...base, branch: "all", browseType: "bySearch", param: "0", orderBy: "" },
      { ...withLowercaseProductId(base), branch: "all", browseType: "bySearch", param: "0", orderBy: "" }
    );
  }
  result.push(...bases);
  for (const base of bases) {
    for (const browseType of ["bySearch", "all", "unclosed", "assigntome"]) {
      result.push({ ...base, browseType });
    }
  }
  return dedupeParamSets(result);
}

function isBySearchFallbackParams(params: Record<string, string>): boolean {
  return params.m === "bug" && params.f === "browse" && (params.browseType ?? "").toLowerCase() === "bysearch";
}

function isOpenBug(bug: ZenTaoBugSummary): boolean {
  return bug.status !== "resolved" && bug.status !== "closed";
}

function hasSameBugIds(left: ZenTaoBugSummary[], right: ZenTaoBugSummary[]): boolean {
  return left.length > 0 && left.length === right.length && left.every((bug, index) => bug.id === right[index]?.id);
}

function bugScopeParamVariants(baseParams: Record<string, string>): Array<Record<string, string>> {
  const scopeId = baseParams.productID ?? baseParams.productid ?? baseParams.projectID ?? baseParams.executionID;
  if (!scopeId) {
    return [baseParams];
  }
  const base = { ...baseParams };
  delete base.productID;
  delete base.productid;
  delete base.projectID;
  delete base.executionID;
  return [
    { ...baseParams },
    { ...base, productID: scopeId },
    { ...base, productid: scopeId },
    { ...base, projectID: scopeId },
    { ...base, executionID: scopeId },
    { ...base, m: "project", f: "bug", projectID: scopeId },
    { ...base, m: "execution", f: "bug", executionID: scopeId }
  ];
}

function dedupeMemberSources(
  values: Array<{ path: string; params: Record<string, string>; ajax: boolean }>
): Array<{ path: string; params: Record<string, string>; ajax: boolean }> {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.path}?${JSON.stringify(Object.entries(value.params).sort(([left], [right]) => left.localeCompare(right)))}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function memberSourceParams(baseParams: Record<string, string>): Array<Record<string, string>> {
  const lowercaseProductParams = withLowercaseProductId(baseParams);
  return dedupeParamSets([
    baseParams,
    { ...lowercaseProductParams, branch: "all", browseType: "unresolved" },
    { ...baseParams, branch: "all", browseType: "unresolved" },
    { ...lowercaseProductParams, branch: "all", browseType: "bySearch" },
    { ...baseParams, browseType: "bySearch" }
  ]);
}

function withLowercaseProductId(params: Record<string, string>): Record<string, string> {
  const next = { ...params };
  if (next.productID) {
    next.productid = next.productID;
    delete next.productID;
  }
  return next;
}

function dedupeParamSets(values: Array<Record<string, string>>): Array<Record<string, string>> {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveAssignees(query: BugListQuery, currentAccount?: string): Array<string | undefined> {
  if (query.assigneeScope === "all") {
    return [undefined];
  }
  if (query.assigneeScope === "team") {
    const members = query.teamMembers?.map((item) => item.trim()).filter(Boolean) ?? [];
    return members.length ? members : [currentAccount];
  }
  if (query.assigneeScope === "member") {
    return [query.assignee || currentAccount];
  }
  return [currentAccount];
}

function buildWorkflowForm(request: BugWorkflowRequest): URLSearchParams {
  const form = new URLSearchParams();
  const comment = request.comment ?? "";
  form.set("comment", comment);
  form.set("remark", comment);
  form.set("comment[]", comment);
  form.set("mailto", "");

  if (request.action === "resolve") {
    form.set("resolution", request.solution ?? "fixed");
    form.set("resolvedBuild", request.resolvedBuild ?? "trunk");
    form.set("resolvedDate", formatZenTaoDate(new Date()));
    if (request.assignedTo) {
      form.set("assignedTo", request.assignedTo);
    }
  }

  if (request.action === "assign" && request.assignedTo) {
    form.set("assignedTo", request.assignedTo);
    form.set("assignedTo[]", request.assignedTo);
  }

  return form;
}

function buildAssignWorkflowForm(source: URLSearchParams, request: BugWorkflowRequest): URLSearchParams {
  const form = new URLSearchParams();
  const assignedTo = request.assignedTo?.trim();
  if (assignedTo) {
    form.set("assignedTo", assignedTo);
  }
  if (source.has("status")) {
    form.set("status", source.get("status") ?? "");
  }
  if (source.has("uid")) {
    form.set("uid", source.get("uid") ?? "");
  }
  form.set("comment", request.comment ?? "");
  return form;
}

function buildConfirmWorkflowForm(source: URLSearchParams, request: BugWorkflowRequest): URLSearchParams {
  const form = new URLSearchParams();
  for (const key of ["assignedTo", "type", "pri", "status", "uid"]) {
    if (source.has(key)) {
      form.set(key, source.get(key) ?? "");
    }
  }
  form.set("comment", request.comment ?? "");
  return form;
}

function buildResolveWorkflowForm(source: URLSearchParams, request: BugWorkflowRequest, formHtml: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("resolution", nonBlank(request.solution) ?? nonBlank(source.get("resolution")) ?? "fixed");
  form.set("duplicateBug", nonBlank(source.get("duplicateBug")) ?? "0");
  form.set("buildExecution", nonBlank(source.get("buildExecution")) ?? "0");
  form.set(
    "resolvedBuild",
    nonBlank(request.resolvedBuild) ?? nonBlank(source.get("resolvedBuild")) ?? readSelectFieldValue(formHtml, "resolvedBuild") ?? "trunk"
  );
  form.set("buildName", nonBlank(source.get("buildName")) ?? "");
  form.set("resolvedDate", formatZenTaoDate(new Date()));
  if (source.has("assignedTo")) {
    form.set("assignedTo", source.get("assignedTo") ?? "");
  }
  form.set("status", "resolved");
  if (source.has("uid")) {
    form.set("uid", source.get("uid") ?? "");
  }
  form.set("comment", request.comment ?? "");
  return form;
}

function buildActivateWorkflowForm(source: URLSearchParams, request: BugWorkflowRequest): URLSearchParams {
  const form = new URLSearchParams();
  if (source.has("assignedTo")) {
    form.set("assignedTo", source.get("assignedTo") ?? "");
  }
  form.set("status", "active");
  if (source.has("openedBuild[]")) {
    form.set("openedBuild[]", source.get("openedBuild[]") ?? "");
  }
  if (source.has("uid")) {
    form.set("uid", source.get("uid") ?? "");
  }
  form.set("comment", request.comment ?? "");
  return form;
}

function readWorkflowFormFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const input of matchAll(html, /<input\b[^>]*>/gi)) {
    const name = readAttr(input, "name");
    if (name) form.set(name, readAttr(input, "value") ?? "");
  }
  for (const textarea of matchAll(html, /<textarea\b[\s\S]*?<\/textarea>/gi)) {
    const name = readAttr(textarea, "name");
    if (name && !form.has(name)) form.set(name, htmlText(textarea));
  }
  for (const select of matchAll(html, /<select\b[\s\S]*?<\/select>/gi)) {
    const name = readAttr(select, "name");
    if (!name || form.has(name)) continue;
    const options = matchAll(select, /<option\b[^>]*>[\s\S]*?<\/option>/gi);
    const selected = options.find((option) => /\sselected(?:\s|=|>)/i.test(option)) ?? options[0];
    form.set(name, selected ? readAttr(selected, "value") ?? "" : "");
  }
  return form;
}

function readFormAction(html: string): string | undefined {
  const form = html.match(/<form\b[^>]*>/i)?.[0];
  return form ? readAttr(form, "action")?.replace(/&amp;/g, "&") : undefined;
}

function nonBlank(value?: string | null): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

function readSelectFieldValue(html: string, name: string): string | undefined {
  const select = html.match(new RegExp(`<select\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/select>`, "i"))?.[0];
  if (!select) {
    return undefined;
  }
  const options = matchAll(select, /<option\b[^>]*>[\s\S]*?<\/option>/gi);
  for (const option of options) {
    if (!/\sselected(?:\s|=|>)/i.test(option)) {
      continue;
    }
    const value = nonBlank(readAttr(option, "value"));
    if (value) {
      return value;
    }
  }
  for (const option of options) {
    const value = nonBlank(readAttr(option, "value"));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractWorkflowResponseError(value: string): string | undefined {
  const alertMatch = value.match(/alert\s*\(\s*['"]([^'"]+)['"]/i);
  if (alertMatch?.[1]) {
    return alertMatch[1].replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  }
  const parsed = parseLoginResult(value);
  if (parsed?.result === "fail" && parsed.message) {
    return parsed.message.trim();
  }
  if (value.includes('"result":"fail"')) {
    return "禅道返回失败结果";
  }
  const text = htmlText(value);
  if (/不能为空|必填|请选择|失败|错误/i.test(text) && text.length <= 240) {
    return text;
  }
  return undefined;
}

function containsPerson(value: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const actual = personAliases(value);
  const target = personAliases(expected);
  return target.some((item) => actual.some((candidate) => candidate === item || candidate.includes(item) || item.includes(candidate)));
}

function personAliases(value: string | undefined): string[] {
  const text = (value ?? "").trim();
  if (!text) return [];
  const aliases = [text, ...text.split(/[|/／,，;；]/).map((item) => item.trim())];
  const beforeParen = text.replace(/\s*[（(].*?[）)]\s*/g, "").trim();
  if (beforeParen) aliases.push(beforeParen);
  for (const match of text.matchAll(/[（(]([^）)]+)[）)]/g)) aliases.push(match[1].trim());
  return [...new Set(aliases.map((item) => item.toLowerCase()).filter(Boolean))];
}

function workflowActionName(action: BugWorkflowRequest["action"]): string {
  return { assign: "指派", confirm: "确认", resolve: "解决", close: "关闭", activate: "激活" }[action];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function resolveServerUrl(configured?: string | null): string {
  const value = configured?.trim() ?? "";
  if (!value || PLACEHOLDER_SERVER_URLS.has(value) || PLACEHOLDER_SERVER_URLS.has(normalizeBaseUrl(value))) {
    return DEFAULT_ZENTAO_SERVER_URL;
  }
  return normalizeBaseUrl(value);
}

export function describeErrorChain(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message && !messages.includes(current.message)) {
      messages.push(current.message);
    }
    current = current.cause;
  }
  return messages.join("；") || "未知错误";
}

function formatZenTaoRequestError(url: string, error: unknown, timeoutMs: number): Error {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`连接禅道超时（${Math.round(timeoutMs / 1000)} 秒）：${url}`);
  }
  const detail = describeErrorChain(error);
  if (/fetch failed/i.test(detail)) {
    return new Error(
      `无法连接禅道服务器 ${url}。请检查服务器地址、VPN/内网连接和防火墙。底层错误：${detail}`
    );
  }
  if (error instanceof Error && /禅道/.test(error.message)) {
    return error;
  }
  return new Error(`禅道请求失败（${url}）：${detail}`);
}

function formatZenTaoDate(value: Date): string {
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function extractCookie(setCookieHeader: string | null): string {
  return (setCookieHeader?.split(/,(?=\s*[^;,]+=)/) ?? [])
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function mergeCookieString(jar: Map<string, string>, cookieHeader: string | undefined): void {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...valueParts] = part.trim().split("=");
    const value = valueParts.join("=");
    if (name && value) {
      jar.set(name, value);
    }
  }
}

function mergeSetCookieHeader(jar: Map<string, string>, setCookieHeader: string | null): void {
  for (const cookie of setCookieHeader?.split(/,(?=\s*[^;,]+=)/) ?? []) {
    const [pair] = cookie.split(";");
    const [name, ...valueParts] = pair.trim().split("=");
    const value = valueParts.join("=");
    if (!name) {
      continue;
    }
    if (!value) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function summarizeBugHtml(html: string): Record<string, unknown> {
  const source = normalizeZenTaoHtml(html);
  const text = htmlText(source);
  const rows = matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi);
  const links = matchAll(source, /<a\b[^>]*>[\s\S]*?<\/a>/gi);
  return {
    htmlLength: html.length,
    decodedHtmlLength: source.length,
    tableRowCount: rows.length,
    tableCellCount: matchAll(source, /<td\b[\s\S]*?<\/td>/gi).length,
    bugViewLinkCount: matchAll(source, /m=bug[^"']*f=view|f=view[^"']*m=bug|bug[-/]view|bug-view/gi).length,
    bugIdPatternCount: matchAll(source, /(?:bugID|bug-id|data-bug-id|data-bug|id=["']bug)\D{0,12}\d+/gi).length,
    hasDatatable: /data-ride=["']table|datatable|dataTable/i.test(source),
    hasPager: /pager|pageID|recTotal|recPerPage/i.test(source),
    hasNoDataText: /暂无|没有|无数据|No data|No records/i.test(text),
    hasSearchForm: /module=bug|browseType|searchForm|queryID/i.test(source),
    title: source.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ? htmlText(source.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "") : undefined,
    linkSamples: links.slice(0, 8).map((link) => ({
      href: readAttr(link, "href") ?? "",
      dataUrl: readAttr(link, "data-url") ?? "",
      text: htmlText(link).slice(0, 120)
    })),
    rowSamples: rows.slice(0, 5).map((row) => htmlText(row).slice(0, 220))
  };
}

function summarizeWorkflowForm(html: string): Record<string, unknown> {
  const inputs = matchAll(html, /<input\b[^>]*>/gi);
  const selects = matchAll(html, /<select\b[\s\S]*?<\/select>/gi);
  const textareas = matchAll(html, /<textarea\b[\s\S]*?<\/textarea>/gi);
  return {
    htmlLength: html.length,
    formCount: matchAll(html, /<form\b[\s\S]*?<\/form>/gi).length,
    action: readAttr(html.match(/<form\b[^>]*>/i)?.[0] ?? "", "action"),
    method: readAttr(html.match(/<form\b[^>]*>/i)?.[0] ?? "", "method"),
    inputNames: [...new Set(inputs.map((input) => readAttr(input, "name")).filter(Boolean))],
    selectNames: [...new Set(selects.map((select) => readAttr(select, "name")).filter(Boolean))],
    textareaNames: [...new Set(textareas.map((textarea) => readAttr(textarea, "name")).filter(Boolean))],
    resolutionOptions: summarizeSelectOptions(html, "resolution"),
    resolvedBuildOptions: summarizeSelectOptions(html, "resolvedBuild"),
    assignedToOptions: summarizeSelectOptions(html, "assignedTo"),
    hasRequiredMarker: /required|required='required'|class=["'][^"']*required/i.test(html),
    hasTokenField: /token|verify|uid|csrf/i.test(html)
  };
}

function summarizeMemberHtml(html: string): Record<string, unknown> {
  const source = normalizeZenTaoHtml(html);
  const selects = matchAll(source, /<select\b[\s\S]*?<\/select>/gi);
  const assignedSelect = selects.find((select) => readAttr(select, "name") === "assignedTo");
  return {
    htmlLength: html.length,
    selectNames: [...new Set(selects.map((select) => readAttr(select, "name")).filter(Boolean))],
    assignedToOptionCount: parseMembersFromSelects(source, ["assignedTo", "assignedTo[]"]).length,
    assignedToSelectPreview: assignedSelect ? compactText(assignedSelect).slice(0, 400) : undefined,
    assignedColumnMembers: parseAssignedMembersFromBugRows(source).slice(0, 8),
    userMarkerCount: matchAll(source, /assignedTo|openedBy|resolvedBy|closedBy|account|realname/gi).length
  };
}

function summarizeWorkflowResponse(value: string): Record<string, unknown> {
  const parsed = parseLoginResult(value);
  return {
    jsonResult: parsed?.result,
    jsonMessage: parsed?.message,
    htmlLength: value.length,
    hasErrorText: /失败|错误|error|fail|required|必填|请选择/i.test(htmlText(value)),
    hasLoginExpiredText: isLoginExpiredText(value) || isLoginExpiredText(decodeJsonHtml(value)),
    hasModalHtml: /modal|form-actions|table-form/i.test(value)
  };
}

function summarizeSelectOptions(html: string, name: string): string[] {
  const select = html.match(new RegExp(`<select\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/select>`, "i"))?.[0];
  if (!select) {
    return [];
  }
  return matchAll(select, /<option\b[^>]*>[\s\S]*?<\/option>/gi).map(htmlText).filter(Boolean).slice(0, 12);
}

interface BugListPager {
  recTotal: number;
  recPerPage: number;
  pageID: number;
  pageTotal: number;
}

function parseBugListPager(html: string): BugListPager | undefined {
  const source = normalizeZenTaoHtml(html);
  const recTotal = readPagerNumber(source, "recTotal");
  const recPerPage = readPagerNumber(source, "recPerPage") ?? defaultBugRecPerPage;
  const pageID = readPagerNumber(source, "pageID") ?? 1;
  const pageTotal = readPagerNumber(source, "pageTotal");

  let total = recTotal;
  if (total === undefined) {
    const summeryMatch =
      source.match(/共\s*(?:<[^>]+>\s*)?(\d+)\s*(?:<\/[^>]+>\s*)?项/i) ??
      source.match(/,\s*共\s*(\d+)\s*项/i) ??
      source.match(/total\s*(?:<[^>]+>\s*)?(\d+)/i);
    total = summeryMatch ? Number(summeryMatch[1]) : undefined;
  }
  if (total === undefined || total <= 0) {
    return undefined;
  }

  const perPage = recPerPage > 0 ? recPerPage : defaultBugRecPerPage;
  const pages = pageTotal && pageTotal > 0 ? pageTotal : Math.max(1, Math.ceil(total / perPage));
  const current = pageID > 0 ? pageID : 1;

  return { recTotal: total, recPerPage: perPage, pageID: current, pageTotal: pages };
}

function readPagerNumber(html: string, key: string): number | undefined {
  const hiddenValues = [
    ...html.matchAll(new RegExp(`<input\\b[^>]*\\b(?:id|name)=["']_?${key}["'][^>]*\\bvalue=["'](\\d+)["']`, "gi")),
    ...html.matchAll(new RegExp(`<input\\b[^>]*\\bvalue=["'](\\d+)["'][^>]*\\b(?:id|name)=["']_?${key}["']`, "gi"))
  ].map((match) => Number(match[1])).filter((value) => value > 0);
  if (hiddenValues.length) {
    return key.toLowerCase() === "rectotal" ? Math.min(...hiddenValues) : hiddenValues[0];
  }

  const fromUrl = [...html.matchAll(new RegExp(`(?:[?&]|&amp;)${key}=?(\\d+)`, "gi"))].map((match) => Number(match[1]));
  if (fromUrl.length) {
    if (key.toLowerCase() === "rectotal") {
      const positiveTotals = fromUrl.filter((value) => value > 0);
      return positiveTotals.length ? Math.min(...positiveTotals) : undefined;
    }
    return fromUrl[0];
  }

  const fromJs = html.match(new RegExp(`${key}\\s*[:=]\\s*['"]?(\\d+)`, "i"));
  if (fromJs?.[1]) {
    return Number(fromJs[1]);
  }

  return undefined;
}

function assertBugListParseHealthy(html: string, bugs: ZenTaoBugSummary[], params: Record<string, string>): void {
  if (bugs.length) {
    return;
  }
  const source = normalizeZenTaoHtml(html);
  const text = htmlText(source);
  const pager = parseBugListPager(source);
  const summary = summarizeBugHtml(source);
  const hasReturnedBugRows = hasBugListPageEvidence(source);
  if (!hasReturnedBugRows) {
    return;
  }
  const preview = compactText(text).slice(0, 260);
  throw new BugListParseError(
    `禅道返回了 Bug 列表痕迹，但插件解析为 0。请反馈当前项目、筛选条件和页面摘要以便补充解析规则。请求参数：${JSON.stringify(
      redactParams(params)
    )}；页面摘要：rows=${summary.tableRowCount}, cells=${summary.tableCellCount}, bugLinks=${summary.bugViewLinkCount}, bugIdPatterns=${summary.bugIdPatternCount}, recTotal=${
      pager?.recTotal ?? "unknown"
    }；预览：${preview}`
  );
}

function hasBugListPageEvidence(html: string): boolean {
  const source = normalizeZenTaoHtml(html);
  const pager = parseBugListPager(source);
  const summary = summarizeBugHtml(source);
  return (
    (pager?.recTotal ?? 0) > 0 ||
    Number(summary.bugViewLinkCount ?? 0) > 0 ||
    (Number(summary.bugIdPatternCount ?? 0) > 0 && !summary.hasNoDataText)
  );
}

function parseBugList(html: string, assignedTo?: string): ZenTaoBugSummary[] {
  const source = normalizeZenTaoHtml(html);
  const rows = matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi);
  const headerCells = rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row)))
    ? matchAll(rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row))) ?? "", /<t[dh]\b[\s\S]*?<\/t[dh]>/gi).map(htmlText)
    : [];
  const columns = readBugColumns(headerCells);
  const bugs = rows
    .map((row) => parseBugRow(row, assignedTo, columns))
    .filter((bug): bug is ZenTaoBugSummary => Boolean(bug));

  const linkBugs = bugs.length ? [] : parseBugListFromLinks(source, assignedTo);
  const contextBugs = bugs.length || linkBugs.length ? [] : parseBugListFromDataIdContexts(source, assignedTo);
  return dedupeById(bugs.length ? bugs : linkBugs.length ? linkBugs : contextBugs);
}

function parseBugListFromLinks(html: string, assignedTo?: string): ZenTaoBugSummary[] {
  const source = normalizeZenTaoHtml(html);
  const links = matchAll(source, /<a\b[^>]*href=["']([^"']*(?:(?:m=bug[^"']*f=view)|(?:f=view[^"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi);
  const grouped = new Map<string, Array<{ text: string; context: string }>>();
  for (const link of links) {
    const href = readAttr(link, "href") ?? "";
    const id = readBugIdFromHref(href) ?? positiveBugId(htmlText(link).match(/^#?(\d+)$/)?.[1]);
    if (!id) {
      continue;
    }
    const index = source.indexOf(link);
    const context = index >= 0 ? source.slice(Math.max(0, index - 1600), Math.min(source.length, index + 2600)) : link;
    const items = grouped.get(id) ?? [];
    items.push({ text: htmlText(link), context });
    grouped.set(id, items);
  }

  return [...grouped.entries()].map(([id, items]) => {
    const contextText = htmlText(items.map((item) => item.context).join(" "));
    const title = items
      .map((item) => item.text.trim())
      .find((text) => text && text !== id && text !== `#${id}` && !/^#?\d+$/.test(text)) ?? `Bug #${id}`;
    return {
      id,
      title,
      priority: parsePriority(contextText),
      status: parseStatus(contextText),
      createdAt: contextText.match(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0],
      assignedTo: readAssigneeFromContext(contextText) ?? assignedTo,
      openedBy: undefined,
      confirmed: isConfirmedText(contextText)
    };
  });
}

function parseBugListFromDataIdContexts(html: string, assignedTo?: string): ZenTaoBugSummary[] {
  const source = normalizeZenTaoHtml(html);
  const result = new Map<string, ZenTaoBugSummary>();
  const pattern = /\bdata-(?:bug-id|bug|id)=["']([1-9]\d*)["']/gi;
  for (const match of source.matchAll(pattern)) {
    const id = positiveBugId(match[1]);
    if (!id || result.has(id)) {
      continue;
    }
    const index = match.index ?? 0;
    const contextHtml = source.slice(Math.max(0, index - 1800), Math.min(source.length, index + 3200));
    const contextText = htmlText(contextHtml);
    if (!looksLikeBugListContext(id, contextHtml, contextText)) {
      continue;
    }
    result.set(id, {
      id,
      title: extractBugTitleFromContext(id, contextText),
      priority: parsePriority(contextText),
      status: parseStatus(contextText),
      createdAt: contextText.match(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0],
      assignedTo: readAssigneeFromContext(contextText) ?? assignedTo,
      openedBy: undefined,
      confirmed: isConfirmedText(contextText)
    });
  }
  return [...result.values()];
}

function looksLikeBugListContext(id: string, html: string, text: string): boolean {
  if (!text.includes(id)) {
    return false;
  }
  const hasBugMarker = /bugIDList|bugID|Bug|bug[-/]view|bug-view|m=bug/i.test(html) || /Bug/.test(text);
  const hasStatus = /(激活|已解决|关闭|active|resolved|closed|婵€娲粅宸茶В鍐硘鍏抽棴)/i.test(text);
  const hasPriority = /(一般|严重|致命|建议|高|中|低|high|medium|low|涓€鑸瑋涓ラ噸|鑷村懡|寤鸿|楂榺涓瓅浣?)/i.test(text);
  const hasDate = /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text);
  return hasBugMarker && hasStatus && hasPriority && hasDate;
}

function extractBugTitleFromContext(id: string, text: string): string {
  const normalized = compactText(text);
  const idIndex = normalized.indexOf(id);
  const afterId = idIndex >= 0 ? normalized.slice(idIndex + id.length).trim() : normalized;
  const title =
    afterId.match(/^(.{4,160}?)(?:\s+(?:一般|严重|致命|建议|高|中|低|high|medium|low|激活|已解决|关闭|未确认|已确认|\d{2}-\d{2}\s+\d{2}:\d{2}|涓€鑸?|涓ラ噸|鑷村懡|寤鸿|婵€娲?|宸茶В鍐?|鍏抽棴))/i)?.[1]?.trim() ??
    afterId.slice(0, 120).trim();
  return title || `Bug #${id}`;
}

function readBugIdFromHref(href: string): string | undefined {
  const source = decodeHtmlAttr(href);
  return positiveBugId(
    readQueryParam(source, "bugID") ??
    readQueryParam(source, "id") ??
    source.match(/bug[-/]view[-/](\d+)/i)?.[1] ??
    source.match(/bug-view-(\d+)/i)?.[1] ??
    source.match(/[?&]bug=(\d+)/i)?.[1] ??
    source.match(/(?:^|[/?&=-])bugID[=/](\d+)/i)?.[1] ??
    source.match(/(?:^|[/?&=-])id[=/](\d+)/i)?.[1]
  );
}

function positiveBugId(value: string | undefined): string | undefined {
  const text = (value ?? "").trim().replace(/^#/, "");
  return /^[1-9]\d*$/.test(text) ? text : undefined;
}

function readAssigneeFromContext(value: string): string | undefined {
  const match = value.match(/指派给\s*[:：]?\s*([^\s,，;；|]+)/);
  return match?.[1]?.trim();
}

function parseProjectList(html: string): ZenTaoProject[] {
  const source = decodeJsonHtml(html);
  const linkProjects = matchAll(source, /<a\b[^>]*>[\s\S]*?<\/a>/gi)
    .map((link) => {
      const href = readAttr(link, "href") ?? readAttr(link, "data-url") ?? readAttr(link, "data-href") ?? "";
      const id =
        readProjectIdFromText(href) ??
        readProjectIdFromAttrs(link) ??
        readProjectIdFromText(readAttr(link, "onclick") ?? "");
      const name = htmlText(link);
      const looksLikeProject = /m=bug|m=product|productID|bug[-/]browse|product[-/]browse|browse|data-(?:id|key|value|url|href)=|onclick=/i.test(link);
      return id && name && looksLikeProject && !/^(关闭|closed|more|更多)$/i.test(name) ? { id, name } : undefined;
    })
    .filter((project): project is ZenTaoProject => Boolean(project));

  const itemProjects = matchAll(source, /<(?:li|div|span|button)\b[^>]*(?:data-(?:id|key|value|url|href)=["'][^"']+["'])[^>]*>[\s\S]*?<\/(?:li|div|span|button)>/gi)
    .map((item) => {
      const id =
        readProjectIdFromAttrs(item) ??
        readProjectIdFromText(readAttr(item, "data-url") ?? "") ??
        readProjectIdFromText(readAttr(item, "data-href") ?? "") ??
        readProjectIdFromText(readAttr(item, "onclick") ?? "");
      const name = htmlText(item);
      return id && name && !isIgnoredProjectName(name) ? { id, name } : undefined;
    })
    .filter((project): project is ZenTaoProject => Boolean(project));

  const clickableProjects = matchAll(source, /<(?:li|div|span|button)\b[^>]*onclick=["'][^"']+["'][^>]*>[\s\S]*?<\/(?:li|div|span|button)>/gi)
    .map((item) => {
      const id = readProjectIdFromText(readAttr(item, "onclick") ?? "");
      const name = htmlText(item);
      return id && name && !isIgnoredProjectName(name) ? { id, name } : undefined;
    })
    .filter((project): project is ZenTaoProject => Boolean(project));

  const scriptProjects = parseProjectLikeText(source);
  const projects = [...linkProjects, ...itemProjects, ...clickableProjects, ...scriptProjects];
  return [...new Map(projects.map((project) => [project.id, project])).values()];
}

function parseMemberList(html: string): ZenTaoMember[] {
  const source = normalizeZenTaoHtml(html);
  const members = parseMembersFromSelects(source, [
    "assignedTo",
    "assignedTo[]",
    "openedBy",
    "resolvedBy",
    "closedBy",
    "confirmedBy",
    "lastEditedBy"
  ]);
  return dedupeMembers([...members, ...parseAssignedMembersFromBugRows(source)]);
}

function dedupeMembers(members: ZenTaoMember[]): ZenTaoMember[] {
  return [...new Map(members.map((member) => [member.account, member])).values()].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN")
  );
}

function parseMembersFromSelects(html: string, names: string[]): ZenTaoMember[] {
  const source = normalizeZenTaoHtml(html);
  return names.flatMap((name) => {
    const selects = matchAll(
      source,
      new RegExp(`<select\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/select>`, "gi")
    );
    return selects.flatMap(parseMemberOptions);
  });
}

function parseMemberOptions(selectHtml: string): ZenTaoMember[] {
  return matchAll(selectHtml, /<option\b[^>]*>[\s\S]*?<\/option>/gi)
    .map((option) => {
      const account = decodeHtmlAttr(readAttr(option, "value") ?? "").trim();
      const name = htmlText(option).trim();
      if (!account || !name || isIgnoredMember(account, name)) {
        return undefined;
      }
      return { account, name: name === account ? account : `${name} (${account})` };
    })
    .filter((member): member is ZenTaoMember => Boolean(member));
}

function isIgnoredMember(account: string, name: string): boolean {
  return /^(all|0|closed|ditto|admin|guest)$/i.test(account) || /^(全部|所有|选择|空|无|closed)$/i.test(name);
}

function readUserAccount(html: string): string {
  const href = readAttr(html, "href") ?? "";
  for (const name of ["account", "userID", "assignedTo"]) {
    const match = href.match(new RegExp(`[?&]${name}=([^&#]+)`, "i"));
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  for (const name of ["data-account", "data-user", "data-id", "data-value"]) {
    const value = readAttr(html, name)?.trim();
    if (value) {
      return value;
    }
  }
  const text = htmlText(html).trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{1,40}$/.test(text) ? text : "";
}

function parseMembersFromTeamTable(html: string): ZenTaoMember[] {
  const source = normalizeZenTaoHtml(html);
  const result = new Map<string, ZenTaoMember>();
  for (const row of matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi)) {
    const text = htmlText(row);
    if (!/(账号|用户名|真实姓名|成员|realname|account)/i.test(text) && !matchAll(row, /<td\b[\s\S]*?<\/td>/gi).length) {
      continue;
    }
    for (const link of matchAll(row, /<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      const account = readUserAccount(link);
      const name = htmlText(link).trim();
      if (account && name && !isIgnoredMember(account, name)) {
        result.set(account, { account, name: name === account ? account : `${name} (${account})` });
      }
    }
    for (const cell of matchAll(row, /<td\b[\s\S]*?<\/td>/gi).map(htmlText)) {
      if (/^[A-Za-z][A-Za-z0-9_.-]{1,40}$/.test(cell) && !isIgnoredMember(cell, cell)) {
        if (!result.has(cell)) {
          result.set(cell, { account: cell, name: cell });
        }
      }
    }
  }
  return [...result.values()];
}

function parseAssignedMembersFromBugRows(html: string): ZenTaoMember[] {
  const source = normalizeZenTaoHtml(html);
  const rows = matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi);
  const header = rows.find((row) => /指派给/.test(htmlText(row)));
  const headerCells = header ? matchAll(header, /<t[dh]\b[\s\S]*?<\/t[dh]>/gi).map(htmlText) : [];
  const assignedIndex = headerCells.findIndex((cell) => /指派给/.test(cell));
  if (assignedIndex < 0) {
    return [];
  }

  return rows
    .map((row) => {
      const cells = matchAll(row, /<td\b[\s\S]*?<\/td>/gi);
      const cell = cells[assignedIndex];
      if (!cell || !readBugIdFromRow(row)) {
        return undefined;
      }
      const link = matchAll(cell, /<a\b[^>]*>[\s\S]*?<\/a>/gi)[0] ?? cell;
      const text = htmlText(link).trim();
      const href = readAttr(link, "href") ?? "";
      const account =
        readQueryParam(href, "assignedTo") ??
        readQueryParam(href, "account") ??
        readAttr(link, "data-value") ??
        readAttr(link, "data-id") ??
        text;
      if (!account || !text || /^(closed|ditto|0)$/i.test(account)) {
        return undefined;
      }
      return { account, name: text === account ? account : `${text} (${account})` };
    })
    .filter((member): member is ZenTaoMember => Boolean(member));
}

function extractProductIds(html: string): string[] {
  const source = normalizeZenTaoHtml(html);
  const ids = [
    ...matchAll(source, /productID[=/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(source, /bug[-/]browse[-/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(source, /product[-/]browse[-/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(source, /data-(?:id|key|value)=["'](\d+)["']/gi).map((item) => item.match(/\d+/)?.[0])
  ].filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

function parseBugRow(row: string, assignedTo?: string, columns: BugColumns = {}): ZenTaoBugSummary | undefined {
  const cells = matchAll(row, /<td\b[\s\S]*?<\/td>/gi).map(htmlText);

  const id = readBugIdFromRow(row) ?? positiveBugId(cells.find((cell) => /^#?\d+$/.test(cell))?.replace("#", ""));
  if (!id) {
    return undefined;
  }

  const bugLinks = matchAll(row, /<a\b[^>]*href=["'][^"']*(?:(?:m=bug[^"']*f=view)|(?:f=view[^"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^"']*["'][^>]*>[\s\S]*?<\/a>/gi);
  const linkText = bugLinks
    .map(htmlText)
    .find((text) => text && text !== id && !/^#?\d+$/.test(text)) ?? "";
  const title =
    readCell(cells, columns.title) ??
    (linkText && linkText !== id && !/^#?\d+$/.test(linkText) ? linkText : undefined) ??
    cells.find((cell) => isLikelyBugTitleCell(cell, id)) ??
    `Bug #${id}`;
  const assigneeFromRow = readCell(cells, columns.assignedTo);

  return {
    id,
    title,
    priority: parsePriority(cells.join(" ")),
    status: parseStatus(cells.join(" ")),
    createdAt: readCell(cells, columns.createdAt) ?? cells.find((cell) => /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/.test(cell)),
    assignedTo: assigneeFromRow ?? assignedTo,
    openedBy: readCell(cells, columns.openedBy),
    confirmed: isConfirmedText(readCell(cells, columns.confirmed)) || cells.some((cell) => isConfirmedText(cell))
  };
}

function readBugIdFromRow(row: string): string | undefined {
  for (const link of matchAll(row, /<a\b[^>]*href=["'][^"']*(?:(?:m=bug[^"']*f=view)|(?:f=view[^"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const id = readBugIdFromHref(readAttr(link, "href") ?? "");
    if (id) {
      return id;
    }
  }
  for (const attrName of ["data-bug-id", "data-bug"]) {
    const value = positiveBugId(readAttr(row, attrName)?.match(/\d+/)?.[0]);
    if (value) {
      return value;
    }
  }
  for (const input of matchAll(row, /<input\b[^>]*>/gi)) {
    const inputMarker = `${readAttr(input, "name") ?? ""} ${readAttr(input, "id") ?? ""} ${readAttr(input, "class") ?? ""}`;
    if (!/bug/i.test(inputMarker)) {
      continue;
    }
    const value = positiveBugId(readAttr(input, "value")?.match(/\d+/)?.[0]);
    if (value) {
      return value;
    }
  }
  return positiveBugId(row.match(/\bbugID\s*[:=]\s*["']?(\d+)/i)?.[1]);
}

interface BugColumns {
  title?: number;
  openedBy?: number;
  createdAt?: number;
  assignedTo?: number;
  confirmed?: number;
}

function readBugColumns(headerCells: string[]): BugColumns {
  return {
    title: headerCells.findIndex((cell) => /Bug标题|标题/.test(cell)),
    openedBy: headerCells.findIndex((cell) => /创建者|由谁创建|提交者/.test(cell)),
    createdAt: headerCells.findIndex((cell) => /创建日期|创建时间/.test(cell)),
    assignedTo: headerCells.findIndex((cell) => /指派给/.test(cell)),
    confirmed: headerCells.findIndex((cell) => /确认/.test(cell))
  };
}

function readCell(cells: string[], index: number | undefined): string | undefined {
  if (index === undefined || index < 0) {
    return undefined;
  }
  const value = cells[index]?.trim();
  return value || undefined;
}

function isConfirmedText(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return /已确认|confirmed/i.test(value.trim());
}

function isLikelyBugTitleCell(value: string, id: string): boolean {
  if (!value || value === id || /^#?\d+$/.test(value)) {
    return false;
  }
  if (/^(一般|严重|致命|建议|激活|已解决|关闭|未确认|已确认|未知|高|中|低)$/i.test(value)) {
    return false;
  }
  if (/^\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$|^\d{4}-\d{2}-\d{2}/.test(value)) {
    return false;
  }
  return value.length > 4;
}

function parseBugDetail(html: string, bugId: string, baseUrl: string): ZenTaoBugDetail {
  const source = normalizeZenTaoHtml(html);
  const detailContentHtml = readBugDescriptionHtml(source, baseUrl);
  const detailSections = splitBugDescriptionHtml(detailContentHtml);
  const descriptionHtml = detailSections.descriptionHtml || readSectionHtml(source, ["描述", "Bug描述"], baseUrl);
  const reproduceStepsHtml = detailSections.reproduceStepsHtml || readSectionHtml(source, ["重现步骤", "复现步骤"], baseUrl);
  const expectedResultHtml = detailSections.expectedResultHtml || readSectionHtml(source, ["预期结果", "期望"], baseUrl);
  const actualResultHtml = readSectionHtml(source, ["实际结果"], baseUrl);
  const description = htmlText(descriptionHtml ?? "");
  const title = [readBugTitle(source, bugId), description]
    .map((item) => (item ? stripBugIdPrefix(item, bugId) : undefined))
    .find((item) => item && item !== bugId);
  const text = htmlText(source);

  const attachments = matchAll(source, /<a\b[^>]*href=["']([^"']*(?:file|download)[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi)
    .map((item) => {
      const rawUrl = item.match(/href=["']([^"']+)["']/i)?.[1];
      const url = rawUrl ? new URL(rawUrl.replace(/&amp;/g, "&"), baseUrl).toString() : undefined;
      const name = htmlText(item);
      return {
        name,
        url,
        kind: classifyAttachment(name, url)
      };
    })
    .filter((item) => item.name);

  return {
    id: bugId,
    title: title || `Bug #${bugId}`,
    priority: parsePriority(text),
    status: parseDetailStatus(source, text, baseUrl),
    createdAt: text.match(/\d{4}-\d{2}-\d{2}/)?.[0],
    assignedTo: firstNonBlank(
      readDetailFieldHtml(source, ["当前指派", "指派给"], baseUrl),
      readDetailField(text, "当前指派"),
      readDetailField(text, "指派给")
    ),
    confirmed: /已确认|confirmed/i.test(text),
    description,
    descriptionHtml,
    reproduceSteps: htmlText(reproduceStepsHtml ?? "") || undefined,
    reproduceStepsHtml,
    expectedResult: htmlText(expectedResultHtml ?? "") || undefined,
    expectedResultHtml,
    actualResult: htmlText(actualResultHtml ?? "") || undefined,
    attachments,
    videos: attachments.filter((item) => item.kind === "video"),
    hasVideo: attachments.some((item) => item.kind === "video"),
    comments: matchAll(source, /class=["'][^"']*(?:comment|history|actions|item)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi)
      .map((item) => ({ content: htmlText(item) }))
      .filter((item) => item.content)
  };
}

function extractImageSources(detail: ZenTaoBugDetail): string[] {
  const sources = [
    ...extractImagesFromHtml(detail.descriptionHtml),
    ...extractImagesFromHtml(detail.reproduceStepsHtml),
    ...extractImagesFromHtml(detail.expectedResultHtml)
  ];
  return [...new Set(sources)].filter((item) => !/^data:/i.test(item));
}

function extractImagesFromHtml(html: string | undefined): string[] {
  if (!html) return [];
  const urls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const url = readImageAttr(tag, "data-original-src") || readImageAttr(tag, "src");
    if (url) urls.push(url);
  }
  return urls;
}

function readImageAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

function classifyAttachment(name?: string, url?: string): "image" | "video" | "file" {
  const value = `${name ?? ""} ${url ?? ""}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#\s]|$)/i.test(value)) return "image";
  if (/\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv)(?:[?#\s]|$)/i.test(value)) return "video";
  return "file";
}

async function readImageMeta(metaPath: string): Promise<{ source?: string; path?: string } | undefined> {
  try {
    return JSON.parse(await fs.readFile(metaPath, "utf8")) as { source?: string; path?: string };
  } catch {
    return undefined;
  }
}

function imageExtension(contentType: string): string {
  const value = contentType.toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return ".jpg";
  if (value.includes("gif")) return ".gif";
  if (value.includes("webp")) return ".webp";
  if (value.includes("svg")) return ".svg";
  return ".png";
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readBugTitle(html: string, bugId: string): string | undefined {
  const candidates = [
    ...matchAll(html, /<div\b[^>]*class=["'][^"']*page-title[^"']*["'][^>]*>[\s\S]*?<\/div>/gi),
    ...matchAll(html, /<h1\b[\s\S]*?<\/h1>/gi),
    ...matchAll(html, /<[^>]*class=["'][^"']*(?:detail-title|bug-title)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi)
  ]
    .map((item) => stripBugIdPrefix(htmlText(item), bugId))
    .filter((item) => item && item !== bugId && !/^#?\d+$/.test(item) && item.length > 4);
  return candidates[0];
}

function stripBugIdPrefix(value: string, bugId: string): string {
  return value
    .replace(new RegExp(`^(?:BUG\\s*)?#?${escapeRegExp(bugId)}(?:\\s+|\\s*[-:：#]\\s*)`, "i"), "")
    .replace(new RegExp(`^(?:BUG\\s*)?#?${escapeRegExp(bugId)}$`, "i"), "")
    .trim();
}

function readDetailField(text: string, label: string): string | undefined {
  const pattern = new RegExp(`${label}\\s*[:：]?\\s*([^\\n\\r]+)`, "i");
  return text.match(pattern)?.[1]?.trim();
}

function readDetailFieldHtml(html: string, labels: string[], baseUrl: string): string | undefined {
  const value = readSectionHtml(html, labels, baseUrl);
  return value ? normalizeDetailField(htmlText(value)) : undefined;
}

function normalizeDetailField(value: string | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.replace(/\s*于\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?/g, "").trim() || undefined;
}

function parseDetailStatus(html: string, text: string, baseUrl: string): ZenTaoBugSummary["status"] {
  const field = readDetailFieldHtml(html, ["Bug状态"], baseUrl) ?? readDetailField(text, "Bug状态");
  return parseStatus(field || text);
}

function matchesAssignee(
  currentAssignee: string | undefined,
  expectedAccount: string | undefined,
  members: BugWorkflowRequest["members"]
): boolean {
  if (!expectedAccount) {
    return false;
  }
  if (containsPerson(currentAssignee, expectedAccount)) {
    return true;
  }
  for (const member of members ?? []) {
    if (member.account.toLowerCase() !== expectedAccount.toLowerCase() && member.name.toLowerCase() !== expectedAccount.toLowerCase()) {
      continue;
    }
    if (containsPerson(currentAssignee, member.account) || containsPerson(currentAssignee, member.name)) {
      return true;
    }
  }
  return false;
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function readBugDescriptionHtml(html: string, baseUrl: string): string | undefined {
  const content = extractElementInnerHtmlByClass(html, ["detail-content", "article-content", "bug-content"]);
  const normalizedContent = content ? normalizePreviewContentHtml(content, baseUrl) : undefined;
  if (normalizedContent && htmlText(normalizedContent)) {
    return normalizedContent;
  }
  return readSectionHtml(html, ["描述", "Bug描述"], baseUrl);
}

function extractElementInnerHtmlByClass(html: string, classNames: string[]): string | undefined {
  const classPattern = classNames.map(escapeRegExp).join("|");
  const openTagPattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>`, "gi");
  for (const openMatch of html.matchAll(openTagPattern)) {
    const tagName = openMatch[1]?.toLowerCase();
    if (!tagName || openMatch.index === undefined) {
      continue;
    }
    const innerStart = openMatch.index + openMatch[0].length;
    const innerEnd = findMatchingCloseTag(html, tagName, innerStart);
    if (innerEnd > innerStart) {
      const inner = html.slice(innerStart, innerEnd);
      if (htmlText(inner)) {
        return inner;
      }
    }
  }
  return undefined;
}

function findMatchingCloseTag(html: string, tagName: string, startIndex: number): number {
  const tagPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    if (/^<\//.test(tag)) {
      depth -= 1;
      if (depth === 0) {
        return match.index;
      }
    } else if (!/\/\s*>$/.test(tag)) {
      depth += 1;
    }
  }
  return -1;
}

function splitBugDescriptionHtml(value: string | undefined): {
  descriptionHtml?: string;
  reproduceStepsHtml?: string;
  expectedResultHtml?: string;
} {
  if (!value) {
    return {};
  }
  const steps = findSectionMarker(value, ["步骤", "重现步骤", "复现步骤"]);
  const result = findSectionMarker(value, ["结果", "实际结果"]);
  const expected = findSectionMarker(value, ["期望", "预期结果"]);
  const firstMarkerIndex = [steps?.index, expected?.index].filter((item): item is number => item !== undefined).sort((a, b) => a - b)[0];
  const descriptionHtml = firstMarkerIndex === undefined ? value : value.slice(0, firstMarkerIndex).trim();
  const reproduceStart = steps?.end;
  const reproduceEnd = [result?.index, expected?.index]
    .filter((item): item is number => item !== undefined)
    .sort((a, b) => a - b)[0] ?? value.length;
  const expectedStart = expected?.end;

  return {
    descriptionHtml: descriptionHtml && htmlText(descriptionHtml) ? descriptionHtml : undefined,
    reproduceStepsHtml: reproduceStart !== undefined && reproduceStart < reproduceEnd ? value.slice(reproduceStart, reproduceEnd).trim() : undefined,
    expectedResultHtml: expectedStart !== undefined ? value.slice(expectedStart).trim() : undefined
  };
}

function findSectionMarker(value: string, labels: string[]): { index: number; end: number } | undefined {
  const pattern = new RegExp(`[\\[【]\\s*(?:${labels.map(escapeRegExp).join("|")})\\s*[\\]】]`, "i");
  const match = pattern.exec(value);
  return match && match.index !== undefined ? { index: match.index, end: match.index + match[0].length } : undefined;
}

function readSectionHtml(html: string, labels: string[], baseUrl: string): string | undefined {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`<th\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/th>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i"),
      new RegExp(`<td\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i")
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const value = match ? normalizePreviewContentHtml(match[1], baseUrl) : undefined;
      if (value && htmlText(value)) {
        return value;
      }
    }
  }

  return undefined;
}

function normalizePreviewContentHtml(value: string, baseUrl: string): string {
  return sanitizePreviewHtml(value, baseUrl)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|h\d)>/gi, "\n")
    .replace(/<(?!img\b)[^>]+>/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizePreviewHtml(value: string, baseUrl: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+=["'][^"']*["']/gi, "")
    .replace(/<img\b([^>]*?)\sdata-src=["']([^"']+)["']([^>]*?)>/gi, (match, before: string, url: string, after: string) =>
      /\ssrc=["']/i.test(match) ? match : `<img${before} src="${url}"${after}>`
    )
    .replace(/\s(?:src|href)=["']([^"']+)["']/gi, (match, url: string) => match.replace(url, absoluteUrl(url, baseUrl)));
}

function absoluteUrl(value: string, baseUrl: string): string {
  if (/^(?:https?:|data:|vscode-resource:)/i.test(value)) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function readSection(html: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = html.match(new RegExp(`${escaped}[\\s\\S]{0,200}?<[^>]+>([\\s\\S]{0,2000}?)<\\/[^>]+>`, "i"));
    const value = match ? htmlText(match[1]) : undefined;
    if (value) {
      return value;
    }
  }

  return undefined;
}

function parsePriority(value: string): ZenTaoBugSummary["priority"] {
  if (/严重|致命|高|high|p1/i.test(value)) {
    return "high";
  }
  if (/一般|普通|中|medium|p2/i.test(value)) {
    return "medium";
  }
  if (/建议|低|low|p3/i.test(value)) {
    return "low";
  }
  return "unknown";
}

function parseStatus(value: string): ZenTaoBugSummary["status"] {
  if (/激活|active/i.test(value)) {
    return "active";
  }
  if (/已解决|resolved/i.test(value)) {
    return "resolved";
  }
  if (/关闭|closed/i.test(value)) {
    return "closed";
  }
  return "unknown";
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function computePasswordStrength(password: string): number {
  const characterSets = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z\d]/.test(password)
  ].filter(Boolean).length;
  return Math.min(3, Math.max(0, Math.floor(password.length / 4) + characterSets - 1));
}

function parseFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];

  for (const input of inputs) {
    const name = readAttr(input, "name");
    if (!name) {
      continue;
    }
    fields[name] = decodeHtmlAttr(readAttr(input, "value") ?? "");
  }

  return fields;
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function isLoginExpiredText(value: string): boolean {
  return /登录已超时|重新登入|重新登录/.test(value);
}

function htmlText(value: string): string {
  return compactText(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
  );
}

function decodeJsonHtml(value: string): string {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    return collectStrings(parsed).join("\n");
  } catch {
    // Non-JSON HTML responses are the normal case.
  }
  return value;
}

function normalizeZenTaoHtml(value: string): string {
  let source = value ?? "";
  for (let index = 0; index < 2; index++) {
    const decoded = decodeJsonHtml(source);
    if (decoded === source) {
      break;
    }
    source = decoded;
  }
  return source;
}

export const __zentaoParserTestInternals = {
  normalizeZenTaoHtml,
  parseBugList,
  parseBugListPager
};

function parseLoginResult(value: string): { result?: string | boolean; message?: string; locate?: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const data = parsed as Record<string, unknown>;
    return {
      result: typeof data.result === "string" || typeof data.result === "boolean" ? data.result : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
      locate: typeof data.locate === "string" ? data.locate : undefined
    };
  } catch {
    return undefined;
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

function readAttr(html: string, name: string): string | undefined {
  return html.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']+)["']`, "i"))?.[1];
}

function readQueryParam(value: string, name: string): string | undefined {
  const match = value.match(new RegExp(`[?&]${escapeRegExp(name)}=([^&#]+)`, "i"));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function readProjectIdFromAttrs(html: string): string | undefined {
  return (
    readAttr(html, "data-id") ??
    readAttr(html, "data-key") ??
    readAttr(html, "data-value") ??
    readAttr(html, "data-product") ??
    readAttr(html, "data-product-id")
  )?.match(/\d+/)?.[0];
}

function readProjectIdFromText(value: string): string | undefined {
  return (
    value.match(/productID[=/](\d+)/i)?.[1] ??
    value.match(/bug[-/]browse[-/](\d+)/i)?.[1] ??
    value.match(/product[-/]browse[-/](\d+)/i)?.[1] ??
    value.match(/browse(?:&productID=|-)(\d+)/i)?.[1] ??
    value.match(/(?:productID|product|objectID)\D{0,12}(\d+)/i)?.[1]
  );
}

function parseProjectLikeText(source: string): ZenTaoProject[] {
  const projects: ZenTaoProject[] = [];
  const patterns = [
    /["'](?:id|productID)["']\s*:\s*["']?(\d+)["']?[\s\S]{0,120}?["'](?:name|title)["']\s*:\s*["']([^"']+)["']/gi,
    /["'](?:name|title)["']\s*:\s*["']([^"']+)["'][\s\S]{0,120}?["'](?:id|productID)["']\s*:\s*["']?(\d+)["']?/gi
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const first = match[1];
      const second = match[2];
      const id = /^\d+$/.test(first) ? first : second;
      const name = /^\d+$/.test(first) ? second : first;
      if (id && name && !isIgnoredProjectName(name)) {
        projects.push({ id, name: compactText(name) });
      }
    }
  }

  return projects;
}

function isIgnoredProjectName(name: string): boolean {
  return /^(关闭|closed|more|更多|全部项目|all|搜索)$/i.test(name);
}

function matchAll(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => match[0]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeById(bugs: ZenTaoBugSummary[]): ZenTaoBugSummary[] {
  return [...new Map(bugs.map((bug) => [bug.id, bug])).values()];
}
