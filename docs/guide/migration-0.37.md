# 迁移到 0.37

0.37.0 是一次"删除冗余"的版本：同一件事只保留一种写法，旧写法直接删除，不保留兼容期。被删除的写法在解析时会报错，并在错误信息里指向本页。

| 删除的内容 | 改用 | 影响 |
| --- | --- | --- |
| v1 友好语法（`qiy v1;`） | v0 语法 | 模型需改写 |
| JetBrains MPS 工作台与 exporter | `.qiy` 文本 | 只影响仓库维护者 |
| 各厂商独立的 OIDC provider 关键字 | `provider oidc { preset ...; }` | 单 Provider 模型需改写 |
| Ably 实时传输、graphql-ws、outbox 死信与运维端点 | 内置 SSE | 重新生成 + 迁移 + 清理环境变量 |
| `dashboard { metric ... }` | `chart` | 模型需改写 |
| `llms-full.txt` | `llms-dsl.txt` + `llms-guides.txt` | 只影响 Agent 检索地址 |

升级步骤：

1. 按下面各节改写模型，运行 `qiy check` 直到没有错误。
2. 重新生成：`qiy generate app.qiy <输出目录> --sync`。
3. 运行数据库迁移（实时 outbox 表结构有变化）：开发环境在项目根目录运行 `bun run db:migrate`，生产环境在 `apps/server` 下运行 `bun run db:migrate:production`。
4. 从部署环境删除下文列出的旧环境变量。

## v1 友好语法

`qiy v1;` 开头的模型会报：

```text
The v1 shorthand syntax was removed in Qiy 0.37.0. Rewrite the model as `qiy v0; application <name> { ... }`; see docs/guide/migration-0.37.md.
```

v1 只是预处理成 v0 的语法糖，逐项改写即可：

| v1 | v0 |
| --- | --- |
| `qiy v1;` + `project shop` + `database sqlite` | `qiy v0;` + `application shop { database sqlite {} ... }` |
| `module Catalog { ... }` | 去掉外壳，或拆成 `include "modules/catalog.qiy";` 片段 |
| `entity Product { ... }`（PascalCase 自动转表名） | `entity Product table products { ... }` |
| 省略 `id` 自动生成主键 | 显式写 `field id UUID @id;` |
| `name: text`、`price: decimal(12, 2) nullable` | `field name Text;`、`field price Decimal(12, 2) @nullable;` |
| `primary` / `unique` 修饰 | `@id` / `@unique` |
| `customer: Customer`（一对一） | `field customerId UUID;` + `relation orderCustomer orders customerId customers id one;` |
| `lines: OrderLine[]`（一对多） | 在子实体写 `field orderId UUID;` + `relation orderLineOrder order_lines orderId orders id one;` |
| `tags: Tag[]` + `products: Product[]`（多对多） | 显式声明中间实体（如 `products_tags`）和两条 `relation ... one` |

类型名改为 v0 的大写形式：`text` → `Text`、`integer`/`int` → `Integer`、`decimal` → `Decimal`、`money` → `Money`、`uuid` → `UUID`、`date`/`time`/`datetime` → `Date`/`Time`/`DateTime`、`file`/`files` → `File`/`Files`、`vector(n)` → `Vector(n)`。注解（`@label`、`@display`、`@code`、`@onDelete` 等）和 v0 配置块原样保留。完整 v0 语法见 [DSL 总览](/dsl/overview)。

## MPS 工作台

仓库里的 `languages/`、`.mps/`、MPS exporter（`tools/mps-*.ts`）和内部的 `export-qiy`/`export-ir`/`validate-mps` 命令已删除，`fast-xml-parser` 依赖随之移除。已发布的 CLI 一直只接受 `.qiy`，因此只影响在本仓库里用 MPS 建模的维护者：用 0.36 的仓库导出一次 `.qiy`，之后直接维护文本模型。

## OIDC provider

所有外部登录都是 OpenID Connect，厂商之间只差端点形态、按钮文案和 claim 约定，所以 0.37 只保留一种外部 Provider，用 `preset` 选厂商。单 Provider 写厂商名会报：

```text
Unsupported auth provider okta; use provider local, otp or oidc (for example provider oidc { preset okta; })
```

| 0.36 | 0.37 |
| --- | --- |
| `provider okta;`（auth0、azure-ad-b2c、keycloak、google、kinde 同理） | `provider oidc { preset okta; }` |
| `provider oauth2;` / `provider sso;` | `provider oidc;` |
| `providers okta, google;` | 不变：名字与 preset 同名时自动套用 |
| 用 `keycloak` 名字承载其他 IdP（如 Dex） | 自由命名：`providers local, dex;` + `provider dex { label "Dex"; }` |

单 Provider 模式的环境变量仍是 `QIY_OIDC_ISSUER` / `QIY_OIDC_AUDIENCE` / `QIY_OIDC_JWKS_URL`；多 Provider 模式仍按 Provider 名使用 `QIY_OIDC_<NAME>_*`。只有在把 Provider 改名时（例如 `keycloak` → `dex`）才需要同步改环境变量名。详见 [Provider 命名与 preset](/dsl/auth#provider-命名与-preset)。

## 实时推送

`.qiy` 的 `realtime` 语法不变，变化都在生成结果里：

- 传输统一为 SSE：REST `GET /api/v1/realtime/stream`，GraphQL subscription `GET /graphql/subscribe`。生成的 Refine LiveProvider 已经指向新端点，不需要外部服务。
- 删除了 Ably 依赖、graphql-ws、outbox 租约/重试/死信/重放、管理与 Prometheus 指标端点、`realtime:admin` CLI 和 Grafana/Prometheus 清单。
- outbox 表删除了 `attempts`、`availableAt`、`deliveredAt`、`leaseOwner`、`leaseExpiresAt`、`deadLetteredAt`、`lastError` 列，索引改为 `qiy_realtime_outbox_created_idx`；重新生成后运行迁移即可。
- 反向代理需要允许 SSE 长连接：SSE 响应带 `X-Accel-Buffering: no`，Nginx 默认据此关闭缓冲；其他代理请对这两个路径关闭响应缓冲并放宽读超时（服务端每 25 秒发一次 keep-alive）。

从部署环境删除这些变量：

```text
QIY_ABLY_API_KEY
QIY_REALTIME_LEASE_MS
QIY_REALTIME_MAX_ATTEMPTS
QIY_REALTIME_SUBSCRIBE_POLL_MS
QIY_REALTIME_ADMIN_URL
QIY_REALTIME_ADMIN_TOKEN
QIY_REALTIME_METRICS_TOKEN
QIY_REALTIME_ALERT_MAX_PENDING
QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS
QIY_REALTIME_ALERT_MAX_DEAD_LETTERED
```

保留的变量：`QIY_REALTIME_DISABLED`（默认 0）、`QIY_REALTIME_POLL_MS`（默认 1000，最小 100）、`QIY_REALTIME_RETENTION_DAYS`（默认 1）、`QIY_REALTIME_CLEANUP_MS`（默认 3600000）。详见 [realtime](/dsl/realtime)。

## dashboard 指标

`dashboard { metric ... }` 会报：

```text
The dashboard { metric ... } block was removed in Qiy 0.37.0; declare chart views instead (for example chart const OrderCount { data = count orders; }); see docs/guide/migration-0.37.md.
```

逐条改写成 `chart`：

| 0.36 `metric` | 0.37 `chart` |
| --- | --- |
| `metric orderCount orders @label("订单总数") @icon(ShoppingOutlined);` | `chart const OrderCount { title = "订单总数"; icon = "ShoppingOutlined"; data = count orders; }` |
| `@type(distribution) @groupBy(status)` | `chart pie OrderStatus { data = count orders group by status; labels = status; }` |
| `@type(trend) @groupBy(createdAt) @days(30)` | `chart line OrderTrend { data = trend orders.createdAt days 30; }` |
| `@type(aggregate) @field(amount) @agg(sum)` | `chart const OrderAmount { data = sum orders.amount; }` |
| `@span(8\|12\|24)` | `chart panels` 的 `grid 24 <rows>` 与每个变体的 `x y w h` |
| `@comment(...)` | 无对应属性；说明写进 `title` 或 `qiy.charts.<Chart>.label` |
| `messages` 里的 `qiy.dashboard.<metric>.label` | `qiy.charts.<Chart>.label` |

没有任何 `chart` 时，概览页自动为每个可写资源显示一张计数卡，等同于 0.36 不写 `dashboard` 的默认行为。生成的 `apps/web/app/dashboard.ts` 会在 `--sync` 时删除。详见 [chart](/dsl/charts) 与 [菜单与概览页](/guide/menu-dashboard#从-dashboard-metric-迁移)。

## llms-full.txt

文档站不再发布 `llms-full.txt`，它与 `llms-dsl.txt` + `llms-guides.txt` 内容完全重复。Agent 先读 [llms.txt](/llms.txt) 索引或 Skill 的 `language-reference.md` 语法卡，需要全文时按主题请求 [llms-dsl.txt](/llms-dsl.txt) 或 [llms-guides.txt](/llms-guides.txt)。
