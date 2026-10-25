# realtime（实时订阅）

`realtime` 把生成的 Refine 资源声明为可实时订阅：收到 `created`/`updated`/`deleted` 事件后自动刷新相关查询（`mode auto`）或把事件交给页面自定义处理（`mode manual`）。**当前生成器只为详情页（show）传入 `liveMode`**；列表页由生成的 `routes/list.tsx` 覆盖，使用 `useTable` 时没有 `liveMode`，因此默认不会因 realtime 自动刷新——需要时在自定义列表页给 `useTable` 显式传 `liveMode`（`manual`/`auto`）。传输由 `api.client` 推导：

| `api.client` | 传输 | 生成物 |
| --- | --- | --- |
| `rest` | **Ably**（订阅 `qiy:<table>[:<claimValue>]`，命令事件 `qiy:event:<event>`） | `web/app/live-provider` 逻辑（`createQiyLiveProvider`）、`POST /api/v1/realtime/token`、outbox worker |
| `graphql` | Ably **+** GraphQL Subscription over **SSE**（`GET /api/v1/graphql/subscribe`） | 追加订阅根与 `web/app/subscriptions.ts` |

`realtime` 必须同时声明生成式 `auth`：token、死信、指标、重放、清理端点都要重新认证并执行角色授权，未声明认证的模型在生成前失败；`mode integration` 也不允许生成独立 realtime（改用宿主 LiveProvider adapter）。

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
    resource stock_movements {
      events created;
      roles admin, operator;
      when warehouseCode claim warehouse.code;   // 按 claim 分段通道（字段须 Text/Integer）
    }
  }

  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }

  enum userRole { value admin; value operator; value viewer; }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
    field role userRole;
    field orgId UUID @nullable;
  }

  entity orders {
    field id UUID @id;
    field number Text @unique;
  }

  entity stock_movements {
    field id UUID @id;
    field warehouseCode Text;
    field quantity Integer;
  }
}
```

## 语法

```text
realtime "{" [ "mode" ( "auto" | "manual" ) ";" ]
  ( "resource" <entity> "{"
      "events" ( "created" | "updated" | "deleted" ) ( "," … )* ";"
      "roles" role ( "," role )* ";"
      [ "when" <field> "claim" <claim> ";" ]
    "}" )+
"}"
```

| 元素 | 必填 | 默认 | 校验 |
| --- | --- | --- | --- |
| `mode` | 否 | `auto` | 只有 `auto`/`manual`；重复或未知报 `Unsupported realtime mode` |
| `resource <r>` | 是（≥1） | — | 实体名或表名；生成前归一化为表名；未知报 `Realtime: unknown resource`，重复报 `Duplicate realtime resource` |
| `events` | 是 | — | 至少一个，且不重复；只接受 `created`/`updated`/`deleted` |
| `roles` | 是 | — | 至少一个，且不重复；只接受 `admin`/`operator`/`viewer`；决定谁能拿到该资源的 subscribe capability |
| `when <field> claim <claim>` | 否 | 无 | 字段必须存在、**非空**、类型 `Text`/`Integer`；claim 允许点号 |
| 整个块 | — | — | 至少一个 `resource`；无 `auth` → `Realtime requires generated authentication`；`mode integration` → 拒绝 |

## `mode auto` 与 `manual`

| 模式 | 客户端行为 |
| --- | --- |
| `auto` | 生成的 LiveProvider 收到事件后让 Refine 自动刷新相关 `useTable`/`useOne`/`useMany` 查询（详情页按 `id`、批量页按 `ids` 裁剪；列表页需页面显式传 `liveMode`，生成器目前未为列表页启用） |
| `manual` | 只把事件交给 Refine 的 `onLiveEvent`，页面自行决定如何响应（适合「先提示再刷新」或局部更新） |

记录级裁剪：`subscribe({ params: { id } })` / `params: { ids: [...] }` 时只有 `payload.id`（或 `data.id`）命中才回调；没有这些参数时仍收到该资源全部事件。生成的 show 页会按记录 id 订阅，list 页默认不订阅。

## 权限模型

一个 channel（`qiy:<table>`）被同一资源的所有订阅者共享，服务端**无法按订阅者裁剪单条事件**。因此生成器在两侧同时约束：

| 约束 | 机制 |
| --- | --- |
| 谁能订阅 | `roles` → Ably TokenRequest 的 **subscribe-only** capability；浏览器永远没有 publish 权限 |
| 订阅哪些 channel | capability 由服务端 `realtimeCapabilities(principal)` 计算；客户端从 token 的 `capability` 解析实际授予的 channel 再订阅（不假设基础资源名） |
| 字段脱敏 | 入队前按「可订阅角色」裁剪 payload：任何对该资源可订阅角色生效的 `mask`（含全局 mask 与 `claim present/absent` mask）都会从事件里删掉；只对不能订阅角色生效的 mask 不误伤 |
| 行级隔离 | **共享 channel 做不到**，因此带 `restrict` 行谓词（`when`）的资源**禁止**开启 realtime：`restrict row predicates cannot be enforced on a shared channel` |
| 租户分段 | 用 `when <field> claim <claim>` 把资源切成 `qiy:<table>:<value>`；claim 缺失时**不签发任何 channel**（`/token` 403） |

::: warning 行谓词 vs 分段通道
`restrict { when … }` 与 `when <field> claim <claim>` 是两种隔离手段，不能同时用于同一资源：分段通道已经完成行级隔离，生成期会报 `a claim-scoped channel already isolates rows; remove the restrict row predicates`。只有 `roles`/`mask`（没有 `when`）的 `restrict` 可以和 realtime 共存。
:::

## 生成结果

REST 模式：

- Refine `LiveProvider`（Ably JavaScript SDK 2.x），List/Show hook 的资源级 `liveMode`；
- `POST /api/v1/realtime/token`：重复执行 Qiy 身份认证，签发 role-scoped、subscribe-only TokenRequest；
- CRUD repository 在**业务写入与审计的同一个 Drizzle 事务**里写 `qiy_realtime_outbox`，提交后由 service 立即触发一次投递；
- 服务端后台 worker 按 `QIY_REALTIME_POLL_MS` 扫描未投递行；PostgreSQL/MySQL 用事务 + lease + `FOR UPDATE SKIP LOCKED` 原子领取，失败释放租约并按指数退避重试；
- 达到 `QIY_REALTIME_MAX_ATTEMPTS` 后写 `deadLetteredAt` 并停止自动领取，只有 `admin` 能通过受保护 API 查看/重放；
- Dataflow `emit` 同时写业务 `dataflow_outbox` 与实时 channel `qiy:event:<event>`，与业务写入同生共死；dataflow 的 `allow roles` 会转成对应事件 channel 的 subscribe-only capability；
- 字段脱敏在**入队时**完成（批量删除同样适用）。

运维端点（全部要求 `admin`，除 Prometheus 文本端点可用只读 token）：

| 端点 | 说明 |
| --- | --- |
| `GET /api/v1/realtime/outbox/dead` | 最近 100 条死信 |
| `GET /api/v1/realtime/outbox/metrics` | JSON 指标 |
| `GET /api/v1/realtime/outbox/metrics/prometheus` | Prometheus 0.0.4 文本 |
| `GET /api/v1/realtime/outbox/health` | 按阈值返回 `200 ok` / `503 degraded` |
| `POST /api/v1/realtime/outbox/:id/replay` | 重放单条死信 |
| `POST /api/v1/realtime/outbox/replay` | 批量重放 1–100 个唯一 UUID，返回 `{ replayed, notFound }` |
| `DELETE /api/v1/realtime/outbox/delivered?retentionDays=N` | 清理已投递历史 |

- 重放与手动清理以当前管理员为 actor 写 `audit_events`（`realtime.outbox.replayed`、`realtime.outbox.bulk_replayed`、`realtime.outbox.cleaned`），Outbox 修改与审计同事务；审计失败则操作回滚。后台自动清理没有交互式管理员，不写审计。
- `QIY_REALTIME_DISABLED=1` 时 worker 不投递、`/token` 返回 503，生成测试用它避免依赖真实 Ably。

## GraphQL Subscription（SSE）

`api { client graphql; }` + `realtime` 时追加订阅根：

```graphql
type OrdersEvent { event: String! record: Orders! }
type Subscription { ordersChanged: OrdersEvent! }
```

- 传输：**Server-Sent Events**，`GET /api/v1/graphql/subscribe?query=...`，每帧 `data: {...}`。
- 鉴权：匿名 401；角色不在该资源 `roles` → 403（复用 Ably 的 capability 计算）；未知订阅字段/非订阅文档/语法错误 400；客户端 abort 关闭迭代器并清理订阅。
- 脱敏：负载来自 outbox（已裁剪），被 mask 的字段**没有键**；GraphQL 只能对客户端显式请求的字段返回 `null`，不会泄漏值。
- 事件源：进程内总线（本实例刚投递的事件）+ 按 `QIY_REALTIME_SUBSCRIBE_POLL_MS`（默认 1000，最小 100）尾随 `deliveredAt` 已写入的 outbox 行，因此**多副本时任意实例投递的事件都能被订阅者收到**（按行 id 去重）。

客户端：

```ts
const stop = subscribeGraphql({
  query: "subscription { ordersChanged { event record { id number } } }",
  onData: (data) => console.log(data),
  onError: (error) => console.warn(error.message),
});
stop();
```

## 环境变量

| 变量 | 默认 | 校验/说明 |
| --- | --- | --- |
| `QIY_ABLY_API_KEY` | 空 | 启用 realtime 时必需；**只放服务端**，浏览器只拿短期 TokenRequest |
| `QIY_REALTIME_DISABLED` | `0` | `1` 时 worker 不投递、`/token` 503（测试与灰度用） |
| `QIY_REALTIME_POLL_MS` | `5000` | 投递轮询间隔，最小 250 |
| `QIY_REALTIME_LEASE_MS` | `30000` | 领取租约，最小 1000；必须大于正常 publish 延迟 |
| `QIY_REALTIME_MAX_ATTEMPTS` | `10` | 1–1000；超过进入死信 |
| `QIY_REALTIME_RETENTION_DAYS` | `7` | 1–3650；delivered 历史保留天数 |
| `QIY_REALTIME_CLEANUP_MS` | `86400000` | 清理周期，最小 60000 |
| `QIY_REALTIME_SUBSCRIBE_POLL_MS` | `1000` | SSE 尾随间隔，最小 100 |
| `QIY_REALTIME_ADMIN_URL` | 本机 `/api/v1/realtime/outbox` | 运维 CLI 的目标 |
| `QIY_REALTIME_ADMIN_TOKEN` | 空 | 运维 CLI 用的**管理员** access token |
| `QIY_REALTIME_METRICS_TOKEN` | 空 | 只读抓取 token：**仅**允许 Prometheus 文本端点 |
| `QIY_REALTIME_ALERT_MAX_PENDING` | `1000` | health 阈值 |
| `QIY_REALTIME_ALERT_MAX_DEAD_LETTERED` | `0` | health 阈值 |
| `QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS` | `300000` | health 阈值 |

非法值在启动/首次使用时 fail-closed 抛错（例如 `QIY_REALTIME_LEASE_MS must be an integer of at least 1000ms`）。

## 运维 CLI

```powershell [apps/server]
$env:QIY_REALTIME_ADMIN_TOKEN = "<admin-access-token>"
bun run realtime:admin -- metrics
bun run realtime:admin -- health
bun run realtime:admin -- prometheus
bun run realtime:admin -- dead
bun run realtime:admin -- replay 00000000-0000-4000-8000-000000000001
bun run realtime:admin -- cleanup 30
```

除 `prometheus` 原样输出文本外，其余输出单行 JSON。`replay` 接受 1–100 个唯一 UUID；`cleanup` 保留天数 1–3650；远程 Server 用 `QIY_REALTIME_ADMIN_URL=https://admin.example.com/api/v1/realtime/outbox`。CLI 只调用受保护 HTTP API，不直连数据库、不绕过角色检查或审计。

## Prometheus 与 Grafana

声明 realtime 的独立项目额外生成：

- `deploy/kubernetes/realtime-servicemonitor.yaml`（用 Service 的 `http` 端口，从应用 Secret 的 `QIY_REALTIME_METRICS_TOKEN` 读取 Bearer 凭据）；
- `deploy/kubernetes/realtime-prometheusrule.yaml`（持续 5 分钟健康降级 / 1 分钟死信 / 10 分钟指标缺失）；
- `deploy/observability/grafana/qiy-realtime-outbox.json`（导入时选择 Prometheus datasource）。

指标：`qiy_realtime_outbox_pending`、`…_leased`、`…_dead_lettered`、`…_delivered`、`…_oldest_pending_age_seconds`、`…_health`。**不带**用户/tenant/channel/事件 ID 标签（避免高基数）。

## 扩展性与语义边界

- **at-least-once**：PostgreSQL/MySQL 用租约 + `SKIP LOCKED` 避免正常并发重复领取；SQLite 定位单进程。provider 成功但未标记 delivered 时崩溃、或 publish 超过租约被另一 worker 重新领取，仍可能重复投递——**消费者必须幂等**，Qiy 不宣称 exactly-once。
- `QIY_REALTIME_LEASE_MS` 必须大于正常 publish 延迟；修改 outbox schema 后已有项目必须重新生成并执行 migration。
- 多副本 SSE 依赖 outbox 尾随：每个订阅者都会轮询数据库，订阅规模很大时建议换成专用消息中间件。
- 事件负载是**字段级**裁剪；行级隔离靠「禁止行谓词 + claim 分段通道」实现。

## 可重复验收

```powershell
qiy create -f examples/realtime/app.qiy -n realtime-admin -o out/realtime-admin
bun install --cwd out/realtime-admin
bun run --cwd out/realtime-admin typecheck
bun run --cwd out/realtime-admin test
bun run --cwd out/realtime-admin build
```

生成 Server 测试会强制 `QIY_REALTIME_DISABLED=1`，不依赖开发环境 `.env`，也不把本地测试当真实 Ably 验收；realtime 专项测试显式开启该开关并验证允许角色、匿名 401、无 channel 权限 403、subscribe-only capability、失败退避、重试、并发 worker 单次领取、死信阈值与管理员运维权限。SQLite 生成包还会真实删表制造 outbox 插入失败，证明 CRUD/审计/outbox 同成同败。

真实数据库 store（租约列、`SKIP LOCKED`、退避、死信、重放、清理）：

```sh
bun tools/verify-realtime-outbox.ts sqlite
bun tools/verify-realtime-outbox.ts postgresql <容器名>
bun tools/verify-realtime-outbox.ts mysql <容器名>
bun tools/verify-realtime-claim.ts        # claim 分段通道
bun tools/verify-realtime-policy.ts       # 行谓词拒绝 + mask 裁剪
```

MySQL 需要 `datetime(3)`（毫秒精度）：不带小数秒时 MySQL 会**四舍五入**，刚入队的 `availableAt` 可能被推到未来导致 worker 跳过；生成的 MySQL schema 现已统一 `fsp: 3`，已有项目需重新生成并迁移。

## 校验错误

| 错误（节选） | 触发 |
| --- | --- |
| `Realtime requires at least one resource` | 空 `realtime {}` |
| `Realtime requires generated authentication` | 无 `auth` |
| `application mode integration cannot generate standalone realtime; use the host LiveProvider adapter instead.` | `mode integration` |
| `Unsupported realtime mode <m>` | 非法 mode |
| `Duplicate realtime resource <r>` / `Realtime: unknown resource <r>` | 资源重复/不存在 |
| `Realtime resource <r>: events requires at least one event` / `unsupported event <e>` / `duplicate event <e>` | events |
| `Realtime resource <r>: roles requires at least one role` / `unsupported role <r>` / `duplicate role <r>` | roles |
| `Realtime resource <r>: duplicate when clause` / `when requires "claim"` | `when` 语法 |
| `Realtime <r>: unknown claim field <f>` / `must be non-nullable` / `must be Text or Integer` | `when` 字段契约 |
| `Realtime <r>: restrict row predicates cannot be enforced on a shared channel; remove the realtime events or the row predicates` | 行谓词 + realtime |
| `Realtime <r>: a claim-scoped channel already isolates rows; remove the restrict row predicates` | 分段通道 + 行谓词 |
| `QIY_REALTIME_LEASE_MS must be an integer of at least 1000ms` 等 | 环境变量非法 |

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `/api/v1/realtime/token` 403 | principal 缺少分段通道所需的 claim | 给 users 行/IdP 补 claim，或去掉 `when … claim …` |
| 页面收不到事件 | 角色不在 `roles`，或 channel capability 与资源名不一致（分段通道） | 检查 `roles` 与 claim；客户端必须从 token 的 capability 取 channel |
| 事件里少了字段 | 该字段被 `mask` 且对可订阅角色生效 | 调整 mask 或角色 |
| 列表刷新但详情页不刷新 | 详情页按 `id` 裁剪，事件 payload 的 id 与页面不一致 | 检查记录 id；`useMany` 需传 `params.ids` |
| 死信持续增长 | Ably 不可达/凭据错误/超过重试上限 | 看 `outbox/health`、`outbox/dead`，修复后 `replay` |
| 生成期拒绝 realtime | 资源带 `restrict` 行谓词 / 无 `auth` / integration 模式 | 去掉行谓词、加 auth，或改用宿主 LiveProvider |
| `/token` 503 `Realtime is disabled` | `QIY_REALTIME_DISABLED=1` | 取消该变量 |

## 进阶用法

**1）分段 + 脱敏组合**：按 claim 分段隔离租户，同时用 `mask` 对可订阅角色裁剪敏感字段（入队前生效）。

```qiy
realtime {
  resource stock_movements {
    events created, updated;
    roles admin, operator;
    when warehouseCode claim warehouse.code;
  }
}
restrict stock_movements {
  allow roles admin, operator;
  mask unitCost roles operator mode redact replacement "***";
}
```

**2）auto 与 manual 混用**：列表页用 `mode auto` 自动刷新，详情页自行处理 `onLiveEvent`（例如只对「当前步骤」的变化弹提示），避免整页重渲染。

**3）死信运维闭环**：

```powershell
bun run realtime:admin -- health      # 503 先看阈值
bun run realtime:admin -- dead        # 定位事件
bun run realtime:admin -- replay <id> # 修复 provider 后重放
bun run realtime:admin -- cleanup 30  # 清理已投递历史
```

**4）多副本部署**：确保 `QIY_REALTIME_LEASE_MS` 明显大于 publish 延迟；SSE 订阅者通过 outbox 尾随获得跨实例事件，但每个订阅者都会轮询数据库——订阅量很大时改用专用消息中间件。

**5）前端订阅封装**：把 `subscribeGraphql()` 的 `stop()` 交给 React `useEffect` 清理，避免路由切换后残留订阅；事件负载已脱敏，可直接用于 UI 局部刷新。

## 相关

- [dataflow](/dsl/dataflow)：`emit` 与实时 outbox 的联动。
- [权限（permission）](/dsl/permissions)：`roles`/`mask`/行谓词与 realtime 的关系。
- [API 与数据源](/guide/api)：DataProvider 与 LiveProvider 的生成约定。
- 示例：[examples/realtime/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/realtime/app.qiy)。
- 测试：`tests/realtime-qiy.test.ts`、`tools/verify-realtime-outbox.ts`、`tools/verify-realtime-claim.ts`、`tools/verify-realtime-policy.ts`、`tools/verify-graphql-subscription.ts`。
