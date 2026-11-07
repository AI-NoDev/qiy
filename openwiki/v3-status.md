# 能力现状与待办

这一页只记录 Qiy 1.0.0 的**现在**：已经交付的能力、明确的边界和下一步。发布说明见 [CHANGELOG](../CHANGELOG.md)，发布前审计见 [AUDIT](../AUDIT.md)，维护者的真实环境验收步骤见 [MAINTAINER_VERIFICATION](../MAINTAINER_VERIFICATION.md)。

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
| 权限 | 自定义角色（`full`/`write`/`read` 访问级别）、原子权限/权限组、provider、校验块；`scope`、tree scope、`restrict` 记录条件（AND/OR/NOT）与字段脱敏；`pages` 页面与路由守卫 | [permissions](../docs/dsl/permissions.md) |
| 业务流程 | Dataflow（typed input、context、require/allow、事务写入、audit/emit、result）与 `app.test.qiy` 声明式场景；Action 按钮；`statemachine` 状态机（每个 transition 编译为带守卫、幂等的 dataflow + action） | [dataflow](../docs/dsl/dataflow.md)、[actions](../docs/dsl/actions.md)、[statemachine](../docs/dsl/statemachine.md) |
| 存储 | local / S3-compatible；单文件与多文件、分片续传、MIME/大小策略、孤儿对象扫描 | [storage](../docs/dsl/storage.md) |
| 事件投递与定时任务 | `webhook` / `notification` 订阅 `emit` 事件：事务内写 `qiy_deliveries`，提交后由每个副本的 worker 抢占发送（HMAC 签名、退避重试、缺配置时等待）；通知 provider 为 SMTP/Resend/webhook/console；cron 可定时运行 dataflow，`qiy_job_leases` 保证每个 tick 只执行一次 | [通知与 Webhook](../docs/dsl/notifications.md) |
| 实时 | 数据库 outbox + SSE（REST `GET /api/v1/realtime/stream`、GraphQL `GET /graphql/subscribe`），频道权限与记录级订阅，无外部服务依赖 | [realtime](../docs/dsl/realtime.md) |
| 生成与集成 | `standalone` / `integration`（宿主 API 适配器）两种模式；`--sync` manifest 保护手写代码；生成器插件；`qiy diff`/增量生成；`qiy dev --watch` | [CLI](../docs/guide/cli.md) |
| AI 入口 | 官方 Agent Skill（`qiy skill install`）、`qiy mcp`、`qiy agent` HTTP API、`llms.txt` / `llms-dsl.txt` / `llms-guides.txt` | [Agent Skill](../docs/guide/agent-skill.md) |
| 质量 | 根仓 typecheck/oxlint/bun test、覆盖率门槛、生成应用 Playwright CRUD E2E、布局快照与 Docker 像素回归、a11y、负载测试、SBOM/CodeQL | [AUDIT](../AUDIT.md) |

## 已知边界

- GraphQL 的 `QiyFilterInput` 是平铺的顶层 AND；嵌套条件树只在 REST 上可用。
- SQLite 的 Money 映射为 `REAL`，没有十进制精确语义。
- 状态机只负责状态字段的流转；库存预留等副作用需要自己写 dataflow。
- 通知只发纯文本邮件，模板取默认语言文案；投递是至少一次，接收方需按 `X-Qiy-Delivery` 去重。
- 定时 dataflow 以第一个 `full` 角色运行，不能使用数据范围资源；cron 租约依赖各实例时钟同步。
- 真实 IdP tenant、生产 S3 bucket、邮件/短信供应商由使用方按 [MAINTAINER_VERIFICATION](../MAINTAINER_VERIFICATION.md) 的步骤自行验收；本地 preview 不能公开部署。

## 下一步

当前没有排队中的功能项。新需求先写入 [ROADMAP](../ROADMAP.md)，完成后同步本页的能力表与边界。
