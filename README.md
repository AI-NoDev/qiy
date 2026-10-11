<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/qiy-logo-dark.svg">
    <img src="docs/public/qiy-logo-light.svg" width="88" height="88" alt="Qiy logo">
  </picture>
</p>

<h1 align="center">Qiy</h1>

<p align="center">
  <strong>以数据模型生成可二次开发的管理后台</strong><br>
  一份 `.qiy` 模型，生成 Refine 前端、Bun + Elysia API 和 Drizzle 数据层。
</p>

<p align="center">
  <a href="https://ai-nodev.github.io/qiy/"><strong>文档</strong></a> ·
  <a href="https://ai-nodev.github.io/qiy/guide/getting-started"><strong>快速开始</strong></a> ·
  <a href="https://github.com/AI-NoDev/qiy/releases/latest"><strong>下载 CLI</strong></a> ·
  <a href="https://ai-nodev.github.io/qiy/guide/best-practice-warehouse"><strong>完整示例</strong></a>
</p>

<p align="center">
  <a href="https://github.com/AI-NoDev/qiy/actions/workflows/deploy-docs.yml"><img src="https://github.com/AI-NoDev/qiy/actions/workflows/deploy-docs.yml/badge.svg" alt="Documentation deployment status"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun&logoColor=white" alt="Bun">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb" alt="MIT license"></a>
</p>

Qiy 面向数据驱动的后台应用：定义实体、字段、关系和界面配置，生成可继续开发的 TypeScript 项目。CLI 提供 Windows、Linux 和 macOS 可执行文件；生成项目使用 Bun。

## 快速开始

需要 Bun 1.3+ 来安装依赖并运行生成项目。前端生产构建还需要 Node.js 20+，仅用于 React Router 的构建工具链；生成后的 API 运行时仍是 Bun + Elysia。Dockerfile 已内置独立 Node 构建阶段。也可以从 [GitHub Releases](https://github.com/AI-NoDev/qiy/releases/latest) 下载独立 CLI，无需在运行 CLI 的机器上安装 Bun。

```bash
git clone https://github.com/AI-NoDev/qiy.git
cd qiy
bun install
bun run qiy -- create -f examples/catalog/app.qiy -n catalog-admin -o out/catalog-admin

cd out/catalog-admin
bun install
bun run build
bun run preview
```

打开终端显示的本地地址即可查看生成的 Admin。`preview` 用于本机体验，不是生产服务器。

## 集成已有 Bun 项目

在 `.qiy` 模型的 `workspace` 块中配置可选 alias，然后在已有 Bun 项目根目录执行：

```bash
qiy init -f ./models/admin.qiy
bun install
bun run qiy:admin:typecheck
```

`qiy init` 不会创建第二个 Turborepo，也不会覆盖宿主根目录已有的 `.env*` 文件。完整配置和同步边界见[集成指南](https://ai-nodev.github.io/qiy/guide/existing-bun-project)。

## 文档

- [CLI 安装与命令](https://ai-nodev.github.io/qiy/guide/cli)
- [数据建模与 DSL 参考](https://ai-nodev.github.io/qiy/guide/data-modeling) · [DSL 全览](https://ai-nodev.github.io/qiy/dsl/overview)
- [模块化 include](https://ai-nodev.github.io/qiy/guide/modules)
- [仓储管理最佳实践](https://ai-nodev.github.io/qiy/guide/best-practice-warehouse)
- [认证](https://ai-nodev.github.io/qiy/guide/auth) · [UI 与主题](https://ai-nodev.github.io/qiy/guide/ui-theming) · [工作流](https://ai-nodev.github.io/qiy/guide/workflow) · [存储](https://ai-nodev.github.io/qiy/guide/storage)
- [部署](https://ai-nodev.github.io/qiy/guide/deployment) · [编辑器插件](https://ai-nodev.github.io/qiy/guide/editor-support)
- [Qiy Agent Skill](https://ai-nodev.github.io/qiy/guide/agent-skill)

仓库维护者和贡献者可从 [OpenWiki 快速入口](openwiki/quickstart.md) 查看架构、实现状态和开发验证说明。

## License

[MIT](LICENSE)
