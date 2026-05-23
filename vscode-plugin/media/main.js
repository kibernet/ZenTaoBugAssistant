const vscode = acquireVsCodeApi();
const selectedIds = new Set();
const categoryFilterValues = ["assignedToMe", "unresolved", "resolved", "closed"];
const bugCategoryFilters = new Set(categoryFilterValues);
let currentBugPage = 1;
const bugsPerPage = 20;
let lastState;
let categoryFiltersHydrated = false;
const debugEndpoint = "http://127.0.0.1:7837/ingest/16d23de6-52c7-4de0-86a3-b3263b8c05ca";
const debugSessionId = "4538d4";

document.getElementById("login").addEventListener("click", () => post("login"));
document.getElementById("loginState").addEventListener("click", () => post("login"));
document.getElementById("autoLogin").addEventListener("change", (event) => {
  post("setAutoLogin", { autoLoginEnabled: event.target.checked });
});
document.getElementById("refresh").addEventListener("click", () => post("refresh"));
document.getElementById("fixSelected").addEventListener("click", () => postAiFixVisibleUnresolved());
document.getElementById("clearImageCache").addEventListener("click", () => post("clearImageCache"));
document.getElementById("aiEngine").addEventListener("change", (event) => {
  post("setAiEngine", { aiEngine: event.target.value });
});
document.getElementById("refreshProjects").addEventListener("click", () => post("refreshProjects"));
document.getElementById("refreshMembers").addEventListener("click", () => post("refreshMembers"));
document.getElementById("project").addEventListener("change", (event) => {
  post("selectProject", { projectId: event.target.value });
});
document.getElementById("assignee").addEventListener("change", () => postAssigneeFilter());
document.getElementById("assignee").addEventListener("blur", () => postAssigneeFilter());

window.addEventListener("message", (event) => {
  if (event.data.type !== "state") {
    return;
  }
  render(event.data.state);
});

function render(state) {
  lastState = state;
  hydrateCategoryFilters(state);
  document.getElementById("status").textContent = state.status;
  document.getElementById("autoLogin").checked = Boolean(state.autoLoginEnabled);
  document.getElementById("aiEngine").value = state.aiEngine ?? "auto";
  renderLoginState(state);
  renderFilters(state);
  renderBugCategoryFilters();
  // #region agent log
  debugLog("UX1,UX2,UX3,UX4", "vscode-plugin/media/main.js:26", "webview render state", {
    loggedIn: Boolean(state.loggedIn),
    loading: Boolean(state.loading),
    bugCount: state.bugs?.length ?? 0,
    aiEngine: state.aiEngine ?? "auto",
    projectCount: state.projects?.length ?? 0,
    memberCount: state.members?.length ?? 0,
    selectedCount: state.selectedIds?.length ?? 0,
    hasSelectedProject: Boolean(state.selectedProjectId),
    assigneeScope: state.assigneeScope,
    autoLoginEnabled: Boolean(state.autoLoginEnabled),
    status: state.status
  });
  // #endregion
  const root = document.getElementById("bugs");
  root.innerHTML = "";
  selectedIds.clear();
  for (const id of state.selectedIds ?? []) {
    selectedIds.add(id);
  }

  if (!state.bugs.length) {
    // #region agent log
    debugLog("UX1,UX3", "vscode-plugin/media/main.js:43", "empty bug state shown", {
      loggedIn: Boolean(state.loggedIn),
      projectCount: state.projects?.length ?? 0,
      status: state.status
    });
    // #endregion
    root.innerHTML = `<p class="empty">暂无 Bug，请先登录或刷新。</p>`;
    renderPagination(0, 0, 0);
    document.getElementById("bugCount").textContent = "共 0 个 Bug";
    updateAiFixButton([]);
    return;
  }

  const filteredBugs = filterBugs(state.bugs, state);
  updateAiFixButton(filteredBugs);
  const totalPages = Math.max(1, Math.ceil(filteredBugs.length / bugsPerPage));
  currentBugPage = Math.min(Math.max(1, currentBugPage), totalPages);
  const start = (currentBugPage - 1) * bugsPerPage;
  const pageBugs = filteredBugs.slice(start, start + bugsPerPage);
  document.getElementById("bugCount").textContent = `共 ${filteredBugs.length} 个 Bug / 总 ${state.bugs.length} 个`;

  if (!pageBugs.length) {
    const filterHint = state.bugs.length
      ? `已拉取 ${state.bugs.length} 个 Bug，当前筛选条件下无匹配项。请勾选「全部」或「未解决」后重试。`
      : "当前分类暂无 Bug。";
    root.innerHTML = `<p class="empty">${escapeHtml(filterHint)}</p>`;
    renderPagination(filteredBugs.length, currentBugPage, totalPages);
    return;
  }

  for (const bug of pageBugs) {
    const row = document.createElement("article");
    row.className = `bug ${escapeAttr(bug.status)}`;
    const title = displayBugTitle(bug);
    row.innerHTML = `
      <div class="bug-head">
        <div class="bug-main">
          <div class="bug-title-row">
            <strong class="bug-id">#${escapeHtml(bug.id)}</strong>
            ${renderBugMeta(bug)}
          </div>
          ${title ? `<div class="bug-title">${escapeHtml(title)}</div>` : ""}
        </div>
      </div>
      <small>${escapeHtml(bug.createdAt ?? "")}</small>
      <div class="bug-buttons">${renderBugButtons(bug)}</div>
    `;
    root.appendChild(row);
  }
  renderPagination(filteredBugs.length, currentBugPage, totalPages);

  root.querySelectorAll("[data-select]").forEach((item) => {
    item.addEventListener("change", (event) => {
      const id = event.target.getAttribute("data-select");
      if (event.target.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
      post("select", { ids: [...selectedIds] });
    });
  });

  root.querySelectorAll("[data-preview]").forEach((item) => {
    item.addEventListener("click", () => post("preview", { id: item.getAttribute("data-preview") }));
  });

  root.querySelectorAll(".bug").forEach((item) => {
    item.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      const preview = item.querySelector("[data-preview]");
      if (preview) {
        post("preview", { id: preview.getAttribute("data-preview") });
      }
    });
  });

  root.querySelectorAll("[data-fix]").forEach((item) => {
    item.addEventListener("click", () => post("fix", { id: item.getAttribute("data-fix") }));
  });

  root.querySelectorAll("[data-workflow]").forEach((item) => {
    item.addEventListener("click", () => {
      post("workflow", {
        id: item.getAttribute("data-id"),
        action: item.getAttribute("data-workflow")
      });
    });
  });
}

function renderBugMeta(bug) {
  const parts = [];
  if (bug.status && bug.status !== "unknown") {
    parts.push(`<span class="status ${escapeAttr(bug.status)}">${escapeHtml(statusLabel(bug.status))}</span>`);
  }
  parts.push(`<span class="assignee">指派给：${escapeHtml(formatAssignee(bug.assignedTo))}</span>`);
  if (bug.priority && bug.priority !== "unknown") {
    parts.push(`<span class="priority">${escapeHtml(priorityLabel(bug.priority))}</span>`);
  }
  if (bug.hasVideo) {
    parts.push(`<span class="priority" title="该 Bug 包含视频附件">🎬 视频</span>`);
  }
  return parts.join("");
}

function formatAssignee(value) {
  const assignee = String(value ?? "").trim();
  return assignee && assignee !== "unknown" ? assignee : "未指派";
}

function displayBugTitle(bug) {
  const title = String(bug.title ?? "").trim();
  if (!title || title === bug.id || title === `#${bug.id}` || title === `Bug #${bug.id}`) {
    return "";
  }
  return title;
}

function renderBugCategoryFilters() {
  const root = document.getElementById("bugCategoryFilters");
  const mineDisabled = isMineFilterDisabled(lastState);
  if (mineDisabled && bugCategoryFilters.delete("assignedToMe")) {
    post("setBugCategoryFilters", { bugCategoryFilters: [...bugCategoryFilters] });
  }
  const enabledFilterValues = categoryFilterValues.filter((value) => value !== "assignedToMe" || !mineDisabled);
  const allChecked = enabledFilterValues.every((value) => bugCategoryFilters.has(value));
  const options = [
    ["all", "全部"],
    ["assignedToMe", "我的"],
    ["unresolved", "未解决"],
    ["resolved", "已解决"],
    ["closed", "已关闭"]
  ];
  root.innerHTML = options.map(([value, label]) => {
    const checked = value === "all" ? allChecked : bugCategoryFilters.has(value);
    const disabled = value === "assignedToMe" && mineDisabled;
    return `
    <label class="filter-chip ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}">
      <input type="checkbox" value="${escapeAttr(value)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>`;
  }).join("");
  root.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "all") {
        bugCategoryFilters.clear();
        if (input.checked) {
          for (const value of enabledFilterValues) {
            bugCategoryFilters.add(value);
          }
        }
      } else {
        if (input.checked) {
          bugCategoryFilters.add(input.value);
        } else {
          bugCategoryFilters.delete(input.value);
        }
      }
      currentBugPage = 1;
      post("setBugCategoryFilters", { bugCategoryFilters: [...bugCategoryFilters] });
      render(lastState);
    });
  });
}

function hydrateCategoryFilters(state) {
  if (categoryFiltersHydrated) {
    return;
  }
  categoryFiltersHydrated = true;
  if (!Array.isArray(state.bugCategoryFilters)) {
    return;
  }
  bugCategoryFilters.clear();
  for (const value of state.bugCategoryFilters) {
    if (categoryFilterValues.includes(value)) {
      bugCategoryFilters.add(value);
    }
  }
}

function filterBugs(bugs, state) {
  const scopedBugs = filterBugsBySelectedMember(bugs, state);
  if (!bugCategoryFilters.size || categoryFilterValues.every((value) => bugCategoryFilters.has(value))) {
    return scopedBugs;
  }
  return scopedBugs.filter((bug) => {
    const mineValues = [state.account].filter(Boolean).map((value) => String(value).toLowerCase());
    const assignedTo = String(bug.assignedTo ?? "").toLowerCase();
    return (
      (bugCategoryFilters.has("assignedToMe") && mineValues.some((value) => assignedTo.includes(value))) ||
      (bugCategoryFilters.has("unresolved") && bug.status !== "resolved" && bug.status !== "closed") ||
      (bugCategoryFilters.has("resolved") && bug.status === "resolved") ||
      (bugCategoryFilters.has("closed") && bug.status === "closed")
    );
  });
}

function filterBugsBySelectedMember(bugs, state) {
  if (!state.assignee) {
    return bugs;
  }
  const member = (state.members ?? []).find((item) => item.account === state.assignee);
  const candidates = memberFilterCandidates(state.assignee, member);
  return bugs.filter((bug) => {
    const assignedToValues = personAliases(bug.assignedTo);
    return candidates.some((value) => assignedToValues.some((assignedTo) => assignedTo === value || assignedTo.includes(value) || value.includes(assignedTo)));
  });
}

function memberFilterCandidates(account, member) {
  return [...new Set([
    ...personAliases(account),
    ...personAliases(member?.name),
    ...personAliases(member?.account)
  ])].filter(Boolean);
}

function personAliases(value) {
  const text = String(value ?? "").trim();
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
  const parenMatches = [...text.matchAll(/[（(]([^）)]+)[）)]/g)];
  for (const match of parenMatches) {
    aliases.push(match[1].trim());
  }
  return aliases.map((item) => item.toLowerCase()).filter(Boolean);
}

function unresolvedBugs(bugs) {
  return bugs.filter((bug) => bug.status !== "resolved" && bug.status !== "closed");
}

function updateAiFixButton(filteredBugs) {
  const button = document.getElementById("fixSelected");
  const count = unresolvedBugs(filteredBugs).length;
  button.textContent = count ? `AI一键修复 ${count}` : "AI一键修复";
  button.disabled = count === 0;
  button.title = count ? `依次修复当前列表中的 ${count} 个未解决 Bug` : "当前列表没有未解决 Bug";
}

function postAiFixVisibleUnresolved() {
  if (!lastState) {
    return;
  }
  const ids = unresolvedBugs(filterBugs(lastState.bugs ?? [], lastState)).map((bug) => bug.id);
  post("fixSelected", { ids });
}

function renderBugButtons(bug) {
  const buttons = [{ type: "preview", label: "预览" }];
  if (bug.status === "resolved") {
    buttons.push({ workflow: "activate", label: "激活" });
  } else if (bug.status === "closed") {
    buttons.push({ workflow: "activate", label: "激活" });
  } else {
    buttons.push({ workflow: "assign", label: "指派" });
    if (!bug.confirmed) {
      buttons.push({ workflow: "confirm", label: "确认" });
    }
    buttons.push(
      { workflow: "resolve", label: "解决" },
      { type: "fix", label: "AI修复" }
    );
  }
  return buttons.map((button) => {
    if (button.type === "preview") {
      return `<button class="action-preview" data-preview="${escapeAttr(bug.id)}">${escapeHtml(button.label)}</button>`;
    }
    if (button.type === "fix") {
      return `<button class="action-ai-fix" data-fix="${escapeAttr(bug.id)}">✦ ${escapeHtml(button.label)}</button>`;
    }
    return `<button class="action-${escapeAttr(button.workflow)}" data-workflow="${escapeAttr(button.workflow)}" data-id="${escapeAttr(bug.id)}">${escapeHtml(button.label)}</button>`;
  }).join("");
}

function renderPagination(total, page, totalPages) {
  const root = document.getElementById("pagination");
  if (!total) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `
    <span>共 ${total} 项</span>
    <span>每页 ${bugsPerPage} 项</span>
    <button data-page="first" ${page <= 1 ? "disabled" : ""}>|&lt;</button>
    <button data-page="prev" ${page <= 1 ? "disabled" : ""}>&lt;</button>
    <span>${page}/${totalPages}</span>
    <button data-page="next" ${page >= totalPages ? "disabled" : ""}>&gt;</button>
    <button data-page="last" ${page >= totalPages ? "disabled" : ""}>&gt;|</button>
  `;
  root.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-page");
      if (action === "first") currentBugPage = 1;
      if (action === "prev") currentBugPage = Math.max(1, currentBugPage - 1);
      if (action === "next") currentBugPage = Math.min(totalPages, currentBugPage + 1);
      if (action === "last") currentBugPage = totalPages;
      render(lastState);
    });
  });
}

function renderLoginState(state) {
  const loginState = document.getElementById("loginState");
  document.getElementById("login").style.display = state.loggedIn ? "none" : "inline-block";
  loginState.textContent = state.loggedIn ? `已登录：${state.account ?? ""}` : "未登录";
  loginState.className = `login-state ${state.loggedIn ? "logged-in" : "logged-out"}`;
  loginState.title = state.loggedIn ? "点击重新登录" : "点击登录";
}

function renderFilters(state) {
  const project = document.getElementById("project");
  const currentProject = project.value;
  project.innerHTML = `<option value="">全部项目</option>`;
  for (const item of state.projects ?? []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === state.selectedProjectId || (!state.selectedProjectId && item.id === currentProject);
    project.appendChild(option);
  }
  project.value = state.selectedProjectId ?? currentProject ?? "";

  const assignee = document.getElementById("assignee");
  const assigneeOptions = document.getElementById("assigneeOptions");
  assigneeOptions.innerHTML = "";
  for (const member of state.members ?? []) {
    const option = document.createElement("option");
    option.value = formatMemberOption(member);
    option.label = member.account === member.name ? member.account : member.account;
    assigneeOptions.appendChild(option);
  }
  assignee.value = formatSelectedMember(state.assignee, state.members ?? []);
  // #region agent log
  debugLog("UX3", "vscode-plugin/media/main.js:120", "filters rendered", {
    projectOptions: state.projects?.length ?? 0,
    memberOptions: state.members?.length ?? 0,
    selectedProjectIdPresent: Boolean(state.selectedProjectId),
    assigneeScope: "member",
    assigneeInputVisible: true
  });
  // #endregion
}

function postAssigneeFilter() {
  post("setAssigneeScope", {
    assigneeScope: "member",
    assignee: resolveAssigneeValue(document.getElementById("assignee").value, lastState?.members ?? [])
  });
}

function isMineFilterDisabled(state) {
  if (!state?.assignee) {
    return false;
  }
  const member = (state.members ?? []).find((item) => item.account === state.assignee);
  const candidates = memberFilterCandidates(state.assignee, member);
  const accountValues = personAliases(state.account);
  return !candidates.some((candidate) => accountValues.includes(candidate));
}

function formatSelectedMember(account, members) {
  if (!account) {
    return "";
  }
  const member = members.find((item) => item.account === account);
  return member ? formatMemberOption(member) : account;
}

function formatMemberOption(member) {
  return member.name === member.account ? member.account : `${member.name} | ${member.account}`;
}

function resolveAssigneeValue(value, members) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  const explicitAccount = text.includes("|") ? text.split("|").pop().trim() : text;
  const matched = members.find((member) => formatMemberOption(member) === text || member.account === explicitAccount || member.name === text);
  return matched?.account ?? explicitAccount;
}

function post(type, payload = {}) {
  // #region agent log
  debugLog("UX2,UX4", "vscode-plugin/media/main.js:142", "webview action posted", {
    type,
    hasPayload: Object.keys(payload).length > 0,
    selectedCount: selectedIds.size
  });
  // #endregion
  vscode.postMessage({ type, ...payload });
}

function debugLog(hypothesisId, location, message, data) {
  fetch(debugEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": debugSessionId },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId: "ux-baseline",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
}

function priorityLabel(value) {
  return { high: "高", medium: "中", low: "低", unknown: "未知" }[value] ?? value;
}

function statusLabel(value) {
  return { active: "激活", resolved: "已解决", closed: "关闭", unknown: "未知" }[value] ?? value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
