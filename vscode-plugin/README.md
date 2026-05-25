# 禅道 Bug 修复助手

在 VS Code / Cursor 侧边栏中登录禅道、查看分配给你的 Bug，一键把 Bug 详情发送给 **Claude Code** 或 **Cursor** 进行 AI 辅助修复。

## 功能

- **登录禅道** — 支持自动保存会话，下次打开自动登录
- **查看 Bug 列表** — 按项目、成员、状态（未解决 / 已解决 / 已关闭）筛选
- **"仅看我的"** — 一键过滤出指派给自己的 Bug
- **预览 Bug 详情** — 在编辑器标签页中渲染重现步骤、期望结果、视频附件
- **AI 一键修复** — 把 Bug 描述和截图整理成提示词，直接发送到 Claude Code 或 Cursor 聊天窗口
- **批量修复** — 对当前筛选出的所有未解决 Bug 逐一生成提示词并发送
- **禅道状态同步** — 行内执行指派、确认、解决、关闭、激活操作

## 使用前提

- 已安装 [Claude Code](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code) 或 [Cursor](https://www.cursor.com/) 中的至少一种 AI 工具
- 可访问自己团队的禅道服务器（支持禅道 17+ 的 Web 界面）

## 快速开始

1. 安装插件后，点击活动栏的**禅道图标**打开侧边栏
2. 在设置中填写禅道服务器地址：`zentaoBugAssistant.serverUrl`
3. 点击**登录**，输入禅道用户名和密码
4. 选择项目，勾选筛选条件，即可看到 Bug 列表
5. 点击某条 Bug 的 **✦ AI修复**，详情将自动发送到 Claude Code 或 Cursor

## 插件设置

| 设置项 | 说明 | 默认值 |
|---|---|---|
| `zentaoBugAssistant.serverUrl` | 禅道服务器地址 | `http://your-zentao-server/` |
| `zentaoBugAssistant.aiEngine` | AI 引擎（`claudeCode` / `cursor`） | `claudeCode` |
| `zentaoBugAssistant.autoLogin` | 启动时自动登录 | `true` |
| `zentaoBugAssistant.autoSyncAfterFix` | 发送修复提示词后询问同步状态到禅道 | `false` |
| `zentaoBugAssistant.sessionKeepAliveIntervalMinutes` | 会话保活间隔（分钟） | `5` |

## 版本兼容

- VS Code `^1.95.0`
- 禅道 17+（基于 Web 界面抓取，不依赖 REST API）
