# Realtime

`realtime` 为生成的 Refine 资源声明实时订阅。传输由 `api.client` 推导：`rest` 用 Ably，`graphql` 另外生成 SSE 的 GraphQL Subscription（两者可以同时存在）。Realtime 必须同时声明生成式 `auth`，因为 token、死信、指标、重放和清理端点都必须重新认证并执行角色授权；未声明认证的模型会在生成前失败。

```qiy [examples/realtime/app.qiy]
qiy v0;
application operations-admin {
  database sqlite {}
  api { client rest; }

  realtime {
    mode auto;
    resource orders {
      events created, updated, deleted;
      roles admin, operator, viewer;
    }
  }

  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }

  enum userRole {
    value admin;
    value operator;
    value viewer;
  }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
    field role userRole;
  }

  entity orders {
    field id UUID @id;
    field number Text @unique;
  }
}
```

## 配置

- `mode auto`：Refine 收到相关事件后自动刷新 `useTable` / `useOne` 查询。
- `mode manual`：事件交给 Refine 的 `onLiveEvent`，页面自行决定如何响应。
- `resource` 使用实体名或物理资源名；生成前会归一化并拒绝未知或重复资源。
- `events` 当前只接受 `created`、`updated`、`deleted`，必须至少声明一个且不能重复。
- `roles` 当前只接受 `admin`、`operator`、`viewer`。服务端签发的 Ably capability 只有被允许 channel 的 `subscribe` 权限，不向浏览器授予 publish 权限。
- `auth` 为必需配置。Realtime 不会生成匿名 token 服务，也不会依赖默认的空认证器；本地登录、OIDC/OAuth2/SSO 或受支持的企业身份 provider 均可作为认证来源。
- `when <field> claim <claim>`（可选）：把资源切成**按 claim 分段**的 channel（`qiy:<table>:<value>`）。订阅者只拿到自己 claim 对应那一段的 capability；缺失 claim 时**不授予任何 channel**（token 端点 403）。字段必须是实体上的非空 `Text`/`Integer`，且不能与 `restrict` 的行谓词同时声明（行谓词已经由分段隔离取代）。

```ts
realtime {
  mode auto;
  resource orders {
    events created, updated;
    roles admin, operator;
    when tenantId claim tenant;
  }
}
```

分段 channel 的工作方式：

| 位置 | 行为 |
| --- | --- |
| 入队 | Outbox 行的 `channel` 直接写成 `qiy:orders:<record.tenantId>`，因此投递（含多副本尾随）只会发到该段 |
| capability | `realtimeCapabilities(principal)` 只为该 principal 的 claim 值签发 `qiy:orders:<value>`；claim 缺失则一条都不签发 |
| GraphQL Subscription | 订阅根从 capability 里解析实际授予的 channel，非本段事件不会进入流 |
| Web（Ably） | LiveProvider 从 token 的 `capability` 解析实际授予的 channel 后再订阅，而不是假设基础资源名 |
| 脱敏 | 与普通资源一致：mask 字段在入队时就被裁掉 |

## 生成结果

REST 模式生成：

- Refine `LiveProvider`，直接使用 Ably JavaScript SDK 2.x；
- List/Show hook 的资源级 `liveMode`；
- `POST /api/v1/realtime/token`，重复执行 Qiy 身份认证并签发 role-scoped、subscribe-only TokenRequest；
- CRUD repository 在业务写入和审计记录的同一个 Drizzle 事务中写入 `qiy_realtime_outbox`，提交后由 service 立即触发投递；
- Server 启动后台 worker，按照 `QIY_REALTIME_POLL_MS` 扫描未投递记录；PostgreSQL/MySQL worker 使用数据库事务、lease 和 `FOR UPDATE SKIP LOCKED` 原子领取，失败记录释放租约并按指数退避重试；
- 达到 `QIY_REALTIME_MAX_ATTEMPTS` 后写入 `deadLetteredAt` 并停止自动领取；只有 `admin` 可以通过受保护的 Outbox API 查看并重放；
- `GET /api/v1/realtime/outbox/dead` 列出最近 100 条死信，`GET /api/v1/realtime/outbox/metrics` 返回 JSON 指标，`GET /api/v1/realtime/outbox/metrics/prometheus` 输出 Prometheus 0.0.4 文本，`GET /api/v1/realtime/outbox/health` 按阈值返回 `200 ok` 或 `503 degraded`；`POST /api/v1/realtime/outbox/:id/replay` 重放单条，`POST /api/v1/realtime/outbox/replay` 接受 1–100 个唯一 UUID 并返回 `replayed/notFound`；`DELETE /api/v1/realtime/outbox/delivered?retentionDays=N` 清理已投递历史；这些运维端点只允许 `admin`；
- 单条重放、批量重放和手动清理会以当前管理员为 actor 写入 `audit_events`，动作分别是 `realtime.outbox.replayed`、`realtime.outbox.bulk_replayed` 和 `realtime.outbox.cleaned`。Outbox 修改与审计写入处于同一数据库事务；审计失败时运维操作也回滚。后台自动清理没有交互式管理员，不写管理员审计；
- Dataflow `emit "order.approved"` 同时写入业务 `dataflow_outbox` 和实时 `qiy:event:order.approved` channel，二者与业务修改一起提交或回滚；
- Dataflow 的 `allow roles` 会转换为对应业务事件 channel 的 subscribe-only capability；
- Server 环境变量 `QIY_ABLY_API_KEY`、`QIY_REALTIME_POLL_MS`、`QIY_REALTIME_LEASE_MS`、`QIY_REALTIME_MAX_ATTEMPTS`、`QIY_REALTIME_RETENTION_DAYS`、`QIY_REALTIME_CLEANUP_MS`、三个 `QIY_REALTIME_ALERT_*` 阈值和测试专用 `QIY_REALTIME_DISABLED`。Worker 启动时执行一次清理，之后按独立维护周期清理 delivered 历史，不会在每次投递轮询时扫描历史表。
- `bun run realtime:admin -- <command>` 运维客户端。它只调用上述受保护 HTTP API，不直连数据库、不绕过角色检查或审计；`QIY_REALTIME_ADMIN_TOKEN` 必须是管理员 access token，`QIY_REALTIME_ADMIN_URL` 默认为当前 Server 的 `/api/v1/realtime/outbox`。

`QIY_ABLY_API_KEY` 只能配置在 Server 环境或 secret manager，不能使用 `VITE_` 前缀，也不能写入 `.qiy`。浏览器只取得短期、受 capability 限制的 TokenRequest。

## 运维 CLI

在生成的 Server package 中设置管理员 access token，然后执行：

```powershell [apps/server]
$env:QIY_REALTIME_ADMIN_TOKEN = "<admin-access-token>"
bun run realtime:admin -- metrics
bun run realtime:admin -- health
bun run realtime:admin -- prometheus
bun run realtime:admin -- dead
bun run realtime:admin -- replay 00000000-0000-4000-8000-000000000001
bun run realtime:admin -- cleanup 30
```

除 `prometheus` 原样输出文本外，其余命令输出单行 JSON，适合脚本、CI 或运维平台解析。`replay` 接受 1–100 个唯一 UUID；`cleanup` 的可选保留天数范围为 1–3650。远程 Server 通过 `QIY_REALTIME_ADMIN_URL=https://admin.example.com/api/v1/realtime/outbox` 指定。不要把 token 写入 `.qiy`、提交到仓库或传给浏览器；CLI 请求在服务端重新验证管理员角色，重放与清理仍以 token 对应的 principal 作为审计 actor。

默认告警阈值为 pending `1000`、dead-lettered `0`、最老 pending 年龄 `300000ms`。分别使用 `QIY_REALTIME_ALERT_MAX_PENDING`、`QIY_REALTIME_ALERT_MAX_DEAD_LETTERED` 和 `QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS` 调整。Prometheus 指标不包含用户、tenant、channel 或事件 ID 标签，避免高基数；可由 Prometheus 直接抓取，也可由 OpenTelemetry Collector 的 Prometheus receiver 接入。抓取请求可以携带管理员 Bearer token，或单独配置的只读 `QIY_REALTIME_METRICS_TOKEN`。只读 token 仅允许 Prometheus 文本端点，不能访问 JSON 指标、健康、死信、重放、清理或 Ably token 端点；默认留空，轮换后需重启 Server 并等待抓取端重新加载凭据。

## Prometheus Operator 与 Grafana

声明 Realtime 的独立项目额外生成 `deploy/kubernetes/realtime-servicemonitor.yaml`、`deploy/kubernetes/realtime-prometheusrule.yaml` 和 `deploy/observability/grafana/qiy-realtime-outbox.json`。ServiceMonitor 使用 Service 的 `http` 端口，在同一 namespace 从应用 Secret 的 `QIY_REALTIME_METRICS_TOKEN` key 读取 Bearer 凭据；Deployment 从同一 Secret 注入该变量和 `QIY_ABLY_API_KEY`。替换 Secret 示例占位值后再部署。

集群必须安装 Prometheus Operator CRD，并配置 Prometheus 的 ServiceMonitor/Rule selector 选中生成对象的 `app` label 和 namespace。告警覆盖持续 5 分钟的健康降级、持续 1 分钟的死信，以及持续 10 分钟的指标缺失；告警表达式按应用 `service` label 限定。通知接收人和 Alertmanager 路由由部署者配置。Grafana 导入 JSON 时选择 Prometheus datasource；当前面板展示该 datasource 中的 Qiy Outbox 指标。监控端点应通过私有网络访问，跨可信网络边界时使用 TLS。

## 可重复验收

仓库中的 `examples/realtime/app.qiy` 同时包含本地登录、角色模型和 Realtime 资源。可以用公开 CLI 链路生成并验证完整工作区：

```powershell [PowerShell]
qiy create -f examples/realtime/app.qiy -n realtime-admin -o out/realtime-admin
bun install --cwd out/realtime-admin
bun run --cwd out/realtime-admin typecheck
bun run --cwd out/realtime-admin test
bun run --cwd out/realtime-admin build
```

生成的 Server 测试会强制设置 `QIY_REALTIME_DISABLED=1`，不会依赖开发环境 `.env` 的默认值，也不会把本地测试误认为真实 Ably 验收。Realtime 专项测试再显式开启该开关，并验证允许角色、匿名 `401`、无 channel 权限角色 `403`、subscribe-only capability、失败退避、重试、并发 worker 单次领取、死信阈值和管理员运维权限。SQLite 生成包还会真实删除 Outbox 表制造插入失败，证明 CRUD、审计与 Outbox 同成同败；Dataflow 测试验证业务事件成功入队，并在后续业务规则失败时随事务回滚。仓库的 PostgreSQL/MySQL 容器验收会在真实迁移后启动两个 worker 竞争同一行，并实际执行死信、重放及 delivered 清理。

## 投递存储的真实数据库验收

生成的 Server 测试注入的是内存假 store，因此**真实数据库 store**（租约列、`SKIP LOCKED` 领取、退避、死信、重放、清理）由源码仓库的工具单独验收：

```sh
bun tools/verify-realtime-outbox.ts sqlite
bun tools/verify-realtime-outbox.ts postgresql <容器名>
bun tools/verify-realtime-outbox.ts mysql <容器名>
```

它生成带 Realtime 的应用、迁移到真实数据库，然后用假 Ably client 驱动真实 `databaseOutboxStore`，逐项断言：单次投递并清空租约；已投递不再重投；**worker 崩溃后租约到期可被重新领取**而有效租约不被抢占；失败退避期内不再领取、到期后成功；达到 `QIY_REALTIME_MAX_ATTEMPTS` 进入死信并被 `deadLetters` 列出；重放重置计数、清空死信并写入审计；清理只删除超过 `QIY_REALTIME_RETENTION_DAYS` 的已投递历史；PostgreSQL/MySQL 上**两个 worker 并发只投递一次**（SQLite 定位为单进程，不断言并发）。

MySQL 需要 `datetime(3)`（毫秒精度）：`datetime` 不带小数秒时 MySQL 会**四舍五入**，刚入队的 `availableAt` 可能被推到未来，worker 会跳过该行。生成的 MySQL schema 现已统一使用 `fsp: 3`；已有 MySQL 项目需要重新生成并执行 migration 才能获得毫秒精度。

## GraphQL Subscription

`api { client graphql; }` 与 `realtime` 同时启用时，生成的 GraphQL schema 会增加订阅根：

```graphql
type OrdersEvent { event: String! record: Orders! }
type Subscription { ordersChanged: OrdersEvent! }
```

订阅通过 **Server-Sent Events** 传输（`GET /api/v1/graphql/subscribe?query=...`），每个 GraphQL 结果是一帧 `data: {...}`：

- **鉴权与授权**：匿名 401；角色不在该资源的 `events`/`roles` 里返回 403（复用 Ably token 的同一套 capability 计算）。
- **错误映射**：未知订阅字段、非订阅文档、语法错误都返回 400；客户端中止（abort）会关闭迭代器并清理订阅。
- **脱敏**：事件负载来自 Outbox，已经过 `qiyRealtimePayload` 裁剪，因此被 mask 的字段在服务端负载里**没有键**；GraphQL 只能对客户端显式请求的字段返回 `null`（GraphQL 不能删除被请求的字段），值不会泄漏。
- **行谓词**：与 REST 一致——带 `restrict` 行谓词的资源不允许开启 realtime，生成期即报错。

实现要点：`api/src/realtime-bus.ts` 提供进程内总线与 `realtimeEventIterator()`；`dispatchRealtimeOutbox` 在 `delivered` 之后把**已投递、已脱敏**的负载发布到总线；订阅根是惰性 getter，因此普通查询不会触发订阅。

客户端使用生成的 `web/app/subscriptions.ts`：

```ts
const stop = subscribeGraphql({
  query: "subscription { ordersChanged { event record { id title } } }",
  onData: (data) => console.log(data),
  onError: (error) => console.warn(error.message),
});
// 取消订阅
stop();
```

它带 Bearer token 请求 SSE 端点、按 `\n\n` 分帧（能处理跨 chunk 拆分的帧）、把 `errors` 交给 `onError`、把 HTTP 4xx 的 `error` 也交给 `onError`，并在 `stop()` 时 abort 请求、取消 reader 且不再回调。

当前边界：订阅事件源是**总线 + Outbox 尾随**——`realtimeChannelIterator()` 先从进程内总线取本实例刚投递的事件（低延迟），再按 `QIY_REALTIME_SUBSCRIBE_POLL_MS`（默认 1000ms，最小 100ms）尾随 `deliveredAt` 已写入的 Outbox 行，因此**多副本部署时任意实例投递的事件都能被订阅者收到**（按 Outbox 行 id 去重）。仍未做：`graphql-ws` WebSocket 传输、订阅级 filter 参数、基于 claim/租户的订阅表达式；尾随读取会给数据库带来与订阅数量成正比的轮询压力，超大订阅规模建议改用专用消息中间件。

## 记录级订阅（页面级裁剪）
详情页（`useOne`）与批量页（`useMany`）只关心特定记录，因此生成的 LiveProvider 会按请求参数裁剪事件：`subscribe({ params: { id } })` 或 `params: { ids: [...] }` 时，只有 payload 的 `id`（或 `data.id`）命中才回调；列表页不带这些参数，仍然收到该资源的全部事件。这样"页面级订阅"在客户端就生效，不会把整资源的更新都灌进单条记录页面。

`createQiyLiveProvider(fetcher, injected?)` 的第二个参数用于注入 Ably 客户端，生成测试据此断言裁剪行为（命中/不命中、嵌套 `data.id`、无 id 事件、unsubscribe 代理）。

## 权限数据范围与事件负载

一个 Realtime channel（`qiy:<table>`）被同一资源的所有订阅者共享，服务端**无法按订阅者裁剪单条事件**。因此生成器在两侧都做约束：

- **字段脱敏**：入队前按"可订阅角色"裁剪负载。任何对 `realtime` 中声明的可订阅角色生效的 `mask` 字段（含无 `roles` 的全局 mask、以及带 `claim present/absent` 的 mask）都会从 `created`/`updated`/`deleted` 负载中删除；只对**不能订阅**的角色生效的 mask 不会误伤负载。裁剪发生在写事务内的 Outbox 插入处，批量删除同样适用。
- **行级谓词**：`restrict` 的 `when ...` 行谓词**无法**在共享 channel 上生效，因此带行谓词的资源**不能开启 Realtime**，生成阶段直接报错（`restrict row predicates cannot be enforced on a shared channel`），而不是把订阅者无权读取的行推给所有订阅者。需要实时且需要行级隔离时，请把隔离维度并入独立资源或改用轮询式拉取。
- 角色层面仍由 Ably token 的 channel capability 限制为 subscribe-only；未授权角色拿到 token 也无法订阅。

## 当前边界

- 当前实现是**多实例 at-least-once**：PostgreSQL/MySQL 使用带过期时间的租约与 `SKIP LOCKED` 避免正常并发扫描重复领取；SQLite 仍定位为单进程开发/轻量部署。
- provider 已成功但数据库尚未标记 delivered 时进程崩溃，或 publish 超过 `QIY_REALTIME_LEASE_MS` 后被另一 worker 重新领取，仍可能重复投递。消费者必须幂等，Qiy 不宣称 exactly-once。
- `QIY_REALTIME_LEASE_MS` 默认 `30000`，必须大于正常 provider publish 延迟；修改 Outbox Schema 后，已有生成项目必须生成并执行数据库 migration，不能只替换运行时代码。
- `QIY_REALTIME_MAX_ATTEMPTS` 默认 `10`，`QIY_REALTIME_RETENTION_DAYS` 默认 `7`，`QIY_REALTIME_CLEANUP_MS` 默认 `86400000`（24 小时，最小 60 秒）。当前提供受保护的 HTTP 运维 API、机器可读运维 CLI、单条/批量死信重放、事务性管理员审计、JSON/Prometheus 指标、阈值健康告警、自动历史清理及 Prometheus Operator/Grafana 文件；尚无云监控专属适配器或原生 OTLP exporter，集群安装和 Grafana 实际导入仍需环境验收。
- 尚未实现 GraphQL Subscription、页面自定义 channel、record/global scope、permission 表达式和租户 capability 细分。
- 事件负载只做**字段级**裁剪，不做行级裁剪；行级隔离通过"禁止对带行谓词的资源开启 Realtime"实现，见上文。
- 真实 Ably tenant、浏览器断线重连、跨租户拒绝和多副本部署仍需环境级验收；投递 store 本身已由 `tools/verify-realtime-outbox.ts` 在真实数据库上验收。
