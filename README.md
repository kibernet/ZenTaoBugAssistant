# 禅道 Bug 修复助手

在 VS Code / Cursor 与 IntelliJ IDEA 侧边栏中登录禅道、查看分配给你的 Bug，一键把 Bug 详情发送给 **Claude Code** 或 **Cursor** 进行 AI 辅助修复。

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
- **AI 一键修复** — 把 Bug 描述和截图整理成提示词，直接发送到 Claude Code 或 Cursor
- **批量修复** — 对当前筛选出的所有未解决 Bug 逐一生成提示词并发送
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
| `zentaoBugAssistant.autoLogin` | 启动时自动登录 | `true` |
| `zentaoBugAssistant.autoSyncAfterFix` | 发送修复提示词后询问同步状态到禅道 | `false` |

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
