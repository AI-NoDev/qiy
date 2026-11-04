# Qiy 测试与发布审计

审计对象：Qiy **0.33.0**（tag `v0.33.0`，commit `95d5444`）  
审计日期：2026-11-02  
执行者：Qiy maintainer session  
范围：仓库测试、类型检查、lint、覆盖率、文档构建、Agent Skill 打包、生成项目验收、DB view 方言验证、依赖漏洞与发布流水线。

## 结论

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 仓库单元/集成测试 | **434 pass / 0 fail**，69 文件 | `bun test` |
| 覆盖率 | **90.10% 函数 / 93.41% 行** | `bun test --coverage` |
| TypeScript | 干净 | `bun run check` |
| Lint | **0 warning / 0 error** | `bun run lint` |
| 文档构建 | 成功 | `bun run docs:build` |
| 文档 bundle | 3249.5 KiB（预算 3906 KiB） | `bun run bundle:check` |
| 文档 Agent 资产 | 5 个 skill、99 个文件 | `docs/public/` |
| Agent Skill 打包 | 88 个文件 / 5 个 skill | `bun run skill:build` |
| 生成应用 E2E | **2 pass**，含只读 view 迁移与布局快照 | `bun run e2e:generated` |
| 发布 v0.33.0 | dry-run 5 平台全绿；release + smoke 通过 | GitHub Actions |
| 依赖漏洞 | **0** | `bun audit` |

## 已验证能力

- MCP server、HTTP Agent API、生成器插件。
- 软删除、租户 DSL、计算字段、DB view。
- DB view REST/GraphQL/Web list/detail。
- SQLite view 迁移：`drizzle-kit generate` 生成 `CREATE VIEW`，`db:migrate` 后 E2E 可查询。
- PostgreSQL / MySQL view：生成项目 `tsc --noEmit` 通过；容器实库执行迁移后 view 可查询，schema drift 忽略 view。
- CSV 数组/JSON/Boolean 导入、负载冒烟、oxlint、跨平台布局快照。

## 已知边界（非发布阻塞）

1. **视觉回归是布局快照**：验证标题、侧边栏、搜索、列顺序与操作可见性，不比较像素/颜色/间距。
2. **DB view 权限**：REST/GraphQL 只做认证，不套用实体 policy 行级过滤；敏感视图需数据库账号或网关限制。
3. **计算字段**：仅支持 Text 模板，不支持算术或多类型结果。
4. **软删除**：delete 复用 update 写时间戳，审计动作当前记为 `updated`，无 restore API/UI。
5. **租户 DSL**：依赖 auth claim；本地登录要求 users 实体存在同名字段。
6. **负载测试**：CI `generated-e2e` 已执行 100 请求 / 10 并发 / p95 1000ms 门禁；仍是单机冒烟，不代表生产容量。
7. **本地 Windows 沙箱**：根 `turbo run test` 仍可能因 OS 临时目录 `EPERM` 失败；直接运行 `apps/server` / `apps/web` 测试通过。

## 复现命令

```bash
# 仓库
bun test
bun test --coverage
bun run check
bun run lint
bun run docs:build
bun run skill:build
bun run bundle:check

# 生成应用 E2E
bun run e2e:generated

# 生成项目 / DB view
bun run tools/cli.ts generate <model.qiy> <dir> --sync
cd <dir>/apps/server && bun run db:generate && bun run db:migrate

# 依赖
bun audit
```

## 剩余 ROADMAP

| 优先级 | 项 |
| --- | --- |
| P1 | 文档按任务重构：任务索引已覆盖当前能力；逐页“目标 → 命令 → 语法”和内部工具页下线仍需继续 |

已完成项记录在 [ROADMAP](ROADMAP.md)；文档按任务重构仍为进行中。

## 审计判定

- 0.33.0 的质量门槛（测试、类型、lint、文档、生成应用、发布验收）通过；
- 没有阻断发布的缺陷；
- 未完成项与已知边界已登记，不应表述为“全部完美完成”；
- 生产使用前仍需对目标数据库、认证 provider、对象存储和网关限流做真实环境验收。
