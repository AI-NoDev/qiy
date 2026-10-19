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
PUT    /api/v1/:resources/:id      更新
DELETE /api/v1/:resources/:id      删除
DELETE /api/v1/:resources          批量删除
GET    /api/v1/:resources/export   受权限约束的 CSV 导出
POST   /api/v1/:resources/import   受权限约束的 CSV 导入
GET    /api/v1/:resources/distribution  枚举字段分布
GET    /api/v1/:resources/trend    日期趋势
GET    /api/v1/graphql/subscribe   GraphQL 订阅（SSE，仅 GraphQL 客户端 + realtime）
```

契约由同一份 IR 生成，server 侧的校验与 web 侧 DataProvider 类型不会发生字段漂移。

## CSV 导出

`GET /api/v1/:resources/export` 与列表接口**共用同一条查询路径**（同一个过滤校验、数据 scope 与 `restrict` 策略），因此导出不会绕过记录级范围或字段脱敏：

- 行：`restrict` 的行谓词照常下推，导出只包含调用者可见的行。
- 列：`mode omit` 的脱敏字段**整列消失**（表头也不出现）；`mode null` / `mode redact` 保留列但输出掩码后的值。列顺序按实体字段顺序。
- 过滤/排序/搜索参数与列表一致（`filters`、`sort`、`order`、`search`），非法字段或操作符返回 400。
- **仅选中行**：`ids=<id1>,<id2>` 只导出这些行（上限 500，非法 id 400 `export.invalidId`，超量 400 `export.tooManyIds`）。选中导出不受行数上限约束，但**仍然经过行谓词与脱敏**——调用者看不到的 id 会被丢弃，不会泄漏。Web 列表在有勾选时按钮变为 `Export selected (n)` 并带上 ids。
- **流式分批**：导出按 250 行的页循环读取并写入 `ReadableStream`，不再把整个结果集拼成字符串，因此大导出不会随行数增长内存；响应没有 `Content-Length`（分块传输）。表头与列集合在第一页确定（脱敏 `omit` 的列整列不导出），行谓词、排序与过滤对每一页都重新应用。审计记录在流结束时写入，包含实际导出的行数。
- **列选择**：`columns=title,region` 只导出指定列（最多 100，未知列 400 `export.invalidColumn`）。列顺序仍按实体声明顺序；与脱敏取交集——请求只包含被 `omit` 脱敏的列时返回 400 `export.noColumns`，不会退化成导出行 id。Web 列表按**当前可见列**导出（列显隐下拉的结果）。
- **后台导出**：`GET /api/v1/:resources/export?async=1` 立即返回 `202 { jobId, total }`，后台按同样的分页/行谓词/脱敏构建 CSV 并**存到任务行**（`qiy_export_jobs.payload`，MySQL 用 MEDIUMTEXT）；`GET /api/v1/:resources/export/jobs/:id` 查询进度（未完成 200 带状态，未知/跨资源 404），`GET /api/v1/:resources/export/jobs/:id/download` 在完成后一次性下载（未完成 409 `export.notReady`）。任务行持久化，跨请求/重连后可继续取结果。
- 规模：默认上限 1000 行，可用 `QIY_EXPORT_MAX_ROWS` 调整（1–100000）。超过上限时返回 **400 `export.tooLarge`**，而不是静默导出部分数据；请先收窄过滤条件。
- 审计：每次导出写入一条 `<resource>.exported` 审计事件（行数、过滤条数、操作者），便于追溯数据外带。
- Web：列表页头部有 **Export CSV** 按钮（`web/app/export.ts`），它把当前表格的过滤/排序状态（`useTable` 的 `filters`/`sorters`）编码成同一套参数，因此导出范围与屏幕上看到的行一致；服务端拒绝（401 / 400 `export.tooLarge`）以通知形式显示，不会下载残缺文件。
- 需要已认证调用者，匿名请求返回 401；响应为 `text/csv; charset=utf-8` 并带 `Content-Disposition` 附件头，CSV 按 RFC 4180 转义（逗号、引号、换行）。
- 写入越权也返回 4xx：当写入的行落在调用者自身行谓词之外时，返回 **403 `policy.outsideScope`**，而不是 500。

## 保存视图（服务端）

浏览器本地视图（`qiy.views.<resource>`）之外，每个应用还生成一套服务端保存视图，用于跨设备同步与团队共享：

- `GET /api/v1/saved-views?resource=<table>` → `{ items }`：返回**自己的**视图 + 所有人可见的 `shared` 视图，按更新时间倒序。
- `POST /api/v1/saved-views` body `{ resource, name, shared?, search?, filters?, sorters?, columns? }` → `201` 视图对象；`name` 去空格后必填（≤80 字符），`filters` ≤50 项、`sorters` ≤10 项、`columns` ≤100 项。
- `DELETE /api/v1/saved-views/:id` → `204`；只有创建者能删除（他人 `403 views.forbidden`），不存在 `404`。
- 校验：未知资源 `400 views.unknownResource`；每人每资源最多 100 个视图（`400 views.limit`）；未认证 `401`。
- 持久化在生成的 `qiy_saved_views` 表（三方言 schema 都包含），不依赖进程内存。
- Web：列表页打开时通过 `web/app/views-api.ts` 的 `fetchServerViews()` 拉取并合并进 `Saved views` 下拉（共享视图显示为 `名称 (shared)`，可直接应用）；本地视图仍是即时保存，发布共享视图目前通过上述 API。

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

