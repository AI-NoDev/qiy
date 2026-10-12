# V3 实施状态与验收规划

## 真实浏览器 Action 验收（2026-10-12）

后续修复：详情页业务 Action 成功后现在同时使包含 `audit` 的 Refine Query 失效，避免审计历史停留在 Action 执行前的缓存；列表批量 Action 也使用同一策略。`tests/action-qiy.test.ts` 与 `tests/refine-providers.test.ts` 已覆盖生成代码包含该刷新契约，专项 15 项/101 断言和 `bun run check` 通过。详情 Action 的独立浏览器执行已验证成功，审计记录刷新一致性修复后仍需在下一次完整浏览器回归中重新观察。

新增 `examples/dataflow/browser-actions.qiy` 与 `tools/prepare-action-browser.ts`：生成临时 SQLite 应用、安装、类型检查、SPA 构建、迁移并填入 admin/viewer 和三条审核记录。准备工具曾因 password helper 导入路径错误在 seed 阶段失败；已修复为 `auth/password`，现有工作区单独完成 seed，无需重跑已通过构建。测试账号只用于隔离本机夹具，不是生产默认账号。

证据工作区为 `%TEMP%/qiy-browser-actions-7DyWmq/admin`，生产 Server 使用生成的 `.env.development`，端口 3026。最初由 Windows 0.1.3 候选 EXE 创建，发现问题后用源码 CLI sync，再通过生成包 typecheck/build。构建脚本仍调用 Node React Router CLI，此验收不能证明纯 Bun 构建。

浏览器真实交互已验证：本地账号登录；列表单记录必填校验与取消；成功归档刷新行并隐藏条件按钮；含锁定记录的批量失败保留输入和选择；数据库确认普通记录及锁定记录均未改变；合法两记录批量成功刷新并清空选择；详情页显示并执行 Action；列表/详情进入手写历史页；中文字段说明、中文/英文规则失败通知和手写页面描述；历史页刷新后 SPA 深链接正常；viewer 不显示业务按钮，直接历史页显示 403。`tools/verify-action-browser-api.ts` 独立请求生产接口，验证本地登录、匿名 401、viewer 单条/批量 403、锁定规则 409/errorKey 以及锁定记录未变化。详情/批量 Action 成功后审计查询缓存刷新已加入生成器，下一次完整浏览器回归需继续观察刷新后的最新审计行。

此次发现并修复两个生成缺陷：Ant Design App 上下文未挂载，Refine 通知未显示；Modal 的 `validateFields().then(run)` 导致必填失败产生未处理 Promise。模板现用 App 包裹，Refine provider hook 在内部组件调用；Action 改用 Form.submit/onFinish，重建后的必填失败没有新增浏览器错误，成功/失败通知均可见。模板内嵌数据已刷新。根仓 196 项测试/1855 断言/0 失败，专项 15 项/99 断言、类型检查和文档构建通过。

复现：在仓库运行 `bun tools/prepare-action-browser.ts [候选可执行文件]`，按输出进入临时 `apps/server`；PowerShell 设置 `$env:PORT='3026'` 后运行 `bun --env-file=.env.development src/server.ts`。浏览器使用 `admin@qiy.test` 或 `viewer@qiy.test`、测试密码 `qiy-browser-test-only`，API 检查运行 `bun tools/verify-action-browser-api.ts`。每次准备创建新临时数据库，不使用业务数据库。已生成夹具可继续使用，重复 seed 不支持。

用户文档 `docs/dsl/actions.md` 同步表单、提示与业务页边界。当前 EXE 尚未包含本节模板/生成器修复；本节不是新版 Release 黑盒证明。V3 保持未完成：GraphQL Subscription、scope/租户 capability、真实外部服务、其他原生平台及发布资产仍需验收。

## 删除与 Outbox 声明式断言（2026-10-12）

`.test.qiy` 新增 `expect exists review == false;` 与 `expect outbox "review.deleted" count == 1;`。存在性根据 given fixture 主键查询；事件数量按事件名统计持久化 `dataflow_outbox`，不证明外部投递。未知 fixture/事件、重复断言、非负整数以外的 count 和已删除 fixture 的字段断言在生成前拒绝。SQLite 使用参数化查询，PostgreSQL/MySQL 使用同一 Drizzle schema；测试数据库保护保持生效。

`examples/dataflow/side-effects.qiy` / `side-effects.test.qiy` 覆盖删除并写事件、viewer 拒绝无副作用、更新/写事件/删除之后规则失败时整体回滚。SQLite 干净生成、安装、Server typecheck 与三场景/12 断言通过，目录 `qiy-side-effects-e4016db3557d43eb88d52571534ed3ae`。PostgreSQL 16 与 MySQL 8.4 在隔离测试库分别通过新增三场景/14 断言，连同原有 call/create-delete/identity 共 11 场景/38 断言；迁移、Server typecheck 与缺少测试连接的负例通过，测试库最终删除。证据目录分别为 `qiy-postgresql-scenarios-oXuzvq`、`qiy-mysql-scenarios-LqXSee`。

根仓 195 项测试/1849 断言/0 失败，`bun run check`、官网构建及 diff 检查通过。用户文档、官方 Skill/内嵌 Skill、TextMate/VS Code 和 JetBrains keyword 表已同步；JetBrains 插件未重新打包。已重建 Windows 候选 `dist/qiy-0.1.3-windows-x64.exe`，直接用该文件分别生成 side-effects 和 identity，在干净安装后通过 Server typecheck 与八场景/22 断言；证据目录 `qiy-side-effects-exe-d888f886feda4e26a13ad1828e236967`。该候选没有提交或发布到 GitHub，其他原生平台尚未验收，不能声称 Release 已包含本增量。

下文历史身份、删除/Outbox 断言待办由本节及身份节取代。V3 仍未完成：浏览器 Action 场景、GraphQL Subscription、订阅 scope/租户 capability、真实外部服务和多平台发布验收仍需推进。

## 声明式身份与租户场景（2026-10-12）

`app.test.qiy` 现在支持 `given` 后的 `identity anonymous;`，或 `identity { id = "operator-a"; role = "operator"; claims { "tenant.id" = review.tenantId; } }`。身份 id/claim 可引用 fixture；角色限定 admin/operator/viewer，scope claim 值按模型字段类型检查。未知角色、空 id、重复设置、危险 claim key 和无效引用在生成前拒绝。省略 identity 保留原有首个允许角色/default admin 的兼容行为。SQLite/PostgreSQL/MySQL 生成测试均创建独立场景认证器，复用生产 Dataflow 路由；身份注入不是 JWT/Cookie/真实 IdP 验证。

新增 `examples/dataflow/identity.qiy` 与 `identity.test.qiy` 五个场景：匹配租户成功、匿名 401、viewer 403、缺少租户 403、跨租户记录 404，均检查写入结果或拒绝后数据未变。SQLite 干净生成/安装、Server typecheck 与五场景/10 断言通过，目录 `qiy-identity-f7d32732d7d94e3d8a3a983b208b2ea1`。PostgreSQL 16 与 MySQL 8.4 verifier 增加同一模型，在迁移后的隔离数据库各通过五身份场景/15 断言及此前三场景/9 断言；证据目录 `qiy-postgresql-scenarios-sdcupE` 与 `qiy-mysql-scenarios-zMEv2Q`，测试库最终删除。

根仓最终 `bun run check`、194 项测试/1826 断言/0 失败及官网构建通过。用户 Dataflow 文档和官方 Skill 补齐 identity 用法与真实认证边界，Skill 内嵌文件已刷新；TextMate/VS Code 和 JetBrains keyword 表增加场景与身份关键词，语法资产测试通过（未重新打包 JetBrains 插件）。下文历史“身份/scope fixture 尚未实现”由本节取代；outbox/删除断言、浏览器 Action 场景仍未实现。这次新增尚未重建 EXE，不能据上一轮候选黑盒宣称已发布；V3 继续未完成。

## 最新候选增量验收（2026-10-12）

当前重新打包的 `dist/qiy-0.1.3-windows-x64.exe` 已直接通过 PostgreSQL 16 和 MySQL 8.4 声明式测试验收：每种数据库均完成 call、create-delete 两个项目的生成、干净安装、Server typecheck、缺少测试连接的负例、迁移与 3 项场景/9 断言；外键夹具和清理顺序也包含在实库验证中。证据目录为 `qiy-postgresql-scenarios-jooadB` 与 `qiy-mysql-scenarios-3byc4A`。下节“尚未重建发布 EXE”只描述此前源码验收，不再描述当前候选。

同一 EXE 生成的 `qiy-release-standalone-bIHyRr/realtime-admin` 已通过 Docker promtool 三条告警规则的语法和行为测试，并核对 ServiceMonitor selector、命名端口、Server/scraper Secret 一致性及 Grafana datasource 绑定；证据目录 `qiy-prometheus-R13JKq`。这不代表 Kubernetes 部署或 Grafana 导入已验收。当前根仓 `bun run check` 与 192 项测试/1786 断言通过；公开 CLI 的两项测试确认应用输入仅为 `.qiy` 且不暴露 MPS 维护命令。

本轮完整 standalone/integration 黑盒均退出 0。Standalone 证据 `qiy-release-standalone-bIHyRr` 覆盖匿名 Realtime 拒绝、原子 batch/已认证 Realtime Server 安装与测试、主项目 typecheck/test/build，以及实际启动后的 health、SPA 深链接、静态资源、资源 API、OpenAPI、API 路由隔离及生产认证 fail-closed。Integration 证据 `qiy-release-integration-NLDrf1` 覆盖离线 Skill、Cookie/CSRF 与 Bearer 接入、init/sync、手写 adapter 与宿主文件保留及 Web typecheck/test/build。GitHub 资产与其他原生平台尚未更新，V3 保持未完成；待办仍包括 GraphQL Subscription、细粒度订阅 scope/租户 capability、身份与 scope 声明式测试夹具，以及真实外部服务和多平台验收。

## PostgreSQL/MySQL 声明式测试增量（2026-10-12）

本阶段根仓最终测试为 192 项/1785 断言/0 失败；类型检查及官网构建通过。专项外键顺序测试首次使用仅主键实体触发既有 GraphQL 输入约束，补齐合法字段后完整测试通过。

`app.test.qiy` 已扩展到 PostgreSQL/MySQL；生成的场景使用同一 Drizzle schema 和 `createDataflowRoutes`，按 relation 的父表顺序插入夹具、子表顺序清理，循环外键在生成时拒绝。必须使用已迁移的专用 `qiy_test_*` 数据库，并显式令 `DATABASE_URL` 与 `QIY_TEST_DATABASE_URL` 相等；检查发生在数据库导入前，缺少 opt-in 不执行清理。测试前后会清理模型业务表和相关 Dataflow 辅助表；不能并发共享数据库。同步 call 使用成功 stub，身份/scope fixture、outbox/删除断言及浏览器 Action 场景仍未实现。早期 SQLite-only runner 结论由本节取代。

`tools/verify-qiy-scenarios-database.ts` 在现有 PostgreSQL 16/MySQL 8.4 容器创建随机隔离数据库，对 call 和 create-delete 两个完整 sidecar 示例执行干净生成、安装、Server typecheck、真实迁移与场景测试，并验证缺少测试连接被拒绝。create-delete 额外加入 restrict 外键并反转 entity 声明顺序，证明清理不依赖源文件顺序。两种数据库各通过 3 项场景、9 断言，隔离数据库在 finally 删除。证据目录分别为 `qiy-postgresql-scenarios-j8MGvB` 和 `qiy-mysql-scenarios-4zpsjb`。这些验收尚未重建发布 EXE，V3 仍 active。

## REST / Ably Realtime 第一阶段（2026-10-12）

### 最新增量：只读抓取与监控文件

本增量最终门禁：`bun run check` 通过，根仓 190 项测试/1779 断言/0 失败，官网构建和 `git diff --check` 通过。官方 Skill 与内嵌模板同步更新。

独立 Realtime 项目已生成 Prometheus Operator ServiceMonitor、三条 PrometheusRule 告警和五面板 Grafana JSON；Service 使用 `http` 命名端口及匹配的 app label。Deployment 与 ServiceMonitor 读取同一应用 Secret 的 `QIY_REALTIME_METRICS_TOKEN`，默认环境值为空。该 token 只允许 Prometheus 文本端点，恒定时间比较，不能取得管理员 API 或 Ably token 权限；原有管理员访问路径保持可用。轮换后重启 Server 加载新环境。下文早期“指标只能管理员访问”和“尚缺平台告警文件”的结论由本段取代；原生 OTLP、云监控专属适配器、真实集群安装及 Grafana 导入仍未验收。

最新生成工作区 `qiy-realtime-monitoring-5b05696b` 完成干净安装和 Server typecheck；47 项 Server 测试中 44 通过、3 项 Storage 条件跳过、252 断言，实际验证 token 权限隔离、错误凭据和轮换。生成测试的类型断言错误已修复并重新生成、通过 typecheck。根仓 Realtime 专项 4 项/72 断言通过。`tools/verify-realtime-monitoring.ts` 对生成 YAML 检查 selector、端口和 Secret 一致性，再在 Docker `prom/prometheus:v3.5.0` 中执行 promtool：三条规则合法，健康/死信 hold 时间、其他应用隔离以及缺失指标 10 分钟告警的行为测试全部通过，证据目录 `qiy-prometheus-ewM16v`。此证据不代表完整 Kubernetes 或真实 Ably 验收；V3 继续 active，旧 EXE 黑盒结果不涵盖本增量。

新增 `realtime { mode auto|manual; resource <name> { events created, updated, deleted; roles admin, operator, viewer; } }`。Parser、IR 与 serializer 保留资源、事件、角色和 Refine mode；未知/重复资源、事件、角色和空配置在生成前失败。Realtime 现在强制要求同一应用声明生成式 `auth`；Parser、serializer、项目生成器和 Server 生成器均 fail-closed，避免生成依赖空认证器的 token 与管理员运维端点。传输由 `api.client` 推导，当前仅实现 REST/Ably；GraphQL 项目声明 realtime 会明确拒绝，避免把 Ably 静默冒充 GraphQL Subscription。

生成 Web 使用 Ably JavaScript SDK 2.29.0 实现 Refine `LiveProvider`，不采用仍引用已移除 `ably/promises` 的 `@refinedev/ably@5.0.1`。List/Show 按资源配置 `liveMode`。生成 Server 提供 `/api/v1/realtime/token`，重新执行应用认证，根据 principal role 生成 channel capability，并且只授予 `subscribe`；`QIY_ABLY_API_KEY` 只进入 Server 环境。CRUD repository 现将 `created/updated/deleted` 与业务写入、审计记录一起写入 `qiy_realtime_outbox`；提交后立即投递，后台 worker 按 `QIY_REALTIME_POLL_MS` 扫描，失败后保留记录并指数退避。PostgreSQL/MySQL 使用 `leaseOwner`、`leaseUntil` 和事务级 `FOR UPDATE SKIP LOCKED` 原子领取；达到 `QIY_REALTIME_MAX_ATTEMPTS` 后设置 `deadLetteredAt`。管理员可列出死信、重放单条记录并按 `QIY_REALTIME_RETENTION_DAYS` 清理 delivered 历史。Dataflow `emit` 同时写入原业务 Outbox 和 `qiy:event:<event>` 实时 Outbox，事件 channel capability 继承 Dataflow `allow roles`。

专项 `tests/realtime-qiy.test.ts` 为 4 项/49 断言，其中新增缺少认证的 Parser、serializer 和直接 generator 三层负例。最新 SQLite Realtime 生成包完成干净安装、Server/Web typecheck，并通过 39 项、跳过 3 项、208 断言；除管理员指标、单条/批量重放和重复 ID 拒绝外，还实际验证批量重放、手动清理及对应审计在同一 SQLite 事务内提交。PostgreSQL 容器工作区 `qiy-postgresql-dataflow-DDwhWS/admin` 与 MySQL 工作区 `qiy-mysql-dataflow-ltvSQt/admin` 分别通过 migration、Server typecheck 和 28 项/189 断言；真实验证多实例领取、死信、指标、批量/单条重放、清理，以及三个管理员动作写入正确 actor/resource 的审计记录。SQLite 继续定位为单进程；已有数据库必须生成 migration 增加租约与死信列。

本轮根仓门禁为 190 项测试/1770 断言/0 失败、`bun run check` 通过、官网 VitePress 构建通过和 `git diff --check` 通过。Realtime SQLite 生成包完成 Server/Web typecheck 与完整 Server 测试；PostgreSQL/MySQL 容器迁移、并发领取、死信、指标、重放、清理及管理员审计验收通过。完整 SPA production build 已由最新 Windows standalone 黑盒重新执行；真实 Ably tenant/browser 验收仍尚未完成。

当前已经具备 PostgreSQL/MySQL 多实例 durable Outbox 领取协调、失败重试、死信、单条/批量重放、delivered 清理、事务性管理员操作审计、JSON/Prometheus 指标、阈值健康告警、机器可读运维 CLI 和 Dataflow `emit` 分发。Prometheus 端点使用低基数 gauge，可由 Prometheus 或 OpenTelemetry Collector Prometheus receiver 抓取；健康端点按 pending、dead-lettered 和最老 pending 年龄阈值返回 200/503。两者与 CLI 都要求管理员认证。CLI 通过 `QIY_REALTIME_ADMIN_TOKEN` 调用受保护 HTTP API，不直接访问数据库，因此角色授权、actor 审计与事务回滚语义不会被绕过。Worker 启动时及之后每个 `QIY_REALTIME_CLEANUP_MS` 周期自动删除超过 `QIY_REALTIME_RETENTION_DAYS` 的 delivered 历史，维护扫描与高频投递轮询分离。语义仍为 at-least-once：provider 成功后、delivered 标记前崩溃，或 publish 超过租约时间时仍可能重复，消费者必须幂等。仍缺平台专属告警规则、原生 OTLP exporter、GraphQL Subscription、自定义页面/record/global scope、permission 表达式、租户 capability 细分或真实 Ably tenant/browser 断线重连验收。V3 继续 active。

运维 CLI 新增 `metrics`、`health`、`prometheus`、`dead`、`replay <1..100 UUIDs>` 与 `cleanup [retentionDays]`；除 Prometheus 原文外输出单行 JSON。专项生成包 `qiy-realtime-ops-45c1c24b/admin` 完成干净安装与 Server typecheck，46 项生成测试中 43 项通过、3 项因未配置外部 Storage 条件跳过、233 个断言；其中 Server 路由实际验证 operator 拒绝、管理员 Prometheus 文本、阈值超限 503 及三类 alert，`realtime-admin.test.ts` 验证 URL、Bearer header、JSON/Prometheus 响应、批量重放 body、清理参数及缺少凭据/重复 ID/非法保留天数 fail-closed。

## 最新 Windows 发布候选黑盒（2026-10-12）

刷新 46 个内嵌模板文件和 12 个官方 Skill 文件后，使用 Bun 1.3.13 从当前源码重新构建 `dist/qiy-0.1.3-windows-x64.exe`，二进制内部 `--version` 为 `0.1.3`。扩展后的 standalone verifier 首先使用真实 EXE 验证未声明 `auth` 的 Realtime 模型被 `Realtime requires generated authentication` 拒绝，再分别生成 create/delete Dataflow、原子 batch Action 和已认证 Realtime 三个独立工作区；Realtime 输出明确包含租约/死信 Schema、管理员 JSON/Prometheus/健康路由、单条与批量重放/清理路由、事务性运维审计、Bearer 运维 CLI，以及 lease、最大尝试次数、保留期、告警阈值和独立自动清理周期等 Server 环境默认值。Batch 与 Realtime Server 均完成干净安装、typecheck 和完整测试；主工作区继续完成安装、typecheck/test/build、SPA 产物、实际 runtime health/asset/deep-link/API/OpenAPI 隔离及 production 未配置认证 fail-closed。脚本退出 0，最新证据目录为 `qiy-release-standalone-qd5DMF`。

同一个 EXE 的 integration verifier 在独立 Bun 宿主中完成离线 Skill 安装、Cookie/CSRF 与 Bearer 两个 `init`、`--sync` 手写 adapter 保留、宿主 Agent/OpenWiki/env 保护、认证传输测试、Web typecheck/test/build，脚本退出 0，最新证据目录为 `qiy-release-integration-zIuSE8`。此前首次安装曾遇到 npm 注册表瞬时无法解析已存在的 `@radix-ui/react-slot@1.5.0`，确认 registry 随后可返回该版本并以相同 EXE 重跑通过；本轮没有复现。这证明当前本地 Windows x64 候选与最新源码一致；GitHub Release 资产和 Linux x64/arm64、macOS x64/arm64 原生 runner 尚未重新执行，因此不能将本地证据表述成五平台发布完成。

## 原子批量 Dataflow Action 闭环（2026-10-12）

`action` 现支持受限的 `batch true;`：只允许 Dataflow Action、只允许 `placement list`、不能与记录级 `when` 混用，绑定流程必须声明 `idempotency required`，并通过一个必填 UUID input 加载目标资源。Parser、IR 与 serializer 往返保留 batch 标记；不满足集合事务契约的声明在生成前 fail-closed。

生成 Refine 列表复用选中行状态，批量按钮把共享表单输入复制到各 item，只发送一次 `{ items: [...] }` 请求。生成 Elysia 路由为 `POST /api/v1/commands/<flow>/batch`，最多接受 100 个唯一 ID，在一个数据库事务中顺序复用现有 Dataflow 的认证、role/scope、加载锁、require、update/create/delete、同步 call、审计和 outbox 逻辑；任意项失败抛出带 `index`/`id` 的批量错误并回滚之前所有项。整批只写一条持久化幂等回执，相同 key/body 回放，相同 key 与不同 items 或顺序返回 409，重复 ID 在事务前返回 400。前端 DataProvider 白名单显式登记 batch URL，不使用客户端逐条请求。

专项 `tests/action-qiy.test.ts` 为 11 项/77 断言。`examples/dataflow/batch-actions.qiy` 实际生成 127 文件并干净安装 710 packages，Server/Web typecheck 通过；生成 Server 32 项/179 断言、Web 17 项/73 断言和 SPA production build 全部通过。生成的 SQLite 测试实际让第一项更新、第二项业务校验失败，验证两条记录、审计和幂等回执全部回滚；修复第二项后以同一 key 通过 GraphQL 重试整批成功，再使用 REST 回放同一持久化回执，并验证冲突和重复 ID 拒绝。重新构建的 Windows x64 `0.1.3` EXE standalone 黑盒使用真实二进制生成批量示例，不仅检查 `/archiveReview/batch`、`runArchiveReviewBatch`、adapter resolver 和 Refine `BatchBusinessActions`，还对批量 Server 执行干净安装、typecheck 与完整测试；随后原有 create/install/typecheck/test/build/runtime 验收继续通过，证据目录为 `qiy-release-standalone-e6mOj3`。integration 黑盒继续通过 Cookie/CSRF、Bearer、离线 Skill、init/sync、typecheck/test/build，证据目录为 `qiy-release-integration-0YOABW`。

真实数据库验收已在运行中的 `postgres:16-alpine` 与 `mysql:8.4` 容器上通过。`bun tools/verify-postgres-dataflow.ts qiy-erp-pg postgresql` 和 `bun tools/verify-postgres-dataflow.ts qiy-dataflow-mysql mysql` 分别创建隔离数据库、生成 107 个应用文件、执行迁移与 Server typecheck，并各通过 25 项/148 断言。批量用例以第二项已处于 `revoked` 状态制造业务失败，验证第一项更新、审计、outbox 与幂等回执全部回滚；将第二项恢复为 `active` 后使用同一 key 重试成功，再验证单一回执、相同结果回放、顺序变化冲突与重复 ID 拒绝。生成工作区证据分别保留在 `qiy-postgresql-dataflow-D17aXj/admin` 与 `qiy-mysql-dataflow-0VKwU5/admin`，隔离数据库由 verifier 的 `finally` 删除。

GraphQL batch mutation 也已进入统一事务链路。生成 SDL 发布 `run<Flow>Batch(items: [<Flow>CommandInput!]!, idempotencyKey: String!): [Result!]!`；native、Yoga 和 Apollo resolver 均把 `{ items }` 委托给现有 `/api/v1/commands/<flow>/batch`，没有复制数据库事务。GraphQL 首次执行后，REST 使用同一 key/body 能回放相同持久化回执。真实生成的 native 工作区 `qiy-graphql-batch-0448f642/admin` 通过 Server typecheck 和 32 项/179 断言；Yoga 工作区 `qiy-graphql-yoga-batch-209ae066/admin` 与 Apollo 工作区 `qiy-graphql-apollo-batch-eed34ea5/admin` 均通过 Server typecheck，专项 Dataflow 测试各为 7 项/48 断言。该验收同时修复了批量路径被整体 URL 编码、Yoga SDL description 类型推导和 Apollo context 类型不完整三个适配器问题。当前仍无部分成功、后台异步 job 或超过 100 项的分片执行；V3 保持未完成。

本阶段最终根仓门禁为 `bun run check` 通过、186 项测试/1705 断言/0 失败、官网 VitePress 构建通过和 `git diff --check` 通过。三个临时 native/Yoga/Apollo 生成工作区在记录结果后已清理；standalone/integration 发布黑盒目录继续保留用于复核。

## Application / Database 注释与生成元数据闭环（2026-10-12）

顶层 `application` 与必需的 `database` 声明现均支持 `@comment("...")` 和 `@comment(t("message.key"))`。Parser 先保存翻译引用，再在完整 `messages` 块解析后使用默认语言解析 fallback；缺失默认语言消息、重复注解和未知注解均在生成前 fail-closed。Qiy IR 与 serializer 同时保留 fallback 和 key，round-trip 不丢失语义。

应用说明写入 standalone 根包及生成 Server/Web 包的 `package.json.description`，integration 模式写入生成 Web 包；数据库说明成为生成 Drizzle `schema.ts` 的文件级 JSDoc，不改变数据库迁移。专项 `tests/qiy-comments.test.ts` 为 8 项/106 断言。刷新模板快照后，根仓 `bun run check`、185 项测试/1682 断言、官网 `vitepress build` 和 `git diff --check` 全部通过。用户 DSL 文档与官方 Qiy Skill 已同步；仍未实现所有配置块的通用注释、数据库原生 `COMMENT ON` 迁移或剩余业务错误全面翻译，因此 V3 保持未完成。

## `app.test.qiy` 声明式 Dataflow 场景（2026-10-12）

CLI 现会在入口 `app.qiy` 旁自动发现 `app.test.qiy`，解析独立的 `qiy test v0` 文件，并在写入生成项目之前把 application、scenario、fixture alias、entity/field、Dataflow/input、类型与引用全部对照主模型验证。第一阶段语法覆盖 `given alias = entity ...`、单个 `when dataflow ...`、必填 `expect status`、可选 `expect errorKey` 和记录字段断言；input 与 expectation 可引用已给定 fixture 字段。重复、缺失必填字段、未知引用、类型不匹配和非 HTTP 状态均 fail-closed。

SQLite 模型生成 `apps/server/tests/qiy-scenarios.test.ts`，场景通过真实 `createDataflowRoutes` 执行，复用角色、幂等 header、事务和同步 call adapter 契约；PostgreSQL/MySQL sidecar 当前明确拒绝，避免把尚未实现的跨方言 runner 当作可用。专项 4 项测试/14 断言通过。`examples/dataflow/call.qiy` 与相邻 `call.test.qiy` 由真实 CLI 自动发现并生成 103 文件，干净安装 710 packages，生成 Server typecheck 和场景测试 1 项/3 断言通过，隔离目录已清理。发布样例 `create-delete.qiy` 也新增两个 sidecar 场景；最新 Windows exe standalone 黑盒确认生成场景文件并在完整生成包测试中执行。最终根仓门禁为 184 项/1671 断言、0 失败，类型检查、官网构建和 diff 空白检查通过。尚未支持多数据库场景 runner、身份/scope fixture、outbox/删除断言和浏览器 Action 场景，因此 V3 继续保持未完成。

## Enum、菜单和 Dashboard 通用注释闭环（2026-10-12）

枚举、枚举值、菜单分组和 Dashboard 指标现均支持 `@comment("...")` 或 `@comment(t("message.key"))`。Parser 使用统一消息解析，默认语言缺失、重复 `@comment` 和未知注解在生成前 fail-closed；IR 与 serializer 保留 fallback 和 key，往返不丢失。生成 Web metadata 新增完整枚举定义、枚举值说明、菜单说明和指标说明；枚举 Tag/Select 与 Dashboard 卡片按当前 Refine locale 显示说明，菜单说明保留给自定义布局和扩展。

专项 `tests/qiy-comments.test.ts` 当前 7 项/95 断言通过，覆盖四类对象的字面量/翻译注释、序列化往返、缺失消息、重复注解及生成元数据/UI 使用；根仓 TypeScript 检查通过。扩展后的 `examples/dataflow/documented-inputs.qiy` 实际生成 107 文件并干净安装 710 packages，生成 Server typecheck、22 项/122 断言，Web typecheck、13 项/88 断言及 SPA production build 全部通过；隔离目录已清理。该阶段根仓完整测试为 178 项/1627 断言，类型检查、官网构建和 diff 空白检查均通过。应用/数据库注释、受控 `call`、SQLite `app.test.qiy` 与受限原子批量 Action 已在后续阶段落地；更多配置对象注释、MPS 投影/exporter、realtime 和剩余真实外部服务验收仍未完成。V3 保持未完成。

## Dataflow 流程元数据、i18n 继承与 API 文档闭环（2026-10-12）

Dataflow 根声明现支持 `@label(...)`、`@confirm(...)` 和 `@comment(...)`，均接受字面量或 `t("message.key")`，并保留默认语言 fallback 与 key。绑定 Dataflow 的 Action 可以省略 label/confirm 并继承流程默认值，也可显式覆盖；两边都没有 label 时生成前失败。Parser、IR 与 serializer 可往返，重复或未知注解及默认 locale 缺失消息 fail-closed。

流程 comment 进入生成 TypeScript 安全文档注释、REST OpenAPI endpoint 的 summary/description/tags，以及 GraphQL command input/mutation 描述；Action 继承后的 label/confirm 继续通过 Refine `useTranslation`。专项 Dataflow/Action/i18n 测试 30 项/275 断言和根仓类型检查通过。另从 `examples/dataflow/documented-inputs.qiy` 生成 107 文件、干净安装 710 个包，server typecheck、22 项/119 断言，web typecheck、13 项/76 断言及 `CI=1` SPA build 全部通过；增加运行时 OpenAPI endpoint 断言后再次通过生成 server typecheck 和 1 项/10 断言。临时目录已清理。通用对象注释、流程 permission、受控 `call` 与批量 Action 仍未完成，V3 保持未完成。

## Action 记录条件显示闭环（2026-10-12）

`action` 新增受限且可静态检查的 `when <field> ==|!= "<value>";`。条件字段必须属于当前资源并使用 Text 或声明枚举；未知字段、非文本字段、非法枚举值、重复 `when` 和其他运算符在生成前失败。Parser、serializer 和生成 metadata 保持往返，Refine 列表行与详情页把完整记录交给 `BusinessActions`；记录缺少条件字段时 fail-closed 隐藏按钮。条件只负责 UI 可见性，`CanAccess`、Dataflow 角色、scope、状态校验和事务仍由原服务端路径独立执行。

专项 `tests/action-qiy.test.ts` 为 9 项/51 断言并通过根仓类型检查。另从独立 `.qiy` 条件模型生成 105 文件、干净安装 710 个包，生成 Web typecheck、14 项/49 断言和 `CI=1` SPA production build 全部通过，临时工作区已清理。真正的批量业务 Action 尚未实现：不能用前端逐条命令伪装原子批处理，后续必须先定义服务端集合输入、单事务、逐项错误和幂等语义。V3 保持未完成。

## GraphQL Dataflow command 统一事务链路（2026-10-12）

Dataflow 现在生成 `run<Dataflow>` GraphQL mutation：UUID/Integer/Boolean/Decimal/enum input 映射到对应 GraphQL 类型，必填性保留；空 `input {}` 不生成 GraphQL 禁止的空 input object。启用 `idempotency required` 时 mutation 要求 `idempotencyKey`。名称在 kebab/snake/camel 归一化后参与 type/mutation 冲突检查，生成前拒绝重复。

resolver 不复制事务逻辑，而是以内部 `Request` 调用同一 `createDataflowRoutes(authenticate)` Elysia 路由，保留认证 header、Cookie、角色、scope、幂等、事务、审计和 outbox 行为。应用授权守卫显式登记生成的 `runX` mutation，避免把合法业务命令误判为未知 GraphQL 字段；业务失败使用 `GraphQLError.extensions.status/errorKey` 暴露与 REST 相同的机器契约。结果返回类型按 Dataflow result 实体生成，满足 Yoga 的严格 resolver 类型检查。

实际生成 SQLite create/delete/空 input 组合项目后，native GraphQL server typecheck 与 39 项/226 断言通过，四条命令均验证成功、同键回放及不同输入冲突。Yoga 与 Apollo 各自生成 107 文件，server typecheck 通过，Dataflow + 官方适配器各 24 项/152 断言通过。`localized-errors.qiy` 干净生成并安装后 server typecheck 与 8 项/62 断言通过，实际检查 GraphQL `extensions.status=409` 和稳定 `errorKey`。最终根仓 `bun test --timeout 30000` 为 174 项/1587 断言，`bun run check`、官网构建和 `git diff --check` 通过。GraphQL subscription、multipart upload、Dataflow `call` 和 integration 模式服务端命令仍未实现，V3 保持未完成。

## File 上传策略、base64 与生成包验收（2026-10-12）

`File` 字段现支持 `@upload(binary|base64|both)`、1–100 MiB 的 `@maxBytes(...)`、可重复或逗号列出的精确/通配 `@mime(...)` 以及当前限定为 1 的 `@maxFiles(1)`。Parser、serializer 与 Database IR 保持往返，拒绝非 File 注解、未知模式、非法/重复 MIME、越界大小和多文件伪装；修复了多个独立 `@mime` 原先后写覆盖前写的问题。

生成 Web Resource metadata 和 Ant Design Upload 会按 MIME、大小、数量与模式预检；服务端注入 `resource.field` 策略并 fail-closed，二进制与 `/api/v1/files/base64` 都重新验证权限、字段、模式、MIME、大小和重复 key，严格校验 base64，元数据写入失败继续删除已写对象。专项根仓测试 45 项/343 断言通过。

从 `examples/erpadmin/app.qiy` 实际生成 156 文件，干净安装 712 个包后，server typecheck 与 48 项/260 断言、web typecheck 和 `CI=1` SPA build 全部通过；运行时覆盖未知字段 400、错误 MIME/模式 415、超限 413、非法 base64 400、重复 key 409、binary/base64 成功、owner 下载与删除。临时工作区已清理。GraphQL multipart upload、多文件 `Files` 类型、浏览器大文件直传/分片和对象存储孤儿扫描仍未实现，V3 保持未完成。

## Action label/confirm 国际化闭环（2026-10-12）

`action` 的 `label` 和 Dataflow Action 的 `confirm` 现在支持字面量或 `t("message.key")`。解析器从默认语言解析安全 fallback 并保留 `labelKey`/`confirmKey`，serializer 可无损 round-trip；生成的列表/详情按钮、Modal、Popconfirm 和成功通知通过 Refine `useTranslation` 使用当前语言。缺失默认语言消息在生成前拒绝。

专项 Dataflow/i18n/Refine 测试 23 项/227 断言和根仓类型检查通过；从 `examples/dataflow/documented-inputs.qiy` 实际生成 107 文件，server/web typecheck 与 Web 13 项/76 断言通过。流程自身的 label/confirm 注解和批量 action 仍未实现；条件 action 已在后续独立阶段完成。V3 保持未完成。

## Dataflow 受控事件 payload（2026-10-12）

`emit "event" { ... }` 已扩展为受控 payload：值只能来自必填 input、当前未删除 context 字段或字符串/整数常量，最多 32 个字段；解析器拒绝未知/可选 input、未知字段、重复键、删除后的 context 和本地认证密码字段。serializer、IR、生成器与 SQLite/PostgreSQL/MySQL 均输出 JSON text payload，禁止任意 JavaScript 对象和事务内外部副作用。

Dataflow 专项测试为 15 项/137 断言；PostgreSQL/MySQL 各 24 项/135 断言及生成 server typecheck 通过，实际检查 payload 字段、同键并发、完整回滚和重试。用户文档已补充语法。worker/broker 投递、消费者幂等、实时订阅和自由动态 payload 仍未实现，V3 保持未完成。

## Refine Action 通知与记录级授权、ERP 生成回归（2026-10-12）

修复生成 Web Action 仍直接使用 Ant Design `message`、成功文案硬编码中文且 `CanAccess` 缺少记录参数的问题。Dataflow Action 现在显式关闭 Refine mutation 的默认通知，统一使用 `useNotification`，成功/失败文案通过 `useTranslation`，权限检查携带 `params: { id }`；订单 workflow 操作也使用同一通知和 i18n 路径，并将记录 ID 传给访问控制。专项 Refine/provider、注释/i18n 和项目生成测试共 33 项/259 断言通过，根仓类型检查通过。

从 `examples/erpadmin/app.qiy` 重新生成 156 文件 Bun workspace，安装依赖后 server typecheck、web typecheck 及 `CI=1` SPA build 均通过；构建产出 client `index.html` 和静态资源。构建器仍会打印 React Router/Vite 的未来版本与 `envFile` 弃用警告，但 CI 退出码为 0。上传高级约束已在后续独立阶段完成；此验收仍不代表 realtime 或商业认证已完成，V3 保持未完成。

## PostgreSQL/MySQL Outbox 实库修复与验收（2026-10-12）

检查 `tools/generate-server.ts` 发现非 SQLite 的 emit insert 未 await，且向 text payload 列传入对象。现统一 JSON.stringify 并等待 PostgreSQL/MySQL insert，确保插入实际在事务内执行。`tools/verify-postgres-dataflow.ts`（MySQL wrapper 共用）扩展为 24 项/135 断言：12 个同键并发仅留一条事件，检查 actor、时间和可解析 payload；晚阶段业务失败以及审计/回执失败不留事件；outbox 约束故障导致业务、审计、回执一起回滚，解除后相同键可重试。

本轮 PostgreSQL 与 MySQL 分别从 `.qiy` 生成 109 文件、安装依赖、生成并执行迁移，均通过上述 24 项/135 断言及生成 server typecheck，finally 删除隔离数据库。专项 parser/生成测试 15 项/131 断言和根仓 check 通过。用户 DSL 文档补充 emit 用法、迁移要求与边界。此验收不覆盖外部 broker 投递、自由 payload、消费者幂等或实时订阅；V3 保持未完成。

## 隔离 HTTPS OIDC/JWKS 与 HTTP 认证验收（2026-10-12）

`bun tools/verify-oidc-docker.ts --isolated` 已解除旧容器证书过期阻断：自动创建随机 Docker 网络、新的两天有效期自签名证书和测试 IdP，生成 113 文件的 SQLite/OIDC 应用并在 Bun 1.3.13 Linux 容器内安装依赖。临时证书通过 `NODE_EXTRA_CA_CERTS` 显式信任；应用保持 TLS 验证，不通过关闭生产校验绕过证书问题。此模式不接触已有 ERP/IdP 容器。

实际 HTTP 测试 1 项/15 断言通过：HTTPS discovery、远端 JWKS、有效签名经 production authenticator 与 SQLite `issuer|subject` 用户映射返回身份，无 token/无效 token/过期 token/错误 issuer/错误 audience/损坏签名/未映射用户均返回 401；数据库角色 viewer 访问 users 返回 403，token 的 admin claim 不覆盖业务用户角色。另直接验证错误 issuer/audience 的 verifier 拒绝。生成 server typecheck、根仓 check 和用户文档 build 通过；临时验收容器、IdP、网络及目录已清理。

这是具有真实 HTTPS/JWKS 网络请求、真实签名和 SQLite 用户查询的测试 IdP 验收，仍不是商业 IdP tenant、浏览器 PKCE、key rotation、退出/撤销或 PostgreSQL ERP 身份联合验收。`docs/guide/auth.md` 增加工具使用方法，并修正“生产必须开启开发模式”的误导表述；生产应保持开发模式关闭并配置认证。V3 保持未完成。

## OIDC Docker HTTP 验收工具与证书阻断（2026-10-12）

新增 `tools/verify-oidc-docker.ts qiy-oidc`：从 `.qiy` 生成 SQLite/OIDC 应用，在现有测试 IdP 的 Docker 网络中安装依赖并运行 HTTPS discovery/JWKS、生成 production authenticator、SQLite 用户映射和 HTTP auth/me 验收。测试还要求无 token、损坏签名、未映射用户返回 401，数据库 viewer 用户不能访问 users，错误 issuer/audience 被 verifier 拒绝。它从本机映射端口提取测试公开证书作为隔离信任根；只在该公开证书提取阶段关闭验证，生成服务的请求仍严格校验 TLS，不能用于未知生产 IdP 的信任引导。

实际运行完成 113 文件生成与 Docker 依赖安装，但 discovery 因现有 `qiy-oidc` 证书过期返回 `CERT_HAS_EXPIRED`，认证断言尚未执行，不能标记 OIDC 验收通过。现增加证书有效期预检，在生成/安装前明确拒绝过期或尚未生效的证书；每条命令有 180 秒超时，临时验收容器与目录最终清理，不删除既有 IdP 容器。下一步须建立具有有效证书的隔离测试 IdP 后重跑；仍需真实商业 IdP、key rotation、PKCE 浏览器与 ERP 实库身份联合验收。

## ERP 租户隔离与失败回滚扩展验收（2026-10-12）

`tools/verify-postgres-erp.ts` 原先名为 scope 的用例没有切换租户，也只判断重复提交 Response 存在。现已改为明确断言 409，并增加四条真实 PostgreSQL 验收：submit/approve/ship/cancel 对缺失 claim 返回 403、外租户返回 409 且订单/库存/预占/幂等/审计快照完全不变；后续商品库存不足时回滚前一商品的预占，补库存后同一幂等键可成功重试；取消释放原库存行且重复取消不写入；预占数量异常时出库失败不改变订单、库存和审计。测试 reset 显式清理预占和回执。

最新从 `.qiy` 生成 156 个文件、安装依赖、Drizzle generate/migrate、实库 6 项测试/47 断言、生成 server typecheck 全部通过，隔离数据库已由 finally 删除。根仓类型检查通过。用户工作流文档的 approved → cancel 错误箭头已修正；实际仅 draft/submitted 可取消。身份仍由测试注入，真实 OIDC/JWKS 与浏览器 ERP 联合验收未完成，V3 保持未完成。

## ERP orderInventory PostgreSQL 实库验收（2026-10-12）

新增 `tools/verify-postgres-erp.ts qiy-erp-pg`：读取指定 PostgreSQL 容器端口和临时测试凭据，创建随机隔离数据库，从 `examples/erpadmin/app.qiy` 生成完整应用，执行依赖安装、Drizzle migration generate/migrate，然后在真实 PostgreSQL 上运行 workflow acceptance。测试覆盖 8 个并发相同幂等键提交只产生一次预占、operator 不能审批、admin 审批、出库扣减库存并释放 reservation、三类审计事件，以及无效状态下 ship 返回 409 且数据库状态不被破坏。最新运行通过 2 项测试/12 个断言和 server typecheck；finally 已删除临时数据库，未修改 `qiy-erp-pg` 中的既有数据库。

该验收证明生成的 orderInventory PostgreSQL 事务切片可以连接真实数据库运行；不代表真实 local/OIDC 用户登录、浏览器端 ERP 操作、生产连接池、跨副本故障恢复或完整订单边界条件已验收。MySQL/SQLite 不生成该 workflow 属于明确能力边界。

## Dataflow 事务性 Outbox emit（2026-10-12）

新增受限 `emit "event.name";` 语法。Parser/serializer/IR 会拒绝空事件名；生成器按 SQLite/PostgreSQL/MySQL 方言增加 `dataflow_outbox` 表，并在 Dataflow 当前事务内写入事件名、actor、flow payload 和时间。事务后续失败时 outbox 一并回滚。它不连接 Kafka、Redis、Ably 或其他 broker，外部 worker 的投递、重试、幂等和死信策略仍由应用实现。

专项测试 15 项/131 断言通过；实际生成 SQLite 工作区包含 outbox schema 和路由，server typecheck 及生成包 20 项/109 断言通过。此次实现没有把 `call`、自由 payload、GraphQL command 或外部网络副作用伪装成已支持。

## 宿主签名 JWT、管理员白名单与显式刷新验收（2026-10-12）

发布 integration 黑盒现在除 Cookie/CSRF 外，还实际生成第二个 `auth bearer` Web 挂载并运行本地宿主 HTTP 服务。测试使用 Web Crypto 签发、验签 HS256 JWT，校验 issuer、audience、subject、过期时间和 role；viewer token 首次访问管理员白名单返回 403，错误状态与消息进入 Refine AuthProvider，宿主 `onError` 显式换发 admin token。Qiy 不自动重放已拒绝请求，请求计数保持 1；调用方下一次显式请求携带新 token 后成功。外域 URL 在读取/发送 token 前拒绝。

最新 Windows exe 黑盒在同一 Bun 宿主中完成 Cookie 挂载的 init/sync/保留/完整构建，以及 Bearer 挂载的签名 JWT 2 项测试/13 断言；完整脚本退出 0，目录为 `qiy-release-integration-gMMqIK`。专项 parser/transport 测试仍为 7 项/111 断言通过。测试 JWT 不依赖新增前端运行时库，模板 snapshot 与官方 Skill 已刷新。

此证据覆盖 Qiy 的 token 传输、API 边界、错误交接和“不自动重放”契约；refresh 是宿主测试桥接主动换发 token，不是生产刷新 Cookie/IdP。真实应用仍需验证自己的签名/JWKS、Cookie 属性、CSRF、管理员目录、撤销和并发刷新。五平台远端 workflow 尚未运行，本轮未提交或发布。

## 已构建生成包 HTTP 运行验收（2026-10-12）

发布前 standalone 黑盒脚本新增 `verifyGeneratedRuntime`：实际启动生成的本机 preview 子进程，等待 health，再验证已构建首页、client asset、`/users` SPA 深链接、资源分页契约、OpenAPI，以及未知 API 404 不回退 HTML；finally 停止子进程。随后单独启动没有认证配置且 `QIY_DEV_MODE=0` 的 production 入口，要求在期限内非零退出并包含明确的未认证禁用错误。启动与请求均有超时，不会把已有前端构建成功当作服务可运行。

本轮复用上一阶段 Windows exe 实际生成并完整构建的 `qiy-release-standalone-QMEuGQ/admin`，`bun tools/verify-generated-runtime.ts <workspace>` 退出 0，根仓类型检查通过。该运行验收使用 preview 内存仓库与注入 admin；不代表真实数据库 CRUD、真实登录或浏览器交互已验收，也未在其他平台运行。本轮没有重复已通过的安装/typecheck/test/build，未提交或发布。

## 发布前原生平台门禁与标签来源（2026-10-12）

此前 release workflow 仅检查五个产物存在，可能发布未运行的二进制；已有 tag 而无 Release 时还可能从 main 构建，造成标签源码与资产不一致。现在先执行根仓 check/tests/docs build、刷新模板并构建候选；Windows x64、Linux x64/arm64、macOS x64/arm64 五个原生 runner 分别执行 standalone 与 integration 黑盒脚本，全部成功才发布同一组候选资产。已有 tag 时 checkout 对应提交并核对 package.version，已有 Release 仍跳过，不移动 tag。

新增 `tools/verify-release-standalone.ts` 使用真实 exe 生成 create/delete Dataflow 工作区，核对版本、manifest、Storage 路由与元数据回归测试，干净安装并执行完整 typecheck/test/build，再确认只有 SPA client 输出。2026-10-12 在当前源码重新构建本地 Windows x64 `0.1.3` exe，standalone 黑盒在 `qiy-release-standalone-eSNHfn` 完成 create、干净安装、typecheck/test/build，并实际启动生成 runtime 验证 health、SPA 深链接、asset、资源 API、OpenAPI、API 404 隔离及 production 未配置认证时 fail-closed；integration 黑盒在 `qiy-release-integration-zc3e6Y` 完成 Cookie/CSRF 与 Bearer 宿主认证传输、init/sync、离线 Skill、宿主文件保护、typecheck/test/build。两条脚本均退出 0。工作流通过 Docker actionlint（含 shellcheck），根仓类型检查与文档构建通过。前端生产构建仍使用已记录的 Node 回退，不能声称构建期 Bun-only。

五平台门禁只是已实现，尚未在远端执行，不能当作五平台已通过；当前版本号仍为 0.1.3，未更新同版本 GitHub 资产或创建新 Release。待 V3 其余发布门槛满足后再更新版本并推送。

## S3 HTTP、附件数据库与权限联合验收（2026-10-12）

`bun tools/verify-s3-storage.ts --api` 已完成真实生成工作区、干净依赖安装、Bun HTTP 服务、SQLite 附件表与 MinIO 联合验收：匿名访问 401、只读用户上传 403 且无对象、上传持久化 ownerId/size、重复 key 409、所有者下载与签名 URL 实际下载、其他用户 download/metadata/signed 全部 404、operator 删除 403、admin 删除成功且对象与数据库记录同时消失。生成 API 测试 1 项/18 断言通过，脚本最终退出码 0；临时工作区清理完成，隔离容器 `qiy-minio-v3-api` 已移除，未操作 ERP 数据。

验收身份由测试路由注入，不代表真实 JWT/IdP 验证；数据库是 SQLite，不代表 PostgreSQL/MySQL 联合存储验收；MinIO 不代表 AWS IAM/KMS 或云端生产 bucket。默认模式仍只验证生成 S3 adapter；`--api` 才安装生成包依赖并运行 HTTP/数据库/权限联合测试。相关工具为 `tools/verify-s3-storage.ts` 与 `tools/s3-api-acceptance.ts`。V3 发布门槛尚未全部满足，本轮未提交、推送或发布。

## 附件元数据权威与清理默认值（2026-10-12）

修复模板两处问题：数据库模式查询不到附件时不再回退内存缓存，避免删除数据库记录后仍可下载或签发新 URL；`cleanupMissingAttachmentObjects()` 默认 dryRun=true 与实际执行一致，显式 false 才删除，修复此前省略参数却删除并报告预演的问题。定时任务继续显式 false，CLI 继续由 `--apply` 控制。已签发 URL 的有效期与对象存储权限不因数据库记录删除自动撤销。

SQLite 生成工作区新增实库测试：上传后删除附件记录，下载/metadata/signed 全部 404，随后清理物理文件；插入缺失对象记录，默认清理保留记录，显式 apply 删除。模板 snapshot 已刷新；生成包 server 全套 24 项测试/150 断言及类型检查通过，根仓 168 项测试/1527 断言、类型检查、文档构建与 diff 检查通过。此证据自身不覆盖 S3 HTTP 路由与生产 DB/存储联合验收，后续 S3 联合验收见上节；本轮没有重新构建 exe 或发布资产。

## 生成 S3 适配器实服务验收（2026-10-12）

新增 `tools/verify-s3-storage.ts`，从最小 `.qiy` 实际生成 S3 工作区，再加载其 storage adapter；使用环境变量指定已有验收 bucket，不读取仓库 `.env`，不输出凭据或签名 URL。真实 MinIO 容器中验证 Bun.S3Client 上传、exists、内容读取、签名 URL 的 HTTP 下载与删除；finally 清理 UUID 隔离对象和临时生成工作区。类型检查通过。此证据覆盖生成 provider 与 S3-compatible 服务，不覆盖 HTTP 上传路由/权限、数据库附件元数据、AWS IAM/KMS、云端生产 bucket 或孤儿对象扫描。

本轮隔离容器 `qiy-minio-v3` 使用临时测试凭据和既有本地镜像；验收后移除。最初未创建 bucket 时返回 NoSuchBucket，说明配置不会自动创建远端 bucket；准备 bucket 后完整验收成功。运行新脚本需预先提供 `QIY_S3_BUCKET`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY`，可选 `QIY_S3_REGION`。云存储与真实身份服务验收仍未完成，V3 保持 active。

## 当前 Windows 候选集成黑盒验收（2026-10-12）

重新构建本地 Windows x64 `0.1.3` 可执行文件，刷新内置官方 Skill；通过实际 exe 完成 integration `init`/`--sync`，验证 web alias、包名、manifest 版本、离线 Skill、多文件示例、宿主 AGENTS/OpenWiki/env 与手写 adapter/test 保留，且没有生成后端、Docker 或 Turborepo。隔离宿主工作区干净安装后，Web typecheck、测试和 SPA build 全部通过；`build/client/index.html` 存在，`build/server` 不存在。

黑盒测试新增实际 Bun HTTP 服务返回 401，验证 `hostRequest` 状态码与原始错误消息、Refine 登录跳转和单次请求；原有 CSRF、credentials、目标 origin/path 限制与默认未登录检查继续通过。验收脚本增加阶段进度输出、SPA 产物断言，并将成功输出改为 executable acceptance，避免把本地候选误称为已发布资产。当前证据只覆盖本地 Windows 候选，GitHub 资产尚未更新，Linux/macOS/arm64 与真实宿主 JWT/刷新 Cookie/IdP/S3 仍需验证。

## 宿主认证错误契约（2026-10-12）

修复 integration 模式 `hostRequest` 丢失 HTTP 状态码，以及 AuthProvider `onError` 错误解构参数的问题。生成错误携带 `statusCode`；AuthProvider 将原始错误交给可选的宿主 `window.qiyHostAuth.onError`，缺省仅在 401 跳转登录页且不注销宿主会话，403/500 不触发登录跳转。不会自动刷新 token 或重放业务请求。已有未托管 host adapter 不会被同步覆盖，用户文档明确要求手动合并此修复。

运行实际生成 adapter 的测试覆盖 401/403/500、非 JSON 502、宿主自定义登录跳转及原始错误身份，确认没有额外请求或自动重放。集成专项 7 项测试通过；完整根仓 168 项测试/1526 断言、类型检查、文档构建与 diff 检查通过。本轮未对生成工作区执行独立完整安装与类型检查，未重打包或发布。宿主真实 JWT/refresh-cookie 项目验收和外部服务验收仍未完成，V3 保持 active。

## 模型与业务阶段源码说明（2026-10-12）

实体/字段/索引/外键关系 `@comment` 已进入 PostgreSQL、MySQL、SQLite 的 Drizzle schema JSDoc；实体说明进入生成 repository 接口和 service 工厂。Dataflow input/context/step 的说明进入请求 schema 或对应事务阶段源码，空 step 的说明也保留，操作索引和阶段排序保持原义。源码使用默认语言并保留 `i18n: key`；运行时 OpenAPI/GraphQL 与 Refine 描述保持原文与翻译机制。共享 renderer 转义 `*/` 并处理 CR/LF 与 Unicode 行分隔符，测试将含代码片段的恶意描述生成到三种方言 schema，再由 TypeScript 移除注释编译，确认没有注入可执行声明。此实现不写数据库 COMMENT、不改变迁移。

`documented-inputs.qiy` 干净安装生成 106 文件工作区，server typecheck 与 23 项测试/132 断言通过，Web typecheck 与 13 项测试/70 断言通过；阶段分组调整后重新生成并复验 server typecheck、Dataflow/OpenAPI 6 项测试/37 断言。根仓 167 项测试/1506 断言、类型检查与文档构建通过。应用/菜单/配置等所有对象通用注释、流程级描述、MPS TextGen 对齐仍未完成；本轮没有重新打包或发布 exe。

## REST Dataflow 业务错误 i18n（2026-10-12）

Parser/IR/serializer 支持 `@error(t("key"))`，默认语言缺失 key 时生成前拒绝；字面量错误保持原义。业务规则失败返回 409、默认语言 `error` 和稳定 `errorKey`，生成 Refine REST DataProvider 使用当前文档语言翻译，缺少翻译回退默认语言，未知 key 回退 API 原文，保留状态码供认证错误处理。新增完整 SQLite 样例 `examples/dataflow/localized-errors.qiy`，自动生成业务错误响应断言与 Web 翻译/自定义命令传输测试。

样例干净安装 710 packages 后 server typecheck 与 23 项测试/141 断言通过；Web typecheck、12 项测试/57 断言及 SPA build 通过，其中两项测试覆盖错误翻译和 Refine 自定义命令传输。根仓完整测试为 166 项/1473 断言通过，根仓类型检查、文档构建与 diff 空白检查通过。GraphQL command、错误全面翻译、完整注释传播、MPS 对齐与真实外部服务验收仍未完成；本轮未发布 Release，也未重打包此前本地 exe。

## Dataflow 创建、删除与并发回放（2026-10-12）

文本 Parser/IR/serializer 与共享 server generator 支持 `create binding = entity name { ... }` 和 `delete binding;`。创建自动生成 UUID 主键并从认证 claim 推导 scope；必填字段完整性、同类型必填 input、enum 值、保留/重复绑定、密码字段、主键与 scope 写入均在生成前校验。新绑定可供后续步骤更新、删除和返回，删除返回最后快照且禁止再次使用该绑定校验或写入。空 input/context 允许纯创建。字面量仍仅 Text/enum，input 赋值支持 UUID/Text/Integer/Decimal/enum，不支持自由表达式。

SQLite 生成测试扩展到创建、删除、纯创建和创建→更新→删除组合；修复成功夹具应断言最终字段值而非所有历史写入的错误，并覆盖晚阶段业务、审计和幂等回执失败后的完整回滚。`examples/dataflow/create-delete.qiy` 生成包 server 37 项测试/226 个断言与 server/web typecheck 通过；其基础创建/删除包已完成干净安装和 SPA build。新增组合的前端无独立业务页面，不能将此记录视为浏览器端业务验收。

实库发现并修复并发回放顺序问题：初始回执查询早于 context load，确保已删除行可回放；等待行锁后发生业务失败时，在事务回滚后再次查询已提交回执，再返回业务错误。回执请求哈希包含 scope，角色/claim 缺失先拒绝，换租户复用同键返回 409，不能读取原租户的成功结果。PostgreSQL 16 与 MySQL 8.4 在各自隔离数据库完成生成、迁移、server typecheck，各 22 项测试/117 个断言通过，包含 12 请求同键创建/删除并发、换租户拒绝、业务/审计/回执失败回滚与重试；finally 已删除测试库，未修改 ERP 数据库。

根仓 `bun test --timeout 30000` 为 165 项/1460 个断言通过；默认 5 秒首次并行验收曾遇到文件生成测试超时，未改变测试断言。类型检查、文档构建与 diff 空白检查通过。Windows x64 本地可执行文件重新打包，`--version` 为 0.1.3，使用该 exe 重新生成最新组合样例并通过 server 37 项测试/226 个断言；未替换 GitHub 同版本发布资产。`call`、GraphQL command、`.test.qiy`、自定义权限、完整 ERP 与真实外部服务验收仍未完成；`emit` 后续已以事务性 outbox 受限子集实现，见本页最新章节。MPS 尚未覆盖这些新增业务语法；V3 保持未完成，此轮不发布 Release。

## 0.1.3 发布验收（2026-10-12）

五个平台的独立可执行文件由 Bun 1.3.13 构建。`0.1.2` 候选的 Windows x64 与 Linux x64 已完成黑盒生成、安装、typecheck、21 项 API 测试、11 项 Web 测试及 SPA/Docker build；随后发现源码 checkout 中模板 `storage/` 被模板自身 `.gitignore` 误排除，因此不移动既有 tag，改由 `0.1.3` 补丁版纳入模板源码、CI 与发布运营修复。

Linux 黑盒验收发现 React Router 的 SPA 构建仍会在 Bun 中加载 `react-dom/server.bun.js`，React 19.2/19.3 均无法完成其即将删除的 SSR 中间阶段。生成 Web 的 `build` 脚本现明确调用 Node.js 20+ 的 React Router CLI；Bun 继续负责依赖、测试、API 和运行时，Dockerfile 使用独立 `node:22-alpine` 构建阶段，最终镜像仍为 Bun。用户文档不再宣称构建阶段完全没有 Node。

同轮发现新建工作区在首次 `bun install` 前没有 `bun.lock`，旧 Dockerfile 因强制 `COPY bun.lock` 无法构建。`qiy create` 的 Dockerfile 现从精确版本的 package manifests 执行 `bun install`；`qiy init` 集成到已有 Bun workspace 时仍复制宿主 `bun.lock` 并使用 `--frozen-lockfile`。修复后的发布候选镜像已完成非缓存依赖安装、前端构建、镜像导出并启动，开发安全开关显式开启时首页返回 HTTP 200；未配置认证且 `QIY_DEV_MODE=0` 时继续 fail-closed，属于预期生产边界。

`0.1.3` 发布前数据库 smoke 使用本机 PostgreSQL 16 与 MySQL 8.4 容器各自创建隔离数据库，分别完成生成、迁移、server typecheck 和 14 项测试/76 个断言。覆盖类型化整数/枚举写入、角色与租户范围、同键/不同键并发、跨表联动，以及业务、审计和幂等回执故障的事务回滚与同键重试；脚本最终清理隔离数据库。该证据属于通用 Dataflow 切片，不等于完整 ERP 订单工作流、真实 IdP 或真实 S3 已生产验收。

## 单一公开编译链路与选择性消息模块（2026-10-12）

公开 CLI 的应用生成入口已收敛为 `.qiy`：`create`、`generate` 和 `init` 不再把 `.mps` 或 Database IR `.json` 暴露为应用输入。MPS 保留为可选语言工作台、投影编辑器和内部一致性验证来源，通过 TextGen/导出得到 `.qiy` 后进入同一条 Bun Parser → Qiy IR → generators 链路。MPS 维护脚本仍可在源码仓库单独运行，但不再出现在发布 CLI 帮助中；这避免 Dataflow、Action、消息与 UI 配置继续形成第二套业务生成语义。

模块 include 新增 `@messages`，并兼容 `@message`，只提取目标文件唯一的顶层 `messages` 块。选择器会先展开嵌套 include，继续拒绝绝对路径、`..`、项目根外符号链接和循环引用；缺失或重复消息块 fail-closed。`@menu.operations` 等通用对象路径选择器尚未实现并明确报错。专项测试覆盖完整片段隔离、别名、缺失、重复、不支持 selector 和循环依赖；用户文档与官方 Skill 已同步准确边界。

最终回归为根仓 162 项测试/1431 个断言、`tsc --noEmit`、VitePress build 和 `git diff --check` 全部通过。源码 CLI 在自动清理的临时目录完成真实 `create`，确认选中的消息进入 `app/messages.ts` 且同文件未选择实体不会泄漏到资源；重新构建的 Windows x64 `0.1.3` 可执行文件帮助仅公开 `.qiy` 输入，不再出现 MPS/IR 生成命令。该本地二进制尚未发布新 Release，V3 继续 active。

## Refine UI adapter 与主题闭环（2026-10-12）

新增 `ui { library antd; theme ...; themes ...; colorMode light|dark|system; allowThemeSwitch ...; allowColorModeSwitch ...; }`，支持 `blue`、`purple`、`green`、`orange`、`red` 五个稳定主题 key。解析器校验未知 UI 库、未知/重复主题和默认主题不在可选列表；序列化往返保持配置。未声明时默认 Ant Design、五色主题、blue 与 system。

生成 Web 新增 `app/ui/` adapter：Ant Design `ConfigProvider`、default/dark algorithm、浏览器 `prefers-color-scheme`、`localStorage` 恢复和 Header 右上角主题/明暗模式控件集中管理，语言选择器继续保留。List/Show/Create/Edit 外壳和常用 CRUD 按钮改为优先使用 `@refinedev/antd` 官方组件；动态过滤、列可见性、批量删除、文件下载、权限、审计、业务 Actions 和 Kbar 保持现有链路。

完整样例 `examples/themes/app.qiy` 生成 95 文件工作区 `tmp/theme-admin-20261012c`。干净 `bun install` 后 Web 类型检查通过，8 项测试/32 个断言通过，SPA build 输出 `build/client/index.html`。保留 React 19 peer warning、`envFile` 弃用、React Router v8 future flag 和 i18n chunk 超过 500 kB 提示。Material UI/Mantine/Chakra adapter 尚未实现，当前 fail-closed，不把仅有主题文档或依赖安装视为支持。

## Refine Kbar 与常用认证 provider（2026-10-12）

默认 Web 模板已加入 `@refinedev/kbar@2.0.1`，`RefineKbarProvider` 包裹 Refine，`RefineKbar` 位于 Refine context 内，命令面板直接读取生成资源与 CRUD 路由。认证 DSL 新增 `okta`、`auth0`、`azure-ad-b2c`、`keycloak`、`google`、`kinde` 与 `otp`；原有 `local`、`oidc`、`oauth2`、`sso` 保持兼容。

Okta/Auth0/Azure AD B2C/Keycloak/Google/Kinde 和通用 OIDC-family provider 共用 Authorization Code + PKCE 客户端：生成 `/auth/callback`、state/verifier session、S256 challenge、无 client secret 的 token exchange、可选 RP logout，以及 provider 对应的 env 示例。服务端继续使用 `jose` 对 issuer/audience/JWKS 验签，并按 `subjectField` 映射本地用户。Auth0 完整示例位于 `examples/auth-providers/auth0.qiy`；干净安装生成 115 文件后，server 22 项测试/124 断言通过，Web 类型检查、16 项测试/67 断言和 SPA build 通过。

OTP 不复用 OIDC：`auth { provider otp; ... usernameField ... }` 生成 request/verify API、两阶段登录页、5 分钟签名 challenge、固定时间验证码摘要比较和 12 小时 access token。生产发送通过 HTTPS `QIY_OTP_DELIVERY_URL` adapter，开发固定码只在 `QIY_DEV_MODE=1` 下返回。示例 `examples/auth-providers/otp.qiy` 生成 113 文件；server 类型检查及 23 项测试/130 断言、Web 类型检查和 SPA build 通过。challenge 不依赖进程内存，但真实邮件/短信供应商的限流、反滥用、送达率与故障恢复仍需生产验收。

以上验证使用本地 PKCE/token endpoint mock、JWKS 单测和 OTP adapter 注入，不等于真实 Okta/Auth0/Azure/Keycloak/Google/Kinde tenant 已验收。provider redirect/logout allowlist、真实 audience/claim、JWKS 轮换、第三方 Cookie 和 OTP 供应商仍列入外部服务验收。

## 高级列表过滤器闭环（2026-10-12）

字段 DSL 新增 `@filter(eq,contains,startsWith,endsWith,gt,gte,lt,lte,between,in)`，解析器拒绝未知和重复 operator，并在序列化后保持配置。生成的 Refine 列表页按字段声明显示 operator Select 与输入控件，可同时提交多个字段条件；REST DataProvider 兼容原对象等值过滤协议并为高级条件发送 clause 数组，GraphQL `QiyFilterInput` 增加默认 `operator: "eq"`。REST/GraphQL 都按字段 allowlist 和 operator allowlist 拒绝非法条件，Drizzle repository 已生成三方言共用的文本匹配、比较、区间和集合条件。

完整样例为 `examples/filters/app.qiy`。实际生成 97 文件 SQLite 工作区 `tmp/filter-demo-20261012b`，干净 `bun install` 后 server/web 类型检查通过；Web 12 项测试/43 个断言、server 18 项测试/96 个断言通过。生成验收同时修复了 SQLite 审计回滚夹具对 DateTime 字段写入字符串的问题。当前多个字段条件按 AND 组合；任意嵌套 AND/OR 条件树、保存的用户筛选视图和浏览器交互验收仍未完成。

## Refine providers：审计、通知、认证与访问控制（2026-10-12）

生成 Web 已接入 Refine 官方 provider 组合：REST/GraphQL `DataProvider`、`AuthProvider`、`Authenticated`、`AccessControlProvider`、Ant Design notification provider，以及认证配置存在时的 `AuditLogProvider`。本地认证使用官方 Ant Design `AuthPage`，将其 email 字段映射到 `.qiy` 的 `usernameField`；外部身份已改为 Authorization Code + PKCE，OTP 使用独立两阶段登录页。

列表删除、批量删除、文件下载错误、详情页错误和业务 action 通知统一走 `useNotification`，不再依赖未配置的全局 `antd` message。`CanAccess` 覆盖资源路由、菜单、CRUD action、详情 action、审计面板和声明的业务 action；它只负责前端可见性，服务端仍重复授权。

服务端审计事件写入与业务 mutation 共用事务；只读 `/api/v1/audit-logs/` 通过配置的 auth user entity 左连接 author，保留已删除作者的历史 id，公开投影不包含密码哈希或原始 metadata。客户端 create/update 审计写入明确拒绝。当前 scoped resource 查询在没有持久化 scope metadata 时 fail-closed，租户审计过滤仍未完成。详情见 [Refine providers](../docs/guide/refine-providers.md)。

最新 catalog 生成包已通过 server typecheck、15 项 server 测试/81 断言和 8 项 web 测试/32 断言；local auth 的生成包确认 `AuthPage` 与 username/email 映射源码。常用外部 provider 与 OTP 的本地生成验收见本页首节；真实 IdP、真实 OTP 供应商、租户审计和既有系统 cookie/refresh 契约仍需独立验收。

## 多语言 Refine I18nProvider（2026-10-12）

`messages` 从中英文限定扩展为规范 BCP 47 标签，支持默认字典校验与往返。生成器使用 i18next 实现官方 Refine I18nProvider：两种 translate 签名、默认文字、插值、CLDR 复数、异步 changeLocale 和独立实例；getLocale 读取实际切换后的语言，未声明语言拒绝且保持当前语言。用户仍只在 `.qiy` 配置。语言选择器使用母语标签，模型默认语言进入初始界面，页面 lang/dir 随切换更新，ar/fa/he/ur 使用 RTL。声明的已映射语言加载 Ant Design 组件语言包，未映射标签回退英语。扩充常用通知、操作、错误页和自动保存中英文键；并未完整翻译全部 Refine 组件或 Qiy 固定页面文字。

完整例子 `examples/multilingual/app.qiy` 包含法、英、日、阿拉伯语及插值/复数。实际生成 95 文件工作区 `qiy-multilingual-20261012`，server/web 类型检查通过，Web 12 项测试/94 个断言、server 18 项测试/96 个断言和 SPA build 通过。原有依赖复用，仅 i18next 在独立临时目录实际安装；不代表完整干净安装验收。发现并修复无 Dataflow 模型生成 `Set<never>` 导致 web 类型检查失败。根仓 139 项测试/1234 个断言、类型检查及文档构建通过。保留 envFile 弃用、React Router future flag 与部分 chunk 超过 500 kB 提示。

五平台可执行文件已刷新；Windows x64 实际 exe 和 Linux x64 Docker 中的实际二进制均生成此 95 文件例子，确认 i18next 依赖与多语言 provider 打包完整。Linux 此轮仅验证生成输出，不据此新增运行或干净安装验收；arm64/macOS 未运行。业务错误翻译、所有配置的通用 comment、通用 include selector、新语法 MPS 对齐及 V3 其余发布门槛仍待完成。未远端发布，V3 保持 active。基础 `@message(s)` 选择性导入已在后续“单一公开编译链路与选择性消息模块”阶段完成。

## 整数业务规则与三方言验收（2026-10-12）

Dataflow `require` 支持必填 `input.field` 和 context 字段；非空 Integer 支持 `==`、`!=`、`>`、`>=`、`<`、`<=` 与有符号 32 位整数字面量。Text/enum 仍只支持字符串相等/不等。编译期拒绝类型混用、未知或可选输入、nullable Integer 和越界字面量，context 禁用保留名 `input`。运行时在事务中执行条件，晚阶段失败回滚之前的写入。完整示例为 `examples/dataflow/guarded-inputs.qiy`，使用数量 100–200、初始库存非负及写入后的再校验。

SQLite 测试夹具为多个整数条件求共同合法值，并区分写入前的 context 条件与写入后条件；互相矛盾的条件报告无法推导成功夹具，尚非通用流程求解器。自动生成输入规则失败、业务/审计/回执无写入和同键重试测试。源码生成的 96 文件后台通过 server 类型检查与 24 项测试/145 个断言，复用已有依赖。根仓完整测试 138 项/1218 个断言通过，随后补充 signed32 边界和矛盾条件测试，专项 10 项/87 个断言及类型检查通过。

共享实库 harness 新增数量上下限与晚阶段整数规则失败；PostgreSQL 和 MySQL 8.4 各通过实际迁移、14 项测试/76 个断言及 server 类型检查，脚本已清理各自隔离数据库，未修改原 ERP 业务库。这两份 harness 的 `bun install` 本轮成功退出；不据此把其他挂起的安装或所有生成模式的干净安装验收视为通过。认证仍为测试注入。

五平台可执行文件已重新构建。Linux x64 实际二进制在自动清理的 Docker 容器中生成库存示例，server 类型检查及 24 项测试/145 个断言通过，复用镜像依赖；arm64/macOS 未运行验收，未远端发布。上轮含本地化手写 Action 页的 SPA build 本轮补验成功，`ssr:false` 删除服务器构建并输出 `build/client/index.html`；保留 React Router future flag 与 envFile 弃用提示。文档构建及 diff 空白检查通过。

尚未实现字段间比较/算术、Boolean/Decimal 条件、Dataflow create/delete/call/emit、声明式 `.test.qiy`、通用 include selector 和新语法 MPS 对齐；真实 IdP/S3 与完整 ERP 生产验收仍待完成。基础 `@message(s)` 选择性导入已在后续阶段完成，V3 保持 active。

## GraphQL 描述与手写 Action 本地化（2026-10-12）

模型实体/字段描述现在进入 GraphQL 实体类型与 Create/UpdateInput 的 SDL description，使用已解析的默认语言；公开字段过滤仍排除本地认证 passwordField。生成 GraphQL schema 测试以实际 `buildSchema` 类型与字段读取描述，覆盖主键只出现在输出类型及 nullable 字段。manual Action 的 `page manual @comment(t("key"))` 保存引用并可序列化往返，新生成的扩展占位页使用 Refine `useTranslation` 切换说明和返回按钮；既有扩展文件仍不被 sync 覆盖。模型例子为 `examples/dataflow/documented-inputs.qiy`，目前生成 103 文件。

生成 server/web 类型检查、实际 OpenAPI/GraphQL 文档三项测试/18 个断言，以及 Web 消息/Action 四项测试/25 个断言通过。根仓 137 项测试/1200 个断言、类型检查、文档构建和 diff 空白检查通过。并行检查首次出现 CLI 版本测试失败与 Windows 依赖读取 EUNKNOWN，独立重试均通过；不将首次失败隐去。五平台产物已刷新，Linux x64 实际二进制在自动清理的 Docker 容器生成 103 文件后台，server 类型检查及 23 项测试/132 个断言通过，复用镜像依赖。此改动只扩展文档/占位页，不代表 GraphQL Dataflow command、动作条件/批量操作、其他语言、MPS 或干净安装已完成；V3 保持 active，未远端发布。

## 本地化模型描述（2026-10-12）

新增 `messages { default "en-US"; locale "en-US" { "key" "message"; } locale "zh-CN" { ... } }`；默认语言在解析期校验，缺失引用、重复语言/key 与危险属性名均拒绝。实体、字段、索引、关系及 Dataflow input/context/step 支持字面量或 `@comment(t("key"))`，IR 同时保存默认描述与引用，序列化往返不丢失引用。Refine 字段提示及命令输入描述随中英文切换，REST CRUD 和命令 TypeBox/OpenAPI 使用默认描述。示例为 `examples/dataflow/documented-inputs.qiy`。

新生成的 `qiy-documented-reviews-20261012` 服务端通过类型检查及 22 项测试、122 个断言，包含实际 `/api/v1/openapi/json` 的实体/字段/nullable 描述验证；Web 通过类型检查、11 项测试、40 个断言及 SPA build。依赖复用已安装目录，并非干净安装。补充字典原型属性回退保护后，Web 再次通过类型检查与消息专项 16 个断言；TextMate 与 JetBrains 源码匹配检查覆盖新增关键字及 `#` 注释，未编译 JetBrains 插件。根仓类型检查、137 项测试/1196 个断言、文档构建与 diff 空白检查通过。首次文档构建出现 `spawn UNKNOWN`，未改配置的重试成功。

五个平台的 0.1.1 可执行文件已刷新。Windows x64 实际 exe 创建 101 文件描述示例；Linux x64 在自动清理的 Docker 容器内用实际二进制生成同一示例，并通过 server 类型检查和 22 项测试/122 个断言，复用镜像已有依赖。arm64/macOS 仅有构建证据，未远端发布。索引/关系/context/step 描述尚未全面生成代码注释，manual Action 页仍仅支持字面量；GraphQL 描述、其他语言、业务错误翻译、通用 selector 与 MPS 对齐仍待完成。基础消息选择性 include 已在后续阶段完成，V3 保持 active。

## MySQL 真实事务验收（2026-10-12）

MySQL 8.4 隔离容器 `qiy-dataflow-mysql` 就绪后运行 `bun tools/verify-mysql-dataflow.ts qiy-dataflow-mysql`；生成的 `qiy-mysql-dataflow-lo7hl4/admin` 完成实际迁移、server 类型检查和 13 项测试/67 个断言。涵盖整数/枚举持久化、非法输入拒绝、角色和租户范围、同键/不同键并发、跨表联动，以及业务/审计/回执故障的全事务回滚与重试。脚本成功退出并清理独立测试数据库，不操作现有 ERP 数据库。认证仍是测试注入，不代表真实 IdP 验收；真实 S3、完整 ERP 生产验收及干净安装检查尚未完成。

## V3 扩展路线：既有系统集成与 Dataflow（进行中，2026-10-11）

枚举 Dataflow 输入与类型化实库验收：input 可引用已声明 enum，更新只能写入同一 enum 的字段；编译时同时检查枚举字面量更新及 require 的合法值。生成请求使用 TypeBox Literal Union，前端 Action 使用带 enum label 的 Ant Design Select；SQLite 夹具使用合法初始状态并验证非法输入无业务、审计或回执写入。新增完整 `examples/dataflow/enum-inputs.qiy`。生成包 `qiy-enum-inputs-86a09cd6e7df45a3a35438ec5469274c` 通过 server 23 项测试、135 个断言、server/web 类型检查与 SPA build。共享 PostgreSQL/MySQL harness 扩为 13 项；实际 PostgreSQL 包 `qiy-postgresql-dataflow-qvxiAf` 通过迁移、13 项测试、67 个断言与 server 类型检查，包含整数/枚举真实存储、回放冲突、非法输入和晚阶段回滚，隔离数据库已清理。根仓 133 项测试、1165 个断言与类型检查通过。修复 include 展开器误处理 `#` 注释内 include 和大括号，加入模块化回归。Windows x64 exe 已刷新至本轮源码并以实际 exe 生成 100 文件枚举后台，确认 Literal Union 和 Select 存在；该 exe 生成包未再次安装与运行测试。MySQL 下载及另一个干净安装仍在进行；真实 IdP/S3、i18n 引用与 MPS 对齐尚未完成，目标保持 active。

类型化 Dataflow 写入与敏感字段保护：新增同类型必填 Integer input 写入，生成请求契约限制为有符号 32 位整数；Elysia 保留数字字符串转换行为，非法字符串、小数、null 和越界值拒绝且不写业务、审计或回执。Parser 禁止 Dataflow 修改主键、已声明 scope 字段与本地认证 passwordField，覆盖字面量和 input 两种写法。新增 `examples/dataflow/typed-inputs.qiy`；实际生成 SQLite 应用通过 server 类型检查、原有 21 项 server 测试及新增整数负例专项测试（Dataflow 最终 6 项、50 个断言），验证数量从 1 写入 7、回放、审计/回执故障重试及后续业务失败回滚。根仓 132 项测试、1156 个断言与类型检查通过。生成应用复用已安装依赖，不计独立干净安装验收；Boolean 实体字段、Decimal/enum 动态写入、MPS 对齐仍未完成。MySQL 镜像拉取与干净安装进程仍无完成结果，V3 保持进行中。

多平台本地打包与 Linux Docker 黑盒：当前源码已构建 Windows x64、Linux x64/arm64、macOS x64/arm64 的 0.1.1 产物。Windows exe 生成枚举后台通过；Linux x64 产物在独立临时 Docker 容器中验证版本、创建 100 文件枚举后台、manifest 版本和离线 Skill 安装。该 Linux 实际 exe 生成的 server 复用已有镜像依赖，23 项测试、135 个断言通过；容器退出自动清理，未修改运行中的 ERP。此证据不代表 Linux 干净安装、arm64 或 macOS 运行验收。其余架构当前只有构建证据。文档构建和 diff 空白检查通过，未执行远端发布。

导航 Action 权限与集成权限接线（2026-10-11）：认证模型支持导航 action 的 `allow roles`，允许 admin/operator/viewer 非空子集，拒绝未知角色、重复声明、无生成认证的角色声明及命令 action 的独立角色覆盖。按钮与生成业务页路由使用 `CanAccess` 并传递 `params.id`；手写扩展保持不受 sync 管理。补齐 integration 的 Refine AccessControlProvider，通过宿主 `window.qiyHostAuth.can` 判断；缺失、异常或非布尔允许响应一律拒绝。已有未托管 adapter 需要手动移植新导出，不能依靠 sync 覆盖。生成认证的 getIdentity 在无 token 时返回 null，避免匿名角色判断误用身份响应。SQLite 示例 Web 15 项测试、55 个断言通过，导航页面 typecheck 与 SPA build 通过；宿主权限专项测试覆盖拒绝、允许、记录参数传递与 sync 保留。尚未运行浏览器交互验收，此能力不替代手写页面 API 的服务端授权。

整数示例补充验收：生成 Web 类型检查与 React Router SPA 构建通过，文档构建及 diff 空白检查通过。仍有 React Router 弃用提示和大 chunk 提示。本轮源码更新尚未重新打包进 Windows exe，已有 0.1.1 可执行文件不能视为包含此轮整数与字段保护改动。

本轮最终检查：根仓 130 项测试、1145 个断言、类型检查和文档构建通过。集成样例 `qiy-transport-UfQhwi` 复用已安装依赖进行 Web 类型检查与 SPA 构建，均通过；独立干净安装仍在依赖解析中，不能计为安装验收。Windows x64 CLI 已重新构建，版本为 0.1.1，实际 exe 从角色示例生成 116 个文件（`qiy-actions-exe-5e060fabb6f942dbab74603dc2fad546`），确认页面守卫与记录参数存在；未发布远端 Release，V3 目标继续 active。

验收范围调整：按用户要求，远端 GitHub Release 发布验收暂不作为继续实现或 V3 功能验收的阻断；保留 release-smoke 工作流及未执行的事实，优先使用本地生成包和 Docker 实库验证。真实 IdP、S3、MySQL 等未验证能力仍须明确记录，不能以跳过发布验收替代功能验证。

跨方言 Dataflow 验收扩展（2026-10-11）：PostgreSQL harness 新增缺失/其他租户 claim 拒绝、已提交回执不能绕过当前 tenant scope，两张业务表均声明 tenant scope；新生成包 `qiy-postgresql-dataflow-FBUUeW` 通过迁移、11 项实库测试、55 个断言与 server 类型检查，隔离测试库已删除。共用验收脚本增加 MySQL 8.4 分支，独立入口为 `bun tools/verify-mysql-dataflow.ts <mysql-container>`；按方言使用连接关闭、SQL 执行和数据库约束故障注入，新增 CI MySQL service/job。后续 0.1.2 发布候选已在 PostgreSQL 16 与 MySQL 8.4 各通过 14 项实库测试/76 个断言。测试身份/tenant header 仅用于夹具，不代表生产信任请求 header 或真实 IdP 已验收。

Dataflow 角色授权（2026-10-11）：新增命令级 `allow roles admin;`、`allow roles operator;` 与组合白名单；未声明时仍允许 admin/operator。解析器拒绝空白名单、重复角色/声明和未知角色。服务端在幂等查询及事务前验证角色，admin 不绕过 operator-only 限制；生成的 Refine command action 继承该策略并通过 `CanAccess` 控制。完整示例为 `examples/dataflow/roles.qiy`。新 SQLite 生成包 `qiy-role-flow-5e0d8e0d24a246d6a1bec0d5376091c7` 通过 server 34 项测试、199 个断言及 Web 15 项测试、51 个断言，双方类型检查通过。拒绝请求不改变业务表、不写审计或回执。Docker PostgreSQL 新包 `qiy-postgres-dataflow-MS2dQG` 通过 9 项测试、46 个断言和 server 类型检查，验证同一 actor 降权后无法回放已提交结果；独立测试库已删除。根仓 126 项测试、1117 个断言通过。此项未实现自定义角色、permission claims、独立导航 action 权限或 MPS 对齐；测试注入身份不等于真实 IdP 验收。

Dataflow 输入写入（2026-10-11）：新增 `update connector { revokedReason = input.reason; }`，IR 区分字符串字面量与输入引用，serializer 保留引用语法，服务端只读取经 TypeBox 校验的 request body。当前仅允许必填 Text → 非 enum Text，不接受未知/可选/不匹配输入、嵌套路径或可执行表达式；原有字面量兼容。生成测试同步使用实际 input 预期，并修复晚阶段失败夹具，保证仍验证先写后失败的事务回滚。`examples/dataflow/app.qiy` 不再丢弃操作员填写的 reason。新 PostgreSQL 生成包 `qiy-postgres-dataflow-N4mFyx` 在 Docker 实库通过 8 项测试、39 个断言和 server 类型检查，验证响应及数据库均保存输入；测试库已清理。新 SQLite 生成包通过 20 项测试、108 个断言及 server 类型检查。此项不代表 numeric/enum 动态输入或其他 Dataflow 指令已完成，MPS 对齐仍待实现。语法见 [Dataflow 文档](../docs/dsl/dataflow.md)。

最新 PostgreSQL Dataflow 实库验收：生成上下文查询在 PostgreSQL/MySQL 方言使用 `FOR UPDATE`（SQLite 保持同步事务），避免并发请求基于同一旧状态执行。`bun tools/verify-postgres-dataflow.ts` 使用现有 PostgreSQL Docker 容器创建独立临时数据库，执行生成 schema 的 migration generation/migrate，验证 12 个同键并发请求全部回放且仅一条审计/回执、12 个不同键仅一次状态转换、更新后业务失败完整回滚、同键输入冲突拒绝，并通过生成 server 类型检查。最新 102 文件生成包 `qiy-postgres-dataflow-z4VHfg` 的 8 项测试、37 项断言通过，新增两表联动并发、第二表校验失败、审计/回执数据库约束故障注入和故障解除后的同键重试。测试数据库已在 finally 中删除，未修改 ERP 数据库。新增 `database-smoke.yml` 以独立 PostgreSQL/MySQL service 重复验收；0.1.2 发布候选已在本机两种真实数据库通过同一脚本。认证为测试注入 operator；真实认证及完整 ERP workflow 仍待验收，不能将此切片视为全部数据库门槛完成。

本轮整体检查：根仓 126 项测试、1117 个断言及 `bun run check` 通过；新生成双角色 SQLite 工作区 server/web 类型检查、34 项 server 测试、15 项 Web 测试和 React Router SPA 构建通过，最终仅保留 `build/client`。更新后的 `bun run docs:build` 通过。构建仍有 React Router/Vite 的弃用与 future flag 提示；没有将这一轮验证声明为严格 Bun-only 构建审计。

本地可执行文件验收：刷新 template/Skill snapshot 后构建 Windows x64 CLI，`--version` 为 `0.1.1`；使用该 exe 从双角色 `.qiy` 创建独立 114 文件项目，确认服务端角色守卫与前端 action 角色元数据存在。产物位于 `dist/qiy-0.1.1-windows-x64.exe`，尚未发布；此黑盒检查未在 exe 生成包再次安装依赖或重跑运行测试，运行证据来自上述源码生成包。

下面项目用于回应“可生成 CRUD，但无法安全接入已有 Bun 单体、已有 API、既有 JWT/Cookie/SSO 与真实 ERP 流程”的边界。部分 P0/P1 已落地；每项均需按实际生成与验收范围理解，不能把 parser 或前端 build 误报为生产可用。

1. **P0：生成器可信度与可复现性。** 已修复发布可执行文件的构建时版本注入，并新增 `qiy doctor`。manifest 已记录 schemaVersion/qiyVersion/projectName/mode，保留旧格式读取；release-smoke 工作流已加入发布资产版本与 create/install/typecheck/test/build 检查，以及 init/sync、离线 Skill、宿主文件保护与 Cookie/CSRF 运行测试。本地重新打包的 Windows exe 已通过 integration 黑盒验收，尚未执行远端已发布 Linux 资产工作流。不能以 Web build 成功替代全栈成功。
2. **P0：既有系统集成模式（已实现 MVP）。** `mode integration` + `integration { apiBase; auth; }` 仅允许 `qiy init` 在既有 Bun workspace 生成 Web package。它默认只读（list/show），不生成 server、Drizzle、迁移、Docker 或第二套 auth。`app/host/{data-provider,auth,access-control}.ts` 不登记为 Qiy owned file，`--sync` 保留本地映射。真实 API contract、JWT/Cookie、refresh、CORS、权限与领域逻辑仍需宿主实现并测试。
3. **P1：治理与认证传输。** 增加 resource/menu/action/field permission、确认/审计/幂等 action、Bearer 与 same-origin HttpOnly Cookie + CSRF + 外部门户三类认证传输 profile。Qiy 不自动猜测已有 API 的路径、响应 envelope、refresh cookie 或领域权限；这些必须在 host adapter 中显式映射并测试。
4. **P1：Dataflow 业务命令 DSL（已实现受限子集）。** `.qiy` 支持 input/context/step/result、Text/enum require/update、Integer input 写入与业务比较、受控 create/delete、事务性 outbox `emit`、同步受控 `call`、可选 `audit "event";` 与 `idempotency required;`。standalone 同时生成 REST 与 GraphQL command；native/Yoga/Apollo 的 GraphQL resolver 委托同一 REST Dataflow 路由，不复制事务逻辑。命令按 `allow roles` 检查角色，并在回放前重新检查角色和 scope。SQLite、PostgreSQL/MySQL 的事务与故障注入范围见本页最新验收说明。流程 `@label/@confirm/@comment`、Action 继承、OpenAPI/GraphQL 描述、显式 action 幂等键、input comment 和 GraphQL status/errorKey 已完成。`call` 只允许生成的本地同步验证 adapter，不允许网络或不可逆副作用。未实现 allow permission、自定义角色、GraphQL subscription 或幂等回执清理；MPS Concept/TextGen 未对齐。
5. **P1：业务 Action DSL（已实现 MVP）。** `action` 可显式绑定资源与 Dataflow 命令，生成 Refine 列表 actions 列和详情操作区；当前记录主键自动注入 Dataflow input，其他必填参数生成 Ant Design 弹窗，label/confirm 可使用 `t("key")`、继承 Dataflow 默认值或显式覆盖。`when` 已支持当前资源 Text/枚举字段的 `==`/`!=` 条件显示并对缺失字段 fail-closed。`navigate` + `page manual @comment(...)` 生成 React Router 路由、说明占位页和 `apps/web/app/extensions/` 手写扩展文件；create/init 的 sync 均不覆盖扩展。客户端只允许调用生成白名单中的命令，任意 command URL fail-closed；认证应用的 command action 已继承 Dataflow 角色白名单，导航 action 支持显式角色与直接访问页面的守卫。`batch true` 已实现列表选中项的一次请求、单事务、整批幂等、失败项定位及 native/Yoga/Apollo GraphQL batch mutation；尚未实现异步 job、部分成功、分片执行或更复杂输入组件。生成 Web Action 当前仍以受保护 REST command URL 为稳定调用边界，GraphQL mutation 主要供 GraphQL 客户端和服务端集成使用。
6. **P2：i18n、注释与查询扩展（部分）。** `#` 行注释、BCP 47 多语言 `messages` 及 `include "..." @message(s)` 选择性消息导入已实现；application/database、实体/字段/索引/关系、枚举/枚举值、菜单分组、Dashboard 指标、Dataflow 根/input/context/step 与 manual Action 页支持 `@comment("...")` 和 `@comment(t("key"))`。应用/数据库说明进入生成包元数据与 schema 文件文档；实体/字段描述进入 GraphQL 类型及 CRUD 输入，字段与 Dataflow input 描述进入 REST TypeBox/OpenAPI 和 Refine 表单；流程根说明进入 OpenAPI endpoint、GraphQL command 和源码文档。REST Dataflow `@error(t("key"))` 与 Refine 翻译传输已实现。所有配置对象通用注释、其他业务错误全面翻译、通用 selector（例如 `@menu.operations`）及可移植读取查询 DSL 尚未实现。
7. **验收原则。** 每个阶段必须有 parser/IR 负例、生成源码、生成包 typecheck/test/build 和适用的真实服务验收。Integration mode 不得覆盖未托管扩展；Dataflow 不得以客户端联动替代服务端事务与授权。

## AI 开发入口与官方 Skill 安装（2026-10-11）

集成认证传输补充：生成 helper 在读取 token 前验证请求 URL，只允许有效 API base 的 origin 和路径边界；Cookie 模式要求同源，写请求缺失/损坏 CSRF Cookie 时拒绝发出，所有模式禁止自动重定向。修复认证 helper 未使用 `VITE_QIY_API_BASE` 的配置不一致。四种 transport 的实际生成模块已运行负例与请求测试，根仓 122 项测试通过；此修复仅影响新生成适配器，既有 unowned `app/host/auth.ts` 需开发者手动合并。

发布集成黑盒补充：`tools/verify-release-integration.ts <executable> <version>` 在独立临时 Bun workspace 中调用实际 CLI，验证版本、integration manifest、Web package alias、无后端生成、宿主 Agent/wiki/env/script 保护和 host adapter/test 同步保留，并执行生成 Web 的安装、类型检查、Cookie/CSRF 测试及 SPA 构建。首次运行发现生成的 `authTransport as const` 导致 Cookie 模式 TS2367，已将类型声明修复为支持的 transport 联合类型。修复后 Windows exe 黑盒完整通过（`qiy-release-integration-sjCerl`），根仓 121 项测试和类型检查通过。release-smoke 同时修复 shell glob 引号及 YAML `run` 标量写法；远端 Linux 发布验收仍待执行。

`create` 自动生成根目录 `AGENTS.md`、兼容入口 `AGENT.MD`，以及 `openwiki/{quickstart,architecture,development}.md`。文档从实际生成文件和 package scripts 建立目录、命令与扩展边界说明，不将生成成功表述为生产验收。`init` 在 `apps/<web-alias>/` 生成 Agent 入口，将文档隔离到 `openwiki/qiy-<admin-name>/`，保留宿主根目录的 Agent 文件与 OpenWiki；integration 模式不会声称存在未生成的 server 或迁移。同步保留自定义 Agent 入口与额外手写 wiki 页面，刷新三份生成文档。

`qiy skill install` 在当前目录离线安装官方 Qiy Skill 到 `.agent/skills/qiy/`，包含 references 和完整多文件仓储示例，不安装其他框架 Skill。发布构建内嵌 12 个 Skill 文件；重复安装相同内容安全，修改过的官方文件默认拒绝覆盖，显式 `--force` 才替换，并保留其他 Skill 和额外文件。

验收：根仓类型检查、121 项测试（0 失败）、文档构建通过；Windows x64 可执行文件构建成功，并在独立临时目录用真实 exe 安装 Skill，再以其中仓储示例创建 108 文件项目，确认 Agent 与 OpenWiki 入口存在。本阶段未执行远端 Release；V3 仍未达到完整发布门槛。

## Bun Workspace 集成与生成边界（2026-10-11）

本轮验收：`tmp/v3-dataflow-idempotency-20261011b` 生成工作区通过 server/web typecheck；绕过 Turbo 缓存直接运行 server 20 项测试、web 10 项测试，均通过。服务器额外通过测试专用命令夹具验证“前一步已更新、后一步 require 失败”完整回滚。生成模板的 test task 禁用缓存，避免数据库测试回放旧日志。集成模式修复 apiBase 重复解析并补上 Refine Authenticated 外壳；host adapter sync 保留测试通过。根仓 118 项测试、类型检查及文档构建通过；Web 最新代码直接执行 React Router SPA build 成功，未使用缓存。V3 尚未达到发布门槛。

CLI 新增 `qiy create -f <model.qiy> -n <name> -o <directory>` 用于创建独立 Turborepo + Bun workspace，以及 `qiy init -f <model.qiy> [-n <name>] [--sync]` 用于挂载现有 Bun workspace。别名、集成名称和 package name 直接写在 `.qiy` 的 `workspace` 块中，不需要额外的用户 TS 配置文件。`init` 要求根 `package.json.packageManager` 为 `bun@...`，将 server/web 放入可配置的 `apps/<alias>`，允许独立 npm package alias，并把 deploy、Dockerfile、Compose 重命名到 deploy alias 下；它保留现有 workspace pattern，补入 `apps/*` 与不冲突的 `qiy:<name>:*` scripts，并合并 ignore 文件。

环境变量由 `.qiy` 的 `env` 块声明，并在每个 Admin 包内生成 `.env.development`、`.env.production`、`.env.example`。独立 `create` 默认使用 `apps/server/` 与 `apps/web/`；`init` 根据 alias 改为例如 `apps/ops-api/.env.production` 和 `apps/ops-console/.env.development`，Compose 同步引用 alias 后的 server env 路径。宿主仓库根目录已有 `.env*` 文件不读取、不覆盖、不合并。开发 secret 新建时随机生成；`--sync` 保留 development/production 已有键值并补入新增声明；`.env.example` 不携带真实 secret。`VITE_` 变量仅写入 Web 环境文件且禁止标记为 secret。

每个挂载 Admin 使用独立 `.qiy-<name>.generated.json` manifest。`--sync` 仅重写 manifest 已登记文件并清理由模型移除的登记文件；任何未登记的同路径文件都 fail-closed，因此不覆盖宿主手写扩展。专项 Bun 测试验证 alias、package/workspace 合并、部署文件改名、手写扩展保留和非 Bun 根拒绝；根仓 `bun run check`、103 项 `bun test` 与 `bun run docs:build` 通过。独立 Catalog/ERP 在干净目录中已重新执行生成、`bun install` 与 server/web typecheck，未复现“Storage 模块缺失”报告；但这不等同既有 API、认证、真实数据库/IdP/S3 的生产验收。现有 JWT、refresh Cookie、请求/响应契约、权限和领域流程仍须以未由 Qiy 管理的扩展实现并独立测试。

## 本地用户名/密码认证（2026-10-11）

ERP 示例从 OIDC-only 改为 `auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }`，用户表的 password hash 可空且不进入 Refine 字段表单。生成器提供 `Bun.password` Argon2id 校验、12 小时 HS256 access token、`POST /api/v1/auth/login`、用户名/密码登录界面、`QIY_AUTH_SECRET` 配置、`auth:bootstrap-admin` 与 `auth:set-password` 本机交互命令。密码管理不开放 HTTP endpoint；首个管理员只允许在不存在管理员时从部署主机初始化。

密码 hash 不进入生成的 REST schema / GraphQL schema、列表检索 allowlist 或用户 CRUD 输入；REST 输出还做字段脱敏，原始 POST/PATCH 在 Elysia 请求解析前拒绝 password hash 字段。生成 ERP 的本地登录 API 测试验证正确密码发 token、错误及未知用户返回相同 401、旧匿名密码管理路径不存在；用户 API 测试验证 hash 不被读出/写入。Refine local auth 测试、ERP API 6 项相关测试、web auth 2 项测试和工作区 typecheck 通过。首次管理账户脚本已生成并通过类型检查，但尚未连接 PostgreSQL 实例实跑初始化/登录；无真实 IdP 的 OIDC 部署仍需独立验收。运行需先迁移数据库、设置至少 32 字符的 `QIY_AUTH_SECRET`，再执行 `bun run --cwd apps/server auth:bootstrap-admin`。

## Docker + PostgreSQL + OIDC 容器验收（2026-10-09）

`examples/erpadmin/admin` 已在 Docker Desktop Linux engine 进行非缓存镜像构建并成功运行。生成的 Dockerfile 现在以 Bun 安装依赖和运行 Elysia API；仅在构建阶段使用 `node:22-alpine` 执行 React Router 的 SPA 打包，因为 Linux Bun 1.3.13 和 1.4.2 都会在 React Router 即将删除的 SSR 中间产物阶段加载 `react-dom/server.bun.js` 并触发 CJS wrapper 错误。运行阶段没有 Node 服务或 Node 子进程，仍为 Bun + Elysia。Dockerfile 和 Compose 同时明确 `HOST=0.0.0.0`，容器发布端口与 K8s/Compose 访问不再被 `127.0.0.1` 绑定阻断。

生成器还为 PostgreSQL 项目加入 `postgres` 迁移驱动：应用运行时继续使用 Bun `SQL` + `drizzle-orm/bun-sql`，但 `drizzle-kit migrate` 需要独立的 PostgreSQL driver；此前容器和本机都会报缺少 `pg`/`postgres` driver。新的 ERP 包已重新生成并在容器内迁移成功，数据库实际包含 11 张表（业务表、审计、附件、预占和幂等回执）。

本轮端到端实测使用隔离 Docker network、PostgreSQL 16、仅供测试的 HTTPS JWKS/OIDC fixture 和有范围 claim 的管理员用户：Health、静态 SPA、Refine 登录页、OIDC `/auth/me`、REST Products/Orders、GraphQL Products 均返回预期结果；订单流程实际创建 warehouse/product/inventory/order/order item，完成 draft → submitted → approved → shipped，库存从 100 降至 98。测试 IdP 是自签本地夹具，绝不代表接入真实第三方 IdP；生产仍应使用受信任 HTTPS issuer/JWKS、真实密钥和持久化数据库。已运行的本地演示仅发布到 `127.0.0.1:3010`。

## 最新验收：原生 generator 最小闭环（2026-10-07）

### MPS/Bun 单编译链路收敛（2026-10-12）

Qiy 生产编译器现明确只有一套：`.qiy → Bun Parser/Validator → Qiy IR → generators`。MPS 是可选投影建模工作台，其持久化模型通过 `tools/mps-database-ir.ts` 与 `tools/mps-qiy.ts` 导出规范 `.qiy`；公开 CLI 不直接接收 `.mps`，MPS generator marker 不生成业务应用。原生 `qiy.textGen` 只保留 Catalog、Relations、ERP 既有结构子集的兼容 smoke，不再要求复制注释、Dataflow、Action、i18n 等后续业务语义。

本轮为 Entity、Field、Index、Relation、Enum、EnumValue、MenuGroup 和 DashboardMetric 增加 MPS 可编辑 `comment` 属性，由 Bun exporter 完整保留；未向原生 TextGen 增加相同生成代码。`tests/verify-mps-textgen.ts` 改为对去除 `comment/commentKey` 后的旧结构子集做比较，同时重新解析权威 exporter 输出并检查完整模型与注释。`tests/mps-database-ir.test.ts` 22 项、163 个断言通过；全仓 `bun test --timeout 30000` 为 178 项、1637 个断言、0 失败，`bun run check`、官网文档构建和 `git diff --check` 通过。使用 MPS bundled JBR 的 `tests/mps-smoke.xml` 为 `BUILD SUCCESSFUL`，三个属性校验器、三个 marker、三个 legacy TextGen 结构子集及权威 Bun 导出均通过。V3 仍未完成，剩余发布、外部身份、Realtime/Dataflow 与生产验收不受此项替代。

### Dataflow 同步本地 call（2026-10-12）

Dataflow 新增 `call <adapter> { ... }` 受控语句，payload 仅允许必填 input、当前 context 字段、字符串或安全整数常量，最多 32 个唯一字段，并禁止泄漏本地密码字段或读取已删除 context。生成器输出 owned 类型契约 `apps/server/src/dataflows/calls.ts` 和 unowned 实现入口 `apps/server/src/extensions/dataflow-calls.ts`；默认 handler fail-closed，`--sync` 保留开发者实现。handler 只允许同步本地计算/策略校验，返回 typed success/rejection；不允许把 HTTP 或不可逆副作用伪装为数据库事务，外部投递继续使用 `emit`/outbox。

专项根仓 Dataflow 测试 17 项、164 个断言通过，覆盖解析/序列化、payload 来源、数量/重复/密码/删除后访问负例、生成契约、默认拒绝和 extension sync 保护。`examples/dataflow/call.qiy` 实际生成 102 文件并干净安装 710 packages，Server typecheck 通过，生成 `dataflow.test.ts` 5 项/20 个断言通过；实际验证 call 拒绝返回 409、保留 errorKey，并回滚 call 前的状态更新，GraphQL command 复用同一 REST Dataflow 实现。隔离目录已清理。SQLite `app.test.qiy` 场景已在后续阶段实现；异步第三方调用、补偿事务、多数据库场景 runner 和批量业务 Action 仍未完成。

完成 `call`、MPS 注释、声明式场景、Application/Database 注释、原子批量 Action 与 GraphQL batch mutation 后，根仓门禁会持续按 `bun run template:build`、`bun run check`、`bun test --timeout 30000`、`bun run docs:build` 和 `git diff --check` 执行。最新 `dist/qiy-0.1.3-windows-x64.exe` 已完成 standalone 与 integration 黑盒：standalone 同时生成声明式场景模型和 batch Action 模型，并对两者执行生成契约检查、干净安装、typecheck/test/build、运行时 health/SPA/asset/resource/OpenAPI/API 隔离及生产未认证 fail-closed；批量模型额外实际执行 GraphQL 首次提交与 REST 同回执回放。integration 完成离线 Skill、两个 init 模型、sync、Cookie/CSRF 与 Bearer 宿主认证、typecheck/test/build。最新隔离证据目录分别为 `qiy-release-standalone-e6mOj3` 与 `qiy-release-integration-0YOABW`，脚本均退出 0。这证明当前 Windows x64 产物，不代表远端 Release 或其余四个平台已执行；V3 仍保持未完成。

生成包 SDL 实际验收：最新 ERP native、Apollo、Yoga 配置分别重新生成 132/134/134 个 application files，在各自 server 工作目录执行 `bun test --preload ./tests/setup.ts tests/graphql-schema.test.ts`，三者均 1 pass / 0 fail。测试实际导入生成的 `graphqlTypeDefs`，经安装的 GraphQL 库构建 schema 并通过 `validateSchema`，补齐上一轮仅生成测试、未执行的证据。此次没有重跑 CRUD/API/Web/build；这不等同 adapter 路由实测或数据库连接验收。正式 ERP 示例已同步新增 schema 测试，V3 仍未满足发布门槛。

GraphQL schema 契约补充：生成器现在拒绝空实体模型、没有可写字段的 CRUD 输入、重复 mutation 名，并为每个 server 生成包写入 `api/tests/graphql-schema.test.ts`，使用 `graphql` 的 `validateSchema(buildSchema(...))` 检查实际 SDL。10 项服务端生成测试和类型检查通过（`tmp/graphql-schema-contract.log`）；这只是生成包验收契约，未重复已通过的 Apollo/Yoga ERP 运行测试，真实数据库/IdP 组合仍未完成。

GraphQL 生成命名校验（2026-10-07）：生成前注册内建 scalar、根类型、Qiy 聚合类型、实体类型及 Page/CreateInput/UpdateInput 派生类型，拒绝首字母大写后的名称碰撞；同时检查派生 Query 名、字段名、保留 `__` 前缀及 enum 的 true/false/null 等非法值。9 项服务端生成测试及类型检查通过，涵盖实体/枚举冲突、派生类型/查询冲突和合法枚举。顺带修正上一轮 MySQL bigint 改动遗漏的 import 断言；未重复 ERP 构建。此为生成期检查，完整 GraphQL schema 实例化验证和 V3 发布验收仍待完成。

枚举契约补充（2026-10-07）：Database IR 拒绝空/非数组枚举值集合、无效值项，以及非 Text 存储字段绑定当前字符串枚举，避免生成不可用 GraphQL enum 或 API 字符串契约与数据库数值类型冲突。合法 Text 枚举保持原行为。数据库、MPS 桥接、文本 DSL 三个测试集共 61 项/384 个断言及类型检查通过（`tmp/enum-capability-tests.log`）；未修改模板和原生 aspect，不重复 ERP 构建或 Make。此为编译期契约补充，数值枚举、实库 enum 约束和 V3 完整验收仍未完成。

独立生成等价验收修复：此前 `verify-mps-textgen.ts` 将原生配置同时传给两条生成路径，可能掩盖桥接菜单/Dashboard 差异。现在两条路径各用自身项目配置，并显式比较完整 menuGroups/dashboardMetrics；修正桥接指标属性顺序以保持生成源码字节一致。现有三份原生投影与独立桥接的完整文件集比较通过（`tmp/mps-independent-options.log`），22 项桥接测试与类型检查通过；新增修改菜单/指标标签的负例确认文件集比较能检出变化。未修改 MPS aspect，因此未重复 Make。V3 未完成，原生业务扩面与外部服务验收仍待推进。

原生 Make 入口预检（2026-10-07）：新增 `bun run tools/check-mps.ts <model.mps> [...models.mps]`，只在内存生成目标文件以验证桥接、Database IR 与应用生成契约，不写应用产物。MPS smoke 在删除旧投影和启动 Make 前检查 Catalog/Relations/ERP 三个输入，非法配置不再等到 TextGen 输出后才被发现；刻意无效的 sandbox 诊断模型不在预检列表。CLI 回归验证索引维度非法、缺失文件、批量错误汇总和三个有效输入，类型检查通过；修改后的两阶段 MPS smoke、三个 Java 校验器与三条 marker/TextGen/桥接对比均通过，证据 `tmp/mps-preflight-check.log`。这属于构建入口保护，MPS IDE 直接 Make 的原生诊断仍需扩展，V3 未完成。

原生桥接配置丢失修复：此前 `Application.description/basePath` 与 `DatabaseConfig.provider/url` 虽在允许列表内，却未进入输出 IR，导致配置被静默忽略。当前 `.mps` 导出/生成入口明确拒绝这四个未实现的属性，错误只包含节点/属性，不回显连接 URL。21 项 MPS 桥接测试、150 个断言及类型检查通过，现有三类样例继续通过。连接仍采用生成包运行时 `DATABASE_URL`；自定义 basePath/driver 及描述元数据的完整 IR/TextGen 支持仍待实现。原生 TextGen 单独运行尚未增加同样诊断，不能将本次桥接修复等同所有入口完成；V3 仍未完成。

pgvector 能力边界已补齐当前 `Vector` 目标：按 [pgvector v0.8.0 官方说明](https://github.com/pgvector/pgvector/blob/v0.8.0/README.md)，普通 vector 列最多 16000 维，HNSW/IVFFlat 的 vector 索引最多 2000 维。Database IR 在生成前分别检查两种上限；不带近似索引的高维列仍允许生成，不会错误地统一限制为 2000。13 项数据库测试、53 个断言及类型检查通过，覆盖两类索引的边界与越界、16000 维存储上界。尚未支持 halfvec、量化或表达式索引降级，未执行实库扩展安装/迁移；不将编译期校验当作生产验收，V3 仍未完成。

数值 capability 校验补充：Database IR 对 Decimal/Money 限制 MySQL precision ≤ 65、scale ≤ 30，PostgreSQL 显式 precision ≤ 1000；精度、小数位和向量维度要求 JavaScript 安全整数。非 Decimal/Money 字段声明 precision/scale、非 Vector 字段声明 dimension 均在生成前拒绝，避免生成器静默忽略参数。12 项数据库测试及类型检查通过，包含合法上界和超界生成拒绝；未重复 ERP/MPS 验收。SQLite REAL 金额精度、pgvector 类型/索引维度上限和真实数据库迁移仍需独立处理，V3 未完成。

MySQL Drizzle 生成修复（2026-10-07）：审计与附件的 `createdAt` 原先使用 32 位 `int` 却写入 `Date.now()` 毫秒值，存在 2038 前后及当前范围溢出风险；现在改用 `bigint("createdAt", { mode: "number" })`，业务实体的 DateTime 仍使用 `datetime(..., { mode: "date" })`。数据库回归测试覆盖两个通用时间列、默认值语义、旧 `int` 形态不存在，10 项数据库测试及类型检查通过。真实 MySQL migration/事务仍受外部服务不可用阻断。

生成包同步边界补充（2026-10-07）：检查 `tools/generate-app.ts` 时发现旧 manifest 可通过 `../` 越界删除文件，生成目标中的目录链接也可将写入引向外部。本轮新增 `tools/generated-paths.ts`，在任何删除/写入前校验全部生成目标、manifest 文件与清理候选，拒绝绝对路径、父目录跳转、Windows 路径别名、符号链接/junction、非文件目标和非目录父路径；损坏 manifest 明确失败。隔离临时目录中的实际 Bun CLI 测试覆盖整批预检、外部文件保留、链接目录拒绝、正常旧文件清理和自定义文件保留，3 项测试/30 个断言及类型检查通过。该检查不是文件系统事务，不承诺抵御同时修改目录的其他进程；`--sync` 仍覆盖当前生成文件，且保留既有两条 legacy 路径清理规则，二次开发应使用扩展目录。未重复 MPS Make/ERP 构建。原生业务配置扩展仍是下一主线，V3 保持未完成。

最新桥接校验补充：`tools/mps-database-ir.ts` 现在拒绝重复/空节点 ID、未实现的 `<ref>` 节点引用，以及同一 Concept 内重复 property/child registry 索引或名称，避免导出时静默丢弃引用或覆盖字段语义。`tests/mps-database-ir.test.ts` 的 20 项测试及 `bun run check` 通过，涵盖本地/外部引用、节点冲突、registry 别名冲突和现有 Catalog/Relations/ERP 正向生成。此处只校验桥接输入，不声称解决 MPS 对所有非规范节点 ID 的编码归一化；当前关系仍使用显式实体/字段配置。未修改 MPS aspect 和应用模板，因此未重复 Make 或 ERP 构建。

`qiy.generator` 已加入真实 `CreateRootRule`，生成独立 `QiyGenerationMarker.java`，保留源模型根和 `.qiy` TextGen。`tests/mps-smoke.xml` 每次删除旧 marker 与三个 `.qiy`，先构建语言，再在独立 MPS 进程生成 sandbox，避免同进程重建语言后 generator 未进入 sandbox 生成计划。最新 smoke 为 `BUILD SUCCESSFUL`，Catalog、Relations、ERP workflow 均验证 marker 与投影并存，投影 IR 和生成文件集与外部桥接一致。日志仍有 constraints partial-model 与 classloading teardown 告警，未出现 `Failed to load model`。

最小 mapping 执行已验证，但 marker 仅是执行证据；业务序列化仍由 TextGen 完成，完整业务 generator 模板尚未实现。本轮根仓 `bun run check` 与 `bun test`（70 pass，0 fail）通过，没有重复 ERP 的未受影响验收。下一 P0 是扩展原生业务配置与有效性诊断；V3 保持未完成。证据：`tmp/mps-generator-check.log`、`tmp/v3-generator-root-tests.log`，测试契约：`tests/verify-mps-textgen.ts`。当前目录没有 Git 元数据，此次文档更新依据实际源码与执行日志。

## Elysia 官方能力取舍（2026-10-06）

2026-10-07 后续原生校验验收：修复 `qiy.constraints.mps` 过长节点 ID 在 MPS 持久化解析中的冲突；此前 Field/Index 生成类悄然丢失属性校验器，不能将原来的 Make 成功视为这些约束生效。三个约束现使用短且唯一的节点 ID，并将字符串引用比较改为 null 检查与值比较。`tests/MpsConstraintsSmoke.java` 直接调用生成的 Java 校验器，验证 `Field.type`、`Index.method`、`IndexColumn.fieldName` 拒绝 null、空串及独立分配的空串，接受非空值。`tests/mps-smoke.xml` 同时禁止 constraints partial-model 丢节点告警。两阶段 Make、三个校验器、三个 marker/投影及 IR/生成文件集对比全部通过（`tmp/mps-constraints-check.log`，`BUILD SUCCESSFUL`）；classloading teardown 告警仍存在。根仓类型检查与 70 项测试通过（`tmp/v3-constraints-root-tests.log`）；未重复 ERP 验收；V3 仍未完成。

| 官方能力 | 当前处理 | 后续边界 |
| --- | --- | --- |
| Bearer / Server Timing | DSL 与 MPS 可按需生成官方插件 | Bearer 仅提取 token，仍须 `jose` 验签、角色与数据授权；Timing 不应暴露敏感信息 |
| Cron | 仅允许 `cleanupMissingAttachments`，需显式 `QIY_CRON_ENABLED=1` | 多副本部署需独立 worker 或分布式锁 |
| JWT | `.qiy`/MPS 可显式启用 `@elysia/jwt`（默认 `QIY_JWT_SECRET`）；组合样例实测签发/验证与缺密钥拒绝启动；外部 OIDC/OAuth2/SSO 的 JWKS 验证仍使用 `jose` | 插件接入不等于自签 token/session 登录闭环，不能当外部 IdP 登录器 |
| GraphQL Yoga / Apollo | DSL 可选择 adapter；生成器已写入官方依赖、resolver adapter 与 `/graphql` 路由；两个独立 ERP Bun workspace 均通过 typecheck、44 项 API 测试，真实调用生成的 Refine GraphQL provider 完成 CRUD/batch-delete、distribution/trend 与工作流 REST 命令，并覆盖租户 claim、分页上限、禁用排序/筛选及 GET 页面拒绝 | GraphQL adapter 按 GraphQL 约定将 resolver 失败作为错误结果返回（Yoga 会屏蔽内部错误文案）；仍需统一 native/adapter 错误格式与日志，以及真实数据库/IdP 组合验收 |
| Static | 可显式生成官方 Static 独立资源前缀，异步注册后已实测公开文件可读、源码路径 404；限制目录为 `public` 下且禁止 `/api`、`/graphql`、`/assets` 前缀；SPA 仍由 Bun `createHandler` 处理 API 优先、history fallback 和路径约束 | 官方 Static 的默认语义与 history fallback 不等价，部署仍需验证缓存策略与反向代理路由 |
| HTML | 可显式注册 `@elysia/html`，默认仍是构建后的 React Router SPA | 仅服务端 HTML/SSR 目标才实际需要此插件 |
| Drizzle 集成 | 可显式把生成的 Drizzle `db` 注册到 Elysia context | 官方是集成模式，不是独立数据库插件；repository 仍显式使用 Drizzle |

官方参考：[插件目录](https://elysiajs.com/plugins/overview.html)、[Bearer](https://elysiajs.com/plugins/bearer.html)、[Cron](https://elysiajs.com/plugins/cron.html)、[JWT](https://elysiajs.com/plugins/jwt.html)、[Yoga](https://elysiajs.com/plugins/graphql-yoga.html)、[Apollo](https://elysiajs.com/plugins/graphql-apollo.html)、[Static](https://elysiajs.com/plugins/static.html)、[Server Timing](https://elysiajs.com/plugins/server-timing.html)、[HTML](https://elysiajs.com/plugins/html.html)、[Drizzle 集成](https://elysiajs.com/integrations/drizzle.html)。

这些集成按需组合，不作为默认模板的固定依赖。Qiy 只为经过版本、类型与安全验证的插件提供有类型的 DSL 配置；当前 DSL/MPS 覆盖上表列出的主要插件能力，尚不支持从任意 npm 包名动态安装/执行插件。Frontend `apiClient` 与 Elysia GraphQL adapter 是不同选择：前者每个项目只能选择一种 API transport，后者只影响服务端 GraphQL 实现。

MPS `AuthConfig` 现在能表达 provider、userEntity、subjectField、roleField，并经编辑器、TextGen、外部桥接器往返；回归测试验证无效 provider 和缺少 user entity 都会失败。MPS `ScopeConfig` 已在 Relations sandbox 实例化 `products.categoryId → tenant.categoryId`，TextGen 与外部桥接严格等价，直连生成包已通过 SQLite scoped CRUD、REST/GraphQL claim 测试。原生 sandbox 还没有含用户角色枚举的完整认证模型，也没有真实 IdP 验收，不等于认证闭环。S3 缺少 bucket 时 fail-closed，生成测试使用 local 替代真实对象存储；SQLite `Money` 映射 `REAL`，不保证精确小数。

本页以**已验证的生成结果**为准，不把 README 的远期目标当作已实现功能。截至 2026 年 10 月 12 日，V3 仍未完成生产验收。MPS 原生 Catalog 与双实体 Relations 数据库切片现已由 Make 动态输出 `.qiy`，并与外部 MPS 桥接的 Database IR 严格相等；Catalog 的 78 文件 Bun/Turborepo 已通过 typecheck、API 14/Web 7 tests、SPA build 和 Drizzle migration，迁移 SQL 包含 HNSW 与 B-tree 索引；最新 Relations 的 90 文件 Bun/Turborepo 已通过 typecheck、API 24/Web 7 tests（强制无缓存）、SPA build（强制无缓存）和 SQLite Drizzle migration，迁移 SQL 含 `ON DELETE set null` 外键。通用 Dataflow 和 ERP `orderInventory` 已分别在 PostgreSQL 16 与 MySQL 8.4/隔离 PostgreSQL 数据库完成真实迁移、事务与部分并发验收；ERP 仍未完成所有生产边界和真实身份组合验收。真实 IdP/S3、MPS 全业务配置与原生 generator 业务模板尚未完成，不能据此宣称 production-ready。

`sortable=false` / `filterable=false` 已从 Qiy 字段定义贯通 API 执行面：REST 拒绝非法列表参数，GraphQL resolver 与 Drizzle repository 使用字段 allowlist，scope 字段映射独立保留。专门的原生 GraphQL 回归测试使用有效 scope claim 后分别验证禁用排序与过滤；根仓本轮 `bun run check`、70 项测试通过。MPS TextGen 已 Make 刷新并通过投影校验；本轮修复 typesystem registry 重复声明后，Make 日志未再报告原先的 typesystem 模型加载错误；仍须继续覆盖原生 generator mapping。

Relations 变体还在隔离 SQLite 文件完成真实迁移，并经 `PRAGMA foreign_key_list(products)` 确认 `categoryId → categories.id` 的 `SET NULL` 外键。样例构建的服务端中间产物在 `ssr: false` 下被移除，最终托管 `build/client`。

新增的 Relations 压力样例现还覆盖双列 `@unique` 索引、字段级唯一约束与逻辑字段 `title` → 物理列 `product_title`。MPS Make 与外部桥接 IR 等价；从原生 `.qiy` 新生成的 86 文件 workspace 在 `tmp/v3-mps-rich-20261006/` 完成 typecheck、API 17/Web 7 tests、SPA build、Drizzle migration。隔离 SQLite 文件的 `PRAGMA table_info`/`index_info` 确认列名及索引列次序，仍不能替代 ERP 实库业务验收。

显式布尔三态改动后重新运行 MPS Make/IR 等价检查，生成的 Catalog/Relations 使用 `@id(true/false)`、`@nullable(true/false)`、`@unique(true/false)`、`@concurrently(false)`，而不是将 false 误认为未设置。较早的 Relations `.qiy` 在 `tmp/v3-mps-tristate-20261006/` 独立创建 86 文件包，已通过 typecheck、API 17/Web 7 tests、SPA build 和 SQLite migration；`PRAGMA index_list(products)` 显示预期的唯一与非唯一索引。随后加入 MPS 原生 `apiClient=graphql`、Elysia `bearer/serverTiming/cron` 配置；`.qiy` 与 `.mps` 两条入口插件文件一致。现又加入原生 GraphQL adapter、storage/S3 与 AuthConfig 结构；AuthConfig 仅通过模拟 registry 的桥接回归，尚未在 sandbox 中实例化。`PRAGMA table_info(products)` 确认新增 Money(10,0) 的列；SQLite 金额列目前映射 `REAL`，不具备十进制精确金额语义。

## 已落地

本轮插件组合验收：`examples/plugin-matrix/app.qiy` 显式声明 Bearer、Server Timing、HTML、Drizzle context、JWT、Static、Yoga、Cron，生成到 `tmp/v3-elysia-plugin-matrix/`。最新重生成包 workspace typecheck、API 28/Web 11 项测试和 React Router SPA build 通过；在隔离 SQLite 文件执行 Bun 迁移，并验证 `users`、`documents`、`attachments`、`audit_events` 与迁移历史表落盘。实测 JWT 签发/验证与缺密钥拒绝启动、Bearer 提取、Static 公开文件与源码 404；Static 的官方工厂必须先 `await` 再交给 Elysia `use`。生成器限制 Static 目录为 `public` 下、前缀不得与 API/GraphQL/SPA assets 重叠。生成测试 setup 按 SQLite/MySQL/PostgreSQL 方言选择默认数据库，仅在测试中注入固定 JWT secret；生产仍要求真实密钥。该组合测试不是 PostgreSQL/MySQL、IdP/S3 或部署验收。

同日 Apollo/Yoga 分别重新生成 132 文件 ERP 工作区，服务端 typecheck 与 40/40 API 测试通过；新增生成包测试直接通过 Refine GraphQL provider 请求 distribution/trend，与 REST 返回和 scope 传递比较，同时验证无效字段/天数及缺少 claim 时不触达 repository。本轮再次以同一 ERP DSL 分别生成 133 文件 Apollo/Yoga 工作区，各通过服务端 typecheck 与 44/44 API 测试；新增 REST 与 GraphQL Refine provider 在三种服务端实现下的工作流安全路径、权限和幂等键边界检查。Yoga 对预期的 GraphQL 验证/租户错误仍在测试日志打印堆栈，后续需统一安全错误格式与日志策略。MPS 官方样例的 `Application → Java` 根映射实验替换了原始根，导致现有 `.qiy` TextGen 消失；已撤销该映射并重新运行 MPS Make，Catalog/Relations/ERP workflow 三模型 TextGen 与桥接 IR 校验恢复成功。随后修复 `qiy.typesystem.mps` registry 中重复的 `NotExpression` 声明，本轮 MPS Make 日志不再出现该模型加载失败，并通过三模型校验。下一步原生 mapping 必须保留 DSL 输入根或使用独立产物阶段，不能以简单 root mapping 覆盖当前链路。

| 能力 | 证据 / 验收方式 |
| --- | --- |
| `.qiy` 受限文本模型、枚举和关系 IR | `examples/erpadmin/app.qiy`；支持 MPS 风格 Application 名称归一化及 `@column(...)` 物理列名，避免投影丢失包名/列映射；`bun test tests/qiy-project.test.ts tests/database-ir.test.ts` |
| PostgreSQL Drizzle schema、索引和外键迁移生成 | `examples/erpadmin/admin/apps/server/src/schema.ts`；`bun run db:generate` 输出 11 表（含 `audit_events`、`order_reservations`、`order_idempotency` 与 `attachments`）、10 个业务 FK；真实 PostgreSQL 连接验收仍未完成 |
| Bun + Elysia REST、GraphQL、OpenAPI 与 CORS | `/api/v1/*`、`/graphql`、`/api/v1/openapi/json`；OpenAPI 使用官方 `@elysia/openapi`，CORS 使用官方 `@elysia/cors` 且仅在 `.qiy`/环境显式提供来源白名单时启用；生成的 repository/service/routes 与 GraphQL resolver 共用 service；REST 与 GraphQL 分页均限制 page/pageSize 整数范围及每页最多 100 条 |
| Refine + Ant Design + React Router SPA | 默认资源菜单及 `.qiy` 自定义多级分组/图标、`dashboard` 计数、枚举分布与按 UTC 日趋势卡（Refine `useList`/`useCustom`，REST/GraphQL）、列表/详情/新建/编辑、枚举配色/图标 Tag 和 Select、关系 Select、详情页反向关系明细表（按外键过滤并复用带 scope 的列表 API）、隐藏字段、搜索/排序/多枚举过滤、权限化新建/编辑/删除/批量删除、可选每页 10/20/50/100 条、中英文切换；前端趋势测试覆盖两种 DataProvider |
| 可选前端传输 | `.qiy` 的 `api { client rest; }` 或 `api { client graphql; }`；服务端同时开放两种传输 |
| MPS 可选工作台与 Bun exporter | Catalog、Relations、ERP workflow 路径：MPS Make → Bun exporter → canonical `.qiy` → Bun workspace 已实跑。`tests/verify-mps-textgen.ts` 仅把 legacy TextGen 当既有结构子集 smoke；完整注释和后续语义以 exporter 输出重新解析结果为准。MPS 不再维护第二套 Refine/Elysia/Drizzle 业务生成器。仍非完整 ERP；真实 IdP、完整授权配置及更多 MPS 投影结构尚未完成。 |
| 数据库方言切片 | PostgreSQL/Bun SQL、SQLite/Bun SQLite、MySQL/MySQL2 的 schema、连接、repository 查询和 Drizzle migration 生成；SQLite 迁移走 `drizzle-orm/bun-sqlite/migrator`，不要求 Drizzle Kit 的 `better-sqlite3`/libsql 连接器，已对真实 SQLite 文件跑通；pgvector 非 PostgreSQL 会在生成前拒绝。ERP 示例的多仓订单状态机目前仅在 PostgreSQL 目标下生成，SQLite 变体不包含该业务工作流/预占表，须显式视为能力差异，不能仅凭 CRUD 测试宣称跨方言业务等价 |
| 关系删除策略 | `relation ... one @onDelete(restrict|cascade|setNull)` 三方言生成及可空校验；ERP 订单明细级联、库存产品限制删除，Drizzle 已生成 FK 变更迁移；多对多目前要求显式中间实体 |
| OIDC 与 Refine 权限切片 | `.qiy` 的 `auth` 配置；OIDC issuer/audience/JWKS 校验、外部 subject 映射、服务端角色守卫、Refine `AuthProvider` / `AccessControlProvider`，`CanAccess` 路由与操作控件、拒绝原因及隐藏未授权按钮；匿名请求与 viewer 写操作测试 |
| ERP 业务事务切片 | `.qiy` 显式声明 `workflow orderInventory;` 后才生成 `src/workflows/order.ts` 与 `allocation.ts`：提交时跨仓拆分预占、`order_reservations` 跟踪明细、取消按原库存行释放、审批后出库扣减、审计同事务；`order_idempotency` 持久化请求回执，分仓算法和生成包 API 单测通过。`tools/verify-postgres-erp.ts` 已在隔离 PostgreSQL 实库验证迁移、8 个同键并发提交、审批角色、出库扣减和审计；真实 IdP、跨副本故障恢复、全部取消/回滚边界仍未完成 |
| 三方言 CRUD 审计切片 | REST/GraphQL 写操作透传操作者 ID；PostgreSQL、SQLite、MySQL create/update/delete/batch delete 与 `audit_events` 在同一事务写入，记录资源、记录 ID、动作和更新字段；SQLite 内存数据库已验证审计失败导致新增回滚，PostgreSQL/MySQL 真实数据库回滚尚未验收 |
| 细粒度数据范围 | `.qiy` 支持 `scope <resource> <field> claim <claim>;`；REST、GraphQL 按资源解析 claim，列表/分布/详情/新增/更新/删除/批量删除均传递 scope，缺少 claim fail-closed；ERP 订单四条工作流也在事务读写中加入 scope，缺失 claim 返回 403；PostgreSQL、SQLite、MySQL repository 均生成 scope 条件；`examples/scoped-sqlite/` 已用真实 Bun SQLite 验证租户隔离和写入绑定。ERP PostgreSQL 实库已验证 customer scope 的正常路径，跨租户/缺失 claim 的完整 workflow 组合仍未完成 |
| 文件存储与 Attachment 元数据 | `.qiy` 的 `storage { provider local; }` 或 `s3`；`File` 支持 binary/base64/both、MIME 白名单、1–100 MiB 上限和单文件约束；生成 Refine 预检及 fail-closed 服务端策略、local 与 Bun S3-compatible Provider、路径校验、受保护上传/下载/删除、Attachment 元数据、owner 访问控制、重复 key 防护和 `attachments:cleanup`。ERP 干净生成包的 server 48 项测试实际覆盖未知字段、MIME/模式、大小、base64、重复 key、下载与删除；GraphQL multipart 和多文件类型尚未实现 |
| 可二次开发 Turborepo | `examples/erpadmin/admin/apps/{server,web}`，包含 `modules/`、`hooks/`、`plugins/`、`features/` 和部署文件 |
| 部署静态产物 | `ssr: false` 构建 `apps/web/build/client`，Elysia 同源静态托管与 SPA fallback；Docker/Compose/Nginx/K8s/Vercel 示例 |

## Elysia 插件采用策略

根据 [Elysia 插件目录](https://elysiajs.com/plugins/overview.html)，生成器同时评估官方插件和社区插件，但插件进入生成包前必须通过 Bun/Elysia 版本兼容、维护状态、类型体验、安全边界和生成样例测试；不把插件清单全部塞进默认模板：

- **已直接采用**：OpenAPI 使用官方 `@elysia/openapi`，替换旧命名的 `@elysiajs/openapi`；模板和 Catalog/ERP 生成样例已同步，保持 `/api/v1/openapi/json` 路径。
- **已条件启用**：CORS (`@elysia/cors`) 仅在 `.qiy` `api { cors { origin "https://..."; } }` 或 `QIY_CORS_ORIGINS` 明确给出精确来源白名单时启用；默认同源托管不放宽跨域。DSL 与运行时都拒绝 wildcard、路径和非 HTTP(S) Origin；生成配置关闭 credentials，并仅允许 REST/GraphQL 所需方法及 `Authorization`、`Content-Type`、`Idempotency-Key` 请求头。API 测试覆盖允许/拒绝来源和预检请求。
- **已实现的插件注册**：[Bearer](https://elysiajs.com/plugins/bearer.html)、[Server Timing](https://elysiajs.com/plugins/server-timing.html) 和 [Cron](https://elysiajs.com/plugins/cron.html) 可由 `.qiy` 按需生成。Bearer 只提取 token，不负责签名/权限；Cron 仅支持显式 `cleanupMissingAttachments` 任务，生成包测试通过官方插件 `trigger()` 验证调用与错误日志，隔离 SQLite 文件实跑确认缺失对象元数据被删除、现存对象记录保留。默认不调度，需 `QIY_CRON_ENABLED=1`、数据库元数据、迁移完成的 `DATABASE_URL` 与存储配置。
- **GraphQL adapter 状态**：[GraphQL Yoga](https://elysiajs.com/plugins/graphql-yoga.html) 与 [Apollo](https://elysiajs.com/plugins/graphql-apollo.html) 已可由 DSL 选择并生成官方依赖、`Query`/`Mutation` resolver adapter 和 `/graphql` 路由；两者均已完成生成包 typecheck、路由挂载、真实 Query 和匿名授权测试。仍需补齐 OIDC 身份/context、资源 scope、错误格式、分页上限、GraphiQL 暴露策略及 Refine DataProvider 契约的等价测试。
- **MPS 桥接**：`ElysiaConfig` 的 JWT、Static、HTML、Drizzle 布尔属性已有原生结构与 TextGen；外部桥接现按文本 DSL 的默认配置映射，并验证正向导出、生成依赖和非法布尔拒绝。自定义 JWT 名称/secret 环境变量及 Static 路径目前仍需文本 `.qiy` 配置，MPS 原生尚不能表达。
- **本轮回归（2026-10-06）**：Apollo/Yoga 分别独立生成并安装 Bun server 包，`graphql-adapter.test.ts` 与 `typecheck` 均通过；仓库 `bun run check`、`bun test`（63 pass）通过。MPS Make smoke 为 `BUILD SUCCESSFUL`，Catalog/Relations TextGen 与外部桥接 IR 等价；MPS 日志仍有 `qiy.typesystem.mps` 加载 AssertionError 和 constraints 局部模型告警，不能据此宣称 typesystem 健康。
- **ERP 工作流显式化（2026-10-06）**：`.qiy` 现需声明 `workflow orderInventory;` 才生成工作流 API、表和 Refine 操作；增加无声明不生成、重复/未知声明、SQLite 拒绝和 status enum/字段类型契约负例。`examples/erpadmin/admin/` 已从模型重生成 129 个文件；直接 server typecheck、34 API tests、web typecheck、17 Web tests、SPA build、Drizzle `db:generate`（no schema changes）以及根仓 `bun run check`、`bun test`（64 pass）均通过。
- **MPS workflow 桥接与插件 workspace 验收（2026-10-06）**：新增原生 PostgreSQL ERP workflow 样例，贯通 `WorkflowConfig` 的结构/editor/TextGen、外部桥接、`.qiy` serializer 和完整 workspace 生成；MPS smoke 对 workflow TextGen 与桥接 IR 做等价校验。生成 workflow workspace 已通过 typecheck、API/Web 测试和 SPA build。此样例仅覆盖订单/订单项/库存项 workflow 切片，不代表完整 ERP 的用户权限、菜单或 dashboard 都由 MPS 建模。
- **原生 MPS ERP 与字段可见性闭环（2026-10-06）**：在前一 ERP 配置切片上，新增 `Field.visible/listVisible/formVisible/showVisible` 结构、编辑器、TextGen 和外部桥接，显式 `false` 保留到 Refine resource metadata。MPS Make、原生 `.qiy`、bridge IR 与完整生成文件集等价；110 文件 Turborepo typecheck、API 25/Web 17 tests、SPA build 和 Drizzle Kit 8 表 migration generation 通过。真实 IdP 和 PostgreSQL 事务仍未验收。
- **MPS 字段呈现元数据闭环**：ERP workflow MPS 增加字段 `label`、`icon`、`sortable`、`filterable`，并通过结构、编辑器、TextGen 与 bridge 输出到 Refine resource metadata；MPS Make、`.qiy` 投影和桥接 IR 一致。重新生成的 110 文件 workspace 通过 typecheck、API 25/Web 17 tests 与 SPA build；根仓 `bun run check` 和 `bun test`（66 tests）通过。文本 ERP 示例也展示了枚举状态字段的图标、排序与筛选配置。
- **保留自有 SPA 与外部认证边界**：[Static](https://elysiajs.com/plugins/static.html) 可按需注册独立静态目录，但不替换受路径约束的 Bun SPA handler；对静态插件自身仍需回归目录穿越、防缓存和 404。[JWT](https://elysiajs.com/plugins/jwt.html) 可按需注册，默认不替代 `jose` 的 OIDC issuer/audience/JWKS 验签及 key rotation；尚未构成本地签发/会话功能。Bearer 仍只是 token 提取辅助，不替代认证授权。
- **Cron / Server Timing 边界**：Cron 使用 `unref` 与进程内 `protect`，单实例不会让计时器阻塞测试退出或在同一进程重入；失败记录日志，错误不会被静默吞掉。多副本没有分布式锁，部署默认关闭，只能在单个专用副本启用。官方插件触发测试与本地 SQLite 元数据清理已验收，多副本故障恢复和真实 S3 仍未验收。Server Timing 可按配置启用，不默认暴露内部阶段耗时。
- **Drizzle 集成**：[官方集成](https://elysiajs.com/integrations/drizzle.html)是数据库接入与 schema 复用模式参考，不是必须加入的 Elysia 插件；可显式注册生成的 `db`，但生成器继续显式生成 Drizzle schema、连接、repository 和迁移，避免额外抽象掩盖方言和事务语义。
- **HTML 插件**：[HTML](https://elysiajs.com/plugins/html.html) 适用于 Elysia 服务端动态返回 HTML/JSX；当前目标是 Refine/React Router 纯 SPA，不需要 SSR，因此默认不生成 `@elysia/html`，仅显式配置时加入依赖和注册。
- **优先评估的社区候选**：OAuth2 Resource Server 可与现有 OIDC/JWKS 校验实现做安全及 claim/scope 映射对照；Helmet、安全响应头、Rate Limit、Healthcheck、结构化 Logger、CSRF 和 Request ID 可作为 server 配置项候选。候选插件未经兼容性和回归验证前不改变现有生产路径，尤其认证、跨租户授权、限流分布式语义及 CSRF 策略不得仅凭插件名称视为已覆盖。
- **不纳入当前生成目标**：Nuxt/Remix/Vite SSR、文件系统路由及面向 Node/Deno 的 polyfill 集成，与当前 Refine SPA + Bun/Elysia API 边界不符；除非后续目标明确变化，否则不进入模板依赖。

## 尚未满足 V3 验收

### 本轮工程能力更新（2026-10-11）

- 文档站已具备 GitHub Pages 的 GitHub Actions 发布流程；VitePress 在 CI 中按仓库名设置 `base`，本地仍以 `/` 预览。首次发布仍需仓库管理员在 GitHub Pages 设置中选择 GitHub Actions。
- 文本 `.qiy` 支持安全的模块片段 `include "relative/path.qiy";`：支持递归展开与循环链诊断，拒绝绝对路径、`..` 穿越和越出项目根目录的链接；模块内容仍需遵循 V0 应用体声明顺序。`examples/modular-catalog/` 与专项测试覆盖此路径。
- 根目录 `deploy/` 现提供 Android 国内商店发布框架：`deploy/config.ts` 只保存 `env:NAME` 凭据引用与应用元数据，`deploy/index.ts` 可选择一个或多个目标并要求 `--confirm` 才提交。华为 AppGallery Connect 与小米应用商店适配器按官方自动发布契约生成请求；OPPO、vivo、腾讯应用宝、荣耀各自有独立适配器，通过已配置的企业 relay 对接权限化/合作伙伴 API，否则 fail-closed 并提示门户操作。发布前须以真实开发者资质、商店审核与 CI Secret 验收，不能把 dry-run 视为真实上架完成。

1. **身份与安全**：Local password、OTP、通用 OIDC/OAuth2/SSO 以及 Okta/Auth0/Azure AD B2C/Keycloak/Google/Kinde 已有 DSL、Refine 登录、服务端验证与本地生成包测试；外部 provider 使用 PKCE，OTP 使用签名 challenge 和可替换发送 adapter。PostgreSQL/MySQL 实库的管理员初始化与登录验收、跨租户关系推导、数据范围组合策略、真实 IdP tenant 和真实邮件/短信供应商仍未完成。生产 server 仍需真实数据库及相应认证环境变量，不能把本地 preview 公开。
2. **业务一致性**：`workflow orderInventory;` 显式启用订单提交/审批/出库/取消事务，多仓预占与按原库存行释放、状态条件、行锁、审计事件和持久化幂等回执；分配函数与生成包 API 已单测，并测试未声明时不生成、SQLite 明确拒绝。隔离 PostgreSQL 已通过迁移、同键并发提交、审批/出库和库存审计验收；完整端到端回滚矩阵、跨租户与真实身份组合仍未完成。
3. **模型能力**：文本 DSL 支持有限字段类型、单向 UUID FK；MPS 数据模型现也可声明并导出 `Relation`，删除级联策略已覆盖第一版。基于现有 FK 的详情页反向明细表已生成，但独立反向关系 API、隐式多对多、复杂约束、默认值、MSSQL/CockroachDB 和完整方言能力矩阵仍未完成。
4. **后台配置剩余项**：任意嵌套 AND/OR 条件树、保存的用户筛选视图、持久化用户字段布局、其他 UI 适配器、PostgreSQL/MySQL 趋势实库验收和完整分析 Dashboard 尚未完成。
5. **文件上传与平台集成剩余项**：单文件 File 已有 binary/base64、MIME 白名单、大小上限和数量校验；仍缺多文件 `Files` 类型、GraphQL multipart upload、浏览器直传/分片、对象存储孤儿扫描、GraphQL schema 文档门户、异步任务、生产部署验收和严格 Bun-only 子进程审计。S3/MinIO API smoke 已通过，但用户自己的生产 bucket 权限和拓扑仍需独立验收。Vercel 文件仍是静态站点与远程 API rewrite 草案。
6. **Realtime 与订阅**：REST/Ably 已生成 Refine `LiveProvider`、资源级 List/Show live mode、强制认证的 role-scoped subscribe-only token endpoint、事务性 durable Outbox、失败重试/死信、单条与批量重放、自动清理、管理员 JSON/Prometheus 指标、阈值健康告警与审计、机器可读运维 CLI，以及 Dataflow event。仍缺 GraphQL Subscription、平台告警规则/原生 OTLP、自定义 channel、页面/局部/全局 scope、subscription key、permission 表达式、租户 capability，以及真实 provider/browser 断线重连验收。发布继续发生在 mutation 成功提交之后，并在握手与 channel capability 上重复执行身份和访问控制。
7. **MPS 可选工作台**：Catalog、Relations 与 PostgreSQL ERP workflow 切片已有 MPS Make → Bun exporter → `.qiy` → Bun workspace 验收；workflow、AuthConfig、角色枚举、菜单、dashboard、字段级可见性和当前注释可由 exporter 保留。legacy TextGen 只覆盖旧结构 smoke，`qiy.generator` 只保留执行 marker；不再规划第二套 MPS 业务模板。完整 ERP 的更多 MPS 投影结构与真实 IdP 验收仍未完成。

## 下一阶段顺序

1. **P0：发布与集成地基**：先交付版本注入、manifest 元数据、`qiy doctor`、发布黑盒回归，以及 `standalone|integration` / web-only / host adapter 边界。此项优先于扩大新 DSL，确保现有系统能安全采用 Qiy 而不被第二套后端、认证或同步覆盖。
2. **P0：MPS 工作台导出对齐**：Catalog/Relations 数据库切片及 PostgreSQL ERP workflow 切片均已打通 MPS Make → Bun exporter → `.qiy` → Bun workspace；新增可建模语义只扩展 MPS structure/editor 与 Bun exporter，不再扩展 native TextGen 复制业务语义，也不得把三个模型的结构 smoke 误报为所有语言结构已覆盖。
3. **P1：治理、认证、上传与实时契约**：继续完善默认只读 integration、bearer/cookie/portal transport profile、base64/大小/MIME/数量上传约束，以及 GraphQL subscription/Ably 的 LiveProvider、事件发布、订阅 scope/identity/权限；继续统一 REST/GraphQL 适配错误格式和日志。现有 API/SSO 必须经 host adapter 显式接入。
4. **P1：Dataflow 与数据库闭环**：由 Dataflow IR 抽象当前 `orderInventory` 切片，先覆盖 typed input、context load、require/allow、事务写入、audit/emit、result 和生成测试模板；之后才增加 `*.test.qiy`。覆盖事务回滚、重复请求、审计失败、scope 与关联查询，且将算法/API 单测和 PostgreSQL 实库验收分开报告。
5. **P2：i18n、注释、查询与多方言**：继续业务错误翻译、通用模块 selector、完整 `@comment` 传播、读取查询 DSL、索引/pgvector/方言能力扩展；基础消息字典、`@message(s)` 选择性导入和 `#` 注释已完成。任何“查询可表达”能力都必须在权限和租户边界下验证。
6. **平台与外部服务验收**：PostgreSQL/MySQL 事务并发、真实 IdP/JWKS、S3、Docker/K8s、Bun-only 启动/构建审计、多副本限制与安全配置审计分别验收；不以本地 preview 或模拟服务替代生产验收。
7. **V3 发布门槛**：公开 `.qiy` 编译链路稳定生成，MPS 工作台能导出与其语义一致的 `.qiy`；独立与 integration 两种生成包分别通过 typecheck/test/build；ERP Dataflow 通过实库事务验收；真实认证/存储目标清晰记录验收或限制。未满足时保持 V3 未完成。

## 目前可执行的验收

```powershell
bun run check
bun test
cd examples/erpadmin/admin
bun install
bun run typecheck
bun run test
bun run build
bun run db:generate
bun run preview
```

以上生成包命令在 2026-10-06 已串行以 `--force` 绕过 Turborepo 缓存复验；Drizzle Kit 检测到 schema 与现有迁移一致（no schema changes）。并行强制启动 typecheck/build 曾触发子进程异常，拆成串行后均通过，因此验收采用串行执行。

SQLite ERP 变体的实际迁移验收目录为 `tmp/v3-erp-sqlite-20261006/`；它是临时证据，不是正式示例或跨方言 workflow 的支持声明。SQLite 迁移命令由生成器设为 Bun 原生执行，验证时在独立 `DATABASE_URL` 文件中创建了迁移历史表及 9 张业务表。

租户隔离样例：

```powershell
bun run tools/generate-app.ts examples/scoped-sqlite/app.qiy examples/scoped-sqlite/admin --sync
bun run --cwd examples/scoped-sqlite/admin typecheck
bun run --cwd examples/scoped-sqlite/admin test
```

打开 `http://127.0.0.1:3000/orders`。预览只绑定 `127.0.0.1`，使用内存仓库并关闭数据库工作流；数据库 server 需要 `DATABASE_URL`，启用 OIDC 的生成包还需要 `QIY_OIDC_ISSUER`、`QIY_OIDC_AUDIENCE`、`QIY_OIDC_JWKS_URL`。不要把通过上述命令解读为 V3 已完成。

