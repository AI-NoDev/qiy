# Qiy CLI 与发布

所有生成能力都通过一个 `qiy` CLI 暴露：

```text
qiy create -f <source> -n <name> -o <output-dir> [--sync]
qiy init -f <source> [-n <name>] [--sync]
qiy generate <source> <output-dir> [--sync] # 兼容旧命令
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
./dist/qiy-0.1.0-windows-x64.exe --help
./dist/qiy-0.1.0-windows-x64.exe generate app.qiy out/admin

# Linux / macOS
./dist/qiy-0.1.0-linux-x64 generate app.qiy out/admin
./dist/qiy-0.1.0-darwin-arm64 generate app.qiy out/admin
```

二进制内联了生成应用所需的 Admin 模板，因此即使在仓库外也可从 `.qiy` 文件生成完整应用。`.qiy` 输入可使用相对 [`include` 模块](./modules) 组织业务模型。

## 现有 Bun 项目

`qiy init` 要求当前根目录 `package.json.packageManager` 为 `bun@...`。别名和 package name 直接写在 `.qiy` 的 `workspace` 块中；命令会以 `apps/<server-alias>`、`apps/<web-alias>` 挂载生成物，合并 `apps/*` workspace 与无冲突的 `qiy:<name>:*` 脚本，并创建按 deploy alias 命名的 Docker、Compose 与部署目录。详见[集成现有 Bun 项目](./existing-bun-project)。

`--sync` 只写入 Qiy manifest 已管理的文件。Qiy 不会自动适配现有项目的认证、Cookie、API URL 或响应格式；这些必须以宿主扩展实现并测试。

## 发布到 npm

```powershell
bun install
bun run template:build
bun run check
bun test
npm publish
```

`package.json` 的 `bin` 已暴露 `qiy` 命令。安装后可通过 `bunx qiy` 或全局安装调用。

发布 release 时同时上传 `dist/` 中各平台的文件，并记录版本、平台、架构与 SHA-256。
