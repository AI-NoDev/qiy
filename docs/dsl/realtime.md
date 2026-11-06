# realtime（实时订阅）

`realtime` 把生成的 Refine 资源声明为可实时订阅：收到 `created`/`updated`/`deleted` 事件后自动刷新相关查询（`mode auto`）或把事件交给页面自定义处理（`mode manual`）。**当前生成器只为详情页（show）传入 `liveMode`**；列表页由生成的 `routes/list.tsx` 覆盖，使用 `useTable` 时没有 `liveMode`，因此默认不会因 realtime 自动刷新——需要时在自定义列表页给 `useTable` 显式传 `liveMode`（`manual`/`auto`）。

传输是**自托管的 Server-Sent Events**，不依赖任何第三方服务：

| `api.client` | 传输 | 生成物 |
| --- | --- | --- |
| `rest` | `GET /api/v1/realtime/stream`：一条连接承载调用者被授予的全部 channel（`qiy:<table>[:<claimValue>]`、命令事件 `qiy:event:<event>`） | `web/app/providers/live-provider.ts`（`createQiyLiveProvider`）、`server/src/realtime.ts` |
| `graphql` | 同上 **+** GraphQL Subscription over SSE（`GET /graphql/subscribe`） | 追加订阅根与 `web/app/subscriptions.ts` |

`realtime` 必须同时声明生成式 `auth`：事件流每次连接都重新认证并按角色计算 channel，未声明认证的模型在生成前失败；`mode integration` 也不允许生成独立 realtime（改用宿主 LiveProvider adapter）。

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
| `roles` | 是 | — | 至少一个，且不重复；只接受已声明角色（默认 `admin`/`operator`/`viewer`）；决定谁能订阅该资源的 channel |
| `when <field> claim <claim>` | 否 | 无 | 字段必须存在、**非空**、类型 `Text`/`Integer`；claim 允许点号 |
| 整个块 | — | — | 至少一个 `resource`；无 `auth` → `Realtime requires generated authentication`；`mode integration` → 拒绝 |

## `mode auto` 与 `manual`

| 模式 | 客户端行为 |
| --- | --- |
| `auto` | 生成的 LiveProvider 收到事件后让 Refine 自动刷新相关 `useTable`/`useOne`/`useMany` 查询（详情页按 `id`、批量页按 `ids` 裁剪；列表页需页面显式传 `liveMode`，生成器目前未为列表页启用） |
| `manual` | 只把事件交给 Refine 的 `onLiveEvent`，页面自行决定如何响应（适合「先提示再刷新」或局部更新） |

记录级裁剪：`subscribe({ params: { id } })` / `params: { ids: [...] }` 时只有 `record.id`（或 `data.id`）命中才回调；没有这些参数时仍收到该资源全部事件。生成的 show 页会按记录 id 订阅，list 页默认不订阅。

浏览器端所有 Refine 订阅**共享一条** SSE 连接：第一个订阅打开连接，最后一个取消时关闭；连接断开按指数退避重连，收到 401/403 时保持空闲不重试。

## 权限模型

一个 channel（`qiy:<table>`）被同一资源的所有订阅者共享，服务端**无法按订阅者裁剪单条事件**。因此生成器在两侧同时约束：

| 约束 | 机制 |
| --- | --- |
| 谁能订阅 | `roles` → `realtimeCapabilities(principal)`；匿名 401，没有任何 channel 的角色 403 |
| 订阅哪些 channel | 服务端在连接时计算授予的 channel，首帧 `event: ready` 列出它们；流里只会出现这些 channel 的事件 |
| 字段脱敏 | 入队前按「可订阅角色」裁剪 payload：任何对该资源可订阅角色生效的 `mask`（含全局 mask 与 `claim present/absent` mask）都会从事件里删掉；只对不能订阅角色生效的 mask 不误伤 |
| 行级隔离 | **共享 channel 做不到**，因此带 `restrict` 行谓词（`when`）的资源**禁止**开启 realtime：`restrict row predicates cannot be enforced on a shared channel` |
| 租户分段 | 用 `when <field> claim <claim>` 把资源切成 `qiy:<table>:<value>`；claim 缺失时**不授予该 channel** |

::: warning 行谓词 vs 分段通道
`restrict { when … }` 与 `when <field> claim <claim>` 是两种隔离手段，不能同时用于同一资源：分段通道已经完成行级隔离，生成期会报 `a claim-scoped channel already isolates rows; remove the restrict row predicates`。只有 `roles`/`mask`（没有 `when`）的 `restrict` 可以和 realtime 共存。
:::

## 生成结果

- CRUD repository 在**业务写入与审计的同一个 Drizzle 事务**里写 `qiy_realtime_outbox`（`id`、`channel`、`type`、`payload`、`createdAt`），提交后 service 立即触发一次读取；
- Dataflow `emit` 同时写业务 `dataflow_outbox` 与实时 channel `qiy:event:<event>`，与业务写入同生共死；dataflow 的 `allow roles` 决定谁能订阅对应事件 channel；
- 字段脱敏在**入队时**完成（批量删除同样适用）；
- 每个进程有**一个共享轮询器**：只要有订阅者，就按 `QIY_REALTIME_POLL_MS` 尾随 outbox，按行 id 去重后分发给本进程的全部 SSE/GraphQL 订阅者；没有订阅者时停止轮询。每个副本都尾随同一张表，所以**任意实例写入的事件都能到达所有在线浏览器**；
- 后台按 `QIY_REALTIME_CLEANUP_MS` 删除超过 `QIY_REALTIME_RETENTION_DAYS` 的 outbox 行（outbox 只是短期事件日志，不是投递队列）。

`GET /api/v1/realtime/stream` 帧格式：

```text
event: ready
data: {"channels":["qiy:orders","qiy:stock_movements:WH-1"]}

event: created
data: {"id":"…","channel":"qiy:orders","event":"created","record":{"id":"…","number":"SO-1"}}

: keep-alive
```

鉴权使用与 REST 相同的 `Authorization: Bearer <token>`（浏览器端由 fetch 发起，不使用 `EventSource`，因此可以带头）。每 25 秒发一次注释帧保活。`QIY_REALTIME_DISABLED=1` 时返回 503。

## GraphQL Subscription（SSE）

`api { client graphql; }` + `realtime` 时追加订阅根：

```graphql
type OrdersEvent { event: String! record: Orders! }
type Subscription { ordersChanged: OrdersEvent! }
```

- 传输：**Server-Sent Events**，`GET /graphql/subscribe?query=...`，每帧 `data: {...}`。
- 鉴权：匿名 401；角色不在该资源 `roles` → 403；未知订阅字段/非订阅文档/语法错误 400；客户端断开或取消读取都会关闭迭代器并释放订阅。
- 脱敏：负载来自 outbox（已裁剪），被 mask 的字段**没有键**；GraphQL 只能对客户端显式请求的字段返回 `null`，不会泄漏值。
- 事件源：与 REST 事件流共用同一个 outbox 轮询器，多副本行为一致。

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
| `QIY_REALTIME_DISABLED` | `0` | `1` 时事件流返回 503、不轮询（生成测试默认开启） |
| `QIY_REALTIME_POLL_MS` | `1000` | outbox 尾随间隔，最小 100；决定跨副本事件的最大延迟 |
| `QIY_REALTIME_RETENTION_DAYS` | `1` | 1–3650；outbox 行保留天数 |
| `QIY_REALTIME_CLEANUP_MS` | `3600000` | 清理周期，最小 60000 |

非法值在首次使用时 fail-closed 抛错（例如 `QIY_REALTIME_POLL_MS must be an integer from 100 to …`）。

## 扩展性与语义边界

- **尽力实时，不是可靠消息**：浏览器离线期间的事件不会补发；重连后 Refine 重新查询即可拿到最新数据。需要「一定送达」的业务通知请用 Dataflow `emit` + 你自己的消费者，而不是 realtime。
- 轮询器会回看最近 5 秒的 outbox 行，覆盖「先开始、后提交」的事务与副本间的轻微时钟偏差；按行 id 去重，同一事件不会对同一进程重复分发。新订阅者不会收到它订阅之前写入的事件。
- 轮询成本按**进程**计算，不按订阅者计算：一个副本无论有多少在线浏览器，都只有一个轮询循环和一条查询。
- 事件负载是**字段级**裁剪；行级隔离靠「禁止行谓词 + claim 分段通道」实现。
- 反向代理需要关闭 SSE 响应缓冲（生成的响应已带 `X-Accel-Buffering: no`）并把读超时设得大于 25 秒保活间隔。

## 可重复验收

```powershell
qiy create -f examples/realtime/app.qiy -n realtime-admin -o out/realtime-admin
bun install --cwd out/realtime-admin
bun run --cwd out/realtime-admin typecheck
bun run --cwd out/realtime-admin test
bun run --cwd out/realtime-admin build
```

生成 Server 测试默认强制 `QIY_REALTIME_DISABLED=1`；realtime 专项测试显式开启并验证匿名 401、无 channel 权限 403、禁用时 503、事件流只发送被授予的 channel、迭代器关闭后停止、清理截止时间计算。SQLite 生成包还会真实删表制造 outbox 插入失败，证明 CRUD/审计/outbox 同成同败。

```sh
bun tools/verify-graphql-subscription.ts  # REST 事件流 + GraphQL 订阅 + 跨副本尾随，真实 SQLite
bun tools/verify-realtime-claim.ts        # claim 分段通道
bun tools/verify-realtime-policy.ts       # 行谓词拒绝 + mask 裁剪
```

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

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `/api/v1/realtime/stream` 403 | 角色不在任何 `roles`，或 principal 缺少分段通道所需的 claim | 检查 `roles`；给 users 行/IdP 补 claim，或去掉 `when … claim …` |
| 页面收不到事件 | 反向代理缓冲了 SSE 响应，或读超时短于保活间隔 | 关闭代理缓冲（nginx `proxy_buffering off`），读超时 > 25s |
| 跨副本事件延迟约 1 秒 | 其他副本的事件靠轮询到达 | 调小 `QIY_REALTIME_POLL_MS`（最小 100） |
| 事件里少了字段 | 该字段被 `mask` 且对可订阅角色生效 | 调整 mask 或角色 |
| 列表刷新但详情页不刷新 | 详情页按 `id` 裁剪，事件 payload 的 id 与页面不一致 | 检查记录 id；`useMany` 需传 `params.ids` |
| 生成期拒绝 realtime | 资源带 `restrict` 行谓词 / 无 `auth` / integration 模式 | 去掉行谓词、加 auth，或改用宿主 LiveProvider |
| 事件流 503 `Realtime is disabled` | `QIY_REALTIME_DISABLED=1` | 取消该变量 |

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

**3）非浏览器消费者**：任何能发 HTTP 请求的进程都可以带 Bearer token 读取 `/api/v1/realtime/stream`，按 `event:` 行分派即可，不需要 SDK。

**4）前端订阅封装**：把 `subscribeGraphql()` 的 `stop()` 交给 React `useEffect` 清理，避免路由切换后残留订阅；事件负载已脱敏，可直接用于 UI 局部刷新。

## 从 0.36 迁移

0.37 删除了 Ably 传输、graphql-ws、死信/重放/指标端点、`realtime:admin` CLI 与 Prometheus/Grafana 清单。`.qiy` 语法不变；重新生成后执行 migration（outbox 表删除了 `attempts`/`availableAt`/`deliveredAt`/`lease*`/`deadLetteredAt`/`lastError` 列），并从部署环境移除 `QIY_ABLY_API_KEY` 与 `QIY_REALTIME_LEASE_MS` 等旧变量。详见 [0.37 迁移指南](/guide/migration-0.37)。

## 相关

- [dataflow](/dsl/dataflow)：`emit` 与实时 outbox 的联动。
- [权限（permission）](/dsl/permissions)：`roles`/`mask`/行谓词与 realtime 的关系。
- [API 与数据源](/guide/api)：DataProvider 与 LiveProvider 的生成约定。
- 示例：[examples/realtime/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/realtime/app.qiy)。
- 测试：`tests/realtime-qiy.test.ts`、`tools/verify-graphql-subscription.ts`、`tools/verify-realtime-claim.ts`、`tools/verify-realtime-policy.ts`。
