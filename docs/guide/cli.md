# Qiy CLI 与发布

所有生成能力都通过一个 `qiy` CLI 暴露：

```text
qiy create -f <source> -n <name> -o <output-dir> [--sync]
qiy init -f <source> [-n <name>] [--sync]
qiy generate <source> <output-dir> [--sync] # 兼容旧命令
qiy doctor [--json]
qiy explain <source.qiy> [--json]
qiy schema
qiy skill install [--force] [--global] [--dir <path>]
```

公开生成入口只接受 `.qiy`。MPS 模型和内部 Database IR 不属于已发布 CLI 的应用输入；仓库维护者可以单独运行内部 MPS/TextGen 验证工具，但最终仍应导出 `.qiy` 后进入同一条生成链路。

## 在仓库中运行

```powershell
bun run qiy -- --help
bun run qiy -- create -f examples/catalog/app.qiy -n catalog-admin -o out/catalog-admin
bun run qiy -- init -f models/admin.qiy
```

## 编译成多平台独立可执行文件

Qiy 使用 Bun 的 standalone executable 打包模式，不需要在目标机器安装 Bun：

```powershell
# 当前平台
bun run build:exe

# Windows x64、Linux x64/arm64、macOS x64/arm64
bun run build:exe -- --all
```

输出在 `dist/`：

```powershell
# Windows
./dist/qiy-<version>-windows-x64.exe --help
./dist/qiy-<version>-windows-x64.exe create -f app.qiy -n admin -o out/admin

# Linux / macOS
./dist/qiy-<version>-linux-x64 create -f app.qiy -n admin -o out/admin
./dist/qiy-<version>-darwin-arm64 create -f app.qiy -n admin -o out/admin
```

二进制内联了生成应用所需的 Admin 模板，因此即使在仓库外也可从 `.qiy` 文件生成完整应用。`.qiy` 输入可使用相对 [`include` 模块](./modules) 组织业务模型。

## 现有 Bun 项目

`qiy init` 要求当前根目录 `package.json.packageManager` 为 `bun@...`。别名和 package name 直接写在 `.qiy` 的 `workspace` 块中；命令会以 `apps/<server-alias>`、`apps/<web-alias>` 挂载生成物，合并 `apps/*` workspace 与无冲突的 `qiy:<name>:*` 脚本，并创建按 deploy alias 命名的 Docker、Compose 与部署目录。详见[集成现有 Bun 项目](./existing-bun-project)。

`--sync` 只写入 Qiy manifest 已管理的文件。Qiy 不会自动适配现有项目的认证、Cookie、API URL 或响应格式；这些必须以宿主扩展实现并测试。

## AI 继续开发与官方 Skill

`create` / `generate` 自动生成根目录 `AGENTS.md`、兼容入口 `AGENT.MD` 和 `openwiki/{quickstart,architecture,development}.md`。文档依据实际生成文件和 package scripts 描述现有能力、代码入口与同步边界，不承诺生产验收。

`init` 将入口放入 `apps/<web-alias>/`，文档放入 `openwiki/qiy-<admin-name>/`；链接使用实际 alias，不替换宿主根目录的 AI 指令和 OpenWiki。再次同步保留已有 agent 指令；自动生成的 wiki 页面会更新，额外的手写文档保留。

在需要使用 AI 开发的项目目录运行：

```sh
qiy skill install                  # 当前项目 .agents/skills/qiy
qiy skill install --global        # 用户级 ~/.agents/skills/qiy
qiy skill install --dir .claude/skills/qiy
qiy skill install --force         # 升级后覆盖被本地修改的官方文件
qiy skill list [--json]           # 查看已安装位置、是否最新、被修改/缺失的文件
qiy skill update [--force]        # 只更新已存在的安装
qiy skill uninstall               # 只删除官方文件，保留手写文件
```

命令离线安装可执行文件内置的官方 Agent Skill（标准 `SKILL.md` + `references/` + `examples/`），不会安装其他 skill，也不需要额外用户配置文件。重复安装相同版本可直接执行；本地修改过官方文件时默认拒绝覆盖，确认需要替换后加 `--force`，无关文件仍保留。旧目录 `.agent/skills/qiy` 会被原地更新。不同 AI 工具使用不同的 skill 搜索路径时，用 `--dir` 指向该工具的 skills 目录，详见 [Qiy Agent Skill](./agent-skill)（文档站也提供 `/skills/qiy/SKILL.md` 与 `/skills/qiy-skill.tar.gz` 静态下载）。该命令安装的是当前 CLI 随附版本，不会联网获取最新版本。

## 解释模型与机器可读 schema

```powershell
qiy explain examples/catalog/app.qiy
qiy explain examples/catalog/app.qiy --json
qiy schema
```

`explain` 解析 `.qiy` 后输出规范化摘要：application 模式/数据库、实体与字段（含 `@code`/`@generated` 信息）、关系、枚举、权限、dataflow、action、chart 与计数。`--json` 输出机器可读结构，解析失败时输出 `{ "valid": false, "error": "..." }` 并以退出码 1 结束。`schema` 输出该 JSON 的 JSON Schema（draft 2020-12），也发布在 `/schema/qiy-explanation-1.json`；schema 里的 `formatVersion` 发生破坏性变化时会递增。

## 环境检查

在生成或 CI 前运行：

```powershell
qiy doctor
qiy doctor --json
```

它检查 Bun runtime、内联 Admin 模板和当前目录的 Bun package manager 声明。若不在 Bun workspace 中，命令会给出 warning；`qiy init` 仍会在写入前严格拒绝。

## 发布检查

```powershell
bun install
bun run template:build
bun run check
bun test
bun run docs:build
bun run build:exe -- --all
```

`package.json` 的 `bin` 已暴露 `qiy` 命令；npm 发布仍需维护者单独执行并验证 registry 权限，本仓库当前自动化发布目标是 GitHub Release。

独立项目黑盒验收还会启动已构建的本机预览服务，验证首页、静态资源、SPA 深链接、资源 API、OpenAPI 和未知 API 的 404，并确认未配置认证时生产入口拒绝启动。预览身份与数据为测试用途，不代表真实登录或数据库生产验收。

维护者先更新 `package.json.version` 与 `CHANGELOG.md`，用 `gh workflow run "Release Qiy CLI" -f dry_run=true` 跑完整验收矩阵（检查、测试、文档构建、五平台产物与 native 验收，不创建 Release/tag）；通过后推送 `vX.Y.Z` annotated tag，tag 触发 `.github/workflows/release.yml` 构建五个平台产物并创建 GitHub Release（Release body 来自 `CHANGELOG.md` 对应版本段落）。每个产物在对应原生平台验证版本、实际生成独立项目与 integration 项目、干净安装、typecheck/test/build、同步保护和离线 Skill。tag 一旦推送不再移动；发现问题发布下一个 patch。Release 发布后，`.github/workflows/release-smoke.yml` 还会下载已发布资产进行远端黑盒检查。完整流程见仓库根目录 `RELEASING.md`。
