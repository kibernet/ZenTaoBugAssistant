# 禅道 Bug 修复助手

在 VS Code / Cursor 与 IntelliJ IDEA 中把禅道缺陷单变成 AI 可执行的代码修复上下文：截图、复现步骤、相关代码线索、验证清单和状态回写一次完成。本插件不替代禅道的项目管理能力，只补齐“缺陷单到 AI Coding Agent”之间缺的工程上下文层。

## 目录结构

```text
.
├── build.bat
├── intellij-plugin     # IntelliJ IDEA 插件工程（Java / Gradle）
├── vscode-plugin       # VS Code / Cursor 插件工程（TypeScript / npm）
├── LICENSE
└── README.md
```

## 功能

- **登录禅道** — 支持自动保存会话，下次打开自动登录
- **查看 Bug 列表** — 按项目、成员、状态（未解决 / 已解决 / 已关闭）筛选
- **"仅看我的"** — 一键过滤出指派给自己的 Bug
- **预览 Bug 详情** — 在编辑器标签页中渲染重现步骤、截图和附件
- **AI 一键修复** — 把 Bug 描述和截图整理成提示词，直接发送到 Claude 或 Cursor
- **AI 诊断包** — 自动附加仓库路径、Git 分支、未提交改动、最近提交、疑似相关文件、代码证据和推荐验证命令
- **代码证据包** — 基于 Bug 文本关键词在当前 Git 仓库中搜索代码命中行，减少 AI 靠标题猜测
- **验证命令推荐** — 根据仓库技术栈提示 npm / Gradle / Maven / pytest / Go / Cargo / dotnet / Unity 等验证入口
- **AI 上下文质量评估** — 自动附加上下文评分、已具备信号和待补强缺口，避免低质量 Prompt 直接交给 Agent
- **结构化修复协议** — 约束 AI 输出根因、改动文件、验证结果、风险和禅道回写摘要，减少修复结论散乱
- **AI 诊断包直送** — 自动汇总上下文质量、截图数量、Prompt 规模和诊断信息，并直接交给 Chat/CLI
- **Chat / CLI 双模式** — VS Code / Cursor 与 IntelliJ IDEA 均可选择发送到聊天窗口，或保存提示词并在终端执行命令行 Agent
- **批量修复** — 对当前筛选出的所有未解决 Bug 逐一生成提示词并发送
- **修复后回写** — 解决/关闭 Bug 时根据当前 Git diff 生成禅道备注草稿，用户确认后提交
- **禅道状态同步** — 行内执行指派、确认、解决、关闭、激活操作

## 快速构建

Windows 下直接运行：

```bat
build.bat
```

脚本会依次构建两个插件：

1. `intellij-plugin`：使用 Gradle 构建 JetBrains 平台插件（输出 zip）
2. `vscode-plugin`：安装 npm 依赖、编译 TypeScript 并打包为 `.vsix`

如果本机没有 Gradle 或 Node.js，脚本会自动下载到 `.tools` 目录。

### VS Code / Cursor 插件

```bash
cd vscode-plugin
npm install
npm run build
```

### IntelliJ IDEA 插件

```bash
cd intellij-plugin
./gradlew buildPlugin
```

## 配置

| 设置项 | 说明 | 默认值 |
|---|---|---|
| `zentaoBugAssistant.serverUrl` | 禅道服务器地址 | `http://your-zentao-server/` |
| `zentaoBugAssistant.aiEngine` | AI 引擎（`claudeCode` / `cursor`） | `claudeCode` |
| `zentaoBugAssistant.repairMode` | 修复方式（`chat` / `cli`） | `chat` |
| `zentaoBugAssistant.cliCommandTemplate` | CLI 命令模板，支持 `{promptFile}`、`{promptFileRaw}`、`{bugIds}`、`{engine}` | 空，使用默认模板 |
| `zentaoBugAssistant.autoLogin` | 启动时自动登录 | `true` |
| `zentaoBugAssistant.autoSyncAfterFix` | 发送修复提示词后询问同步状态到禅道 | `false` |

IntelliJ IDEA 侧在 `Settings | ZenTao Bug Assistant` 中提供同等配置：默认禅道地址、AI 引擎、修复方式、CLI 命令模板和会话保活间隔。

## 版本兼容

- VS Code / Cursor `^1.95.0`，Node.js `>=18.0.0`
- IntelliJ IDEA `2021.3+`（`sinceBuild=211`）
- 禅道 17+（基于 Web 界面抓取，不依赖 REST API）

## 许可证

MIT License

## 📥 插件市场 (Marketplace)

### 1. JetBrains IDEA (IntelliJ 平台)
https://plugins.jetbrains.com/author/me

### 2. Visual Studio Code
https://marketplace.visualstudio.com/manage/publishers/kibernet

### 3. Cursor
https://open-vsx.org/
