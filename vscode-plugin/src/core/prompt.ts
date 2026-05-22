import type { ZenTaoBugDetail } from "./types";

const emptyText = "未提供";
const maxImageAttachments = 32;

export function buildBugFixPrompt(bug: ZenTaoBugDetail): string {
  const reproduceImages = extractReproduceStepImages(bug.reproduceStepsHtml).slice(0, maxImageAttachments);
  const reproduceImageText = reproduceImages.length
    ? reproduceImages.map((url, index) => `- 图片${index + 1}：${url}`).join("\n")
    : emptyText;
  const bugDescription = textOrFallback(bug.description, bug.title);
  const reproduceText = textOrFallback(htmlToPromptText(bug.reproduceStepsHtml), bug.reproduceSteps);

  return `【Bug修复任务】
Bug编号：${bug.id}

Bug描述：
${bugDescription}

复现步骤文本：
${reproduceText}

复现步骤图片：
${reproduceImageText}

请在当前代码仓库中修复以上 Bug。完成后请说明：
1. 根因是什么
2. 修改了哪些关键位置
3. 如何验证修复`;
}

export function buildBatchBugFixPrompt(bugs: ZenTaoBugDetail[]): string {
  const body = bugs.map((bug, index) => {
    const reproduceImages = extractReproduceStepImages(bug.reproduceStepsHtml).slice(0, maxImageAttachments);
    const reproduceImageText = reproduceImages.length
      ? reproduceImages.map((url, imageIndex) => `  - 图片${imageIndex + 1}：${url}`).join("\n")
      : `  ${emptyText}`;
    const bugDescription = textOrFallback(bug.description, bug.title);
    const reproduceText = textOrFallback(htmlToPromptText(bug.reproduceStepsHtml), bug.reproduceSteps);
    return `## ${index + 1}. Bug #${bug.id}

Bug描述：
${bugDescription}

复现步骤文本：
${reproduceText}

复现步骤图片：
${reproduceImageText}`;
  }).join("\n\n---\n\n");

  return `【批量Bug修复任务】
以下是当前列表中的未解决 Bug，请在当前代码仓库中依次分析并修复。

${body}

完成后请按 Bug 编号分别说明：
1. 根因是什么
2. 修改了哪些关键位置
3. 如何验证修复`;
}

function extractReproduceStepImages(html: string | undefined): string[] {
  if (!html) {
    return [];
  }
  const urls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const url = readImageAttr(tag, "data-original-src") ?? readImageAttr(tag, "src");
    if (url && !/^data:/i.test(url)) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}

function readImageAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

function textOrFallback(...values: Array<string | undefined>): string {
  const value = values.map((item) => item?.trim()).find((item) => item);
  return value ?? emptyText;
}

function htmlToPromptText(html: string | undefined): string | undefined {
  if (!html) {
    return undefined;
  }
  return html
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
