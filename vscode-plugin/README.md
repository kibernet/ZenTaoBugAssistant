# 禅道 Bug 修复助手

在 VS Code / Cursor 中把禅道缺陷单变成 AI 可执行的代码修复上下文：截图、复现步骤、相关代码线索、验证清单和状态回写一次完成。本插件不替代禅道的项目管理能力，只补齐“缺陷单到 AI Coding Agent”之间缺的工程上下文层。

## 功能

- **登录禅道** — 支持自动保存会话，下次打开自动登录
- **查看 Bug 列表** — 按项目、成员、状态（未解决 / 已解决 / 已关闭）筛选
- **"仅看我的"** — 一键过滤出指派给自己的 Bug
- **预览 Bug 详情** — 在编辑器标签页中渲染重现步骤、期望结果、视频附件
- **AI 一键修复** — 把 Bug 描述和截图整理成提示词，直接发送到 Claude 或 Cursor 聊天窗口
- **AI 诊断包** — 自动附加仓库路径、Git 分支、未提交改动、最近提交、疑似相关文件、代码证据和推荐验证命令
- **代码证据包** — 基于 Bug 文本关键词在当前 Git 仓库中搜索代码命中行，减少 AI 靠标题猜测
- **验证命令推荐** — 根据仓库技术栈提示 npm / Gradle / Maven / pytest / Go / Cargo / dotnet / Unity 等验证入口
- **AI 上下文质量评估** — 自动附加上下文评分、已具备信号和待补强缺口，避免低质量 Prompt 直接交给 Agent
- **结构化修复协议** — 约束 AI 输出根因、改动文件、验证结果、风险和禅道回写摘要，减少修复结论散乱
- **AI 诊断包直送** — 自动汇总上下文质量、截图数量、Prompt 规模和诊断信息，并直接交给 Chat/CLI
- **Chat / CLI 双模式** — 可选择发送到 AI 聊天窗口，或保存提示词并在终端用命令行 Agent 修复
- **批量修复** — 对当前筛选出的所有未解决 Bug 逐一生成提示词并发送
- **修复后回写** — 解决/关闭 Bug 时根据当前 Git diff 生成禅道备注草稿，用户确认后提交
- **禅道状态同步** — 行内执行指派、确认、解决、关闭、激活操作

## 使用前提

- 已安装 [Claude Code](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code) 或 [Cursor](https://www.cursor.com/) 中的至少一种 AI 工具
- 可访问自己团队的禅道服务器（支持禅道 17+ 的 Web 界面）

## 快速开始

1. 安装插件后，点击活动栏的**禅道图标**打开侧边栏
2. 在设置中填写禅道服务器地址：`zentaoBugAssistant.serverUrl`
3. 点击**登录**，输入禅道用户名和密码
4. 选择项目，勾选筛选条件，即可看到 Bug 列表
5. 点击某条 Bug 的 **✦ AI修复**，详情将自动发送到 Claude 或 Cursor

## 插件设置

| 设置项 | 说明 | 默认值 |
|---|---|---|
| `zentaoBugAssistant.serverUrl` | 禅道服务器地址 | `http://your-zentao-server/` |
| `zentaoBugAssistant.aiEngine` | AI 引擎（`claudeCode` / `cursor`） | `claudeCode` |
| `zentaoBugAssistant.repairMode` | 修复方式（`chat` / `cli`） | `chat` |
| `zentaoBugAssistant.cliCommandTemplate` | CLI 命令模板，支持 `{promptFile}`、`{promptFileRaw}`、`{bugIds}`、`{engine}` | 空，使用默认模板 |
| `zentaoBugAssistant.autoLogin` | 启动时自动登录 | `true` |
| `zentaoBugAssistant.autoSyncAfterFix` | 发送修复提示词后询问同步状态到禅道 | `false` |
| `zentaoBugAssistant.sessionKeepAliveIntervalMinutes` | 会话保活间隔（分钟） | `5` |

### CLI 修复模式

选择 `CLI` 后，插件会把 Bug 修复提示词保存为本地 Markdown 文件，并在 VS Code / Cursor 终端执行命令。默认命令会按当前 AI 引擎选择常见 CLI：

- Claude：`claude --print`
- Cursor：把 Prompt 保存为 session 文件后，执行 `cursor-agent -p --trust -- "请读取这个文件..."`，失败时自动重试一次

如果你的团队使用自定义命令，可配置 `zentaoBugAssistant.cliCommandTemplate`，例如：

```text
my-agent --prompt-file {promptFile}
```

## 版本兼容

- VS Code `^1.95.0`
- 禅道 17+（基于 Web 界面抓取，不依赖 REST API）
