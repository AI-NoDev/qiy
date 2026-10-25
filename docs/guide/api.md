# API 与数据源

## 选择客户端

Qiy 可以同时生成 REST 与 GraphQL 服务端，但前端 DataProvider 只能选一个：

```ts
api { client rest; }
```

或：

```ts
api { client graphql; }
```

服务端挂载 `/api/v1/*`；选择 GraphQL 时额外挂载 `/graphql`。

## CORS

```ts
api {
  client rest;
  cors {
    origin "https://admin.example.com";
    origin "http://127.0.0.1:3001";
  }
}
```

origin 必须是精确的 `http(s)` 源，不允许通配符或路径。

## Elysia 插件

```ts
elysia {
  bearer;
  serverTiming;
  html;
  drizzle;
  jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; }
  static { assets "public"; prefix "/public-assets"; }
  graphqlAdapter adapter yoga;
  cron { job attachmentCleanup pattern "0 0 * * *" task cleanupMissingAttachments; }
}
```

`bearer` 解析令牌，`jwt` 负责签发与校验，`serverTiming` 添加耗时头，`static` 托管指定目录，`graphqlAdapter` 可选 `native` / `yoga` / `apollo`，`cron` 提供定时任务，`drizzle` 与数据库连接。

## REST 端点

```text
GET    /api/v1/:resources          列表，分页、排序、过滤、搜索
POST   /api/v1/:resources          创建
GET    /api/v1/:resources/:id      详情
PATCH  /api/v1/:resources/:id      部分更新（没有 PUT）
DELETE /api/v1/:resources/:id      删除
DELETE /api/v1/:resources          批量删除
GET    /api/v1/:resources/export   受权限约束的 CSV 导出
POST   /api/v1/:resources/import   受权限约束的 CSV 导入
GET    /api/v1/:resources/distribution  枚举字段分布
GET    /api/v1/:resources/trend    日期趋势
GET    /api/v1/:resources/aggregate     聚合（sum/avg/min/max，需 field 与 op）
GET    /api/v1/graphql/subscribe   GraphQL 订阅（SSE，仅 GraphQL 客户端 + realtime）
```

`DataProvider` 的 `update` 使用 `PATCH`（空 body 返回 400）；`aggregate?field=<numeric>&op=sum|avg|min|max` 返回 `{ data: { value, operator } }`，其余分析端点返回 `{ data: { items } }`。

契约由同一份 IR 生成，server 侧的校验与 web 侧 DataProvider 类型不会发生字段漂移。

## CSV 导出

`GET /api/v1/:resources/export` 与列表接口**共用同一条查询路径**（同一个过滤校验、数据 scope 与 `restrict` 策略），因此导出不会绕过记录级范围或字段脱敏：

- 行：`restrict` 的行谓词照常下推，导出只包含调用者可见的行。
- 列：`mode omit` 的脱敏字段**整列消失**（表头也不出现）；`mode null` / `mode redact` 保留列但输出掩码后的值。列顺序按实体字段顺序。
- 过滤/排序/搜索参数与列表一致（`filters`、`sort`、`order`、`search`），非法字段或操作符返回 400。
- **仅选中行**：`ids=<id1>,<id2>` 只导出这些行（上限 500，非法 id 400 `export.invalidId`，超量 400 `export.tooManyIds`）。选中导出不受行数上限约束，但**仍然经过行谓词与脱敏**——调用者看不到的 id 会被丢弃，不会泄漏。Web 列表在有勾选时按钮变为 `Export selected (n)` 并带上 ids。
- **流式分批**：导出按 250 行的页循环读取并写入 `ReadableStream`，不再把整个结果集拼成字符串，因此大导出不会随行数增长内存；响应没有 `Content-Length`（分块传输）。表头与列集合在第一页确定（脱敏 `omit` 的列整列不导出），行谓词、排序与过滤对每一页都重新应用。审计记录在流结束时写入，包含实际导出的行数。
- **列选择**：`columns=title,region` 只导出指定列（最多 100，未知列 400 `export.invalidColumn`）。列顺序仍按实体声明顺序；与脱敏取交集——请求只包含被 `omit` 脱敏的列时返回 400 `export.noColumns`，不会退化成导出行 id。Web 列表按**当前可见列**导出（列显隐下拉的结果）。
- **后台导出与跨副本 worker**：`GET /api/v1/:resources/export?async=1` 立即返回 `202 { jobId, total }`，任务行（`qiy_export_jobs`）保存**请求规格**（filter/sort/ids/columns/principal 快照/scope），CSV 由 worker 重建后写入 `result`（MySQL 用 MEDIUMTEXT）。默认当前副本就地执行；`QIY_EXPORT_INLINE=off` 时任务留在队列。
  - `GET /api/v1/:resources/export/jobs`（admin）列出最近任务；`POST /api/v1/:resources/export/jobs/:id/run`（admin）让任意副本 claim 并执行（并发时只有一个成功，另一个 `409 export.claimed`；已结束 `409 export.notQueued`；非 admin `403`）。
  - `GET /api/v1/:resources/export/jobs/:id` 查询进度；`GET .../jobs/:id/download` 在完成后一次性下载（未完成 `409 export.notReady`；未知/跨资源 404）。
  - **CSV 以创建任务时的 principal 为准**（行谓词与脱敏按创建者），所以同一任务由别的 admin 执行也不会放宽数据范围。
- 规模：默认上限 1000 行，可用 `QIY_EXPORT_MAX_ROWS` 调整（1–100000）。超过上限时返回 **400 `export.tooLarge`**，而不是静默导出部分数据；请先收窄过滤条件。
- 审计：每次导出写入一条 `<resource>.exported` 审计事件（行数、过滤条数、操作者），便于追溯数据外带。
- Web：列表页头部有 **Export CSV** 按钮（`web/app/export.ts`），它把当前表格的过滤/排序状态（`useTable` 的 `filters`/`sorters`）编码成同一套参数，因此导出范围与屏幕上看到的行一致；服务端拒绝（401 / 400 `export.tooLarge`）以通知形式显示，不会下载残缺文件。
- 需要已认证调用者，匿名请求返回 401；响应为 `text/csv; charset=utf-8` 并带 `Content-Disposition` 附件头，CSV 按 RFC 4180 转义（逗号、引号、换行）。
- 写入越权也返回 4xx：当写入的行落在调用者自身行谓词之外时，返回 **403 `policy.outsideScope`**，而不是 500。

## 保存视图（服务端）

浏览器本地视图（`qiy.views.<resource>`）之外，每个应用还生成一套服务端保存视图，用于跨设备同步与团队共享：

- `GET /api/v1/saved-views?resource=<table>` → `{ items }`：返回**自己的**视图 + 所有人可见的 `shared` 视图，按 `updatedAt` 倒序（再按 `createdAt`、`id` 稳定排序）。每一项除 `id/resource/name/ownerId/shared/search/filters/sorters/columns/createdAt/updatedAt` 外还带 **`mine`**（`ownerId === 当前用户`），UI 用它决定是否显示删除入口；共享视图不泄露其他用户的身份信息，`mine` 就是唯一的所有权信号。
- `POST /api/v1/saved-views` body `{ resource, name, shared?, search?, filters?, sorters?, columns? }` → `201` 视图对象。**同名发布是 upsert**：同一用户、同一资源、同一 `name` 再次保存时更新既有行（`shared`、`search`、`filters`、`sorters`、`columns`、`updatedAt`）并返回该行，不会新增重复项；旧版本遗留的重复同名行会在下一次发布时被合并。`name` 去空格后必填（≤80 字符），`filters` ≤50 项、`sorters` ≤10 项、`columns` ≤100 项。
- `DELETE /api/v1/saved-views/:id` → `204`。**创建者本人可以删除自己的视图；`role = admin` 的用户也可以删除任意用户的共享视图**（用于清理团队共享项），其他情况 `403 views.forbidden`；不存在的 id `404`。共享（`shared: true`）不授予删除权限。
- 校验：未知资源 `400 views.unknownResource`；每人每资源最多 100 个**不同名称**的视图（`400 views.limit`）——同名重复发布属于更新，不受该上限影响；未认证 `401`。
- 持久化在生成的 `qiy_saved_views` 表（三方言 schema 都包含），不依赖进程内存。
- Web：列表页打开时通过 `web/app/views-api.ts` 的 `fetchServerViews()` 拉取并合并进 `Saved views` 下拉；本地视图标记为 **个人**，服务端私有视图标记为 **发布**，共享视图标记为 **共享**。下拉里每一项右侧有**删除图标 + Popconfirm**：本地视图删除 localStorage 行；`server:<id>` 视图调用 `deleteServerView({ resource, id })` → `DELETE /api/v1/saved-views/:id`，成功后立即重新拉取服务端列表并清除选中项，失败以通知显示。删除图标只在本地视图或 `mine: true` 的服务端视图上出现，其他用户的共享视图不提供删除入口（服务端仍对 admin 开放清理能力）。选中视图后点 **Publish view** → **Save to server**（个人/发布）或 **Share with everyone**（共享）：同名发布走 upsert，发布成功后本地副本会被服务端行取代，下拉不会出现本地 + 服务端两条同名项。
- 保留旧 `shared` 文案键 `qiy.shared` 供旧项目覆盖；新 UI 使用 `qiy.viewMine` / `qiy.viewPublishedTag` / `qiy.viewSharedTag` / `qiy.viewDeleted` / `qiy.viewDeleteFailed` / `qiy.confirmDeleteView`。

## GraphQL Subscription（SSE 与 graphql-ws）

- SSE：`GET /api/v1/graphql/subscribe?query=...`，每个事件一帧 `data: {...}`（见 realtime 文档）。
- **graphql-ws（WebSocket）**：`ws(s)://<host>/graphql/ws`，标准 graphql-ws 帧：
  - `connection_init` 的 `payload.token` 携带 Bearer token（也可用 `Authorization` 头），失败以 `4401` 关闭；
  - `connection_ack` 后可发 `{ id, type: "subscribe", payload: { query, variables, operationName } }`；
  - 每个事件返回 `{ id, type: "next", payload }`，错误 `type: "error"`，结束 `type: "complete"`（客户端 `complete` 会被立即确认）；
  - 支持 `ping/pong` 与 `connection_terminate`；订阅权限仍走 capability（agent 分段 channel 同样生效）。
- 浏览器端：生成的 `web/app/subscriptions.ts` 同时提供 SSE 客户端 `subscribeGraphql()` 与 graphql-ws 客户端 `subscribeGraphqlWs(query, { onData, onError, onComplete, token })`（原生 WebSocket，无新增依赖；`socketFactory` 可注入以便测试）。页面默认仍用 SSE，订阅组件可以按偏好选择 WS。
- **断线重连**：`subscribeGraphqlWs` 在 socket 关闭时自动重连（`reconnectDelayMs` 起始 1s、最高 `maxReconnectDelayMs` 30s 的指数退避，`attempt` 封顶；`onReconnect({ attempt, delayMs })` 可观测），重连成功后重新 `connection_init` + `subscribe`；调用 `stop()` 会清掉重试定时器。
- **SSE 断线重连**：`subscribeGraphql` 在流结束或请求失败后同样按 `reconnectDelayMs`→`maxReconnectDelayMs` 退避重连（默认开启，`reconnect: false` 可关闭），`onReconnect` 报告 attempt/delay，`stop()` 中止请求并清理定时器。

## CSV 导入
`POST /api/v1/:resources/import` 接收 `text/csv` 请求体（首行为表头），逐行调用与创建相同的一条写入路径，因此同样受 `restrict` 行谓词与脱敏规则约束：

- 表头校验：未知列 → 400 `import.unknownField`；重复列 → 400 `import.duplicateColumn`；对当前调用者**脱敏的字段** → 400 `import.maskedField`（fail-closed，不静默丢弃）。`Vector` / `Files` 列不支持通过 CSV 导入。
- 行校验：列数与表头不一致 → 400 `import.rowLength`；整数/日期无法解析 → 400 `import.invalidRow` 并指出行号；写入落在自身行谓词之外 → **403 `policy.outsideScope`** 并指出行号。
- 规模：默认上限 1000 行（`QIY_IMPORT_MAX_ROWS`，1–100000），超限 400 `import.tooLarge`；空文件（只有表头）→ 400 `import.empty`。
- **失败不留残留**：逐行写入，任一行失败即删除本次请求已创建的行再返回 4xx（补偿式回滚，不是跨行单一事务）；成功返回 `201 { imported: n }` 并写入一条 `<resource>.imported` 审计事件。
- CSV 解析遵循 RFC 4180：引号包裹的逗号与换行、`""` 转义、CRLF/LF 均可。
- 空单元格写入 `null`；非空但字段必填/唯一冲突等数据库级错误按 `import.invalidRow` 报出并指出行号。
- Web：列表页头部另有 **Import CSV** 按钮，选择文件后走**后台任务**流程：`startImport()` 上传文件拿到 `jobId`，`waitForImport()` 轮询进度并逐条提示 `已处理/总数`，完成后再刷新表格；失败以通知显示服务端返回的具体行错误。只读的宿主集成模式不生成该按钮。

### 后台导入（async）

`POST /api/v1/:resources/import?async=1` 把逐行写入放进后台任务，请求立即返回 `202 { jobId, total }`：

- 任务行持久化在生成的 `qiy_import_jobs` 表（`id`、`resource`、`status`、`total`、`processed`、`failed`、`errors`、`actorId`、时间戳），不依赖进程内存，重启后仍可查询进度。
- `GET /api/v1/:resources/import/jobs/:id` 返回任务状态；未认证 401，未知 id 或不属于该资源的任务 404。Web 端 `waitForImport()` 每 500ms 轮询（超时 120s），状态为 `completed` 或 `failed` 时停止。
- 语义与同步路径一致：表头/脱敏列校验在任务创建**之前**完成；写行失败仍然补偿删除本次已创建的行，并把行号错误写进任务 `errors`（状态 `failed`）；成功写 `<resource>.imported` 审计。每处理 25 行更新一次进度。
- 权限：`POST .../import` 受 `pages` 的 `create` 规则约束，异步模式不会绕过；除了任务状态查询需要认证外，读任务状态按 `list`/`show` 页面规则处理。
- 不加 `async=1` 时仍是原来的同步接口（`201 { imported: n }`），两个入口共享同一套校验与补偿逻辑。
- **取消**：`POST /:resources/import/jobs/:id/cancel` 只把任务置为 `cancelling`（202），真正的停止由后台循环完成——循环每 10 行检查一次，看到 `cancelling` 就停止写入、**补偿删除本次已创建的行**，最后把状态定为 `cancelled` 并记录 `processed`。因此观察到 `cancelled` 就意味着清理已经完成。对已结束任务返回 409 `import.notRunning`；未知/跨资源 404；未认证 401。
- **崩溃自愈**：`GET .../jobs/:id` 与取消接口会先执行 `releaseStaleImportJobs()`，把 `updatedAt` 超过 `QIY_IMPORT_JOB_STALE_MS`（默认 300000ms，最小 1000ms）仍处于 `queued`/`running` 的任务标记为 `failed`，原因写 `Stale import job timed out`，避免永久挂起。
- `QIY_IMPORT_JOB_DELAY_MS`（默认 0，最大 1000）在每行之间加入延迟，用于演示/测试取消窗口，不影响默认性能。

### 跨副本导入 worker

- 任务行现在**持久化 payload**（表头、数据行、principal 快照与 scope），新增 `leaseOwner` / `leaseUntil` 列；默认 `QIY_IMPORT_INLINE` 不为 `off` 时，创建任务后当前副本会**抢占并就地执行**。
- 任意副本都能接管任务：`GET /api/v1/:resources/import/jobs`（admin）列出该资源的最近任务，`POST /api/v1/:resources/import/jobs/:id/run`（admin）抢占并执行一条 queued 任务。
- 抢占是条件更新（`status = queued` 才能改），所以两个副本同时 run 同一个任务只有一个成功，另一个得到 `409 import.claimed`；已结束的任务返回 `409 import.notQueued`，未知/跨资源 `404`，非 admin `403`。
- 设 `QIY_IMPORT_INLINE=off` 可以关闭就地执行，让外部 worker/另一个副本统一 drain 队列（适合把导入放到独立进程）。失败仍补偿删除本次已创建的行，并把行号写进任务 `errors`。
- **多副本部署**：任务领取是数据库条件更新，两个副本服务同一数据库时天然互斥；`verify-multi-replica.ts` 用两个独立服务进程 + 同一 SQLite + 真实 HTTP 验证了“A 入队、B 领取执行、并发抢同一任务只成功一个、完成/拒绝/鉴权”全链路。

