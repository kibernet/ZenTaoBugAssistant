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

// test/zentaoPrompt.test.ts
var import_strict = __toESM(require("assert/strict"));

// src/core/prompt.ts
var emptyText = "\u672A\u63D0\u4F9B";
var maxImageAttachments = 32;
var repairExecutionProtocol = `\u3010AI\u4FEE\u590D\u6267\u884C\u534F\u8BAE\u3011
\u8BF7\u4E25\u683C\u6309\u4EE5\u4E0B\u987A\u5E8F\u5904\u7406\uFF1A
1. \u5148\u9605\u8BFB\u540E\u6587\u7684 AI \u8BCA\u65AD\u5305\uFF0C\u4F18\u5148\u4F7F\u7528\u5176\u4E2D\u7684\u4EE3\u7801\u8BC1\u636E\u3001\u5019\u9009\u6587\u4EF6\u548C\u63A8\u8350\u9A8C\u8BC1\u547D\u4EE4\u3002
2. \u82E5\u8BCA\u65AD\u5305\u8BC1\u636E\u4E0D\u8DB3\uFF0C\u5148\u5728\u5F53\u524D\u4ED3\u5E93\u4E2D\u641C\u7D22\u5B9A\u4F4D\uFF0C\u4E0D\u8981\u53EA\u6839\u636E Bug \u6807\u9898\u731C\u6D4B\u6539\u52A8\u70B9\u3002
3. \u53EA\u505A\u4E0E\u5F53\u524D Bug \u76F4\u63A5\u76F8\u5173\u7684\u6700\u5C0F\u5FC5\u8981\u6539\u52A8\uFF0C\u907F\u514D\u65E0\u5173\u91CD\u6784\u3001\u683C\u5F0F\u5316\u6574\u6587\u4EF6\u6216\u6539\u52A8\u7985\u9053\u4E1A\u52A1\u6570\u636E\u3002
4. \u4FDD\u7559\u5F53\u524D\u5DE5\u4F5C\u533A\u5DF2\u6709\u672A\u63D0\u4EA4\u6539\u52A8\uFF1B\u4E0D\u8981\u6267\u884C git reset\u3001revert \u6216\u8986\u76D6\u65E0\u5173\u6587\u4EF6\u3002
5. \u4FEE\u590D\u540E\u4F18\u5148\u8FD0\u884C\u8BCA\u65AD\u5305\u63A8\u8350\u7684\u9A8C\u8BC1\u547D\u4EE4\uFF1B\u5982\u679C\u65E0\u6CD5\u8FD0\u884C\uFF0C\u5FC5\u987B\u8BF4\u660E\u539F\u56E0\u548C\u66FF\u4EE3\u9A8C\u8BC1\u65B9\u5F0F\u3002
6. \u4E0D\u8981\u5047\u79F0\u5DF2\u7ECF\u9A8C\u8BC1\u3002\u672A\u6267\u884C\u7684\u547D\u4EE4\u8981\u660E\u786E\u5199\u201C\u672A\u6267\u884C\u201D\u3002

\u6700\u7EC8\u8BF7\u6309\u8FD9\u4E2A\u683C\u5F0F\u8F93\u51FA\uFF0C\u4FBF\u4E8E\u56DE\u5199\u7985\u9053\uFF1A
\u3010AI\u4FEE\u590D\u62A5\u544A\u3011
- Bug\uFF1A#\u7F16\u53F7 / \u6807\u9898
- \u6839\u56E0\uFF1A
- \u6539\u52A8\u6587\u4EF6\uFF1A
- \u5173\u952E\u6539\u52A8\uFF1A
- \u9A8C\u8BC1\u547D\u4EE4\u4E0E\u7ED3\u679C\uFF1A
- \u5269\u4F59\u98CE\u9669\uFF1A
- \u7985\u9053\u56DE\u5199\u6458\u8981\uFF1A`;
function buildBugFixPrompt(bug2) {
  const reproduceImages = (bug2.promptImages?.length ? bug2.promptImages : extractReproduceStepImages(bug2.reproduceStepsHtml)).slice(0, maxImageAttachments);
  const reproduceImageText = reproduceImages.length ? reproduceImages.map((url, index) => `- \u56FE\u7247${index + 1}\uFF1A${url}`).join("\n") : emptyText;
  const bugDescription = textOrFallback(bug2.description, bug2.title);
  const reproduceText = textOrFallback(htmlToPromptText(bug2.reproduceStepsHtml), bug2.reproduceSteps);
  const expectedText = textOrFallback(htmlToPromptText(bug2.expectedResultHtml), bug2.expectedResult);
  const actualText = textOrFallback(bug2.actualResult);
  const attachmentText = formatAttachments(bug2);
  return `\u3010Bug\u4FEE\u590D\u4EFB\u52A1\u3011
Bug\u7F16\u53F7\uFF1A${bug2.id}

\u7985\u9053\u7F3A\u9677\u5355\uFF1A
${formatBugMetadata(bug2)}

Bug\u63CF\u8FF0\uFF1A
${bugDescription}

\u590D\u73B0\u6B65\u9AA4\u6587\u672C\uFF1A
${reproduceText}

\u671F\u671B\u7ED3\u679C\uFF1A
${expectedText}

\u5B9E\u9645\u7ED3\u679C\uFF1A
${actualText}

\u590D\u73B0\u6B65\u9AA4\u56FE\u7247\uFF1A
${reproduceImageText}

\u9644\u4EF6/\u89C6\u9891\u7EBF\u7D22\uFF1A
${attachmentText}

\u8BF4\u660E\uFF1A\u56FE\u7247\u5DF2\u7531\u63D2\u4EF6\u4F7F\u7528\u5F53\u524D\u7985\u9053\u767B\u5F55\u6001\u4E0B\u8F7D\u4E3A\u672C\u5730\u6587\u4EF6\uFF0CAI \u53EF\u76F4\u63A5\u8BFB\u53D6\u4E0A\u8FF0\u672C\u5730\u8DEF\u5F84\uFF1B\u89C6\u9891\u6587\u4EF6\u4E0D\u4F20\u7ED9 AI\uFF0C\u4F46\u6587\u4EF6\u540D\u548C\u94FE\u63A5\u4F1A\u4F5C\u4E3A\u6392\u67E5\u7EBF\u7D22\u3002

\u8BF7\u5728\u5F53\u524D\u4EE3\u7801\u4ED3\u5E93\u4E2D\u4FEE\u590D\u4EE5\u4E0A Bug\u3002

${repairExecutionProtocol}`;
}
function extractReproduceStepImages(html) {
  if (!html) {
    return [];
  }
  const urls = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const url = readImageAttr(tag, "data-original-src") ?? readImageAttr(tag, "src");
    if (url && !/^data:/i.test(url)) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}
function readImageAttr(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}
function formatBugMetadata(bug2) {
  return [
    `- \u6807\u9898\uFF1A${textOrFallback(bug2.title)}`,
    `- \u72B6\u6001\uFF1A${textOrFallback(bug2.status)}`,
    `- \u4F18\u5148\u7EA7\uFF1A${textOrFallback(bug2.priority)}`,
    `- \u5F53\u524D\u6307\u6D3E\uFF1A${textOrFallback(bug2.assignedTo)}`,
    `- \u521B\u5EFA\u8005\uFF1A${textOrFallback(bug2.openedBy)}`,
    `- \u521B\u5EFA\u65F6\u95F4\uFF1A${textOrFallback(bug2.createdAt)}`,
    `- \u5DF2\u786E\u8BA4\uFF1A${bug2.confirmed === void 0 ? emptyText : bug2.confirmed ? "\u662F" : "\u5426"}`
  ].join("\n");
}
function formatAttachments(bug2, prefix = "") {
  const attachments = [...bug2.attachments ?? []].slice(0, 16);
  if (!attachments.length) {
    return `${prefix}${emptyText}`;
  }
  return attachments.map((attachment, index) => {
    const kind = attachment.kind ?? "file";
    const name = attachment.name || `\u9644\u4EF6${index + 1}`;
    const url = attachment.url ? `\uFF1A${attachment.url}` : "";
    return `${prefix}- ${kind} ${name}${url}`;
  }).join("\n");
}
function textOrFallback(...values) {
  const value = values.map((item) => item?.trim()).find((item) => item);
  return value ?? emptyText;
}
function htmlToPromptText(html) {
  if (!html) {
    return void 0;
  }
  return html.replace(/<img\b[^>]*>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|tr|td|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// test/zentaoPrompt.test.ts
var bug = {
  id: "183099",
  title: "\u6E14\u573A\u6FC0\u5149\u6280\u80FD\u89E6\u53D1\u65A9\u6740\u65F6\u7D22\u654C\u7ED3\u675F",
  priority: "medium",
  status: "active",
  createdAt: "06-02 10:55",
  assignedTo: "\u738B\u5F3A\u5F3A",
  openedBy: "\u77F3\u633A\u73B0",
  confirmed: true,
  description: "\u89E6\u53D1\u65A9\u6740\u65F6\u7D22\u654C\u65F6\u95F4\u7ED3\u675F\uFF0C\u6CA1\u6709\u7528\u6FC0\u5149\u4F46\u662F\u5728\u53D1\u70AE\u3002",
  reproduceSteps: "\u8FDB\u5165\u6E14\u573A\uFF0C\u89E6\u53D1\u6FC0\u5149\u6280\u80FD\u65A9\u6740\u3002",
  expectedResult: "\u6280\u80FD\u8868\u73B0\u548C\u53D1\u70AE\u72B6\u6001\u4E00\u81F4\u3002",
  actualResult: "\u6CA1\u6709\u7528\u6FC0\u5149\u4F46\u662F\u5728\u53D1\u70AE\u3002",
  attachments: [
    { name: "repro.mp4", url: "http://zentao.example/file.mp4", kind: "video" },
    { name: "screen.png", url: "C:/tmp/screen.png", kind: "image" }
  ],
  promptImages: ["C:/tmp/screen.png"],
  comments: []
};
var prompt = buildBugFixPrompt(bug);
import_strict.default.match(prompt, /禅道缺陷单/);
import_strict.default.match(prompt, /当前指派：王强强/);
import_strict.default.match(prompt, /创建者：石挺现/);
import_strict.default.match(prompt, /已确认：是/);
import_strict.default.match(prompt, /期望结果：\n技能表现和发炮状态一致。/);
import_strict.default.match(prompt, /实际结果：\n没有用激光但是在发炮。/);
import_strict.default.match(prompt, /附件\/视频线索/);
import_strict.default.match(prompt, /video repro\.mp4：http:\/\/zentao\.example\/file\.mp4/);
import_strict.default.match(prompt, /保留当前工作区已有未提交改动/);
console.log("ZenTao prompt regression tests passed.");
