"use strict";
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

// test/zentaoClientParser.test.ts
var import_strict = __toESM(require("assert/strict"));

// src/core/zentaoClient.ts
var defaultBugRecPerPage = 20;
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
      return positiveTotals.length ? Math.min(...positiveTotals) : void 0;
    }
    return fromUrl[0];
  }
  const fromJs = html.match(new RegExp(`${key}\\s*[:=]\\s*['"]?(\\d+)`, "i"));
  if (fromJs?.[1]) {
    return Number(fromJs[1]);
  }
  return void 0;
}
function parseBugList(html, assignedTo) {
  const source = normalizeZenTaoHtml(html);
  const rows = matchAll(source, /<tr\b[\s\S]*?<\/tr>/gi);
  const headerCells = rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row))) ? matchAll(rows.find((row) => /Bug标题|指派给|创建者/.test(htmlText(row))) ?? "", /<t[dh]\b[\s\S]*?<\/t[dh]>/gi).map(htmlText) : [];
  const columns = readBugColumns(headerCells);
  const bugs = rows.map((row) => parseBugRow(row, assignedTo, columns)).filter((bug) => Boolean(bug));
  const linkBugs2 = bugs.length ? [] : parseBugListFromLinks(source, assignedTo);
  const contextBugs = bugs.length || linkBugs2.length ? [] : parseBugListFromDataIdContexts(source, assignedTo);
  return dedupeById(bugs.length ? bugs : linkBugs2.length ? linkBugs2 : contextBugs);
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
  const normalized2 = compactText(text);
  const idIndex = normalized2.indexOf(id);
  const afterId = idIndex >= 0 ? normalized2.slice(idIndex + id.length).trim() : normalized2;
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
function decodeHtmlAttr(value) {
  return value.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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
var __zentaoParserTestInternals = {
  normalizeZenTaoHtml,
  parseBugList,
  parseBugListPager
};
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
function matchAll(value, pattern) {
  return [...value.matchAll(pattern)].map((match) => match[0]);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function dedupeById(bugs) {
  return [...new Map(bugs.map((bug) => [bug.id, bug])).values()];
}

// test/zentaoClientParser.test.ts
var { normalizeZenTaoHtml: normalizeZenTaoHtml2, parseBugList: parseBugList2, parseBugListPager: parseBugListPager2 } = __zentaoParserTestInternals;
var bugTableHtml = `
<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>Bug\u6807\u9898</th>
      <th>\u7EA7\u522B</th>
      <th>\u72B6\u6001</th>
      <th>\u521B\u5EFA\u8005</th>
      <th>\u521B\u5EFA\u65E5\u671F</th>
      <th>\u786E\u8BA4</th>
      <th>\u6307\u6D3E\u7ED9</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>183099</td>
      <td><a href="/index.php?m=bug&amp;f=view&amp;bugID=183099">8.1.0---\u6E14\u573A\u6FC0\u5149\u6280\u80FD---\u89E6\u53D1\u65A9\u6740\u7684\u65F6\u5019\u7D22\u654C\u65F6\u95F4\u7ED3\u675F\u4E86\uFF0C\u6CA1\u6709\u7528\u6FC0\u5149\u4F46\u662F\u5728\u53D1\u70AE</a></td>
      <td>\u4E00\u822C</td>
      <td>\u6FC0\u6D3B</td>
      <td>\u77F3\u633A\u73B0</td>
      <td>06-02 10:55</td>
      <td>\u5DF2\u786E\u8BA4</td>
      <td><a href="/index.php?m=user&amp;f=view&amp;account=wangqiangqiang">\u738B\u5F3A\u5F3A</a></td>
    </tr>
  </tbody>
</table>
<input type="hidden" id="recTotal" value="1">
<input type="hidden" id="recPerPage" value="20">
<input type="hidden" id="pageID" value="1">
`;
var wrappedTableHtml = JSON.stringify({ result: "success", data: bugTableHtml });
var normalized = normalizeZenTaoHtml2(wrappedTableHtml);
import_strict.default.match(normalized, /183099/);
var tableBugs = parseBugList2(wrappedTableHtml);
import_strict.default.equal(tableBugs.length, 1);
import_strict.default.equal(tableBugs[0].id, "183099");
import_strict.default.match(tableBugs[0].title, /渔场激光技能/);
import_strict.default.equal(tableBugs[0].priority, "medium");
import_strict.default.equal(tableBugs[0].status, "active");
import_strict.default.equal(tableBugs[0].assignedTo, "\u738B\u5F3A\u5F3A");
import_strict.default.equal(tableBugs[0].confirmed, true);
var pager = parseBugListPager2(wrappedTableHtml);
import_strict.default.equal(pager?.recTotal, 1);
import_strict.default.equal(pager?.recPerPage, 20);
import_strict.default.equal(pager?.pageID, 1);
import_strict.default.equal(pager?.pageTotal, 1);
var linkOnlyHtml = JSON.stringify({
  result: "success",
  data: `
    <div class="bug-list">
      <a href="/index.php?m=bug&amp;f=view&amp;bugID=183099">8.1.0---\u6E14\u573A\u6FC0\u5149\u6280\u80FD---\u89E6\u53D1\u65A9\u6740\u7684\u65F6\u5019\u7D22\u654C\u65F6\u95F4\u7ED3\u675F\u4E86</a>
      <span>\u4E00\u822C</span><span>\u6FC0\u6D3B</span><span>\u6307\u6D3E\u7ED9 \u738B\u5F3A\u5F3A</span><span>06-02 10:55</span>
    </div>`
});
var linkBugs = parseBugList2(linkOnlyHtml);
import_strict.default.equal(linkBugs.length, 1);
import_strict.default.equal(linkBugs[0].id, "183099");
import_strict.default.match(linkBugs[0].title, /渔场激光技能/);
import_strict.default.equal(linkBugs[0].assignedTo, "\u738B\u5F3A\u5F3A");
var rewrittenTableHtml = JSON.stringify({
  result: "success",
  data: `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox"></th>
          <th>ID</th>
          <th>Bug\u6807\u9898</th>
          <th>\u7EA7\u522B</th>
          <th>\u72B6\u6001</th>
          <th>\u6307\u6D3E\u7ED9</th>
        </tr>
      </thead>
      <tbody>
        <tr data-id="183099">
          <td><input type="checkbox" name="bugIDList[]" value="183099"></td>
          <td><a href="/bug-view-183099.html">183099</a></td>
          <td><a href="/bug-view-183099.html">8.1.0---\u6E14\u573A\u6FC0\u5149\u6280\u80FD\u89E6\u53D1\u65B0\u6740\u7684\u65F6\u5019\u7D22\u654C\u65F6\u95F4\u7ED3\u675F\u4E86</a></td>
          <td>\u4E00\u822C</td>
          <td>\u6FC0\u6D3B</td>
          <td><a href="/index.php?m=user&f=view&account=wangqiangqiang">\u738B\u5F3A\u5F3A</a></td>
        </tr>
      </tbody>
      <input type="hidden" name="recTotal" value="1">
    </table>`
});
var rewrittenBugs = parseBugList2(rewrittenTableHtml);
import_strict.default.equal(rewrittenBugs.length, 1);
import_strict.default.equal(rewrittenBugs[0].id, "183099");
import_strict.default.match(rewrittenBugs[0].title, /渔场激光技能/);
import_strict.default.equal(rewrittenBugs[0].status, "active");
import_strict.default.equal(rewrittenBugs[0].assignedTo, "\u738B\u5F3A\u5F3A");
var moduleSettingsHtml = JSON.stringify({
  result: "success",
  data: `
    <table>
      <tbody>
        <tr data-id="0">
          <td><input type="checkbox" value="0"></td>
          <td>0</td>
          <td>\u5217\u8868\u9875\u662F\u5426\u663E\u793A\u6A21\u5757\u540D</td>
          <td>\u672A\u6307\u6D3E</td>
        </tr>
      </tbody>
    </table>`
});
var moduleSettingBugs = parseBugList2(moduleSettingsHtml);
import_strict.default.equal(moduleSettingBugs.length, 0);
var dtableHtml = JSON.stringify({
  result: "success",
  data: `
    <div class="dtable" data-module="bug">
      <div class="dtable-header">ID Bug\u6807\u9898 \u7EA7\u522B \u72B6\u6001 \u521B\u5EFA\u8005 \u521B\u5EFA\u65E5\u671F \u786E\u8BA4 \u6307\u6D3E\u7ED9</div>
      <div class="dtable-row" data-id="184055">
        <div class="dtable-cell c-id">184055</div>
        <div class="dtable-cell c-title">\u6D4B\u8BD5\u7528--\u63A8\u9001\u9700\u8981\u652F\u6301\u4E3B\u52A8\u5207\u6362\u5230\u5BF9\u5E94\u7684\u9875\u7B7E</div>
        <div class="dtable-cell c-pri">\u4E00\u822C</div>
        <div class="dtable-cell c-status">\u6FC0\u6D3B</div>
        <div class="dtable-cell c-opened">\u65BD\u5065</div>
        <div class="dtable-cell c-date">06-25 11:51</div>
        <div class="dtable-cell c-confirmed">\u672A\u786E\u8BA4</div>
        <div class="dtable-cell c-assigned">\u8521\u5B8F\u4EAE</div>
      </div>
    </div>`
});
var dtableBugs = parseBugList2(dtableHtml);
import_strict.default.equal(dtableBugs.length, 1);
import_strict.default.equal(dtableBugs[0].id, "184055");
import_strict.default.match(dtableBugs[0].title, /推送需要支持/);
import_strict.default.equal(dtableBugs[0].status, "active");
import_strict.default.equal(dtableBugs[0].priority, "medium");
var zentao18TableHtml = JSON.stringify({
  result: "success",
  data: `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox"></th>
          <th><a href="/index.php?m=bug&amp;f=browse&amp;productID=34&amp;branch=all&amp;browseType=unclosed&amp;orderBy=id_asc&amp;recTotal=22&amp;recPerPage=20">ID</a></th>
          <th><a href="/index.php?m=bug&amp;f=browse&amp;productID=34&amp;branch=all&amp;browseType=unclosed&amp;orderBy=title_asc&amp;recTotal=22&amp;recPerPage=20">Bug\u6807\u9898</a></th>
          <th>\u7EA7\u522B</th>
          <th>P</th>
          <th>\u72B6\u6001</th>
          <th>\u521B\u5EFA\u8005</th>
          <th>\u521B\u5EFA\u65E5\u671F</th>
          <th>\u786E\u8BA4</th>
          <th>\u6307\u6D3E\u7ED9</th>
          <th>\u65B9\u6848</th>
          <th>\u64CD\u4F5C</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><input type="checkbox" name="bugIDList[]" value="184055"></td>
          <td><a href="/index.php?m=bug&amp;f=view&amp;bugID=184055">184055</a></td>
          <td><a href="/index.php?m=bug&amp;f=view&amp;bugID=184055">\u6D4B\u8BD5\u7528---\u63A8\u9001\u9700\u8981\u652F\u6301\u4E3B\u52A8\u5207\u6362\u5230\u5BF9\u5E94\u7684\u9875\u7B7E</a></td>
          <td><span title="3">3</span></td>
          <td>\u4E00\u822C</td>
          <td>\u6FC0\u6D3B</td>
          <td>\u65BD\u5065</td>
          <td>06-25 11:51</td>
          <td>\u672A\u786E\u8BA4</td>
          <td><a href="/index.php?m=bug&amp;f=assignTo&amp;bugID=184055&amp;onlybody=yes">\u8521\u5B8F\u4EAE</a></td>
          <td></td>
          <td>
            <a href="/index.php?m=bug&amp;f=confirmBug&amp;bugID=184055&amp;onlybody=yes">\u786E\u8BA4</a>
            <a href="/index.php?m=bug&amp;f=resolve&amp;bugID=184055&amp;onlybody=yes">\u89E3\u51B3</a>
            <a href="/index.php?m=bug&amp;f=edit&amp;bugID=184055">\u7F16\u8F91</a>
          </td>
        </tr>
      </tbody>
    </table>
    <input type="hidden" id="recTotal" value="22">
    <input type="hidden" id="recPerPage" value="20">
    <input type="hidden" id="pageID" value="1">`
});
var zentao18Bugs = parseBugList2(zentao18TableHtml);
import_strict.default.equal(zentao18Bugs.length, 1);
import_strict.default.equal(zentao18Bugs[0].id, "184055");
import_strict.default.match(zentao18Bugs[0].title, /主动切换/);
import_strict.default.equal(zentao18Bugs[0].status, "active");
import_strict.default.equal(zentao18Bugs[0].priority, "medium");
import_strict.default.equal(zentao18Bugs[0].openedBy, "\u65BD\u5065");
import_strict.default.equal(zentao18Bugs[0].assignedTo, "\u8521\u5B8F\u4EAE");
import_strict.default.equal(zentao18Bugs[0].confirmed, false);
console.log("ZenTao parser regression tests passed.");
