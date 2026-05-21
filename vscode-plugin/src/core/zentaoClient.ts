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

const defaultTimeoutMs = 10_000;
const debugEndpoint = "http://127.0.0.1:7837/ingest/16d23de6-52c7-4de0-86a3-b3263b8c05ca";
const debugSessionId = "4538d4";

export class LoginExpiredError extends Error {
  constructor() {
    super("禅道登录已超时，请重新登录。");
    this.name = "LoginExpiredError";
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
    const params = buildBugBrowseParams(projectId);
    const memberRequestParams = memberSourceParams(params);
    const pages = await Promise.all(memberRequestParams.map((requestParams) => this.getText("index.php", requestParams, false)));
    const members = dedupeMembers(pages.flatMap((html) => parseMemberList(html)));
    // #region agent log
    debugLog("M1,M2,M3", "vscode-plugin/src/core/zentaoClient.ts:139", "member list parsed", {
      projectId,
      requestParams: memberRequestParams.map(redactParams),
      memberCount: members.length,
      sampleAccounts: members.slice(0, 8).map((member) => member.account),
      summaries: pages.map(summarizeMemberHtml)
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
        const html = await this.getText("index.php", params, false);
        const bugs = parseBugList(html);
        const members = parseMemberList(html);
        attempts.push({
          params: redactParams(params),
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
        const html = await this.getText("index.php", params, false);
        const bugs = parseBugList(html, assignee);
        // #region agent log
        debugLog("B1,B2,B3,B4", "vscode-plugin/src/core/zentaoClient.ts:208", "bug list response parsed", {
          params: redactParams(params),
          assignee: assignee ?? "<all>",
          ...summarizeBugHtml(html),
          parsedBugCount: bugs.length,
          hasLoginExpiredText: isLoginExpiredText(html) || isLoginExpiredText(decodeJsonHtml(html)),
          hasLicenseExpiredText: /license is expired|版本已经过期/i.test(html),
          preview: compactText(html).slice(0, 300)
        });
        // #endregion
        if (bugs.length) {
          return bugs;
        }
        return this.diagnoseEmptyBugList(params, assignee);
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

  private async diagnoseEmptyBugList(baseParams: Record<string, string>, assignee?: string): Promise<ZenTaoBugSummary[]> {
    const diagnosticRequests = bugDiagnosticParams(baseParams);

    const results = [];
    let fallbackBugs: ZenTaoBugSummary[] = [];
    for (const params of diagnosticRequests) {
      try {
        const html = await this.getText("index.php", params, false);
        const parsedBugs = parseBugList(html, assignee);
        if (!fallbackBugs.length && parsedBugs.length) {
          fallbackBugs = parsedBugs;
        }
        results.push({
          params: redactParams(params),
          ...summarizeBugHtml(html),
          parsedBugCount: parsedBugs.length
        });
      } catch (error) {
        results.push({
          params: redactParams(params),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // #region agent log
    debugLog("B6,B7,B8,B9", "vscode-plugin/src/core/zentaoClient.ts:247", "empty bug list diagnostics completed", {
      baseParams: redactParams(baseParams),
      assignee: assignee ?? "<all>",
      results
    });
    // #endregion
    return fallbackBugs;
  }

  async getBugDetail(bugId: string): Promise<ZenTaoBugDetail> {
    this.ensureSession();
    const html = await this.getText("index.php?m=bug&f=view", { bugID: bugId }, false);
    return this.inlinePreviewImages(await parseBugDetail(html, bugId, this.baseUrl));
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

    try {
      const formResponse = await this.request("index.php", {
        method: "GET",
        params: { ...params, onlybody: "yes" }
      });
      const formHtml = await formResponse.text();
      // #region agent log
      debugLog("W1,W2,W3,W4", "vscode-plugin/src/core/zentaoClient.ts:296", "workflow form inspected", {
        action: request.action,
        bugId: request.bugId,
        endpoint: actionEndpoint,
        formSummary: summarizeWorkflowForm(formHtml),
        preview: compactText(formHtml).slice(0, 300)
      });
      // #endregion
    } catch (error) {
      // #region agent log
      debugLog("W1,W2,W4", "vscode-plugin/src/core/zentaoClient.ts:307", "workflow form inspection failed", {
        action: request.action,
        bugId: request.bugId,
        endpoint: actionEndpoint,
        message: error instanceof Error ? error.message : String(error)
      });
      // #endregion
    }

    const response = await this.request("index.php", {
      method: "POST",
      body: buildWorkflowForm(request),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      params
    });
    const responseText = await response.text().catch(() => "");
    // #region agent log
    debugLog("W1,W2,W3,W4", "vscode-plugin/src/core/zentaoClient.ts:329", "workflow post completed", {
      action: request.action,
      bugId: request.bugId,
      endpoint: actionEndpoint,
      submittedFields: [...buildWorkflowForm(request).keys()],
      responseSummary: summarizeWorkflowResponse(responseText),
      preview: compactText(responseText).slice(0, 300)
    });
    // #endregion
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
    return text;
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
    try {
      const url = this.buildUrl(path, init.params);
      const { params: _params, ajax: _ajax, ...fetchInit } = init;
      const sentCookieHeader = this.cookieHeader;
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          "User-Agent": "ZenTaoBugAssistant/1.0.0",
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

function debugLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
  fetch(debugEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": debugSessionId },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId: "initial",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
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
  const lowercaseProductParams = withLowercaseProductId(baseParams);
  return dedupeParamSets([
    { ...lowercaseProductParams, branch: "all", browseType: "unresolved" },
    { ...baseParams, branch: "all", browseType: "unresolved" },
    { ...lowercaseProductParams, branch: "all", browseType: "bySearch" },
    { ...baseParams, browseType: "bySearch" },
    { ...baseParams, browseType: "all" },
    { ...baseParams, browseType: "unclosed" },
    { ...baseParams, browseType: "assigntome" },
    { ...baseParams, browseType: "all", param: "0", orderBy: "id_desc" }
  ]);
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
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
  const text = htmlText(html);
  const rows = matchAll(html, /<tr\b[\s\S]*?<\/tr>/gi);
  const links = matchAll(html, /<a\b[^>]*>[\s\S]*?<\/a>/gi);
  return {
    htmlLength: html.length,
    tableRowCount: rows.length,
    tableCellCount: matchAll(html, /<td\b[\s\S]*?<\/td>/gi).length,
    bugViewLinkCount: matchAll(html, /m=bug[^"']*f=view|bug[-/]view|bug-view/gi).length,
    bugIdPatternCount: matchAll(html, /(?:bugID|bug-id|data-id|id=["']bug)\D{0,12}\d+/gi).length,
    hasDatatable: /data-ride=["']table|datatable|dataTable/i.test(html),
    hasPager: /pager|pageID|recTotal|recPerPage/i.test(html),
    hasNoDataText: /暂无|没有|无数据|No data|No records/i.test(text),
    hasSearchForm: /module=bug|browseType|searchForm|queryID/i.test(html),
    title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ? htmlText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "") : undefined,
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
  const selects = matchAll(html, /<select\b[\s\S]*?<\/select>/gi);
  const assignedSelect = selects.find((select) => readAttr(select, "name") === "assignedTo");
  return {
    htmlLength: html.length,
    selectNames: [...new Set(selects.map((select) => readAttr(select, "name")).filter(Boolean))],
    assignedToOptionCount: parseMembersFromSelects(html, ["assignedTo", "assignedTo[]"]).length,
    assignedToSelectPreview: assignedSelect ? compactText(assignedSelect).slice(0, 400) : undefined,
    assignedColumnMembers: parseAssignedMembersFromBugRows(html).slice(0, 8),
    userMarkerCount: matchAll(html, /assignedTo|openedBy|resolvedBy|closedBy|account|realname/gi).length
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

function parseBugList(html: string, assignedTo?: string): ZenTaoBugSummary[] {
  const rows = matchAll(html, /<tr\b[\s\S]*?<\/tr>/gi);
  const headerCells = rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row)))
    ? matchAll(rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row))) ?? "", /<t[dh]\b[\s\S]*?<\/t[dh]>/gi).map(htmlText)
    : [];
  const columns = readBugColumns(headerCells);
  const bugs = rows
    .map((row) => parseBugRow(row, assignedTo, columns))
    .filter((bug): bug is ZenTaoBugSummary => Boolean(bug));

  return dedupeById(bugs);
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
  const members = parseMembersFromSelects(html, [
    "assignedTo",
    "assignedTo[]",
    "openedBy",
    "resolvedBy",
    "closedBy",
    "confirmedBy",
    "lastEditedBy"
  ]);
  return dedupeMembers([...members, ...parseAssignedMembersFromBugRows(html)]);
}

function dedupeMembers(members: ZenTaoMember[]): ZenTaoMember[] {
  return [...new Map(members.map((member) => [member.account, member])).values()].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN")
  );
}

function parseMembersFromSelects(html: string, names: string[]): ZenTaoMember[] {
  return names.flatMap((name) => {
    const selects = matchAll(
      html,
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
      if (!account || !name || /^(all|0|closed|ditto)$/i.test(account) || /^(全部|所有|选择|空|无|closed)$/i.test(name)) {
        return undefined;
      }
      return { account, name: name === account ? account : `${name} (${account})` };
    })
    .filter((member): member is ZenTaoMember => Boolean(member));
}

function parseAssignedMembersFromBugRows(html: string): ZenTaoMember[] {
  const rows = matchAll(html, /<tr\b[\s\S]*?<\/tr>/gi);
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
      if (!cell || !/^\d+$/.test(htmlText(cells[0] ?? ""))) {
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
  const ids = [
    ...matchAll(html, /productID[=/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(html, /bug[-/]browse[-/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(html, /product[-/]browse[-/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(html, /data-(?:id|key|value)=["'](\d+)["']/gi).map((item) => item.match(/\d+/)?.[0])
  ].filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

function parseBugRow(row: string, assignedTo?: string, columns: BugColumns = {}): ZenTaoBugSummary | undefined {
  const cells = matchAll(row, /<td\b[\s\S]*?<\/td>/gi).map(htmlText);

  const id = cells.find((cell) => /^#?\d+$/.test(cell))?.replace("#", "");
  if (!id) {
    return undefined;
  }

  const bugLink = matchAll(row, /<a\b[^>]*href=["'][^"']*m=bug[^"']*f=view[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)[0];
  const linkText = bugLink ? htmlText(bugLink) : "";
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
    confirmed: readCell(cells, columns.confirmed)?.includes("已确认")
  };
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
  const detailContentHtml = readBugDescriptionHtml(html, baseUrl);
  const detailSections = splitBugDescriptionHtml(detailContentHtml);
  const descriptionHtml = detailSections.descriptionHtml || readSectionHtml(html, ["描述", "Bug描述"], baseUrl);
  const reproduceStepsHtml = detailSections.reproduceStepsHtml || readSectionHtml(html, ["重现步骤", "复现步骤"], baseUrl);
  const expectedResultHtml = detailSections.expectedResultHtml || readSectionHtml(html, ["预期结果", "期望"], baseUrl);
  const actualResultHtml = readSectionHtml(html, ["实际结果"], baseUrl);
  const description = htmlText(descriptionHtml ?? "");
  const title = [readBugTitle(html, bugId), description]
    .map((item) => item?.replace(/^#?\d+\s*/, "").trim())
    .find((item) => item && item !== bugId);
  const text = htmlText(html);

  return {
    id: bugId,
    title: title || `Bug #${bugId}`,
    priority: parsePriority(text),
    status: parseStatus(text),
    createdAt: text.match(/\d{4}-\d{2}-\d{2}/)?.[0],
    description,
    descriptionHtml,
    reproduceSteps: htmlText(reproduceStepsHtml ?? "") || undefined,
    reproduceStepsHtml,
    expectedResult: htmlText(expectedResultHtml ?? "") || undefined,
    expectedResultHtml,
    actualResult: htmlText(actualResultHtml ?? "") || undefined,
    attachments: matchAll(html, /<a\b[^>]*href=["']([^"']*(?:file|download)[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi)
      .map((item) => ({
        name: htmlText(item),
        url: item.match(/href=["']([^"']+)["']/i)?.[1]
      }))
      .filter((item) => item.name),
    comments: matchAll(html, /class=["'][^"']*(?:comment|history|actions|item)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi)
      .map((item) => ({ content: htmlText(item) }))
      .filter((item) => item.content)
  };
}

function readBugTitle(html: string, bugId: string): string | undefined {
  const candidates = [
    ...matchAll(html, /<div\b[^>]*class=["'][^"']*page-title[^"']*["'][^>]*>[\s\S]*?<\/div>/gi),
    ...matchAll(html, /<h1\b[\s\S]*?<\/h1>/gi),
    ...matchAll(html, /<[^>]*class=["'][^"']*(?:detail-title|bug-title)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi)
  ]
    .map((item) => htmlText(item).replace(/^#?\d+\s*/, "").replace(new RegExp(`^${escapeRegExp(bugId)}\\s*`), "").trim())
    .filter((item) => item && item !== bugId && !/^#?\d+$/.test(item) && item.length > 4);
  return candidates[0];
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
  if (/高|high|p1/i.test(value)) {
    return "high";
  }
  if (/中|medium|p2/i.test(value)) {
    return "medium";
  }
  if (/低|low|p3/i.test(value)) {
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
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    return collectStrings(parsed).join("\n");
  } catch {
    // Non-JSON HTML responses are the normal case.
  }
  return value;
}

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
