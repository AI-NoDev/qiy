# Qiy 测试与发布审计

审计对象：Qiy **0.37.0**（tag `v0.37.0`）  
审计日期：2026-11-06  
执行者：Qiy maintainer session  
范围：仓库测试、类型检查、lint、覆盖率、文档构建、Agent Skill 打包、生成项目验收（三方言实库）、生成应用 E2E 与像素回归、负载、依赖漏洞与发布流水线。

## 结论

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 仓库单元/集成测试 | **412 pass / 0 fail**，66 文件（随删除的功能移除了对应测试） | `bun test` |
| 覆盖率 | **89.61% 函数 / 92.99% 行**（门槛 78/85） | `bun run coverage:check` |
| TypeScript | 干净（含重新生成的 `examples/self/admin`） | `bun run check` |
| Lint | **0 warning / 0 error** | `bun run lint` |
| 文档构建 | 成功 | `bun run docs:build` |
| 文档 bundle | 3117.9 KiB（预算 3906 KiB） | `bun run bundle:check` |
| 文档 E2E | **3 pass**（含无障碍检查） | `bun run e2e` |
| Agent Skill 打包 | 87 个文件 / 5 个 skill | `bun run skill:build` |
| 生成应用 E2E | **3 pass**：CRUD + 数值计算字段、软删除→回收站→恢复、只读 view 布局快照 | `bun run e2e:generated` |
| 像素视觉回归 | 0.36.0 基线未变（快照页面不受本版影响，本轮未重跑） | `bun run e2e:visual` |
| 生成应用根测试 | 重新生成的 `examples/self/admin`：typecheck 通过，API **168 pass**、Web **119 pass** | `turbo run typecheck test` |
| 实时（SSE） | GraphQL subscription 5 项、频道 claim 4 项（各自生成包 82 项）；PostgreSQL 17 实库 Dataflow 27 项（含 outbox 清理保留期） | `tools/verify-graphql-subscription.ts`、`verify-realtime-claim.ts`、`verify-postgres-dataflow.ts` |
| 三方言运行时冒烟 | 0.36.0 结果（SQLite / PostgreSQL 16 / MySQL 8.4 各 21 项）；本版未改动这些路径，未重跑 | 本地 Docker 实库 |
| 依赖漏洞 | **0**（仓库与生成应用） | `bun audit` |

## 已验证能力

- 删除冗余：`qiy v1;` 与 `dashboard { metric }` 解析时报错并指向迁移指南；单 Provider 厂商关键字给出 `provider oidc { preset ...; }` 改写提示。
- OIDC preset：自由命名的 `providers`、`preset` 推断与显式指定、`label` 按钮文案；文档示例经解析器验证。
- 实时：REST `/api/v1/realtime/stream` 与 GraphQL `/graphql/subscribe` 走同一 outbox 轮询；新订阅者不重放连接前的事件；outbox 清理按保留期执行。
- 概览页：无 chart 时每个可写资源一张计数卡；生成应用 CRUD/回收站/view 三项 E2E 通过。
- Skill 离线示例由测试解析，避免与当前语法漂移。

## 已知边界（非发布阻塞）

1. **像素基线依赖 Docker**：`e2e:visual` 需要本机 Docker；Playwright 升级后需重新生成并审阅基线。像素快照覆盖新建表单的亮/暗主题，列表页由布局快照与 CRUD E2E 覆盖。
2. **容量结论**：仓库给出本地实测量级与多机合并工具，生产容量仍需在预发环境用真实数据库与网关复测。
3. **数据库直连**：view 的行规则在生成的 API 层执行；直接用 SQL 访问数据库视图不受这些规则约束。

## 复现命令

```bash
# 仓库
bun run check
bun run lint
bun test
bun run coverage:check
bun run docs:build
bun run bundle:check
bun run e2e
bun audit

# 生成应用
bun run e2e:generated
bun run e2e:visual          # 需要 Docker

# 生成项目
bun run tools/cli.ts generate <model.qiy> <dir> --sync
cd <dir> && bun install && bun run test
```

## 剩余 ROADMAP

| 优先级 | 项 |
| --- | --- |
| P3 | 本地 E2E 对陈旧服务的鲁棒性、英文用户文档 |

字段校验与默认值、乐观锁、kitchen-sink fixture 与示例漂移检查、自定义角色、多对多、状态机、Webhook/通知/定时 dataflow 已完成。详见 [ROADMAP](ROADMAP.md)「0.37 之后：补齐与优化」。`examples/*/admin` 快照由 CI 的 `examples:check` 保持与生成器一致。

## 审计判定

- 0.37.0 的质量门槛（测试、类型、lint、覆盖率、文档、生成应用 E2E、依赖审计）在本地通过，发布矩阵以 `Release Qiy CLI` dry run 为准；
- 没有阻断发布的缺陷；
- 上面列出的边界是环境前提，不应表述为“全部完美完成”；
- 生产使用前仍需对目标数据库、认证 provider、对象存储和网关限流做真实环境验收。
