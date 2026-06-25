var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/core/zentaoClient.ts
var import_crypto = require("crypto");
var crypto = __toESM(require("crypto"));
var fs = __toESM(require("fs/promises"));
var path = __toESM(require("path"));
var defaultTimeoutMs = 1e4;
var defaultBugRecPerPage = 20;
var LoginExpiredError = class extends Error {
  constructor() {
    super("\u7985\u9053\u767B\u5F55\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    this.name = "LoginExpiredError";
  }
};
var BugListParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "BugListParseError";
  }
};
var ZenTaoClient = class {
  constructor(options) {
    this.options = options;
    this.session = options.session;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    mergeCookieString(this.cookieJar, options.session?.cookie);
  }
  options;
  session;
  cookieJar = /* @__PURE__ */ new Map();
  baseUrl;
  timeoutMs;
  get currentSession() {
    return this.session;
  }
  async login(credentials) {
    debugLog("H1,H3", "vscode-plugin/src/core/zentaoClient.ts:32", "login request starting", {
      baseUrl: this.baseUrl,
      accountProvided: Boolean(credentials.account),
      passwordProvided: Boolean(credentials.password)
    });
    const loginPage = await this.request("index.php?m=user&f=login", { method: "GET", ajax: false });
    const loginHtml = await loginPage.text();
    const formFields = parseFormFields(loginHtml);
    const verifyRandResponse = await this.request("index.php", {
      method: "GET",
      params: { m: "user", f: "refreshRandom" }
    });
    const verifyRand = compactText(await verifyRandResponse.text());
    const encryptedPassword = verifyRand ? md5(`${md5(credentials.password)}${verifyRand}`) : credentials.password;
    debugLog("H15,H16", "vscode-plugin/src/core/zentaoClient.ts:58", "login encrypted payload prepared", {
      formFieldNames: Object.keys(formFields),
      verifyRandReceived: Boolean(verifyRand),
      verifyRandLength: verifyRand.length,
      cookieNamesBeforeLoginPost: cookieNamesFromCookieString(this.cookieHeader)
    });
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
    debugLog("H1,H2,H3", "vscode-plugin/src/core/zentaoClient.ts:51", "login response received", {
      status: response.status,
      redirected: response.redirected,
      setCookieNames: cookieNamesFromSetCookie(setCookieHeader),
      bodyPreview: compactText(loginBody).slice(0, 220)
    });
    const loginResult = parseLoginResult(loginBody);
    if (loginResult?.result === "fail" || loginResult?.result === false) {
      const message = loginResult.message ? htmlText(loginResult.message) : "\u7985\u9053\u62D2\u7EDD\u4E86\u672C\u6B21\u767B\u5F55\u3002";
      throw new Error(`\u767B\u5F55\u5931\u8D25\uFF1A${message}`);
    }
    const cookie = this.cookieHeader || extractCookie(setCookieHeader);
    if (!cookie) {
      throw new Error("\u767B\u5F55\u5931\u8D25\uFF1A\u7985\u9053\u672A\u8FD4\u56DE\u6709\u6548\u4F1A\u8BDD Cookie\u3002");
    }
    this.session = {
      account: credentials.account,
      cookie,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (!await this.isSessionValid()) {
      debugLog("H1,H2,H3", "vscode-plugin/src/core/zentaoClient.ts:88", "login rejected after validation", {
        cookieNames: cookieNamesFromCookieString(this.session.cookie),
        formFieldNames: Object.keys(formFields),
        verifyRandReceived: Boolean(verifyRand),
        loginResult: loginResult?.result,
        loginMessage: loginResult?.message
      });
      this.session = void 0;
      throw new Error("\u767B\u5F55\u5931\u8D25\uFF1A\u7985\u9053\u672A\u63A5\u53D7\u5F53\u524D\u8D26\u53F7\u5BC6\u7801\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    }
    return this.session;
  }
  async listProjects() {
    this.ensureSession();
    const pages = await this.fetchProjectPages();
    return parseProjectList(pages.join("\n"));
  }
  async listMembers(projectId) {
    this.ensureSession();
    const selectNames = projectId ? ["assignedTo", "assignedTo[]"] : ["assignedTo", "assignedTo[]", "openedBy", "resolvedBy", "closedBy", "confirmedBy", "lastEditedBy"];
    const result = /* @__PURE__ */ new Map();
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
    debugLog("M1,M2,M3", "vscode-plugin/src/core/zentaoClient.ts:139", "member list parsed", {
      projectId,
      sourceCount: sources.length,
      memberCount: members.length,
      sampleAccounts: members.slice(0, 8).map((member) => member.account)
    });
    return members;
  }
  async crawlBugAccessDebugInfo(projectId) {
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
  async collectProjectDebugInfo() {
    this.ensureSession();
    debugLog("H2,H4", "vscode-plugin/src/core/zentaoClient.ts:99", "project debug collection starting", {
      sessionCookieNames: cookieNamesFromCookieString(this.session?.cookie),
      hasSessionCookie: Boolean(this.session?.cookie)
    });
    const results = [];
    const pages = await this.fetchProjectPages(results);
    const projects = parseProjectList(pages.join("\n"));
    debugLog("H4,H5", "vscode-plugin/src/core/zentaoClient.ts:107", "project debug collection completed", {
      parsedProjectCount: projects.length,
      requestCount: results.length,
      timedOutResponses: results.filter((result) => /登录已超时|重新登入|login/i.test(result.body)).length,
      firstPreview: compactText(results[0]?.body ?? "").slice(0, 220)
    });
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
  async isSessionValid() {
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
  async listAssignedBugs(account = this.session?.account) {
    return this.listBugs({ assigneeScope: "member", assignee: account });
  }
  async listBugs(query = {}) {
    this.ensureSession();
    const assignees = resolveAssignees(query, this.session?.account);
    debugLog("B1,B2,B3", "vscode-plugin/src/core/zentaoClient.ts:196", "bug list request starting", {
      projectId: query.projectId,
      assigneeScope: query.assigneeScope,
      assigneeCount: assignees.length,
      assignees: assignees.map((assignee) => assignee ?? "<all>")
    });
    const bugGroups = await Promise.all(
      assignees.map(async (assignee) => {
        const params = buildBugBrowseParams(query.projectId, assignee);
        const bugs = await this.fetchBugListFromCandidates(params, assignee);
        debugLog("B1,B2,B3,B4", "vscode-plugin/src/core/zentaoClient.ts:208", "bug list response parsed", {
          params: redactParams(params),
          assignee: assignee ?? "<all>",
          parsedBugCount: bugs.length
        });
        return bugs;
      })
    );
    const deduped = dedupeById(bugGroups.flat());
    debugLog("B1,B2,B3,B4", "vscode-plugin/src/core/zentaoClient.ts:226", "bug list request completed", {
      groupCounts: bugGroups.map((group) => group.length),
      dedupedCount: deduped.length
    });
    return deduped;
  }
  async fetchBugListFromCandidates(baseParams, assignee) {
    const attempts = [];
    let parseFailure;
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
    debugLog("B6,B7,B8,B9", "vscode-plugin/src/core/zentaoClient.ts:fetchBugListFromCandidates", "bug list candidates empty", {
      baseParams: redactParams(baseParams),
      assignee: assignee ?? "<all>",
      attempts
    });
    if (parseFailure) {
      throw parseFailure;
    }
    return [];
  }
  async fetchBugListAllPages(baseParams, assignee) {
    const firstParams = { ...baseParams };
    const firstPage = await this.getBugListText(firstParams, assignee);
    const firstHtml = firstPage.html;
    const firstBugs = parseBugList(firstHtml, assignee);
    const pager = parseBugListPager(firstHtml);
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
    assertBugListParseHealthy(firstHtml, firstBugs, firstParams);
    if (!pager || pager.pageTotal <= 1) {
      return firstBugs;
    }
    const allBugs = [...firstBugs];
    for (let page = 2; page <= pager.pageTotal; page++) {
      const pageParams = {
        ...baseParams,
        pageID: String(page),
        recPerPage: String(pager.recPerPage),
        recTotal: String(pager.recTotal)
      };
      try {
        const html = (await this.getBugListText(pageParams, assignee, firstPage.ajax)).html;
        const pageBugs = parseBugList(html, assignee);
        if (!pageBugs.length && allBugs.length) {
          break;
        }
        allBugs.push(...pageBugs);
      } catch (error) {
        if (allBugs.length) {
          break;
        }
        throw error;
      }
    }
    return dedupeById(allBugs);
  }
  async getBugListText(params, assignee, preferredAjax) {
    const modes = preferredAjax === void 0 ? [true, false] : [preferredAjax, !preferredAjax];
    let fallback;
    let parseFailure;
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
  async getBugDetail(bugId) {
    this.ensureSession();
    const html = await this.getText("index.php?m=bug&f=view", { bugID: bugId }, false);
    return this.inlinePreviewImages(await parseBugDetail(html, bugId, this.baseUrl));
  }
  async enrichVideoFlags(bugs) {
    const result = [];
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
  async preparePromptImages(detail, cacheRoot) {
    const sources = extractImageSources(detail);
    const promptImages = [];
    for (const source of sources.slice(0, 32)) {
      try {
        promptImages.push(await this.downloadPromptImage(detail.id, source, cacheRoot));
      } catch {
      }
    }
    return { ...detail, promptImages };
  }
  async clearImageCache(cacheRoot) {
    const imageDir = path.join(cacheRoot, "bug-images");
    await fs.rm(imageDir, { recursive: true, force: true }).catch(() => void 0);
  }
  async downloadPromptImage(bugId, source, cacheRoot) {
    const normalizedSource = source.replace(/&amp;/g, "&");
    const uri = new URL(normalizedSource, this.baseUrl).toString();
    const imageDir = path.join(cacheRoot, "bug-images");
    await fs.mkdir(imageDir, { recursive: true });
    const digest = crypto.createHash("sha1").update(uri).digest("hex").slice(0, 16);
    const metaPath = path.join(imageDir, `bug-${safeFilePart(bugId)}-${digest}.json`);
    const existing = await readImageMeta(metaPath);
    if (existing?.source === uri && existing.path) {
      const stat2 = await fs.stat(existing.path).catch(() => void 0);
      if (stat2 && stat2.size > 0) {
        return existing.path;
      }
    }
    const response = await this.request(uri, { method: "GET", ajax: false, headers: { Accept: "image/*" } });
    const contentType = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`\u4E0D\u662F\u56FE\u7247\u54CD\u5E94\uFF1A${contentType}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(imageDir, `bug-${safeFilePart(bugId)}-${digest}${imageExtension(contentType)}`);
    await fs.writeFile(filePath, bytes);
    await fs.writeFile(metaPath, JSON.stringify({ source: uri, contentType, path: filePath, savedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2), "utf8");
    return filePath;
  }
  async inlinePreviewImages(detail) {
    const inlineHtml = async (value) => {
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
          const inlinedTag = imageTag.replace(src, dataUri).replace(/<img\b(?![^>]*\bdata-original-src=)/i, `<img data-original-src="${src}"`);
          result = result.replace(imageTag, inlinedTag);
        } catch (error) {
        }
      }
      return result;
    };
    detail.descriptionHtml = await inlineHtml(detail.descriptionHtml);
    detail.reproduceStepsHtml = await inlineHtml(detail.reproduceStepsHtml);
    detail.expectedResultHtml = await inlineHtml(detail.expectedResultHtml);
    return detail;
  }
  async updateBugWorkflow(request) {
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
    debugLog("W1,W2,W3,W4", "vscode-plugin/src/core/zentaoClient.ts:296", "workflow form inspected", {
      action: request.action,
      bugId: request.bugId,
      endpoint: actionEndpoint,
      submitPath,
      formSummary: summarizeWorkflowForm(formHtml),
      preview: compactText(formHtml).slice(0, 300)
    });
    const submitParams = submitPath === "index.php" ? formParams : void 0;
    const response = await this.request(submitPath, {
      method: "POST",
      body: submitForm,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.buildUrl("index.php", formParams).toString(),
        Origin: this.buildUrl("/").origin
      },
      params: submitParams,
      ajax: request.action === "assign" || request.action === "confirm" || request.action === "resolve" || request.action === "activate" ? false : void 0
    });
    const responseText = await response.text().catch(() => "");
    debugLog("W1,W2,W3,W4", "vscode-plugin/src/core/zentaoClient.ts:329", "workflow post completed", {
      action: request.action,
      bugId: request.bugId,
      endpoint: actionEndpoint,
      submittedFields: [...submitForm.keys()],
      responseSummary: summarizeWorkflowResponse(responseText),
      preview: compactText(responseText).slice(0, 300)
    });
    const responseError = extractWorkflowResponseError(responseText);
    if (responseError) {
      throw new Error(`\u7985\u9053\u672A\u63A5\u53D7\u8BE5\u5DE5\u4F5C\u6D41\u63D0\u4EA4\uFF1A${responseError}`);
    }
    await this.verifyWorkflowEffect(request, responseText);
  }
  async verifyWorkflowEffect(request, responseText) {
    const html = await this.getText("index.php?m=bug&f=view", { bugID: request.bugId }, false);
    const detail = parseBugDetail(html, request.bugId, this.baseUrl);
    const ok = request.action === "assign" && matchesAssignee(detail.assignedTo, request.assignedTo, request.members) || request.action === "resolve" && detail.status === "resolved" || request.action === "close" && detail.status === "closed" || request.action === "activate" && detail.status === "active" || request.action === "confirm" && detail.confirmed === true;
    if (!ok) {
      const hint = extractWorkflowResponseError(responseText);
      throw new Error(`\u7985\u9053${workflowActionName(request.action)}\u540E\u6821\u9A8C\u672A\u751F\u6548\u3002\u5F53\u524D\u72B6\u6001\uFF1A${detail.status || "\u672A\u77E5"}\uFF0C\u5F53\u524D\u6307\u6D3E\uFF1A${detail.assignedTo || "\u672A\u77E5"}${hint ? `\u3002${hint}` : ""}`);
    }
  }
  ensureSession() {
    if (!this.session?.cookie) {
      throw new Error("\u5C1A\u672A\u767B\u5F55\u7985\u9053\uFF0C\u8BF7\u5148\u767B\u5F55\u3002");
    }
  }
  authHeaders() {
    return this.cookieHeader ? { Cookie: this.cookieHeader } : {};
  }
  get cookieHeader() {
    return [...this.cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  async getText(path2, params, ajax = true) {
    const response = await this.request(path2, { params, ajax });
    const text = await response.text();
    const decodedText = decodeJsonHtml(text);
    if (isLoginExpiredText(text) || isLoginExpiredText(decodedText)) {
      debugLog("H4,H6", "vscode-plugin/src/core/zentaoClient.ts:194", "zentao response indicates login expired", {
        path: path2,
        params: redactParams(params),
        preview: compactText(text).slice(0, 220),
        decodedPreview: compactText(decodedText).slice(0, 220),
        requestCookieNames: cookieNamesFromCookieString(this.session?.cookie)
      });
      throw new LoginExpiredError();
    }
    return decodedText;
  }
  async tryGetText(path2, params) {
    try {
      return await this.getText(path2, params);
    } catch {
      return void 0;
    }
  }
  async fetchProjectPages(results) {
    const pages = [];
    const seedRequests = [
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
      const dropdownRequests = [
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
  async tryGetProjectPage(request, results) {
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
        status: void 0,
        body: error instanceof Error ? error.message : String(error)
      });
      return void 0;
    }
  }
  async request(path2, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = this.buildUrl(path2, init.params);
    try {
      const { params: _params, ajax: _ajax, ...fetchInit } = init;
      const sentCookieHeader = this.cookieHeader;
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          "User-Agent": "ZenTaoBugAssistant/1.0.1",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          ...init.ajax === false ? {} : { "X-Requested-With": "XMLHttpRequest" },
          ...this.authHeaders(),
          ...init.headers
        }
      });
      if (response.status < 200 || response.status >= 400) {
        throw new Error(`\u7985\u9053\u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${response.status}`);
      }
      mergeSetCookieHeader(this.cookieJar, response.headers.get("set-cookie"));
      if (this.session && this.cookieHeader) {
        this.session.cookie = this.cookieHeader;
      }
      const preview = await response.clone().text().catch(() => "");
      debugLog("H2,H4", "vscode-plugin/src/core/zentaoClient.ts:210", "zentao request response", {
        path: path2,
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
      return response;
    } catch (error) {
      throw formatZenTaoRequestError(url.toString(), error, this.timeoutMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  buildUrl(path2, params) {
    const url = new URL(path2, this.baseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    return url;
  }
};
function debugLog(_hypothesisId, _location, _message, _data) {
}
function cookieNamesFromSetCookie(value) {
  return (value?.split(/,(?=\s*[^;,]+=)/) ?? []).map((cookie) => cookie.split("=")[0]?.trim()).filter(Boolean);
}
function cookieNamesFromCookieString(value) {
  return (value?.split(";") ?? []).map((cookie) => cookie.split("=")[0]?.trim()).filter(Boolean);
}
function redactParams(params) {
  if (!params) {
    return void 0;
  }
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      /pass|pwd|token|key|cookie/i.test(key) ? "<redacted>" : value
    ])
  );
}
function buildBugBrowseParams(projectId, assignee) {
  const params = {
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
function bugDiagnosticParams(baseParams) {
  return bugBrowseParamSetsFromBase(baseParams);
}
function bugBrowseParamSetsFromBase(baseParams) {
  return dedupeParamSets(
    bugScopeParamVariants(baseParams).flatMap((params) => {
      const lowercaseProductParams = withLowercaseProductId(params);
      return [
        params,
        { ...lowercaseProductParams, branch: "all", browseType: "unresolved" },
        { ...params, branch: "all", browseType: "unresolved" },
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
function memberSources(projectId) {
  const sources = [];
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
function bugBrowseParamSets(projectId, assignee) {
  const bases = bugScopeParamVariants(buildBugBrowseParams(projectId, assignee));
  const result = [...bases];
  for (const base of bases) {
    for (const browseType of ["bySearch", "all", "unclosed", "assigntome"]) {
      result.push({ ...base, browseType });
    }
  }
  return result;
}
function bugScopeParamVariants(baseParams) {
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
function dedupeMemberSources(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const key = `${value.path}?${JSON.stringify(Object.entries(value.params).sort(([left], [right]) => left.localeCompare(right)))}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function withLowercaseProductId(params) {
  const next = { ...params };
  if (next.productID) {
    next.productid = next.productID;
    delete next.productID;
  }
  return next;
}
function dedupeParamSets(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const key = JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function resolveAssignees(query, currentAccount) {
  if (query.assigneeScope === "all") {
    return [void 0];
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
function buildWorkflowForm(request) {
  const form = new URLSearchParams();
  const comment = request.comment ?? "";
  form.set("comment", comment);
  form.set("remark", comment);
  form.set("comment[]", comment);
  form.set("mailto", "");
  if (request.action === "resolve") {
    form.set("resolution", request.solution ?? "fixed");
    form.set("resolvedBuild", request.resolvedBuild ?? "trunk");
    form.set("resolvedDate", formatZenTaoDate(/* @__PURE__ */ new Date()));
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
function buildAssignWorkflowForm(source, request) {
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
function buildConfirmWorkflowForm(source, request) {
  const form = new URLSearchParams();
  for (const key of ["assignedTo", "type", "pri", "status", "uid"]) {
    if (source.has(key)) {
      form.set(key, source.get(key) ?? "");
    }
  }
  form.set("comment", request.comment ?? "");
  return form;
}
function buildResolveWorkflowForm(source, request, formHtml) {
  const form = new URLSearchParams();
  form.set("resolution", nonBlank(request.solution) ?? nonBlank(source.get("resolution")) ?? "fixed");
  form.set("duplicateBug", nonBlank(source.get("duplicateBug")) ?? "0");
  form.set("buildExecution", nonBlank(source.get("buildExecution")) ?? "0");
  form.set(
    "resolvedBuild",
    nonBlank(request.resolvedBuild) ?? nonBlank(source.get("resolvedBuild")) ?? readSelectFieldValue(formHtml, "resolvedBuild") ?? "trunk"
  );
  form.set("buildName", nonBlank(source.get("buildName")) ?? "");
  form.set("resolvedDate", formatZenTaoDate(/* @__PURE__ */ new Date()));
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
function buildActivateWorkflowForm(source, request) {
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
function readWorkflowFormFields(html) {
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
function readFormAction(html) {
  const form = html.match(/<form\b[^>]*>/i)?.[0];
  return form ? readAttr(form, "action")?.replace(/&amp;/g, "&") : void 0;
}
function nonBlank(value) {
  const trimmed = (value ?? "").trim();
  return trimmed || void 0;
}
function readSelectFieldValue(html, name) {
  const select = html.match(new RegExp(`<select\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/select>`, "i"))?.[0];
  if (!select) {
    return void 0;
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
  return void 0;
}
function extractWorkflowResponseError(value) {
  const alertMatch = value.match(/alert\s*\(\s*['"]([^'"]+)['"]/i);
  if (alertMatch?.[1]) {
    return alertMatch[1].replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  }
  const parsed = parseLoginResult(value);
  if (parsed?.result === "fail" && parsed.message) {
    return parsed.message.trim();
  }
  if (value.includes('"result":"fail"')) {
    return "\u7985\u9053\u8FD4\u56DE\u5931\u8D25\u7ED3\u679C";
  }
  const text = htmlText(value);
  if (/不能为空|必填|请选择|失败|错误/i.test(text) && text.length <= 240) {
    return text;
  }
  return void 0;
}
function containsPerson(value, expected) {
  if (!expected) return false;
  const actual = personAliases(value);
  const target = personAliases(expected);
  return target.some((item) => actual.some((candidate) => candidate === item || candidate.includes(item) || item.includes(candidate)));
}
function personAliases(value) {
  const text = (value ?? "").trim();
  if (!text) return [];
  const aliases = [text, ...text.split(/[|/／,，;；]/).map((item) => item.trim())];
  const beforeParen = text.replace(/\s*[（(].*?[）)]\s*/g, "").trim();
  if (beforeParen) aliases.push(beforeParen);
  for (const match of text.matchAll(/[（(]([^）)]+)[）)]/g)) aliases.push(match[1].trim());
  return [...new Set(aliases.map((item) => item.toLowerCase()).filter(Boolean))];
}
function workflowActionName(action) {
  return { assign: "\u6307\u6D3E", confirm: "\u786E\u8BA4", resolve: "\u89E3\u51B3", close: "\u5173\u95ED", activate: "\u6FC0\u6D3B" }[action];
}
function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
function describeErrorChain(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const messages = [];
  let current = error;
  while (current instanceof Error) {
    if (current.message && !messages.includes(current.message)) {
      messages.push(current.message);
    }
    current = current.cause;
  }
  return messages.join("\uFF1B") || "\u672A\u77E5\u9519\u8BEF";
}
function formatZenTaoRequestError(url, error, timeoutMs) {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`\u8FDE\u63A5\u7985\u9053\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)} \u79D2\uFF09\uFF1A${url}`);
  }
  const detail = describeErrorChain(error);
  if (/fetch failed/i.test(detail)) {
    return new Error(
      `\u65E0\u6CD5\u8FDE\u63A5\u7985\u9053\u670D\u52A1\u5668 ${url}\u3002\u8BF7\u68C0\u67E5\u670D\u52A1\u5668\u5730\u5740\u3001VPN/\u5185\u7F51\u8FDE\u63A5\u548C\u9632\u706B\u5899\u3002\u5E95\u5C42\u9519\u8BEF\uFF1A${detail}`
    );
  }
  if (error instanceof Error && /禅道/.test(error.message)) {
    return error;
  }
  return new Error(`\u7985\u9053\u8BF7\u6C42\u5931\u8D25\uFF08${url}\uFF09\uFF1A${detail}`);
}
function formatZenTaoDate(value) {
  const pad = (item) => String(item).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
function extractCookie(setCookieHeader) {
  return (setCookieHeader?.split(/,(?=\s*[^;,]+=)/) ?? []).map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}
function mergeCookieString(jar, cookieHeader) {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...valueParts] = part.trim().split("=");
    const value = valueParts.join("=");
    if (name && value) {
      jar.set(name, value);
    }
  }
}
function mergeSetCookieHeader(jar, setCookieHeader) {
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
function summarizeBugHtml(html) {
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
    title: source.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ? htmlText(source.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "") : void 0,
    linkSamples: links.slice(0, 8).map((link) => ({
      href: readAttr(link, "href") ?? "",
      dataUrl: readAttr(link, "data-url") ?? "",
      text: htmlText(link).slice(0, 120)
    })),
    rowSamples: rows.slice(0, 5).map((row) => htmlText(row).slice(0, 220))
  };
}
function summarizeWorkflowForm(html) {
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
function summarizeWorkflowResponse(value) {
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
function summarizeSelectOptions(html, name) {
  const select = html.match(new RegExp(`<select\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/select>`, "i"))?.[0];
  if (!select) {
    return [];
  }
  return matchAll(select, /<option\b[^>]*>[\s\S]*?<\/option>/gi).map(htmlText).filter(Boolean).slice(0, 12);
}
function parseBugListPager(html) {
  const source = normalizeZenTaoHtml(html);
  const recTotal = readPagerNumber(source, "recTotal");
  const recPerPage = readPagerNumber(source, "recPerPage") ?? defaultBugRecPerPage;
  const pageID = readPagerNumber(source, "pageID") ?? 1;
  const pageTotal = readPagerNumber(source, "pageTotal");
  let total = recTotal;
  if (total === void 0) {
    const summeryMatch = source.match(/共\s*(?:<[^>]+>\s*)?(\d+)\s*(?:<\/[^>]+>\s*)?项/i) ?? source.match(/,\s*共\s*(\d+)\s*项/i) ?? source.match(/total\s*(?:<[^>]+>\s*)?(\d+)/i);
    total = summeryMatch ? Number(summeryMatch[1]) : void 0;
  }
  if (total === void 0 || total <= 0) {
    return void 0;
  }
  const perPage = recPerPage > 0 ? recPerPage : defaultBugRecPerPage;
  const pages = pageTotal && pageTotal > 0 ? pageTotal : Math.max(1, Math.ceil(total / perPage));
  const current = pageID > 0 ? pageID : 1;
  return { recTotal: total, recPerPage: perPage, pageID: current, pageTotal: pages };
}
function readPagerNumber(html, key) {
  const hidden = html.match(new RegExp(`<input\\b[^>]*\\b(?:id|name)=["']_?${key}["'][^>]*\\bvalue=["'](\\d+)["']`, "i")) ?? html.match(new RegExp(`<input\\b[^>]*\\bvalue=["'](\\d+)["'][^>]*\\b(?:id|name)=["']_?${key}["']`, "i"));
  if (hidden?.[1]) {
    return Number(hidden[1]);
  }
  const fromUrl = [...html.matchAll(new RegExp(`[?&]${key}=?(\\d+)`, "gi"))].map((match) => Number(match[1]));
  if (fromUrl.length) {
    return key.toLowerCase() === "rectotal" ? Math.max(...fromUrl) : fromUrl[0];
  }
  const fromJs = html.match(new RegExp(`${key}\\s*[:=]\\s*['"]?(\\d+)`, "i"));
  if (fromJs?.[1]) {
    return Number(fromJs[1]);
  }
  return void 0;
}
function assertBugListParseHealthy(html, bugs, params) {
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
    `\u7985\u9053\u8FD4\u56DE\u4E86 Bug \u5217\u8868\u75D5\u8FF9\uFF0C\u4F46\u63D2\u4EF6\u89E3\u6790\u4E3A 0\u3002\u8BF7\u628A\u201C\u5217\u8868\u8BCA\u65AD\u201D\u4FE1\u606F\u53D1\u7ED9\u6211\u7EE7\u7EED\u8865\u89C4\u5219\u3002\u8BF7\u6C42\u53C2\u6570\uFF1A${JSON.stringify(
      redactParams(params)
    )}\uFF1B\u9875\u9762\u6458\u8981\uFF1Arows=${summary.tableRowCount}, cells=${summary.tableCellCount}, bugLinks=${summary.bugViewLinkCount}, bugIdPatterns=${summary.bugIdPatternCount}, recTotal=${pager?.recTotal ?? "unknown"}\uFF1B\u9884\u89C8\uFF1A${preview}`
  );
}
function hasBugListPageEvidence(html) {
  const source = normalizeZenTaoHtml(html);
  const pager = parseBugListPager(source);
  const summary = summarizeBugHtml(source);
  return (pager?.recTotal ?? 0) > 0 || Number(summary.bugViewLinkCount ?? 0) > 0 || Number(summary.bugIdPatternCount ?? 0) > 0 && !summary.hasNoDataText;
}
function parseBugList(html, assignedTo) {
  const source = normalizeZenTaoHtml(html);
  const rows = matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi);
  const headerCells = rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row))) ? matchAll(rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row))) ?? "", /<t[dh]\b[\s\S]*?<\/t[dh]>/gi).map(htmlText) : [];
  const columns = readBugColumns(headerCells);
  const bugs = rows.map((row) => parseBugRow(row, assignedTo, columns)).filter((bug) => Boolean(bug));
  const linkBugs = bugs.length ? [] : parseBugListFromLinks(source, assignedTo);
  const contextBugs = bugs.length || linkBugs.length ? [] : parseBugListFromDataIdContexts(source, assignedTo);
  return dedupeById(bugs.length ? bugs : linkBugs.length ? linkBugs : contextBugs);
}
function parseBugListFromLinks(html, assignedTo) {
  const source = normalizeZenTaoHtml(html);
  const links = matchAll(source, /<a\b[^>]*href=["']([^"']*(?:(?:m=bug[^"']*f=view)|(?:f=view[^"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi);
  const grouped = /* @__PURE__ */ new Map();
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
    const title = items.map((item) => item.text.trim()).find((text) => text && text !== id && text !== `#${id}` && !/^#?\d+$/.test(text)) ?? `Bug #${id}`;
    return {
      id,
      title,
      priority: parsePriority(contextText),
      status: parseStatus(contextText),
      createdAt: contextText.match(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0],
      assignedTo: readAssigneeFromContext(contextText) ?? assignedTo,
      openedBy: void 0,
      confirmed: isConfirmedText(contextText)
    };
  });
}
function parseBugListFromDataIdContexts(html, assignedTo) {
  const source = normalizeZenTaoHtml(html);
  const result = /* @__PURE__ */ new Map();
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
      openedBy: void 0,
      confirmed: isConfirmedText(contextText)
    });
  }
  return [...result.values()];
}
function looksLikeBugListContext(id, html, text) {
  if (!text.includes(id)) {
    return false;
  }
  const hasBugMarker = /bugIDList|bugID|Bug|bug[-/]view|bug-view|m=bug/i.test(html) || /Bug/.test(text);
  const hasStatus = /(激活|已解决|关闭|active|resolved|closed|婵€娲粅宸茶В鍐硘鍏抽棴)/i.test(text);
  const hasPriority = /(一般|严重|致命|建议|高|中|低|high|medium|low|涓€鑸瑋涓ラ噸|鑷村懡|寤鸿|楂榺涓瓅浣?)/i.test(text);
  const hasDate = /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text);
  return hasBugMarker && hasStatus && hasPriority && hasDate;
}
function extractBugTitleFromContext(id, text) {
  const normalized = compactText(text);
  const idIndex = normalized.indexOf(id);
  const afterId = idIndex >= 0 ? normalized.slice(idIndex + id.length).trim() : normalized;
  const title = afterId.match(/^(.{4,160}?)(?:\s+(?:一般|严重|致命|建议|高|中|低|high|medium|low|激活|已解决|关闭|未确认|已确认|\d{2}-\d{2}\s+\d{2}:\d{2}|涓€鑸?|涓ラ噸|鑷村懡|寤鸿|婵€娲?|宸茶В鍐?|鍏抽棴))/i)?.[1]?.trim() ?? afterId.slice(0, 120).trim();
  return title || `Bug #${id}`;
}
function readBugIdFromHref(href) {
  const source = decodeHtmlAttr(href);
  return positiveBugId(
    readQueryParam(source, "bugID") ?? readQueryParam(source, "id") ?? source.match(/bug[-/]view[-/](\d+)/i)?.[1] ?? source.match(/bug-view-(\d+)/i)?.[1] ?? source.match(/[?&]bug=(\d+)/i)?.[1] ?? source.match(/(?:^|[/?&=-])bugID[=/](\d+)/i)?.[1] ?? source.match(/(?:^|[/?&=-])id[=/](\d+)/i)?.[1]
  );
}
function positiveBugId(value) {
  const text = (value ?? "").trim().replace(/^#/, "");
  return /^[1-9]\d*$/.test(text) ? text : void 0;
}
function readAssigneeFromContext(value) {
  const match = value.match(/指派给\s*[:：]?\s*([^\s,，;；|]+)/);
  return match?.[1]?.trim();
}
function parseProjectList(html) {
  const source = decodeJsonHtml(html);
  const linkProjects = matchAll(source, /<a\b[^>]*>[\s\S]*?<\/a>/gi).map((link) => {
    const href = readAttr(link, "href") ?? readAttr(link, "data-url") ?? readAttr(link, "data-href") ?? "";
    const id = readProjectIdFromText(href) ?? readProjectIdFromAttrs(link) ?? readProjectIdFromText(readAttr(link, "onclick") ?? "");
    const name = htmlText(link);
    const looksLikeProject = /m=bug|m=product|productID|bug[-/]browse|product[-/]browse|browse|data-(?:id|key|value|url|href)=|onclick=/i.test(link);
    return id && name && looksLikeProject && !/^(关闭|closed|more|更多)$/i.test(name) ? { id, name } : void 0;
  }).filter((project) => Boolean(project));
  const itemProjects = matchAll(source, /<(?:li|div|span|button)\b[^>]*(?:data-(?:id|key|value|url|href)=["'][^"']+["'])[^>]*>[\s\S]*?<\/(?:li|div|span|button)>/gi).map((item) => {
    const id = readProjectIdFromAttrs(item) ?? readProjectIdFromText(readAttr(item, "data-url") ?? "") ?? readProjectIdFromText(readAttr(item, "data-href") ?? "") ?? readProjectIdFromText(readAttr(item, "onclick") ?? "");
    const name = htmlText(item);
    return id && name && !isIgnoredProjectName(name) ? { id, name } : void 0;
  }).filter((project) => Boolean(project));
  const clickableProjects = matchAll(source, /<(?:li|div|span|button)\b[^>]*onclick=["'][^"']+["'][^>]*>[\s\S]*?<\/(?:li|div|span|button)>/gi).map((item) => {
    const id = readProjectIdFromText(readAttr(item, "onclick") ?? "");
    const name = htmlText(item);
    return id && name && !isIgnoredProjectName(name) ? { id, name } : void 0;
  }).filter((project) => Boolean(project));
  const scriptProjects = parseProjectLikeText(source);
  const projects = [...linkProjects, ...itemProjects, ...clickableProjects, ...scriptProjects];
  return [...new Map(projects.map((project) => [project.id, project])).values()];
}
function parseMemberList(html) {
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
function dedupeMembers(members) {
  return [...new Map(members.map((member) => [member.account, member])).values()].sort(
    (left, right) => left.name.localeCompare(right.name, "zh-CN")
  );
}
function parseMembersFromSelects(html, names) {
  const source = normalizeZenTaoHtml(html);
  return names.flatMap((name) => {
    const selects = matchAll(
      source,
      new RegExp(`<select\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/select>`, "gi")
    );
    return selects.flatMap(parseMemberOptions);
  });
}
function parseMemberOptions(selectHtml) {
  return matchAll(selectHtml, /<option\b[^>]*>[\s\S]*?<\/option>/gi).map((option) => {
    const account = decodeHtmlAttr(readAttr(option, "value") ?? "").trim();
    const name = htmlText(option).trim();
    if (!account || !name || isIgnoredMember(account, name)) {
      return void 0;
    }
    return { account, name: name === account ? account : `${name} (${account})` };
  }).filter((member) => Boolean(member));
}
function isIgnoredMember(account, name) {
  return /^(all|0|closed|ditto|admin|guest)$/i.test(account) || /^(全部|所有|选择|空|无|closed)$/i.test(name);
}
function readUserAccount(html) {
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
function parseMembersFromTeamTable(html) {
  const source = normalizeZenTaoHtml(html);
  const result = /* @__PURE__ */ new Map();
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
function parseAssignedMembersFromBugRows(html) {
  const source = normalizeZenTaoHtml(html);
  const rows = matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi);
  const header = rows.find((row) => /指派给/.test(htmlText(row)));
  const headerCells = header ? matchAll(header, /<t[dh]\b[\s\S]*?<\/t[dh]>/gi).map(htmlText) : [];
  const assignedIndex = headerCells.findIndex((cell) => /指派给/.test(cell));
  if (assignedIndex < 0) {
    return [];
  }
  return rows.map((row) => {
    const cells = matchAll(row, /<td\b[\s\S]*?<\/td>/gi);
    const cell = cells[assignedIndex];
    if (!cell || !readBugIdFromRow(row)) {
      return void 0;
    }
    const link = matchAll(cell, /<a\b[^>]*>[\s\S]*?<\/a>/gi)[0] ?? cell;
    const text = htmlText(link).trim();
    const href = readAttr(link, "href") ?? "";
    const account = readQueryParam(href, "assignedTo") ?? readQueryParam(href, "account") ?? readAttr(link, "data-value") ?? readAttr(link, "data-id") ?? text;
    if (!account || !text || /^(closed|ditto|0)$/i.test(account)) {
      return void 0;
    }
    return { account, name: text === account ? account : `${text} (${account})` };
  }).filter((member) => Boolean(member));
}
function extractProductIds(html) {
  const source = normalizeZenTaoHtml(html);
  const ids = [
    ...matchAll(source, /productID[=/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(source, /bug[-/]browse[-/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(source, /product[-/]browse[-/](\d+)/gi).map((item) => item.match(/\d+/)?.[0]),
    ...matchAll(source, /data-(?:id|key|value)=["'](\d+)["']/gi).map((item) => item.match(/\d+/)?.[0])
  ].filter((id) => Boolean(id));
  return [...new Set(ids)];
}
function parseBugRow(row, assignedTo, columns = {}) {
  const cells = matchAll(row, /<td\b[\s\S]*?<\/td>/gi).map(htmlText);
  const id = readBugIdFromRow(row) ?? positiveBugId(cells.find((cell) => /^#?\d+$/.test(cell))?.replace("#", ""));
  if (!id) {
    return void 0;
  }
  const bugLinks = matchAll(row, /<a\b[^>]*href=["'][^"']*(?:(?:m=bug[^"']*f=view)|(?:f=view[^"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^"']*["'][^>]*>[\s\S]*?<\/a>/gi);
  const linkText = bugLinks.map(htmlText).find((text) => text && text !== id && !/^#?\d+$/.test(text)) ?? "";
  const title = readCell(cells, columns.title) ?? (linkText && linkText !== id && !/^#?\d+$/.test(linkText) ? linkText : void 0) ?? cells.find((cell) => isLikelyBugTitleCell(cell, id)) ?? `Bug #${id}`;
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
function readBugIdFromRow(row) {
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
function readBugColumns(headerCells) {
  return {
    title: headerCells.findIndex((cell) => /Bug标题|标题/.test(cell)),
    openedBy: headerCells.findIndex((cell) => /创建者|由谁创建|提交者/.test(cell)),
    createdAt: headerCells.findIndex((cell) => /创建日期|创建时间/.test(cell)),
    assignedTo: headerCells.findIndex((cell) => /指派给/.test(cell)),
    confirmed: headerCells.findIndex((cell) => /确认/.test(cell))
  };
}
function readCell(cells, index) {
  if (index === void 0 || index < 0) {
    return void 0;
  }
  const value = cells[index]?.trim();
  return value || void 0;
}
function isConfirmedText(value) {
  if (!value) {
    return false;
  }
  return /已确认|confirmed/i.test(value.trim());
}
function isLikelyBugTitleCell(value, id) {
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
function parseBugDetail(html, bugId, baseUrl) {
  const source = normalizeZenTaoHtml(html);
  const detailContentHtml = readBugDescriptionHtml(source, baseUrl);
  const detailSections = splitBugDescriptionHtml(detailContentHtml);
  const descriptionHtml = detailSections.descriptionHtml || readSectionHtml(source, ["\u63CF\u8FF0", "Bug\u63CF\u8FF0"], baseUrl);
  const reproduceStepsHtml = detailSections.reproduceStepsHtml || readSectionHtml(source, ["\u91CD\u73B0\u6B65\u9AA4", "\u590D\u73B0\u6B65\u9AA4"], baseUrl);
  const expectedResultHtml = detailSections.expectedResultHtml || readSectionHtml(source, ["\u9884\u671F\u7ED3\u679C", "\u671F\u671B"], baseUrl);
  const actualResultHtml = readSectionHtml(source, ["\u5B9E\u9645\u7ED3\u679C"], baseUrl);
  const description = htmlText(descriptionHtml ?? "");
  const title = [readBugTitle(source, bugId), description].map((item) => item ? stripBugIdPrefix(item, bugId) : void 0).find((item) => item && item !== bugId);
  const text = htmlText(source);
  const attachments = matchAll(source, /<a\b[^>]*href=["']([^"']*(?:file|download)[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi).map((item) => {
    const rawUrl = item.match(/href=["']([^"']+)["']/i)?.[1];
    const url = rawUrl ? new URL(rawUrl.replace(/&amp;/g, "&"), baseUrl).toString() : void 0;
    const name = htmlText(item);
    return {
      name,
      url,
      kind: classifyAttachment(name, url)
    };
  }).filter((item) => item.name);
  return {
    id: bugId,
    title: title || `Bug #${bugId}`,
    priority: parsePriority(text),
    status: parseDetailStatus(source, text, baseUrl),
    createdAt: text.match(/\d{4}-\d{2}-\d{2}/)?.[0],
    assignedTo: firstNonBlank(
      readDetailFieldHtml(source, ["\u5F53\u524D\u6307\u6D3E", "\u6307\u6D3E\u7ED9"], baseUrl),
      readDetailField(text, "\u5F53\u524D\u6307\u6D3E"),
      readDetailField(text, "\u6307\u6D3E\u7ED9")
    ),
    confirmed: /已确认|confirmed/i.test(text),
    description,
    descriptionHtml,
    reproduceSteps: htmlText(reproduceStepsHtml ?? "") || void 0,
    reproduceStepsHtml,
    expectedResult: htmlText(expectedResultHtml ?? "") || void 0,
    expectedResultHtml,
    actualResult: htmlText(actualResultHtml ?? "") || void 0,
    attachments,
    videos: attachments.filter((item) => item.kind === "video"),
    hasVideo: attachments.some((item) => item.kind === "video"),
    comments: matchAll(source, /class=["'][^"']*(?:comment|history|actions|item)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi).map((item) => ({ content: htmlText(item) })).filter((item) => item.content)
  };
}
function extractImageSources(detail) {
  const sources = [
    ...extractImagesFromHtml(detail.descriptionHtml),
    ...extractImagesFromHtml(detail.reproduceStepsHtml),
    ...extractImagesFromHtml(detail.expectedResultHtml)
  ];
  return [...new Set(sources)].filter((item) => !/^data:/i.test(item));
}
function extractImagesFromHtml(html) {
  if (!html) return [];
  const urls = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const url = readImageAttr(tag, "data-original-src") || readImageAttr(tag, "src");
    if (url) urls.push(url);
  }
  return urls;
}
function readImageAttr(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}
function classifyAttachment(name, url) {
  const value = `${name ?? ""} ${url ?? ""}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#\s]|$)/i.test(value)) return "image";
  if (/\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv)(?:[?#\s]|$)/i.test(value)) return "video";
  return "file";
}
async function readImageMeta(metaPath) {
  try {
    return JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch {
    return void 0;
  }
}
function imageExtension(contentType) {
  const value = contentType.toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return ".jpg";
  if (value.includes("gif")) return ".gif";
  if (value.includes("webp")) return ".webp";
  if (value.includes("svg")) return ".svg";
  return ".png";
}
function safeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function readBugTitle(html, bugId) {
  const candidates = [
    ...matchAll(html, /<div\b[^>]*class=["'][^"']*page-title[^"']*["'][^>]*>[\s\S]*?<\/div>/gi),
    ...matchAll(html, /<h1\b[\s\S]*?<\/h1>/gi),
    ...matchAll(html, /<[^>]*class=["'][^"']*(?:detail-title|bug-title)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi)
  ].map((item) => stripBugIdPrefix(htmlText(item), bugId)).filter((item) => item && item !== bugId && !/^#?\d+$/.test(item) && item.length > 4);
  return candidates[0];
}
function stripBugIdPrefix(value, bugId) {
  return value.replace(new RegExp(`^(?:BUG\\s*)?#?${escapeRegExp(bugId)}(?:\\s+|\\s*[-:\uFF1A#]\\s*)`, "i"), "").replace(new RegExp(`^(?:BUG\\s*)?#?${escapeRegExp(bugId)}$`, "i"), "").trim();
}
function readDetailField(text, label) {
  const pattern = new RegExp(`${label}\\s*[:\uFF1A]?\\s*([^\\n\\r]+)`, "i");
  return text.match(pattern)?.[1]?.trim();
}
function readDetailFieldHtml(html, labels, baseUrl) {
  const value = readSectionHtml(html, labels, baseUrl);
  return value ? normalizeDetailField(htmlText(value)) : void 0;
}
function normalizeDetailField(value) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return void 0;
  }
  return text.replace(/\s*于\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?/g, "").trim() || void 0;
}
function parseDetailStatus(html, text, baseUrl) {
  const field = readDetailFieldHtml(html, ["Bug\u72B6\u6001"], baseUrl) ?? readDetailField(text, "Bug\u72B6\u6001");
  return parseStatus(field || text);
}
function matchesAssignee(currentAssignee, expectedAccount, members) {
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
function firstNonBlank(...values) {
  return values.find((value) => value?.trim())?.trim();
}
function readBugDescriptionHtml(html, baseUrl) {
  const content = extractElementInnerHtmlByClass(html, ["detail-content", "article-content", "bug-content"]);
  const normalizedContent = content ? normalizePreviewContentHtml(content, baseUrl) : void 0;
  if (normalizedContent && htmlText(normalizedContent)) {
    return normalizedContent;
  }
  return readSectionHtml(html, ["\u63CF\u8FF0", "Bug\u63CF\u8FF0"], baseUrl);
}
function extractElementInnerHtmlByClass(html, classNames) {
  const classPattern = classNames.map(escapeRegExp).join("|");
  const openTagPattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>`, "gi");
  for (const openMatch of html.matchAll(openTagPattern)) {
    const tagName = openMatch[1]?.toLowerCase();
    if (!tagName || openMatch.index === void 0) {
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
  return void 0;
}
function findMatchingCloseTag(html, tagName, startIndex) {
  const tagPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;
  let depth = 1;
  let match;
  while (match = tagPattern.exec(html)) {
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
function splitBugDescriptionHtml(value) {
  if (!value) {
    return {};
  }
  const steps = findSectionMarker(value, ["\u6B65\u9AA4", "\u91CD\u73B0\u6B65\u9AA4", "\u590D\u73B0\u6B65\u9AA4"]);
  const result = findSectionMarker(value, ["\u7ED3\u679C", "\u5B9E\u9645\u7ED3\u679C"]);
  const expected = findSectionMarker(value, ["\u671F\u671B", "\u9884\u671F\u7ED3\u679C"]);
  const firstMarkerIndex = [steps?.index, expected?.index].filter((item) => item !== void 0).sort((a, b) => a - b)[0];
  const descriptionHtml = firstMarkerIndex === void 0 ? value : value.slice(0, firstMarkerIndex).trim();
  const reproduceStart = steps?.end;
  const reproduceEnd = [result?.index, expected?.index].filter((item) => item !== void 0).sort((a, b) => a - b)[0] ?? value.length;
  const expectedStart = expected?.end;
  return {
    descriptionHtml: descriptionHtml && htmlText(descriptionHtml) ? descriptionHtml : void 0,
    reproduceStepsHtml: reproduceStart !== void 0 && reproduceStart < reproduceEnd ? value.slice(reproduceStart, reproduceEnd).trim() : void 0,
    expectedResultHtml: expectedStart !== void 0 ? value.slice(expectedStart).trim() : void 0
  };
}
function findSectionMarker(value, labels) {
  const pattern = new RegExp(`[\\[\u3010]\\s*(?:${labels.map(escapeRegExp).join("|")})\\s*[\\]\u3011]`, "i");
  const match = pattern.exec(value);
  return match && match.index !== void 0 ? { index: match.index, end: match.index + match[0].length } : void 0;
}
function readSectionHtml(html, labels, baseUrl) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`<th\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/th>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i"),
      new RegExp(`<td\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i")
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const value = match ? normalizePreviewContentHtml(match[1], baseUrl) : void 0;
      if (value && htmlText(value)) {
        return value;
      }
    }
  }
  return void 0;
}
function normalizePreviewContentHtml(value, baseUrl) {
  return sanitizePreviewHtml(value, baseUrl).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|tr|td|h\d)>/gi, "\n").replace(/<(?!img\b)[^>]+>/gi, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function sanitizePreviewHtml(value, baseUrl) {
  return value.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/\son\w+=["'][^"']*["']/gi, "").replace(
    /<img\b([^>]*?)\sdata-src=["']([^"']+)["']([^>]*?)>/gi,
    (match, before, url, after) => /\ssrc=["']/i.test(match) ? match : `<img${before} src="${url}"${after}>`
  ).replace(/\s(?:src|href)=["']([^"']+)["']/gi, (match, url) => match.replace(url, absoluteUrl(url, baseUrl)));
}
function absoluteUrl(value, baseUrl) {
  if (/^(?:https?:|data:|vscode-resource:)/i.test(value)) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}
function parsePriority(value) {
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
function parseStatus(value) {
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
function compactText(value) {
  return value.replace(/\s+/g, " ").trim();
}
function md5(value) {
  return (0, import_crypto.createHash)("md5").update(value).digest("hex");
}
function computePasswordStrength(password) {
  const characterSets = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z\d]/.test(password)
  ].filter(Boolean).length;
  return Math.min(3, Math.max(0, Math.floor(password.length / 4) + characterSets - 1));
}
function parseFormFields(html) {
  const fields = {};
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
function decodeHtmlAttr(value) {
  return value.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function isLoginExpiredText(value) {
  return /登录已超时|重新登入|重新登录/.test(value);
}
function htmlText(value) {
  return compactText(
    value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  );
}
function decodeJsonHtml(value) {
  try {
    const parsed = JSON.parse(value.trim());
    if (typeof parsed === "string") {
      return parsed;
    }
    return collectStrings(parsed).join("\n");
  } catch {
  }
  return value;
}
function normalizeZenTaoHtml(value) {
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
function parseLoginResult(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return void 0;
    }
    const data = parsed;
    return {
      result: typeof data.result === "string" || typeof data.result === "boolean" ? data.result : void 0,
      message: typeof data.message === "string" ? data.message : void 0,
      locate: typeof data.locate === "string" ? data.locate : void 0
    };
  } catch {
    return void 0;
  }
}
function collectStrings(value) {
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
function readAttr(html, name) {
  return html.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']+)["']`, "i"))?.[1];
}
function readQueryParam(value, name) {
  const match = value.match(new RegExp(`[?&]${escapeRegExp(name)}=([^&#]+)`, "i"));
  return match ? decodeURIComponent(match[1]) : void 0;
}
function readProjectIdFromAttrs(html) {
  return (readAttr(html, "data-id") ?? readAttr(html, "data-key") ?? readAttr(html, "data-value") ?? readAttr(html, "data-product") ?? readAttr(html, "data-product-id"))?.match(/\d+/)?.[0];
}
function readProjectIdFromText(value) {
  return value.match(/productID[=/](\d+)/i)?.[1] ?? value.match(/bug[-/]browse[-/](\d+)/i)?.[1] ?? value.match(/product[-/]browse[-/](\d+)/i)?.[1] ?? value.match(/browse(?:&productID=|-)(\d+)/i)?.[1] ?? value.match(/(?:productID|product|objectID)\D{0,12}(\d+)/i)?.[1];
}
function parseProjectLikeText(source) {
  const projects = [];
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
function isIgnoredProjectName(name) {
  return /^(关闭|closed|more|更多|全部项目|all|搜索)$/i.test(name);
}
function matchAll(value, pattern) {
  return [...value.matchAll(pattern)].map((match) => match[0]);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function dedupeById(bugs) {
  return [...new Map(bugs.map((bug) => [bug.id, bug])).values()];
}

// liveList.ts
async function main() {
  const client = new ZenTaoClient({ baseUrl: process.env.ZENTAO_BASE ?? "" });
  await client.login({ account: process.env.ZENTAO_ACCOUNT ?? "", password: process.env.ZENTAO_PASSWORD ?? "" });
  const bugs = await client.listBugs({ projectId: "34", assigneeScope: "all", teamMembers: [] });
  console.log(JSON.stringify({ count: bugs.length, ids: bugs.slice(0, 10).map((bug) => bug.id), titles: bugs.slice(0, 3).map((bug) => bug.title), assignedTo: bugs.slice(0, 3).map((bug) => bug.assignedTo) }, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
