# Qiy CLI 与发布

所有生成能力都通过一个 `qiy` CLI 暴露：

```text
qiy create -f <source> -n <name> -o <output-dir> [--sync]
qiy init -f <source> [-n <name>] [--sync]
qiy generate <source> <output-dir> [--sync] # 兼容旧命令
qiy doctor [--json]
qiy skill install [--force]
```

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
qiy skill install
```

命令离线安装可执行文件内置的官方 skill 到当前目录 `.agent/skills/qiy/`，包括 `SKILL.md`、参考文档和完整多文件示例。不会安装其他 skill，也不需要额外用户配置文件。重复安装相同版本可直接执行；本地修改过官方文件时默认拒绝覆盖，确认需要替换后运行 `qiy skill install --force`，无关文件仍保留。不同 AI 工具可能使用不同的 skill 搜索路径，需要让工具发现 `.agent/skills`。该命令安装的是当前 CLI 随附版本，不会联网获取最新版本。

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

维护者更新 `package.json.version` 后推送 `main`，`.github/workflows/release.yml` 会检查同版本 Release 是否已存在：已存在则跳过；不存在则构建 Windows x64、Linux x64/arm64、macOS x64/arm64 五个平台产物，创建对应 tag 与 GitHub Release。Release 发布后，`.github/workflows/release-smoke.yml` 会下载 Linux x64 资产，校验二进制版本、生成 manifest、独立项目 typecheck/test/build，以及 `qiy init` 集成与同步。不要手工重复创建同一版本 tag。
