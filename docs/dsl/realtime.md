# Realtime

`realtime` 为生成的 Refine 资源声明实时订阅。传输由 `api.client` 推导：当前已经实现并验收 `rest` + Ably；`graphql` 的 GraphQL Subscription 仍会在生成阶段 fail-closed，不会静默退化成另一个协议。Realtime 必须同时声明生成式 `auth`，因为 token、死信、指标、重放和清理端点都必须重新认证并执行角色授权；未声明认证的模型会在生成前失败。

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

## 当前边界

- 当前实现是**多实例 at-least-once**：PostgreSQL/MySQL 使用带过期时间的租约与 `SKIP LOCKED` 避免正常并发扫描重复领取；SQLite 仍定位为单进程开发/轻量部署。
- provider 已成功但数据库尚未标记 delivered 时进程崩溃，或 publish 超过 `QIY_REALTIME_LEASE_MS` 后被另一 worker 重新领取，仍可能重复投递。消费者必须幂等，Qiy 不宣称 exactly-once。
- `QIY_REALTIME_LEASE_MS` 默认 `30000`，必须大于正常 provider publish 延迟；修改 Outbox Schema 后，已有生成项目必须生成并执行数据库 migration，不能只替换运行时代码。
- `QIY_REALTIME_MAX_ATTEMPTS` 默认 `10`，`QIY_REALTIME_RETENTION_DAYS` 默认 `7`，`QIY_REALTIME_CLEANUP_MS` 默认 `86400000`（24 小时，最小 60 秒）。当前提供受保护的 HTTP 运维 API、机器可读运维 CLI、单条/批量死信重放、事务性管理员审计、JSON/Prometheus 指标、阈值健康告警、自动历史清理及 Prometheus Operator/Grafana 文件；尚无云监控专属适配器或原生 OTLP exporter，集群安装和 Grafana 实际导入仍需环境验收。
- 尚未实现 GraphQL Subscription、页面自定义 channel、record/global scope、permission 表达式和租户 capability 细分。
- 真实 Ably tenant、浏览器断线重连、跨租户拒绝和多副本部署仍需环境级验收。
