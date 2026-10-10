# 编辑器支持

Qiy 的 `.qiy` 不是普通配置文件：官网、VS Code 和 JetBrains IDE 都使用同一组 Qiy 关键字与类型语义进行高亮。

## 官网代码块

VitePress 已加载 Qiy 的 TextMate grammar。文档中使用 `qiy` fenced code block 即可获得关键字、字段类型、注解、字符串和注释高亮。

## VS Code

扩展位于 `editors/vscode-qiy/`，支持 `.qiy` 文件识别、语法高亮、`//` 注释、括号匹配与自动补全括号/引号。

```powershell
cd editors/vscode-qiy
bunx @vscode/vsce package
```

在 VS Code 运行 **Extensions: Install from VSIX...**，选择生成的 `.vsix` 文件。

## JetBrains IDE

插件位于 `editors/jetbrains-qiy/`，面向 IntelliJ IDEA Community 与兼容的 IntelliJ Platform IDE。它提供 `.qiy` 文件类型、原生 Lexer 和 SyntaxHighlighter。

```powershell
cd editors/jetbrains-qiy
gradle buildPlugin
```

生成的 ZIP 可通过 **Settings → Plugins → ⚙ → Install Plugin from Disk** 安装。

## 社区分发

`.github/workflows/publish-editor-plugins.yml` 在 `v*` tag 或手动触发时构建两种插件，并上传 VSIX/ZIP artifact。

- 配置 `VSCE_PAT` 后发布到 Visual Studio Marketplace；
- 配置 `JETBRAINS_MARKETPLACE_TOKEN` 后发布到 JetBrains Marketplace；
- 未配置 token 时仍只构建并上传可手动安装的社区包，不会错误地尝试发布。

发布 tag 前，先把 `editors/vscode-qiy/package.json` 与 `editors/jetbrains-qiy/build.gradle.kts` 的版本同步为该 release 版本。

发布前把 VS Code manifest 中的 `publisher` 替换为已验证的 Marketplace publisher，并将 JetBrains plugin XML 中的仓库地址替换为真实 GitHub 组织地址。
