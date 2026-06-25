import type { ZenTaoBugDetail } from "./types";

const emptyText = "未提供";
const maxImageAttachments = 32;
const repairExecutionProtocol = `【AI修复执行协议】
请严格按以下顺序处理：
1. 先阅读后文的 AI 诊断包，优先使用其中的代码证据、候选文件和推荐验证命令。
2. 若诊断包证据不足，先在当前仓库中搜索定位，不要只根据 Bug 标题猜测改动点。
3. 只做与当前 Bug 直接相关的最小必要改动，避免无关重构、格式化整文件或改动禅道业务数据。
4. 保留当前工作区已有未提交改动；不要执行 git reset、revert 或覆盖无关文件。
5. 修复后优先运行诊断包推荐的验证命令；如果无法运行，必须说明原因和替代验证方式。
6. 不要假称已经验证。未执行的命令要明确写“未执行”。

最终请按这个格式输出，便于回写禅道：
【AI修复报告】
- Bug：#编号 / 标题
- 根因：
- 改动文件：
- 关键改动：
- 验证命令与结果：
- 剩余风险：
- 禅道回写摘要：`;

export function buildBugFixPrompt(bug: ZenTaoBugDetail): string {
  const reproduceImages = (bug.promptImages?.length ? bug.promptImages : extractReproduceStepImages(bug.reproduceStepsHtml)).slice(0, maxImageAttachments);
  const reproduceImageText = reproduceImages.length
    ? reproduceImages.map((url, index) => `- 图片${index + 1}：${url}`).join("\n")
    : emptyText;
  const bugDescription = textOrFallback(bug.description, bug.title);
  const reproduceText = textOrFallback(htmlToPromptText(bug.reproduceStepsHtml), bug.reproduceSteps);
  const expectedText = textOrFallback(htmlToPromptText(bug.expectedResultHtml), bug.expectedResult);
  const actualText = textOrFallback(bug.actualResult);
  const attachmentText = formatAttachments(bug);

  return `【Bug修复任务】
Bug编号：${bug.id}

禅道缺陷单：
${formatBugMetadata(bug)}

Bug描述：
${bugDescription}

复现步骤文本：
${reproduceText}

期望结果：
${expectedText}

实际结果：
${actualText}

复现步骤图片：
${reproduceImageText}

附件/视频线索：
${attachmentText}

说明：图片已由插件使用当前禅道登录态下载为本地文件，AI 可直接读取上述本地路径；视频文件不传给 AI，但文件名和链接会作为排查线索。

请在当前代码仓库中修复以上 Bug。

${repairExecutionProtocol}`;
}

export function buildBatchBugFixPrompt(bugs: ZenTaoBugDetail[]): string {
  const body = bugs.map((bug, index) => {
    const reproduceImages = (bug.promptImages?.length ? bug.promptImages : extractReproduceStepImages(bug.reproduceStepsHtml)).slice(0, maxImageAttachments);
    const reproduceImageText = reproduceImages.length
      ? reproduceImages.map((url, imageIndex) => `  - 图片${imageIndex + 1}：${url}`).join("\n")
      : `  ${emptyText}`;
    const bugDescription = textOrFallback(bug.description, bug.title);
    const reproduceText = textOrFallback(htmlToPromptText(bug.reproduceStepsHtml), bug.reproduceSteps);
    const expectedText = textOrFallback(htmlToPromptText(bug.expectedResultHtml), bug.expectedResult);
    const actualText = textOrFallback(bug.actualResult);
    const attachmentText = formatAttachments(bug, "  ");
    return `## ${index + 1}. Bug #${bug.id}

禅道缺陷单：
${indentLines(formatBugMetadata(bug), "  ")}

Bug描述：
${bugDescription}

复现步骤文本：
${reproduceText}

期望结果：
${expectedText}

实际结果：
${actualText}

复现步骤图片：
${reproduceImageText}

附件/视频线索：
${attachmentText}`;
  }).join("\n\n---\n\n");

  return `【批量Bug修复任务】
以下是当前列表中的未解决 Bug，请在当前代码仓库中依次分析并修复。

${body}

说明：图片已由插件使用当前禅道登录态下载为本地文件，AI 可直接读取上述本地路径；视频文件不传给 AI，但文件名和链接会作为排查线索。

请在当前代码仓库中按 Bug 编号依次修复。

${repairExecutionProtocol}

批量任务要求：每个 Bug 都要单独给出一份【AI修复报告】，不要把多个 Bug 的根因、验证和风险混在一起。`;
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

function formatBugMetadata(bug: ZenTaoBugDetail): string {
  return [
    `- 标题：${textOrFallback(bug.title)}`,
    `- 状态：${textOrFallback(bug.status)}`,
    `- 优先级：${textOrFallback(bug.priority)}`,
    `- 当前指派：${textOrFallback(bug.assignedTo)}`,
    `- 创建者：${textOrFallback(bug.openedBy)}`,
    `- 创建时间：${textOrFallback(bug.createdAt)}`,
    `- 已确认：${bug.confirmed === undefined ? emptyText : bug.confirmed ? "是" : "否"}`
  ].join("\n");
}

function formatAttachments(bug: ZenTaoBugDetail, prefix = ""): string {
  const attachments = [...(bug.attachments ?? [])].slice(0, 16);
  if (!attachments.length) {
    return `${prefix}${emptyText}`;
  }
  return attachments
    .map((attachment, index) => {
      const kind = attachment.kind ?? "file";
      const name = attachment.name || `附件${index + 1}`;
      const url = attachment.url ? `：${attachment.url}` : "";
      return `${prefix}- ${kind} ${name}${url}`;
    })
    .join("\n");
}

function indentLines(value: string, prefix: string): string {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join("\n");
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
