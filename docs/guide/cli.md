# Qiy CLI 与发布

所有生成能力都通过一个 `qiy` CLI 暴露：

```text
qiy generate <source> <output-dir> [--sync]
```

## 在仓库中运行

```powershell
bun run qiy -- --help
bun run qiy -- generate examples/catalog/app.qiy out/catalog-admin
bun run qiy -- generate examples/erpadmin/app.qiy out/erpadmin --sync
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
