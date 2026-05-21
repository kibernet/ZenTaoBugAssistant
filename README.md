# 禅道 Bug 修复助手

禅道 Bug 修复助手是一个面向 VS Code/Cursor 与 IntelliJ IDEA 的跨 IDE 插件工程。它用于登录禅道、拉取分配给当前用户的 Bug、预览详情，并把 Bug 信息组织成适合 AI 助手执行修复的提示词。

## 当前范围

此仓库先提供可扩展的项目骨架和最小闭环实现：

- VS Code/Cursor 插件：侧边栏、项目选择、成员范围过滤、预览、单个修复、批量修复与禅道状态同步入口。
- IntelliJ IDEA 插件：Gradle/Java 插件工程骨架与 Tool Window 入口。
- 文档、许可协议和 Git 忽略规则。

## 目录结构

```text
.
├── build.bat
├── intellij-plugin     # IntelliJ IDEA 插件工程
├── vscode-plugin       # VS Code/Cursor 插件工程
├── LICENSE
└── README.md
```

## 快速开始

### 一键构建

Windows 下直接运行：

```bat
build.bat
```

脚本会参照 `LuaUnity` 的构建方式依次处理：

1. `intellij-plugin`：使用 JDK 17+ 和 Gradle 构建 JetBrains 平台插件。
2. `vscode-plugin`：在插件目录内安装 npm 依赖、编译 TypeScript，并输出 `.vsix`。

如果本机没有 Gradle 或 Node.js，脚本会下载 Gradle `9.0.0` 和 Node.js `20.19.0` 到 `.tools` 目录。

### VS Code/Cursor 插件

```bash
cd vscode-plugin
npm install
npm run build
```

调试插件时，在 VS Code 中打开 `vscode-plugin` 并启动 Extension Host。

### IntelliJ IDEA 插件

IntelliJ 插件位于 `intellij-plugin`。安装 JDK 17 后可执行：

```bash
cd intellij-plugin
./gradlew runIde
```

Windows 环境可使用 `gradlew.bat runIde`。

## 配置项

VS Code/Cursor 插件提供以下配置：

- `zentaoBugAssistant.serverUrl`：禅道服务器地址，默认 `http://zentao.yuwan-game.com:8088/`。
- `zentaoBugAssistant.aiEngine`：AI 引擎，支持 `auto`、`cursor`、`claudeCode`。
- `zentaoBugAssistant.autoLogin`：是否自动使用本地会话。
- `zentaoBugAssistant.rememberPassword`：是否保存密码。
- `zentaoBugAssistant.teamMembers`：团队成员禅道账号列表，用于“看团队的 Bug”。
- `zentaoBugAssistant.autoSyncAfterFix`：发送 AI 修复提示词后，是否询问同步解决/关闭/指派到禅道。

## 版本兼容

- 插件版本：`1.0.0`。
- VS Code/Cursor：`^1.95.0`，Node.js `>=18.0.0`。
- IntelliJ IDEA：基于 IntelliJ IDEA Community `2025.1.7` 构建，`sinceBuild=241`。

## 项目和成员过滤

登录成功后，插件会从禅道 Bug 页面解析可选项目。用户在侧边栏选择项目后，选择会写入 VS Code/Cursor 的全局状态，下次打开插件会自动恢复。

Bug 范围支持四种模式：

- `只看我的`：只拉取当前登录账号名下 Bug。
- `看全部`：不传指派人过滤条件。
- `看团队`：按 `zentaoBugAssistant.teamMembers` 中配置的账号逐个拉取并合并去重。
- `指定成员`：临时输入一个禅道账号，只看该成员名下 Bug。

## 禅道状态同步

每条 Bug 支持行内执行：

- `解决`：对应网页上的“解决”，可选择解决方案并填写修改日志。
- `关闭`：对应网页上的“关闭”，可填写备注。
- `指派`：对应网页上的“指派给”，可填写目标账号和备注。

禅道不同版本的表单字段可能略有差异；当前实现使用 `index.php?m=bug&f=resolve|close|assignto&bugID=...` 的通用表单提交方式，必要时可根据实际 HTML 增加隐藏字段/token 适配。

## AI 修复策略

插件会把 Bug 详情转换为统一提示词，然后优先尝试打开当前 IDE 中可用的 AI 聊天入口。如果无法直接调用对应插件命令，会把提示词复制到剪贴板，并提示用户粘贴到 Cursor 或 Claude Code。

## 安全说明

- 密码应存储在 IDE 提供的 Secret Storage 或 Password Safe 中。
- 日志不得输出密码、Cookie、Token 等敏感信息。
- 当前默认禅道地址为 HTTP，如生产环境支持 HTTPS，应优先切换到 HTTPS。

## 许可证

本项目使用 MIT License。
