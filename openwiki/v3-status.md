# 能力现状与待办

这一页只记录**现在**：已经交付的能力、明确的边界和下一步顺序。每个版本做了什么见 [CHANGELOG](../CHANGELOG.md)，发布前审计见 [AUDIT](../AUDIT.md)，维护者的真实环境验收步骤见 [MAINTAINER_VERIFICATION](../MAINTAINER_VERIFICATION.md)。0.36.0 及以前按日期记录的实施流水账已从这里移除，需要时用 `git show b1fe7fc:openwiki/v3-status.md` 查看。

## 已交付能力

| 领域 | 现状 | 参考 |
| --- | --- | --- |
| 建模 | 单一 `.qiy` v0 文本语法，`include` 模块片段、`qiy fmt`、`qiy explain [--json]`、`qiy schema`、错误码目录；`qiy add entity/field/module/feature` 增量建模 | [DSL 总览](../docs/dsl/overview.md) |
| 字段 | Text/Integer/Decimal/Money/Boolean/Email/URL/JSON/UUID/Date/Time/DateTime/File/Files/Vector 与数组；`@code`/`@generated` 服务端生成值；`@computed`；`@softDelete`；`@tenant` | [entity](../docs/dsl/entity.md)、[生成值](../docs/dsl/generated-values.md) |
| 关系与视图 | 单向 UUID 外键 + `@onDelete`；详情页反向明细表；只读 DB `view`（REST/GraphQL/Web/迁移，继承源实体行规则） | [relation](../docs/dsl/relation-index.md)、[views](../docs/dsl/views.md) |
| 数据库 | PostgreSQL / SQLite / MySQL 三方言 Drizzle schema、迁移、并发保护、`db:check` 漂移检测、逻辑备份与受保护恢复 | [部署](../docs/guide/deployment.md) |
| API | Elysia REST（嵌套 and/or 过滤树、分页上限、CSV 导入导出与后台任务）+ GraphQL（Yoga/Apollo）+ OpenAPI；同一 service 层与审计事务 | [API](../docs/guide/api.md) |
| Web | Refine + Ant Design + React Router SPA：CRUD、关系 Select/Drawer、显示模板、已存视图、字段布局权限、多级菜单、chart 概览页、主题、i18n | [Refine Providers](../docs/guide/refine-providers.md)、[chart](../docs/dsl/charts.md) |
| 认证 | 本地密码（限流/锁定/会话吊销）、OTP、任意多个 OpenID Connect provider（`provider <name> { preset ...; }`，预设 generic/okta/auth0/azure-ad-b2c/keycloak/google/kinde）；混合认证、首次登录 onboarding、账号绑定；API Key（轮换、scopes） | [auth](../docs/dsl/auth.md) |
| 权限 | 角色、原子权限/权限组、provider、校验块；`scope`、tree scope、`restrict` 记录条件（AND/OR/NOT）与字段脱敏；`pages` 页面与路由守卫 | [permissions](../docs/dsl/permissions.md) |
| 业务流程 | Dataflow（typed input、context、require/allow、事务写入、audit/emit、result）与 `app.test.qiy` 声明式场景；Action 按钮；`workflow orderInventory` 订单库存切片 | [dataflow](../docs/dsl/dataflow.md)、[actions](../docs/dsl/actions.md) |
| 存储 | local / S3-compatible；单文件与多文件、分片续传、MIME/大小策略、孤儿对象扫描 | [storage](../docs/dsl/storage.md) |
| 实时 | 数据库 outbox + SSE（REST `GET /api/v1/realtime/stream`、GraphQL `GET /graphql/subscribe`），频道权限与记录级订阅，无外部服务依赖 | [realtime](../docs/dsl/realtime.md) |
| 生成与集成 | `standalone` / `integration`（宿主 API 适配器）两种模式；`--sync` manifest 保护手写代码；生成器插件；`qiy diff`/增量生成；`qiy dev --watch` | [CLI](../docs/guide/cli.md) |
| AI 入口 | 官方 Agent Skill（`qiy skill install`）、`qiy mcp`、`qiy agent` HTTP API、`llms.txt` / `llms-dsl.txt` / `llms-guides.txt` | [Agent Skill](../docs/guide/agent-skill.md) |
| 质量 | 根仓 typecheck/oxlint/bun test、覆盖率门槛、生成应用 Playwright CRUD E2E、布局快照与 Docker 像素回归、a11y、负载测试、SBOM/CodeQL | [AUDIT](../AUDIT.md) |

## 已知边界

- GraphQL 的 `QiyFilterInput` 是平铺的顶层 AND；嵌套条件树只在 REST 上可用。
- `workflow orderInventory` 只在 PostgreSQL 目标下生成；SQLite 的 Money 映射为 `REAL`，没有十进制精确语义。
- Cron 任务没有分布式锁，只能在单个专用副本上启用。
- 真实 IdP tenant、生产 S3 bucket、邮件/短信供应商由使用方按 [MAINTAINER_VERIFICATION](../MAINTAINER_VERIFICATION.md) 的步骤自行验收；本地 preview 不能公开部署。

## 0.37.0：删除冗余（进行中）

按"直接删除旧模式"的决定，0.37.0 移除以下功能，迁移步骤见 [0.37 迁移指南](../docs/guide/migration-0.37.md)：

- v1 友好语法预处理器、JetBrains MPS 工作台与 exporter（以及 `fast-xml-parser` 依赖）；
- 各 OIDC 厂商的独立 provider 关键字，统一为 OIDC provider + `preset`（单个时叫 `oidc`，多个时 `providers local, corp, google;` 自由命名）；
- Ably 实时传输与 outbox 租约/死信/重放/管理端点，统一为 SSE；
- `dashboard { metric ... }` 概览指标块，统一为 `chart`；
- 与 `llms-dsl.txt` + `llms-guides.txt` 完全重复的 `llms-full.txt`。

## 下一步顺序

1. **字段校验与默认值**：`@min`、`@max`、`@length`、`@pattern`、`@default`，服务端校验与前端表单规则同源生成。
2. **乐观锁**：`@version`，更新冲突返回 409，表单提示刷新。
3. **全量 fixture 与示例漂移检查**：一个覆盖全部语法的 kitchen-sink 模型在三方言上生成并测试；CI 检查 `examples/*/admin` 与生成器输出一致。
4. **多对多关系**与多选 UI。
5. **声明式状态机 / 审批流转**。
6. **Webhook 与通知**：通知适配器（SMTP 默认、Resend、webhook，开发环境 console）与定时任务。
7. **工程优化**：按领域拆分 `tools/generate-server.ts`；计算字段落为数据库生成列；view 的 IN 子查询性能与索引；本地 E2E 对陈旧服务的鲁棒性。
8. **英文用户文档**。
