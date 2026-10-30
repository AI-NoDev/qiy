# Qiy 测试与发布审计

审计对象：Qiy **0.6.3**（main 提交见发布记录）  
审计日期：2026-10-30  
执行者：Qiy maintainer session  
范围：仓库测试、类型检查、文档构建、Agent Skill 打包、生成项目验收、依赖漏洞与发布流水线。

## 结论

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 仓库单元/集成测试 | **400 pass / 0 fail**，57 文件 | `bun test` |
| 覆盖率 | **89.44% 函数 / 93.12% 行** | `bun test --coverage` |
| TypeScript | 干净 | `bun run check` |
| 文档构建 | 成功 | `bun run docs:build` |
| 文档 Agent 资产 | 5 个 skill、99 个文件、`llms-full` 约 502KB | `docs/public/` |
| Agent Skill 打包 | 88 个文件 / 5 个 skill | `bun run skill:build` |
| 生成标准项目 | 生成、安装、typecheck、build 通过 | 临时 `audit-app` |
| 生成项目测试（单独运行） | Web 70 pass；Server 37 pass / 3 skip | `apps/*/bun test` |
| 发布 v0.6.2 | dry-run 5 平台全绿；release + smoke 通过 | GitHub Actions |
| 依赖漏洞 | 9 个（1 high / 7 moderate / 1 low），均在 docs 开发依赖链 | `bun audit` |

## 发现与处理

### 已处理

1. **Vue XSS（high）**：`@vue/server-renderer < 3.5.42` 通过 docs 依赖链进入。已升级 `vue` 并添加 `overrides` / `resolutions`，审计中该 high 已消失。
2. **生成测试的临时目录**：`http.test.ts` / `storage.test.ts` 原使用 OS `tmpdir()`；在受限 Windows/子进程环境会 `EPERM`。改为生成项目内 `.qiy-test-*` 临时目录并清理。
3. **生成工作区并发任务**：根 `turbo run build/test/typecheck` 改为 `--concurrency=1`，避免 Web/API 同时构建时的资源竞争；生成标准项目 `build` 已通过。

### 已知边界（非发布阻塞）

1. **本地 Windows 沙箱下根 `turbo run test` 仍可能失败**：表现为子进程创建 OS 临时目录 `EPERM`、或 `@refinedev/core` 解析 `qs` 偶发失败。直接运行 `apps/server` / `apps/web` 测试均通过；CI 的 release 矩阵与 release-smoke 通过。该项已在 P2 跟踪。
2. **依赖审计剩余 9 个漏洞**：均来自 `vitepress → vite → launch-editor/esbuild`（文档开发服务器），不进入 Qiy CLI 运行时或生成应用。`vite` 升级受 VitePress 1.6.4 兼容约束；后续随 VitePress 升级处理。
3. **测试偶发抖动**：仓库 `bun test` 在并行执行时曾出现 1 个偶然失败（重跑通过，未复现具体断言）。建议 P2 引入 `--retry`/隔离或定位共享临时资源。

## 复现命令

```bash
# 仓库
bun test
bun test --coverage
bun run check
bun run docs:build
bun run skill:build

# 生成项目验收
bun run tools/cli.ts create project audit-app --template standard --dir tmp/audit-app
cd tmp/audit-app && bun run ../../tools/cli.ts generate
cd admin && bun install
bun run typecheck
bun run --cwd apps/web test
bun run --cwd apps/server test
bun run build

# 依赖
bun audit
```

## 剩余 ROADMAP

| 优先级 | 项 |
| --- | --- |
| P1 | 文档多语言（核心页翻译或隐藏未翻译入口） |
| P1 | 文档版本化（`/v0.6/` 归档） |
| P1 | 聚合 + chart 扩展（`sum/avg ... group by`、area/stacked/scatter、下钻） |
| P1 | 字段类型扩展（Boolean/Email/URL/JSON/数组）与迁移策略 |
| P1 | 文档按任务重构、每页 OG 图、llms 分段 |
| P2 | Playwright E2E / a11y / bundle budget |
| P2 | lint/format、coverage 阈值、SBOM/CodeQL |
| P2 | MCP server、生成器插件、软删除/租户 DSL/计算字段 |

## 审计判定

- 当前 **0.6.2** 的质量门槛（测试、类型、文档、生成项目、发布验收）通过；
- 没有阻断发布的缺陷；
- 剩余项属于已登记的产品/文档/P2 范围，不构成本次发布回归。
