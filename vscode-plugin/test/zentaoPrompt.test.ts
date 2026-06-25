import assert from "assert/strict";
import { buildBugFixPrompt } from "../src/core/prompt";
import type { ZenTaoBugDetail } from "../src/core/types";

const bug: ZenTaoBugDetail = {
  id: "183099",
  title: "渔场激光技能触发斩杀时索敌结束",
  priority: "medium",
  status: "active",
  createdAt: "06-02 10:55",
  assignedTo: "王强强",
  openedBy: "石挺现",
  confirmed: true,
  description: "触发斩杀时索敌时间结束，没有用激光但是在发炮。",
  reproduceSteps: "进入渔场，触发激光技能斩杀。",
  expectedResult: "技能表现和发炮状态一致。",
  actualResult: "没有用激光但是在发炮。",
  attachments: [
    { name: "repro.mp4", url: "http://zentao.example/file.mp4", kind: "video" },
    { name: "screen.png", url: "C:/tmp/screen.png", kind: "image" }
  ],
  promptImages: ["C:/tmp/screen.png"],
  comments: []
};

const prompt = buildBugFixPrompt(bug);

assert.match(prompt, /禅道缺陷单/);
assert.match(prompt, /当前指派：王强强/);
assert.match(prompt, /创建者：石挺现/);
assert.match(prompt, /已确认：是/);
assert.match(prompt, /期望结果：\n技能表现和发炮状态一致。/);
assert.match(prompt, /实际结果：\n没有用激光但是在发炮。/);
assert.match(prompt, /附件\/视频线索/);
assert.match(prompt, /video repro\.mp4：http:\/\/zentao\.example\/file\.mp4/);
assert.match(prompt, /保留当前工作区已有未提交改动/);

console.log("ZenTao prompt regression tests passed.");
