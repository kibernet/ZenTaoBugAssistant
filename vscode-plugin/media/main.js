const vscode = acquireVsCodeApi();
const selectedIds = new Set();
const categoryFilterValues = ["assignedToMe", "unresolved", "resolved", "closed"];
const bugCategoryFilters = new Set(categoryFilterValues);
let currentBugPage = 1;
const bugsPerPage = 20;
let lastState;
let categoryFiltersHydrated = false;
let memberDropdownActiveIndex = -1;
let memberDropdownMouseDown = false;

const PASSWORD_MASK = "********";

document.getElementById("login").addEventListener("click", () => postLogin());
document.getElementById("loginState").addEventListener("click", () => postLogin());
document.getElementById("serverUrl").addEventListener("change", (event) => {
  post("setServerUrl", { serverUrl: event.target.value });
});
document.getElementById("serverUrl").addEventListener("blur", (event) => {
  post("setServerUrl", { serverUrl: event.target.value });
});
document.getElementById("account").addEventListener("change", (event) => {
  post("setLoginAccount", { loginAccount: event.target.value });
});
document.getElementById("account").addEventListener("blur", (event) => {
  post("setLoginAccount", { loginAccount: event.target.value });
});
document.getElementById("password").addEventListener("focus", (event) => {
  const input = event.target;
  if (input.dataset.saved === "true") {
    input.value = "";
    input.dataset.saved = "false";
  }
});
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
  clearSelectedMemberFilter();
  if (lastState) {
    lastState = {
      ...lastState,
      assignee: undefined,
      bugs: [],
      selectedIds: [],
      selectedProjectId: event.target.value || undefined
    };
  }
  post("selectProject", { projectId: event.target.value });
});
setupMemberPicker();

window.addEventListener("message", (event) => {
  if (event.data.type !== "state") {
    return;
  }
  render(event.data.state);
});

function render(state) {
  lastState = state;
  hydrateCategoryFilters(state);
  const serverInput = document.getElementById("serverUrl");
  if (document.activeElement !== serverInput) {
    serverInput.value = state.serverUrl ?? "";
  }
  const accountInput = document.getElementById("account");
  if (document.activeElement !== accountInput) {
    accountInput.value = state.loginAccount ?? "";
  }
  const passwordInput = document.getElementById("password");
  if (document.activeElement !== passwordInput) {
    if (state.hasSavedPassword) {
      passwordInput.value = PASSWORD_MASK;
      passwordInput.dataset.saved = "true";
    } else if (passwordInput.dataset.saved === "true") {
      passwordInput.value = "";
      passwordInput.dataset.saved = "false";
    }
  }
  document.getElementById("autoLogin").checked = Boolean(state.autoLoginEnabled);
  document.getElementById("aiEngine").value = state.aiEngine ?? "claudeCode";
  renderLoginState(state);
  renderFilters(state);
  const filteredBugs = state.bugs.length ? filterBugs(state.bugs, state) : [];
  renderStatusSummary(state, filteredBugs);
  renderBugCategoryFilters();
  const root = document.getElementById("bugs");
  root.innerHTML = "";
  selectedIds.clear();
  for (const id of state.selectedIds ?? []) {
    selectedIds.add(id);
  }

  if (!state.bugs.length) {
    root.innerHTML = `<p class="empty">暂无 Bug，请先登录或刷新。</p>`;
    renderPagination(0, 0, 0);
    updateAiFixButton([]);
    return;
  }

  updateAiFixButton(filteredBugs);
  const totalPages = Math.max(1, Math.ceil(filteredBugs.length / bugsPerPage));
  currentBugPage = Math.min(Math.max(1, currentBugPage), totalPages);
  const start = (currentBugPage - 1) * bugsPerPage;
  const pageBugs = filteredBugs.slice(start, start + bugsPerPage);

  if (!pageBugs.length) {
    const filterHint = state.bugs.length
      ? `已拉取 ${state.bugs.length} 个 Bug，当前筛选条件下无匹配项。请勾选「未解决」后重试。`
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
  const nonSelfSelected = isMineFilterDisabled(lastState);
  if (nonSelfSelected && bugCategoryFilters.delete("assignedToMe")) {
    post("setBugCategoryFilters", { bugCategoryFilters: [...bugCategoryFilters] });
  }
  const options = [
    ["assignedToMe", "仅看我的"],
    ["unresolved", "未解决"],
    ["resolved", "已解决"],
    ["closed", "已关闭"]
  ];
  root.innerHTML = options.map(([value, label]) => {
    const checked = bugCategoryFilters.has(value);
    return `
    <label class="filter-chip ${checked ? "checked" : ""}">
      <input type="checkbox" value="${escapeAttr(value)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>`;
  }).join("");
  root.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "assignedToMe" && input.checked && isMineFilterDisabled(lastState)) {
        clearSelectedMemberFilter();
        post("setAssigneeScope", { assigneeScope: "member", assignee: undefined });
      }
      if (input.checked) {
        bugCategoryFilters.add(input.value);
      } else {
        bugCategoryFilters.delete(input.value);
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
  const mineOnly = bugCategoryFilters.has("assignedToMe");
  const statusKeys = categoryFilterValues.filter((v) => v !== "assignedToMe");
  const activeStatus = statusKeys.filter((v) => bugCategoryFilters.has(v));
  const allStatusActive = activeStatus.length === statusKeys.length;
  if (!mineOnly && (activeStatus.length === 0 || allStatusActive)) {
    return scopedBugs;
  }
  return scopedBugs.filter((bug) => {
    if (mineOnly) {
      const member = (state.members ?? []).find((item) => item.account === state.account);
      const candidates = memberFilterCandidates(state.account, member);
      const assignedToValues = personAliases(bug.assignedTo);
      if (!candidates.some((candidate) => assignedToValues.some((assignedTo) => assignedTo === candidate || assignedTo.includes(candidate) || candidate.includes(assignedTo)))) return false;
    }
    if (activeStatus.length > 0 && !allStatusActive) {
      const matchesStatus =
        (activeStatus.includes("unresolved") && bug.status !== "resolved" && bug.status !== "closed") ||
        (activeStatus.includes("resolved") && bug.status === "resolved") ||
        (activeStatus.includes("closed") && bug.status === "closed");
      if (!matchesStatus) return false;
    }
    return true;
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

function renderStatusSummary(state, filteredBugs) {
  const statusEl = document.getElementById("status");
  if (state.loading || !state.bugs.length) {
    statusEl.textContent = state.status;
    return;
  }
  statusEl.textContent = filteredBugs.length === state.bugs.length
    ? `共 ${state.bugs.length} 个 Bug`
    : `共 ${filteredBugs.length} 个 Bug / 总 ${state.bugs.length} 个`;
}

function renderLoginState(state) {
  const loginButton = document.getElementById("login");
  const loginState = document.getElementById("loginState");
  const autoLogin = document.querySelector(".auto-login");

  if (state.loggedIn) {
    loginButton.style.display = "none";
    autoLogin.style.display = "inline-flex";
    autoLogin.hidden = false;
    loginState.style.display = "inline-block";
    loginState.hidden = false;
    loginState.textContent = `已登录：${state.account ?? ""}`;
    loginState.className = "login-state logged-in";
    loginState.title = "点击重新登录";
    return;
  }

  loginButton.style.display = "inline-block";
  autoLogin.style.display = "none";
  loginState.style.display = "none";
  loginState.hidden = true;
  autoLogin.hidden = true;
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
  if (document.activeElement !== assignee) {
    assignee.value = formatSelectedMember(state.assignee, state.members ?? []);
  }
  if (document.activeElement === assignee) {
    openMemberDropdown(filterMembersForBrowse(assignee.value, state.members ?? []));
  } else {
    hideMemberDropdown();
  }
}

function setupMemberPicker() {
  const assignee = document.getElementById("assignee");
  const dropdown = document.getElementById("memberDropdown");
  const toggle = document.getElementById("memberDropdownToggle");

  assignee.addEventListener("focus", () => {
    openMemberDropdown(filterMembersForBrowse(assignee.value, lastState?.members ?? []));
  });
  assignee.addEventListener("input", () => {
    memberDropdownActiveIndex = -1;
    openMemberDropdown(filterMembers(assignee.value, lastState?.members ?? []));
  });
  assignee.addEventListener("keydown", (event) => {
    const items = dropdown.querySelectorAll(".member-dropdown-item");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (dropdown.hidden && items.length) {
        openMemberDropdown(filterMembersForBrowse(assignee.value, lastState?.members ?? []));
        return;
      }
      memberDropdownActiveIndex = Math.min(memberDropdownActiveIndex + 1, items.length - 1);
      highlightMemberDropdownItem(items);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      memberDropdownActiveIndex = Math.max(memberDropdownActiveIndex - 1, 0);
      highlightMemberDropdownItem(items);
    } else if (event.key === "Enter") {
      if (memberDropdownActiveIndex >= 0 && items[memberDropdownActiveIndex]) {
        event.preventDefault();
        selectMemberFromDropdown(items[memberDropdownActiveIndex]);
      } else {
        hideMemberDropdown();
        postAssigneeFilter();
      }
    } else if (event.key === "Escape") {
      hideMemberDropdown();
    }
  });
  assignee.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (memberDropdownMouseDown) {
        return;
      }
      hideMemberDropdown();
      postAssigneeFilter();
    }, 150);
  });
  dropdown.addEventListener("mousedown", () => {
    memberDropdownMouseDown = true;
  });
  toggle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    memberDropdownMouseDown = true;
  });
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    toggleMemberDropdown();
  });
  document.addEventListener("mouseup", () => {
    memberDropdownMouseDown = false;
  });
}

function filterMembersForBrowse(query, members) {
  const text = String(query ?? "").trim();
  if (!text) {
    return members;
  }
  if (lastState?.assignee && formatSelectedMember(lastState.assignee, members) === text) {
    return members;
  }
  return filterMembers(text, members);
}

function toggleMemberDropdown() {
  const dropdown = document.getElementById("memberDropdown");
  const assignee = document.getElementById("assignee");
  if (!dropdown.hidden) {
    hideMemberDropdown();
    assignee.focus();
    return;
  }
  assignee.focus();
  openMemberDropdown(filterMembersForBrowse(assignee.value, lastState?.members ?? []));
}

function openMemberDropdown(members) {
  renderMemberDropdown(members);
  updateMemberDropdownToggle(true);
}

function filterMembers(query, members) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) {
    return members;
  }
  return members.filter((member) => matchesMemberSearch(member, needle));
}

function matchesMemberSearch(member, needle) {
  if (!needle) {
    return true;
  }
  const account = String(member.account ?? "").toLowerCase();
  const name = String(member.name ?? "").toLowerCase();
  const label = formatMemberOption(member).toLowerCase();
  return account.includes(needle) || name.includes(needle) || label.includes(needle);
}

function renderMemberDropdown(members) {
  const dropdown = document.getElementById("memberDropdown");
  dropdown.innerHTML = "";
  memberDropdownActiveIndex = -1;
  if (!members.length) {
    dropdown.hidden = true;
    updateMemberDropdownToggle(false);
    return;
  }
  for (const member of members) {
    const item = document.createElement("div");
    item.className = "member-dropdown-item";
    item.textContent = formatMemberOption(member);
    item.dataset.account = member.account;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectMemberFromDropdown(item);
    });
    dropdown.appendChild(item);
  }
  dropdown.hidden = false;
  updateMemberDropdownToggle(true);
}

function updateMemberDropdownToggle(open) {
  const toggle = document.getElementById("memberDropdownToggle");
  if (!toggle) {
    return;
  }
  toggle.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function highlightMemberDropdownItem(items) {
  for (let index = 0; index < items.length; index += 1) {
    items[index].classList.toggle("active", index === memberDropdownActiveIndex);
  }
  if (memberDropdownActiveIndex >= 0 && items[memberDropdownActiveIndex]) {
    items[memberDropdownActiveIndex].scrollIntoView({ block: "nearest" });
  }
}

function selectMemberFromDropdown(item) {
  const assignee = document.getElementById("assignee");
  assignee.value = item.textContent ?? "";
  hideMemberDropdown();
  postAssigneeFilter();
}

function hideMemberDropdown() {
  const dropdown = document.getElementById("memberDropdown");
  dropdown.hidden = true;
  memberDropdownActiveIndex = -1;
  updateMemberDropdownToggle(false);
}

function clearSelectedMemberFilter() {
  const assignee = document.getElementById("assignee");
  assignee.value = "";
  hideMemberDropdown();
  if (lastState) {
    lastState = { ...lastState, assignee: undefined };
  }
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

function postLogin() {
  post("login", {
    account: document.getElementById("account").value,
    password: document.getElementById("password").value
  });
}

function post(type, payload = {}) {
  vscode.postMessage({ type, ...payload });
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
