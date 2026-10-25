# application

一个 `.qiy` 项目有且只有一个 `application <name> { ... }` 块。块内的声明**顺序即语法**：解析器按固定顺序逐个匹配，顺序错了会报 `Expected <关键字> near token N`，而不是“任意顺序配置”。

```qiy
qiy v0;

application qiy-erp-admin @comment("Operations administration") {
  database postgresql @comment("Primary operational database") {
    extension pgvector;
  }

  mode standalone;

  workspace { name admin; }
  ui { library antd; theme blue; colorMode system; }
  api { client rest; }
  features { overview true; apiDocs true; apiKeys true; }
  realtime { mode auto; resource orders { events created, updated; roles admin, operator; } }
  elysia { bearer; serverTiming; }
  storage { provider local; }
  auth {
    providers local, oidc;
    user users;
    subjectField subject;
    roleField role;
    usernameField email;
    passwordField passwordHash;
    provider oidc { subjectField oidcSubject; }
  }
  env { variable PAYMENT_API_URL { production required; } }
  messages {
    default "zh-CN";
    locale "zh-CN" { "app.title" "运营后台"; }
  }

  permission field ApiGetOrderPermission "orders:read";
  permission group admin { ApiGetOrderPermission }
  permission group operator { ApiGetOrderPermission }
  permission group viewer { ApiGetOrderPermission }

  enum userRole { value admin; value operator; value viewer; }
  enum orderStatus { value draft; value paid; }

  entity users {
    field id UUID @id;
    field subject Text @unique;
    field oidcSubject Text @nullable @unique;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity customers { field id UUID @id; field name Text; }
  entity orders { field id UUID @id; field customerId UUID; field status orderStatus; }

  relation orderCustomer orders customerId customers id one;

  restrict orders { allow roles admin, operator; }

  pages orders { list roles admin, operator; }
  menu { group sales @label("销售") { resource orders; } }
  dashboard { metric orderCount orders @label("订单总数"); }

  // dataflow / action 见各自章节
}
```

## 块顺序与基数

| # | 块 | 基数 | 说明 |
| --- | --- | --- | --- |
| 1 | `database` | 必填 ×1 | 必须是 `application {` 之后的第一个声明 |
| 2 | `mode` | 0..1 | `standalone`（默认）/ `integration` |
| 3 | `integration` | 0..1 | 仅 `mode integration` 可用 |
| 4 | `workspace` | 0..1 | `qiy init` 的目录/包名映射 |
| 5 | `ui` | 0..1 | UI adapter、主题、明暗模式 |
| 6 | `api` | 0..1 | 前端 client 与 CORS |
| 7 | `features` | 0..1 | 系统管理页面开关 |
| 8 | `realtime` | 0..1 | 实时订阅 |
| 9 | `elysia` | 0..1 | 服务端插件组合 |
| 10 | `storage` | 0..1 | 文件存储 provider |
| 11 | `auth` | 0..1 | 认证与身份映射 |
| 12 | `env` | 0..1 | 自定义环境变量 |
| 13 | `messages` | 0..1 | 多语言词典（见 [多语言](/dsl/i18n)） |
| 14 | `permission …` | 0..N | 原子权限/权限组/来源/校验，连续书写 |
| 15 | `workflow <name>;` | 0..N | 目前只有 `orderInventory` |
| 16 | `enum …` | 0..N | 枚举（见 [enum/menu/dashboard](/dsl/enum-menu-dashboard)） |
| 17 | `entity …` | 0..N | 实体（见 [entity 与 field](/dsl/entity)） |
| 18 | `relation …;` | 0..N | 关系（见 [relation 与 index](/dsl/relation-index)） |
| 19 | `scope …;` | 0..N | 数据范围 |
| 20 | `restrict … { }` | 0..N | 行级/字段级策略 |
| 21 | `pages … { }` | 0..N | 页面级角色规则 |
| 22 | `menu { … }` | 0..1 | 侧边栏分组 |
| 23 | `dashboard { … }` / `chart …` | 0..N | 概览页，二者共享位置、可混排 |
| 24 | `dataflow … { }` | 0..N | 事务型命令（见 [dataflow](/dsl/dataflow)） |
| 25 | `action … { }` | 0..N | 命令按钮/手写页（见 [action](/dsl/actions)） |

## application 设置总表

下表覆盖 `application` 内全部配置块的可写键（顶层声明 `enum`/`entity`/`relation`/`menu`/`dashboard`/`dataflow`/`action` 见各自章节）；每一块的语法、默认值与错误在后续小节逐一展开。

| 块 | 键 / 语法 | 取值 | 默认 | 生成效果 |
| --- | --- | --- | --- | --- |
| `database` | `postgresql` / `mysql` / `sqlite` | 方言标识符 | 必填 | Drizzle schema 方言、迁移语句、连接驱动 |
| `database` | `@comment(...)` | 字面量或 `t("key")` | 无 | `schema.ts` 文件级 JSDoc |
| `database` | `extension <name>;` | 标识符 | 无 | 扩展声明；`pgvector`/`postgis` 仅 PostgreSQL |
| `mode` | `standalone` / `integration` | 标识符 | `standalone` | 是否生成独立 server workspace |
| `integration` | `apiBase "…"` | `http(s)://…` 或以 `/` 开头的路径 | 必填 | host DataProvider 的 base URL |
| `integration` | `auth none\|bearer\|cookie\|portal;` | 四选一 | `none` | host 认证传输方式 |
| `integration` | `auth cookie { csrfCookie …; csrfHeader …; }` | 字符串 | 无 | 写请求附带 CSRF 头 |
| `integration` | `response { data …; total …; error …; }` | 点分 JSON 路径 | 无 | 解析 host 响应包络 |
| `integration` | `pagination page\|offset\|none;` | 三选一 | `page` | host 列表分页参数 |
| `integration` | `tenant { header …; identity …; }` | 头部名 + identity key | 无 | 请求携带宿主租户头 |
| `workspace` | `name <id>;` | 标识符 | `application` 名 | `qiy init` 的目标目录前缀 |
| `workspace` | `aliases { server …; web …; deploy …; }` | 标识符 | `<name>-server` / `<name>-web` / `<name>` | 生成目录名 |
| `workspace` | `packages { server …; web …; }` | 引号字符串 | 默认包名 | 生成包名 |
| `ui` | `library antd;` | 仅 `antd` | `antd` | UI adapter |
| `ui` | `theme <key>;` | `blue`/`purple`/`green`/`orange`/`red` | `themes` 的第一个 | 默认品牌色 |
| `ui` | `themes …;` | 上述 key 的逗号列表 | 全部五个 | Header 主题切换项 |
| `ui` | `colorMode light\|dark\|system;` | 三选一 | `system` | 默认明暗模式 |
| `ui` | `allowThemeSwitch <bool>;` | `true`/`false` | `true` | 是否渲染主题控件 |
| `ui` | `allowColorModeSwitch <bool>;` | `true`/`false` | `true` | 是否渲染明暗控件 |
| `api` | `client rest\|graphql;` | 二选一 | `rest` | 前端 DataProvider 传输层 |
| `api` | `cors { origin "…"; … }` | 精确 http(s) origin | 无 | `QIY_CORS_ORIGINS` 与服务端 CORS 白名单 |
| `features` | `overview <bool>;` | 布尔 | `true` | `/system/overview` 功能总览页 |
| `features` | `apiDocs <bool>;` | 布尔 | `false` | `/system/api-docs`、`/api/v1/openapi.json` |
| `features` | `apiKeys <bool>;` | 布尔 | `false` | `/system/api-keys`、`qiy_api_keys` 表与端点 |
| `realtime` | `mode auto\|manual;` | 二选一 | `auto` | Refine LiveProvider 订阅模式 |
| `realtime` | `resource <table> { … }` | 表名 | 必填 | 每个资源的订阅配置 |
| `realtime` | `events created, updated, deleted;` | 事件列表 | 必填 | 发布哪些事件 |
| `realtime` | `roles admin, operator, viewer;` | 角色列表 | 必填 | 可订阅角色（capability token） |
| `realtime` | `when <field> claim <claim>;` | 字段 + claim | 无 | 行级通道隔离 |
| `elysia` | `bearer;` / `serverTiming;` / `html;` / `drizzle;` | 开关 | 关 | 服务端插件 |
| `elysia` | `jwt { name …; secretEnv …; }` | 标识符 | `jwt` / `QIY_JWT_SECRET` | JWT 插件与 secret 环境变量 |
| `elysia` | `static { assets …; prefix …; }` | 字符串 | `public` / `/public` | 静态资源目录与前缀 |
| `elysia` | `graphqlAdapter adapter native\|yoga\|apollo;` | 三选一 | `native` | GraphQL 适配器依赖 |
| `elysia` | `cron { job <name> pattern "<cron>" task cleanupMissingAttachments; }` | job 列表 | 无 | 定时清理任务 |
| `storage` | `provider local\|s3;` | 二选一 | `local` | 文件存储适配与 `QIY_STORAGE_*` |
| `auth` | `provider <id>;` / `providers <id>, …;` | 11 种 provider | 必填 | 登录页与 token 校验 |
| `auth` | `provider <id> { subjectField …; claim …; }` | 映射块 | 无 | 每 provider 的标识列/claim |
| `auth` | `user <entity>;` | 实体名 | 必填 | 用户表 |
| `auth` | `subjectField` / `roleField` / `usernameField` / `passwordField` / `profileField` | 字段名 | 视 provider | 身份/角色/口令列 |
| `env` | `variable NAME { … }` | 大写变量名 | 无 | server/web `.env.*` 文件 |
| `messages` | `default "…";` / `locale "…" { "k" "v"; }` | BCP 47 + 词典 | 无 | i18n provider 与模型 label 翻译 |
| `permission` | `field` / `group` / `from` / `verification` | 见 [permissions](/dsl/permissions) | 无 | 权限提供者与守卫 |
| `workflow` | `orderInventory;` | 唯一取值 | 无 | 采购/库存事务链路 |
| `scope` | `scope <resource> <field> claim <claim> [tree …];` | 见下 | 无 | 行级数据范围 |
| `restrict` | `allow roles` / `when` / `mask` | 见下 | 无 | 行策略与字段脱敏 |
| `pages` | `<action> roles …;` / `field <f> roles …;` | 见下 | 无 | 页面级 RBAC |

## database

### 语法

```text
database <postgresql|mysql|sqlite> [@comment(...)] {
  extension <name> ;
  ...
}
```

### 参数

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| 方言 | `postgresql`、`mysql`、`sqlite` | 必填 | 其它值报 `Unsupported database dialect X` |
| `@comment(...)` | 字面量或 `t("key")` | 无 | 生成 `schema.ts` 文件级 JSDoc（含 `i18n: key`） |
| `extension <name>` | 标识符，可多条 | 空 | 数据库扩展声明；当前 `pgvector`、`postgis` 被识别，二者要求 PostgreSQL |

### 默认值与校验

- `database` 是 `application` 内的第一个声明，缺失或位置错误报 `Expected database near token N`。
- 扩展必须在 `database` 中声明后才能在字段 `@extension(...)` 中使用，否则 `undeclared extension X`。
- `pgvector`/`postgis` 出现在非 PostgreSQL 方言报 `pgvector and postgis require PostgreSQL`。
- `Vector` 字段还要求 `database postgresql` + 已声明 `extension pgvector`，否则 `Vector requires PostgreSQL and a declared pgvector extension`。

### 生成结果

Drizzle schema 的方言、列类型映射、迁移 SQL 生成器，以及（PostgreSQL 时）`vector` 列与 `hnsw`/`ivfflat` 索引支持。

### 示例

```qiy
database postgresql @comment("Primary operational database") {
  extension pgvector;
}

database sqlite {}
database mysql {}
```

### 进阶用法

- 同一模型只能有一个方言；需要多库时生成两个项目（或让宿主服务负责跨库读写）。
- `extension` 只是声明，是否真的创建扩展仍取决于目标数据库的迁移权限与 DBA 流程。
- 生产环境建议 `postgresql`：`Vector`、`pgvector` 索引与 `@concurrently` 只在 PostgreSQL 可用。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Unsupported database dialect oracle` | 只用三种受支持方言 |
| `Vector requires PostgreSQL and a declared pgvector extension` | 换 `postgresql` 并声明 `extension pgvector;`，字段再加 `@extension(pgvector)` |
| `@comment` 里 `t("key")` 报 `Missing default locale message for database comment: key` | 在 `messages` 的默认语言里补该 key |

## mode 与 integration

### 语法

```text
mode standalone | integration ;

integration {
  apiBase "<absolute-http-url-or-/path>" ;
  auth none | bearer | cookie | portal ;
  auth cookie { csrfCookie "<name>" ; csrfHeader "<header>" ; } ;   // 仅 cookie
  response { data "<path>" ; total "<path>" ; error "<path>" ; } ;   // 至少一项
  pagination page | offset | none ;
  tenant { header "<header>" ; identity "<identity-key>" ; } ;       // 两者都要
}
```

### 参数

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `apiBase` | `https://…`、`http://…` 或以 `/` 开头的路径 | 必填 | 其它形态报 `integration apiBase must be an absolute http(s) URL or a path starting with /` |
| `auth none` | — | 是 | 不带认证 |
| `auth bearer` | — | — | `Authorization: Bearer <token>` |
| `auth cookie` | 可带 `csrfCookie`/`csrfHeader` | — | Cookie 凭证 + CSRF 头；选项只允许 cookie transport |
| `auth portal` | — | — | 宿主门户注入身份（BFF/门户场景） |
| `response.data` / `.total` / `.error` | 点分 JSON 路径（`items`、`meta.count`） | 无 | 只接受纯 key 组成，`$.items` 会报 `dotted JSON path` |
| `pagination` | `page` / `offset` / `none` | `page` | 分页参数约定 |
| `tenant.header` | 简单 HTTP 头名 | 无 | 转发宿主租户 |
| `tenant.identity` | 简单 identity key | 无 | 从当前身份里取值的键 |

### 默认值与校验

- `mode` 缺省为 `standalone`。
- `mode integration` 必须有 `integration` 块（`application mode integration requires an integration block`）。
- 有 `integration` 块但 `mode` 不是 `integration` 报 `integration block requires application mode integration`。
- 每个键最多出现一次（`Duplicate integration setting X`）；`response` 至少一项；同一 `response` 键不能重复。
- **integration 模式禁止生成式服务端特性**：同时出现 `api { cors { … } }`、`elysia`、`storage`、`auth`、`env`、`scope`、`restrict`、`workflow`、`dataflow`、`permission` 时直接报 `application mode integration cannot configure generated server features; use integration auth and host adapters instead.`（`api { client … }` 本身允许。）
- `realtime` 在 integration 模式报 `application mode integration cannot generate standalone realtime; use the host LiveProvider adapter instead.`
- `mode integration` **不能**用 `qiy generate`/`qiy create` 生成独立工作区：`application mode integration must be mounted with qiy init inside an existing Bun workspace`。

### 生成结果

- `apps/<web>/app/host/data-provider.ts`：按 `apiBase`、`response` 包络、`pagination`、`tenant` 生成可运行的 host DataProvider（`getList/getOne/create/update/deleteOne`）。
- `apps/<web>/app/host/auth.ts`：`bearer`/`cookie`/`portal` 认证注入，以及 `X-Tenant-Id` 之类的租户头；identity 缺失时抛 `Host tenant identity is missing`。
- `apps/<web>/QIY_INTEGRATION.md`：说明宿主需要实现的契约。
- 不生成 server 包；业务规则、路由映射与授权保留在宿主适配层。

### 示例

```qiy
qiy v0;
application host-catalog {
  database sqlite {}
  mode integration;
  integration {
    apiBase "https://api.example.com/api/v2";
    auth bearer;
    response { data "items"; total "meta.count"; error "message"; };
    pagination offset;
    tenant { header "X-Tenant-Id"; identity "tenantId"; };
  }
  entity products { field id UUID @id; field title Text; }
}
```

### 进阶用法

`response` 只描述**读**包络；写请求假设宿主返回记录本身。`pagination none` 表示宿主不分页（前端一次取全量）。`auth portal` 用于宿主已经建立会话、由反向代理注入身份头的场景，`tenant.identity` 再决定从哪取租户值。宿主适配器（URL 映射、业务校验、鉴权）必须写在未被 Qiy 登记的文件里，`--sync` 不会覆盖。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `integration requires apiBase` | 补 `apiBase` |
| `Integration auth options are only supported for cookie transport` | `csrfCookie`/`csrfHeader` 只在 `auth cookie { … }` 里写 |
| `integration tenant requires header and identity` | 两个键都要写 |
| `application mode integration cannot configure generated server features` | 把 `auth`/`storage`/`env` 等换成宿主实现；integration 项目不生成 server |
| `Duplicate integration setting response` | 每个 `response`/`tenant`/`auth` 只出现一次 |

## workspace

### 语法

```text
workspace {
  name <identifier> ;
  aliases { server <identifier>; web <identifier>; deploy <identifier>; }
  packages { server "<package-name>"; web "<package-name>"; }
}
```

### 参数与默认值

| 键 | 取值 | 默认 |
| --- | --- | --- |
| `name` | 标识符 | `application` 名 |
| `aliases.server` | 标识符 | `<name>-server` |
| `aliases.web` | 标识符 | `<name>-web` |
| `aliases.deploy` | 标识符 | `<name>` |
| `packages.server` | 引号字符串 | 由 workspace 名推导 |
| `packages.web` | 引号字符串 | 由 workspace 名推导 |

校验：`workspace` 下只允许 `name`/`aliases`/`packages`；`aliases` 只允许 `server`/`web`/`deploy`；`packages` 只允许 `server`/`web`；重复键报 `Duplicate workspace …`；alias 不能是非法标识符。

### 生成结果

只影响 `qiy init`（把 admin 挂载进已有 Bun 工程）：生成目录名、包名、`deploy/` 目录名与 `docker-compose.<alias>.yml`。`qiy create`/`qiy generate` 忽略 alias 之外的细节，仍生成标准 `apps/server`、`apps/web`。`-n` 可以一次性覆盖 `name`。

### 示例

```qiy
workspace {
  name ops;
  aliases { server ops-api; web ops-console; deploy ops-admin; }
  packages { server "@example/ops-api"; web "@example/ops-console"; }
}
```

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Unsupported workspace alias api` | alias 只有 `server`/`web`/`deploy` |
| `Duplicate workspace server configuration` | 每个区块只写一次 |
| `Workspace name cannot be represented in Qiy syntax` | 用标识符（字母/数字/`_`/`-`） |

## ui

### 语法

```text
ui {
  library antd;
  theme <blue|purple|green|orange|red>;
  themes <key> [, <key>]*;
  colorMode <light|dark|system>;
  allowThemeSwitch <true|false>;
  allowColorModeSwitch <true|false>;
}
```

### 参数

| 参数 | 取值 | 默认 | 生成效果 |
| --- | --- | --- | --- |
| `library` | 仅 `antd` | `antd` | UI adapter（`mui`/`mantine`/`chakra` 报 `Unsupported UI library X; only antd is implemented`） |
| `theme` | 五个主题 key | `themes` 的第一个 | 默认品牌色 |
| `themes` | 五个 key 的逗号列表 | `blue, purple, green, orange, red` | Header 主题切换项与 `qiy.theme*` 文案 |
| `colorMode` | `light`/`dark`/`system` | `system` | 初始明暗模式 |
| `allowThemeSwitch` | 布尔 | `true` | 是否渲染主题控件 |
| `allowColorModeSwitch` | 布尔 | `true` | 是否渲染明暗控件 |

### 默认值与校验

- 未声明 `ui` 时使用 antd + 全部五个主题 + `blue` + `system` + 两个开关 `true`。
- `theme` 必须包含在 `themes` 中，否则 `UI default theme X must be included in themes`。
- `themes` 不能为空（`requires at least one theme key`）、不能重复（`Duplicate UI theme X`）。
- 每个键最多一次（`Duplicate UI setting X`）；未知键报 `Unsupported UI setting X`。

### 生成结果

- `apps/web/app/ui/`：`ConfigProvider` 主题算法、`QiyUiProvider`、`QiyThemedLayout`、Header 右上角的主题/明暗控件。
- 选择写入浏览器 `localStorage`；`system` 监听 `prefers-color-scheme`；折叠侧边栏状态独立保存。
- 语言选择器与 i18n 分开保存（`qiy.locale`），切换后同步 Ant Design locale 与 `<html lang/dir>`。
- 页面优先使用 `@refinedev/antd` 的 `List`/`Show`/`Create`/`Edit`/按钮，再用 Ant Design 原生组件补足动态字段、批量操作与 Action。

### 示例

```qiy
ui {
  library antd;
  theme green;
  themes green, blue, purple;
  colorMode system;
  allowThemeSwitch true;
  allowColorModeSwitch true;
}
```

### 进阶用法

只要定制品牌色，就把 `themes` 收窄到需要的 key 并让 `theme` 指其中一个；如果不想让用户切换，关掉两个 `allow*` 开关即可（控件不渲染，服务端不受影响）。完整主题示例见 [examples/themes/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/themes/app.qiy)。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Unsupported UI library mui` | 只有 `antd` 可用 |
| `UI default theme purple must be included in themes` | 把 `purple` 加进 `themes` |
| `Duplicate UI theme blue` | 去掉重复 key |

## api

### 语法

```text
api {
  client <rest|graphql> ;
  cors {
    origin "<exact-origin>" ;
    ...
  }
}
```

### 参数

| 参数 | 取值 | 默认 | 生成效果 |
| --- | --- | --- | --- |
| `client` | `rest` / `graphql` | `rest` | 前端 DataProvider：REST 走 `/api/v1/*`，GraphQL 走 `/graphql` |
| `cors.origin` | 精确 `http(s)://host[:port]`，可多条 | 无 | `QIY_CORS_ORIGINS` 与服务端 CORS 白名单 |

### 默认值与校验

- `client` 必须写在 `cors` 之前（解析器 `expect("client")` 后才会看 `cors`）。
- 不支持 `basePath` 配置：REST 前缀固定 `/api/v1`，GraphQL 固定 `/graphql`。
- `origin` 必须是引号字符串（`CORS origins must be quoted strings`）。
- 不能带通配符、路径、用户信息；`*`、`https://x/*`、`https://x/path` 都报 `CORS origin must be an exact http(s) origin without a path or wildcard`。
- 至少一个 origin（`CORS configuration requires at least one origin`）；重复 origin 自动去重。

### 生成结果

- Web：`app/data-provider.ts`（REST）或 `app/graphql/data-provider.ts`；`VITE_QIY_API_TRANSPORT` 记录 transport。
- Server：始终同时提供 REST 与 `/graphql`；配置了 CORS 时把 origin 列表注入 `QIY_CORS_ORIGINS` 并启用 CORS 中间件。

### 示例

```qiy
api {
  client graphql;
  cors {
    origin "https://admin.example.com";
    origin "http://localhost:5173";
  }
}
```

### 进阶用法

- REST 与 GraphQL 服务端**同时存在**：`client` 只决定 Web 用哪套 DataProvider，切换不需要改服务端。
- 前后端分离部署（Web 在 CDN、API 在另一域）必须配置 `cors`，并把精确 origin 写全（含端口）。
- 本地开发端口（Vite `5173`、preview `3000`）要逐个加入 origin，通配符不会被接受。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Unsupported API client grpc` | 只用 `rest`/`graphql` |
| `CORS origins must be quoted strings` | 写 `origin "https://…";` |
| `Invalid CORS origin https://example.com/` | 去掉尾部斜杠/路径 |

## features

### 语法

```text
features {
  overview <true|false> ;
  apiDocs <true|false> ;
  apiKeys <true|false> ;
}
```

### 参数与默认值

| 键 | 默认 | 生成内容 | 依赖 |
| --- | --- | --- | --- |
| `overview` | `true` | `/system/overview` 功能总览（实体 Mermaid、Dataflow、权限模型） | 至少一个 docs 开关打开才实际生成 |
| `apiDocs` | `false` | `/system/api-docs` 页面 + `/api/v1/openapi.json` + `/api/v1/docs/model` | — |
| `apiKeys` | `false` | `/system/api-keys` 页面、`qiy_api_keys` 表、`/api/v1/auth/api-keys` 端点、Bearer/`X-API-Key` 认证 | 必须同时声明 `auth` |

### 默认值与校验

- 未知键报 `Unsupported features setting X; expected overview, apiDocs or apiKeys`；重复键报 `Duplicate features setting X`。
- `apiKeys true` 但没有 `auth` 块：解析期就报 `features apiKeys requires an auth block`；生成期还会校验 `auth` 的 user 实体存在（`features apiKeys requires the auth user entity X`）。
- `overview` 只有在 `apiDocs` 或 `apiKeys` 打开时才生成页面（总览页需要 docs API 提供数据）。

### 生成结果

系统管理菜单组下的三个页面、OpenAPI 端点与 API Key 表；菜单项只在对应页面生成时出现。细节见 [features](/dsl/features) 与 [API 文档与访问密钥](/guide/api-docs-and-keys)。

### 示例

```qiy
features {
  overview true;
  apiDocs true;
  apiKeys true;
}
```

### 进阶用法

- `apiDocs` 与 `apiKeys` 是独立开关：只开 `apiDocs` 时没有密钥表；只开 `apiKeys` 时没有 `openapi.json`，但仍有 `/api/v1/docs/model`。
- 三个页面都受登录保护且按当前角色的权限过滤内容，所以“生成页面”≠“授权访问”，访问控制仍由 `auth` + `permission` 决定。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `features apiKeys requires an auth block` | 同时写 `auth { … }` |
| 总览菜单没出现 | `overview` 是 true 但 `apiDocs`/`apiKeys` 都是 false |

## realtime

### 语法

```text
realtime {
  mode <auto|manual> ;
  resource <tableName> {
    events <created|updated|deleted> [, ...] ;
    roles <admin|operator|viewer> [, ...] ;
    when <field> claim <claim> ;
  }
  ...
}
```

### 参数

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | `auto` / `manual` | `auto` | `auto`：写操作后自动发布；`manual`：由显式调用发布 |
| `resource` | 表名（`tableName`） | 必填 | 每个资源最多一次（`Duplicate realtime resource X`） |
| `events` | 三个事件的逗号列表，至少一个 | 必填 | 空或重复报 `events requires at least one event` / `duplicate event X` |
| `roles` | 角色列表，至少一个 | 必填 | 决定 capability token 的订阅范围 |
| `when <field> claim <claim>` | 字段名 + claim（点分或引号） | 无 | 行级通道：订阅者只收到该字段等于自己 claim 的记录 |

### 默认值与校验

- 需要生成的 `auth`：`Realtime requires generated authentication`。
- 至少一个资源（`Realtime requires at least one resource`）。
- 集成模式禁用（见 [integration](#mode-与-integration)）。
- 生成期额外校验：claim 字段必须存在、非可空、类型为 `Text` 或 `Integer`；带行谓词（`restrict … when`）的资源不能开 realtime（共享 channel 无法按订阅者裁剪）；已声明 `when … claim` 时也不能再叠加行谓词。

### 生成结果

- Server：`/api/v1/realtime/token`（角色 + 资源范围、只订阅权限）、`realtime` outbox 表与投递 worker、`/api/v1/realtime/outbox` 管理端点、Prometheus 指标。
- Web：Refine LiveProvider（REST 用 Ably；GraphQL 另有 SSE subscription transport）；字段 `mask` 会在入队前从负载中删除。
- 环境变量：`QIY_ABLY_API_KEY`、`QIY_REALTIME_*`。完整说明见 [realtime](/dsl/realtime)。

### 示例

```qiy
realtime {
  mode auto;
  resource orders {
    events created, updated;
    roles admin, operator;
  }
  resource invoices {
    events created;
    roles admin;
    when tenantId claim tenant.id;
  }
}
```

### 进阶用法

- 只订阅需要的资源与事件：每个订阅都会产生 outbox 行与投递开销。
- 行级隔离优先用 `when <field> claim <claim>`（按 claim 分 channel），而不是在客户端过滤。
- 需要“只让管理员收删除事件、运营收更新事件”时，拆成两个 `resource` 声明是不允许的（同一资源只能一条）；用角色集合表达共同可见范围。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Realtime requires generated authentication` | 添加 `auth { … }` |
| `Realtime X: restrict row predicates cannot be enforced on a shared channel` | 去掉该资源的 `restrict … when`，或改用 `when <field> claim` |
| `claim field X must be non-nullable` | 把 claim 字段改为非空 |

## elysia

### 语法

```text
elysia {
  bearer;
  serverTiming;
  html;
  drizzle;
  jwt { name <identifier>; secretEnv <identifier>; }   // 或 jwt;
  static { assets <string>; prefix <string>; }         // 或 static;
  graphqlAdapter adapter <native|yoga|apollo>;
  cron {
    job <name> pattern "<5-or-6-field cron>" task cleanupMissingAttachments;
  }
}
```

### 参数与默认值

| 配置 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `bearer` | 开关 | 关 | 解析 Bearer 令牌 |
| `serverTiming` | 开关 | 关 | 输出 `Server-Timing` |
| `html` | 开关 | 关 | HTML 响应帮助器 |
| `drizzle` | 开关 | 关 | Drizzle→TypeBox 校验插件 |
| `jwt` | 裸写或带块 | `name`=`jwt`，`secretEnv`=`QIY_JWT_SECRET` | JWT 命名空间与 secret 环境变量 |
| `static` | 裸写或带块 | `assets`=`public`，`prefix`=`/public` | 静态资源；`prefix` 必须以 `/` 开头 |
| `graphqlAdapter adapter X` | `native`/`yoga`/`apollo` | `native` | 选择 `@elysia/graphql-yoga`/`@elysia/apollo` 依赖 |
| `cron` | 若干 `job` | 无 | 只支持任务 `cleanupMissingAttachments` |

### 默认值与校验

- 未知插件报 `Unsupported Elysia plugin configuration X`；`cron` 的 `task` 不是 `cleanupMissingAttachments` 报 `Unsupported Cron task X`；`graphqlAdapter` 非法报 `Unsupported GraphQL adapter X`。
- `static.prefix` 不以 `/` 开头：解析期报 `Elysia static prefix must start with /`；生成期还要求 `assets` 是 `public` 或其子目录、`prefix` 不能落在 `/api`、`/graphql`、`/assets`（例如 `Elysia Static: prefix must be a dedicated path outside /api, /graphql and /assets`）。
- `cron` 的 job 名必须匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$` 且唯一；`pattern` 必须是 5 或 6 段（`Cron X: pattern must have 5 or 6 fields`）。

### 生成结果

- Server 的 Elysia 插件注册、依赖项（`@elysia/bearer`、`@elysia/server-timing`、`@elysia/cron`、`@elysia/jwt`、`@elysia/static`、`@elysia/html`、`@elysia/graphql-yoga`、`@elysia/apollo`）。
- `QIY_CRON_ENABLED=0`（cron 需要显式开启）；JWT 的 `secretEnv` 出现在生成的 `.env.*` 注释中。
- 静态资源路由把 `assets` 目录挂到 `prefix`。

### 示例

```qiy
elysia {
  bearer;
  serverTiming;
  jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; }
  static { assets "public"; prefix "/public-assets"; }
  graphqlAdapter adapter yoga;
  cron {
    job pruneAttachments pattern "0 3 * * *" task cleanupMissingAttachments;
  }
}
```

### 进阶用法

`jwt`/`static` 的裸写形式适合默认值；需要自定义命名空间或目录时再写块。`graphqlAdapter` 一旦选择 `yoga`/`apollo`，生成器会换成对应适配器依赖并保持 REST 端点不变。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Unsupported Elysia plugin configuration cors` | CORS 写在 `api { cors { … } }` |
| `Elysia Static: assets must be public or a subdirectory of public` | 把目录放到 `public/` 下 |
| `Cron prune: pattern must have 5 or 6 fields` | 用标准 5 段 cron（如 `0 3 * * *`） |

## storage

### 语法

```text
storage { provider local | s3 ; }
```

### 参数与默认值

| 参数 | 取值 | 默认 | 生成效果 |
| --- | --- | --- | --- |
| `provider` | `local` / `s3` | `local` | 文件存储适配、`QIY_STORAGE_PROVIDER`、`QIY_STORAGE_ROOT`、`QIY_STORAGE_METADATA` |

校验：只允许 `local`/`s3`（`Unsupported storage provider X`）；`provider` 必写。

### 生成结果

- 存储适配层（本地磁盘或 S3 兼容）、`attachments` 元数据表、`/api/v1/files` 上传/下载路由。
- `s3` 额外生成 `QIY_S3_BUCKET`、`QIY_S3_REGION`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY`、`QIY_S3_SESSION_TOKEN` 环境变量。
- 字段级策略（`@upload`/`@maxBytes`/`@mime`/`@maxFiles`）见 [entity 与 field](/dsl/entity#字段属性矩阵)。

### 示例

```qiy
storage { provider s3; }
```

### 进阶用法

- 本地 `local` 适合开发与单机部署；多副本部署必须用 `s3`（或共享卷），否则各副本看不到彼此上传的文件。
- `s3` 的凭据只放在环境变量/secret manager，绝不写进 `.qiy`。
- 字段级上传策略（大小、MIME、数量）在模型里声明，服务端会二次校验；不要只依赖前端 accept。

### 相关

完整上传、认证、Attachment 元数据与 S3 说明见[文件存储](/guide/storage)。

## auth

这里只列**块级语法与校验**；provider 细节、登录流程、绑定与 onboarding 见 [认证与登录（auth）](/dsl/auth)。

### 语法

```text
auth {
  provider <provider-id> ;
  providers <provider-id> [, <provider-id>]* ;        // 与 provider 互斥
  provider <provider-id> {                            // 每 provider 映射
    subjectField <user-field> ;
    claim <plain-claim-name> ;
  }
  user <entity> ;
  subjectField <user-field> ;
  roleField <user-field> ;
  usernameField <user-field> ;                        // local / otp
  passwordField <user-field> ;                        // local
  profileField <user-field> ;                         // 需要至少一个 OAuth/OIDC
}
```

### 参数

| 键 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `provider` | `local`、`otp`、`oidc`、`oauth2`、`sso`、`okta`、`auth0`、`azure-ad-b2c`、`keycloak`、`google`、`kinde` | 必填（或改用 `providers`） | 单 provider 模式 |
| `providers` | 上面列表的逗号组合（可含 `local`，不能含 `otp`） | 无 | 多 provider / hybrid 模式 |
| `provider <id> { … }` | 映射块 | 无 | 每 provider 的标识列与 claim |
| `user` | 实体名 | 必填 | 用户表 |
| `subjectField` | 用户表字段 | 无 | 外部身份标识列（OAuth 家族必填） |
| `roleField` | 用户表字段 | 必填 | 角色列 |
| `usernameField` | 用户表字段 | 无 | `local`/`otp` 必填 |
| `passwordField` | 用户表字段 | 无 | `local` 必填 |
| `profileField` | 用户表字段 | 无 | 每 provider 的 profile 元数据 |

### 默认值与校验

解析期（`parseQiyProject`）：

- `provider` 与 `providers` 互斥（`Auth accepts either provider or providers, not both`）；`providers` 不能重复、不能包含 `otp`。
- `user` 必填（`Auth requires a user entity`）；`roleField` 必填（`Auth requires roleField`）。
- OAuth/OIDC 家族需要 `subjectField`（`Auth requires subjectField for OAuth/OIDC providers`）。
- `local` 需要 `usernameField` + `passwordField`；`otp` 需要 `usernameField` 且拒绝 `passwordField`；非 local/otp 的 provider 不接受用户名/口令字段。
- `profileField` 只允许在至少一个 OAuth provider 时声明。
- provider 映射：`subjectField` 必填；`claim` 必须是**裸标识符**（纯 claim 名，写引号会报 `Expected identifier`）；映射的 provider 必须在已配置列表内；每 provider 只能一个映射。

生成期（`generateServer`）额外校验用户表形态：

| 规则 | 错误信息 |
| --- | --- |
| `usernameField`：非空、唯一、`Text` | `Auth: usernameField must be a required unique Text field` |
| `passwordField`：可空 `Text`（存 hash） | `Auth: passwordField must be a nullable Text field storing the password hash` |
| `subjectField`：非空、唯一、`Text` | `Auth: subjectField must be a required unique Text field` |
| `roleField`：必须是枚举，且值恰好是 `admin`/`operator`/`viewer` | `Auth: roleField must be an enum with admin, operator and viewer values` |
| hybrid（local + OAuth）每 provider 需要独立的可空唯一 `Text` 列 | `Auth: provider X needs its own nullable subjectField mapping …` |
| hybrid 首次登录要能补齐所有非空列 | `Auth: OAuth onboarding cannot populate required user fields: …; make them nullable` |
| `profileField`：可空 `Text` | `Auth: profileField must be a nullable Text field storing per-provider profile metadata` |
| 未知用户实体 | `Auth: unknown user entity X` |

### 生成结果

- 登录页（单 provider / provider 选择器 / hybrid 密码 + OAuth）、回调、OTP、个人中心绑定/解绑、首次登录 onboarding。
- 服务端令牌校验（OIDC JWKS 或本地签名）、角色与 claim 注入、`/api/v1/auth/providers`、GraphQL/REST 守卫。
- 环境变量：`QIY_OIDC_*`（单 provider）或每 provider 的 `QIY_OIDC_<PROVIDER>_*`；hybrid 另有 `QIY_OIDC_DEFAULT_ROLE`；local 有 `QIY_AUTH_SECRET`。

### 示例

```qiy
auth {
  provider oidc;
  user users;
  subjectField externalSubject;
  roleField role;
}
```

### 进阶用法

混合登录（密码 + 多个 OAuth provider）与 per-provider 映射：

```qiy
auth {
  providers local, okta, google;
  user users;
  subjectField subject;
  roleField role;
  usernameField email;
  passwordField passwordHash;
  profileField oauthProfiles;
  provider okta { subjectField oktaSubject; }
  provider google { subjectField googleSubject; claim "sub"; }
}
```

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Auth providers cannot include otp` | OTP 用 `provider otp;` 单独声明 |
| `Auth provider local requires usernameField and passwordField` | 补两个字段 |
| `Auth provider google does not accept usernameField or passwordField` | 去掉口令字段（只有 local/otp 用） |
| `Auth: roleField must be an enum with admin, operator and viewer values` | 声明包含这三个值的 enum 并让 `roleField` 引用它 |
| `Provider mapping okta is not part of the configured providers` | provider 必须出现在 `provider`/`providers` 中 |

## env

### 语法

```text
env {
  variable <UPPER_NAME> {
    secret;
    development <"literal" | required | generate> ;
    production  <"literal" | required> ;
    example     <"literal" | required> ;
  }
}
```

### 参数与默认值

| 键 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| 变量名 | `^[A-Z_][A-Z0-9_]*$` | 必填 | 非法报 `Environment variable name must use uppercase letters, digits and underscores` |
| `secret;` | 开关 | 关 | 标记为机密；机密变量不能写任何字面值 |
| `development`/`production`/`example` | 引号字面量 / `required` / `generate` | 未配置则留空 | `required` 生成待填写空值；`generate` 只允许 `secret` 的 `development` |

### 默认值与校验

- 变量名重复报 `Duplicate environment variable X`；同一 mode 重复报 `Duplicate env X.development`。
- `generate` 用在非 `secret` 或非 `development` 报 `env X: generate is only allowed for secret development values`。
- `secret` 变量含字面值报 `env X: secret variables cannot contain literal values`。
- `VITE_` 前缀变量进入浏览器 bundle，不能 `secret`（`env X: frontend VITE_ variables cannot be secret`）。
- 名字里含 `SECRET`/`TOKEN`/`PASSWORD`/`API_KEY`/`ACCESS_KEY` 却未标 `secret` 会报 `mark credential-like values as secret`。

### 生成结果

生成 `apps/server/.env.{development,production,example}` 与 `apps/web/.env.{development,production,example}` 六个文件：

- 非 `VITE_` 变量只进 server 文件，`VITE_` 变量只进 web 文件。
- `generate` 在写入时替换为 32 字节随机 hex；`--sync`/`init` 会保留已有文件里的同名值（合并而不是覆盖）。
- 机密变量附 `# … is secret; supply it through a secret manager in production.` 注释；`production required` 附提醒注释。
- 生成器自身的内置变量（`QIY_DEV_MODE`、`QIY_STORAGE_*`、`QIY_OIDC_*`、`QIY_REALTIME_*`、`QIY_S3_*` 等）与模型变量合并输出。

### 示例

```qiy
env {
  variable PAYMENT_API_URL {
    development "http://localhost:8080";
    production required;
    example "https://api.example.com";
  }
  variable PAYMENT_API_TOKEN {
    secret;
    development generate;
    production required;
    example required;
  }
  variable VITE_PAYMENT_PUBLIC_KEY {
    development "pk_dev";
    production required;
  }
}
```

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `env API_TOKEN: mark credential-like values as secret` | 加 `secret;` |
| `env DB_PASSWORD: secret variables cannot contain literal values` | 改为 `production required;` 或 `development generate;` |
| `env VITE_TOKEN: frontend VITE_ variables cannot be secret` | 机密值放非 `VITE_` 变量 |

## messages

`messages` 声明默认语言与词典，是 `@comment(t("key"))`、模型 label 自动翻译键与界面文案覆盖的数据源。完整语法、key 规则、语言回退与 RTL 行为见 [多语言（messages / i18n）](/dsl/i18n)。

要点（与块顺序相关）：

- 位置在 `env` 之后、`permission`/`workflow`/`enum`/`entity` 之前。
- `default "<BCP 47>"` 必填且必须存在同名 `locale` 块，否则 `Missing default message locale X`。
- 语言标识必须是规范 BCP 47（`zh-CN`、`en-US`），`fr_fr`/`FR-fr` 报 `Invalid message locale X`。
- key 形如 `[a-zA-Z_][a-zA-Z_0-9.-]*`，禁止 `__proto__`/`prototype`/`constructor` 段；重复 key 报 `Duplicate message key`。
- `@comment(t("key"))` 在 `enum`/`entity`/`field` 等后续声明中**立即**解析，因此 `messages` 必须写在它们之前；`application`/`database` 的 `@comment(t(...))` 在 `messages` 解析后统一解析。

## permission

`permission` 声明原子权限、权限组、provider 来源与校验表达式；这些声明必须**连续书写**，位置在 `messages` 之后、`workflow` 之前。

```qiy
permission field ApiGetUserPermission "api:getUser" @label("Read user API");
permission group UserApiPermissionGroup { ApiGetUserPermission, ApiPutUserPermission }
permission group SuperAdminManager = UserApiPermissionGroup & ManagerRole;
permission from database field users.permissions;
permission from claim azure-ad-b2c "roles";
permission verification CanAccessUserApi {
  input { field permission Array<String>; }
  return input.permission all included in self.permissions;
}
```

`permission` 需要生成的 `auth`（`Permission declarations require a generated auth block`），且至少要有一个 `field`。完整语法、运算符（`some/all/not … included in`、`=`、`!=`）、HTTP 接口与 `dataflow`/`action` 的 `allow permission` 见 [权限（permission）](/dsl/permissions)。

## workflow

### 语法

```text
workflow orderInventory ;
```

### 参数与校验

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| 名称 | 仅 `orderInventory` | 必填 | 其它值报 `Unsupported workflow X`；重复报 `Duplicate workflow X` |

生成期要求：PostgreSQL 方言，且存在 `orders`、`orderItems`、`inventoryItems` 三个实体并满足约定字段（缺字段会报 `orderInventory workflow requires orders.approvedBy` 这类具体错误）。与 `restrict` 冲突时直接失败（`orderInventory does not apply row policy yet`）。字段清单见[业务工作流](/guide/workflow)。

### 生成结果

订单提交/审批/出库/取消与库存预占的事务链路、`order_reservations` 与 `order_idempotency` 表。说明见[业务工作流](/guide/workflow)。

### 示例

```qiy
workflow orderInventory;
```

### 进阶用法

- `orderInventory` 是**一个固定的内置流程**，不能参数化；需要自定义状态机时用 [dataflow](/dsl/dataflow) 显式写步骤。
- 它会生成额外的预占与幂等表，迁移评审时要一并检查。

## scope

### 语法

```text
scope <resource> <field> claim <claim> [ tree <treeEntity> <parentField> ] ;
```

### 参数

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `resource` | 实体名或表名 | 同一资源只能声明一次 |
| `field` | 该实体的 `UUID` 或 `Text` 字段 | 被限制的租户列 |
| `claim` | 点分标识符或引号字符串 | 例如 `org.id`、`"tenant_id"` |
| `tree <entity> <parentField>` | 自引用实体 + 父字段 | 把 claim 从单节点扩展为整棵子树 |

### 默认值与校验

- 字段必须是 `UUID` 或 `Text`（`Scope X.Y: field must be UUID or Text`）。
- claim 必须匹配 `^[a-zA-Z_][a-zA-Z0-9_.-]*$`（`invalid claim`）。
- 同一资源重复声明报 `Scope: duplicate resource X`；未知资源报 `Scope: unknown resource X`。
- `tree`：实体必须存在，父字段必须存在且为 `UUID`/`Text`；`scope.field` 类型必须与树实体主键、父字段类型一致，否则报 `field X (T) must match tree id Y (T)`。

### 生成结果

- 所有读路径（list/byId/aggregate/distribution/trend/export）都下推 claim 谓词；写路径强制把 `field` 写成 claim 值。
- claim 缺失 fail-closed（403 `Missing required data scope claim`）；claim 指向不存在的节点时返回空结果。
- `tree` 生成 `WITH RECURSIVE` 子树 CTE（64 层上限）+ 组织树页面（`/<treeResource>/tree`，`buildTree` 把缺失父节点/自引用/环放进 orphans）。
- 与 `restrict` 叠加，不互相替代。

### 示例

```qiy
scope orders customerId claim tenant.customerId;
scope warehouses orgId claim org.id tree orgs parentId;
```

### 进阶用法

把数据范围写进布尔表达式：`restrict orders { when ( scope or ownerId claim user.id ); }`，读路径变成“子树内 **或** 本人记录”；写入仍落在调用者自己的节点。`scope` 只在同资源声明了 `scope` 时合法（`when scope requires a matching scope declaration`）。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Scope orders.amount: field must be UUID or Text` | 用 UUID/Text 列做范围列 |
| `Scope orders.orgId: unknown field` | 字段必须先在实体中声明 |
| `when scope requires a matching scope declaration` | 先写 `scope orders …` |

## pages

### 语法

```text
pages <resource> {
  list   roles <role> [, <role>]* ;
  show   roles <role> [, <role>]* ;
  create roles <role> [, <role>]* ;
  edit   roles <role> [, <role>]* ;
  delete roles <role> [, <role>]* ;
  field <fieldName> roles <role> [, <role>]* ;
}
```

### 参数与校验

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `resource` | 实体名或表名 | 必须存在（`Pages X: unknown resource`）；同一资源只能一个块（`duplicate page rules`） |
| 动作 | `list`/`show`/`create`/`edit`/`delete` | 每个动作最多一次（`duplicate page action X`） |
| `roles` | `admin`/`operator`/`viewer`，至少一个 | 空列表报 `X requires at least one role` |
| `field <name> roles …` | 字段名 + 角色 | 字段必须属于该实体；重复报 `duplicate field rule X` |

空块（既无动作也无字段规则）报 `Pages X: requires at least one page action or field rule`。

### 生成结果

- 服务端 guard 同时覆盖 REST 与 GraphQL：REST 按方法推导动作（`GET /:resource`→list、`GET /:resource/:id`→show、`POST`→create、`PATCH`→edit、`DELETE`→delete、`GET …/export`→list、`POST …/import`→create）；GraphQL 按字段名推导（`orders`→list、`ordersById`→show、`aggregate|distribution|trend`→list、`create*/update*/delete*`→create/edit/delete）。
- 未声明的动作不受页面规则限制（仍受 `restrict.roles` 与角色模型约束）。
- Web 的 access-control provider 使用同一张规则表，因此按钮/菜单与 403 一致；`field … roles` 只影响界面渲染，真正的数据保护要靠 `restrict … mask`。

### 示例

```qiy
pages orders {
  list roles admin, operator;
  show roles admin, operator, viewer;
  create roles admin;
  edit roles admin;
  delete roles admin;
  field internalNote roles admin;
}
```

### 进阶用法

- 只声明需要的动作：未声明的动作不受页面规则限制，因此“只限制 delete”是合法且最小的写法。
- 列表/详情与导出/导入分别映射到 `list`/`show`/`create`，给导出单独收紧权限要靠自定义路由，而不是 `pages`。
- 与 `restrict.roles` 叠加时取交集：两边都允许才放行。

### 相关

页面规则与 `restrict` 叠加：角色必须同时通过 `restrict.roles` 与对应 `pages` 规则。授权模型细节见 [权限（permission）](/dsl/permissions)。

## restrict

### 语法

```text
restrict <resource> {
  allow roles <role> [, <role>]* ;                         // 至多一次
  when <field> claim <claim> ;                             // 行谓词：字段 == claim
  when <field> ==|!= "<v>" [, "<v>"] ;                     // 字面量比较（==/!= 只允许一个值）
  when <field> in|notIn "<v>" [, "<v>"] ;                  // 集合（最多 64 个）
  when ( <condition> or <condition> ) ;                    // 析取组
  when <boolean-expression> ;                              // not / and / or / 括号
  mask <field> [roles <r>, …] [claim <present|absent> <claim>] mode <omit|null|redact> [replacement "<text>"] ;
}
```

表达式叶子（`<condition>`）：

```text
<field> claim <claim>                       // claim 比较
<field> ==|!= "<v>"[, "<v>"]                // 字面量
<field> in|notIn "<v>"[, "<v>"]             // 集合
<field> ==|!=|<|<=|>|>= field <otherField>  // 跨字段比较（仅 ==/!= 可用字面量）
scope                                       // 引用同资源的 scope
not <expression> | ( <expression> )
```

### 参数

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `resource` | 实体名或表名 | 每个资源只能一个 `restrict` |
| `allow roles` | 至少一个角色 | 能否使用该资源；缺省不额外限制（admin 不自动豁免） |
| `when` 字段 | 已声明、非主键 | claim 条件不允许可空字段；字面量比较要求 Text/枚举/Integer/Decimal/Money/Date/Time/DateTime |
| `mask.mode` | `omit` / `null` / `redact` | `omit` 删键、`null` 返回 null、`redact` 必须给 `replacement` |
| `mask.claim` | `present` / `absent` + claim | 按 claim 存在性决定是否脱敏 |
| `mask.roles` | 至少一个角色 | 缺省对所有角色生效 |

### 默认值与校验

- 每个资源只能一个 `restrict` 块（`Restrict X: duplicate resource restriction`）。
- 行条件重复字段报 `duplicate row condition on X`；析取组至少两个条件（`a when group needs at least two conditions`）。
- `==`/`!=` 只能一个值；`in`/`notIn` 最多 64 个；重复值报 `duplicate row value`。
- 跨字段比较两侧必须同类（Text/enum/UUID、Integer/Decimal/Money 数值、Date/Time/DateTime 时间），不能是主键，UUID 只支持 `==`/`!=`。
- 主键不能作为行条件或 mask 目标；`Vector` 字段不能 mask。
- `mask replacement` 与 `mode redact` 必须同时出现；重复 mask 报 `duplicate mask for X`。
- 声明 `scope` 原子但没有同资源 `scope` 时，生成期报 `when scope requires a matching scope declaration`。
- `dataflow`/`workflow` 不能操作受 `restrict` 保护的资源（生成期失败），避免命令接口绕过行策略。

### 生成结果

- 行谓词按 AND 组合成 SQL 条件（析取组/表达式用 `or`/`and`/`not`），下推到 REST/GraphQL/导出/写入可见性检查。
- claim 缺失时：普通谓词/析取组 403 `policy.missingClaim`（不会退化成空条件、更不会放行全量）。
- mask 在响应中隐藏字段（REST/GraphQL 一致），并拒绝写入被 mask 的字段；realtime 入队前同样剔除。
- 语义、布尔表达式求值与边界见 [权限（permission）](/dsl/permissions)。

### 示例

```qiy
restrict orders {
  allow roles admin, operator;
  when tenantId claim tenant;
  when status in "draft", "pending";
  when ( ownerId claim user.id or scope );
  mask unitCost roles operator, viewer mode redact replacement "***";
  mask internalNote claim absent compliance.level mode omit;
}
```

### 进阶用法

```qiy
restrict orders {
  allow roles admin, operator;
  when tenantId claim tenant;
  when amount > field cost;
  when not status in "closed";
  when ( ownerId claim user.id or ( status in "draft" and amount > field cost ) );
}
```

优先级 `not` > `and` > `or`；缺 claim 的 `not` 分支不会变成“放行全部”，整个表达式无法求值时 403。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Restrict orders: row conditions cannot target primary key id` | 用非主键列做行条件 |
| `Restrict orders: row condition on nullable field X is not supported` | 改为非空列，或改用 `mask` |
| `Restrict orders: > on amount must compare two fields` | `>`/`>=`/`<`/`<=` 只能用于跨字段比较；字面量比较用 `==`/`!=`/`in`/`notIn` |
| `Restrict orders: mask mode redact for X requires a replacement string` | 补 `replacement "***"` |
| `Restrict orders: dataflow approve cannot use a restricted resource …` | 去掉该资源的 `restrict`，或让命令走未受限资源 |

## 常见错误（整块级）

| 错误 | 原因 | 修复 |
| --- | --- | --- |
| `Expected database near token N` | `database` 不是 `application {` 的第一个声明 | 把它移到最前 |
| `Expected <block> near token N` | 块顺序错误（例如 `entity` 写在 `enum` 之前、`menu` 写在 `dataflows` 之后） | 按[块顺序表](#块顺序与基数)重排 |
| `Expected <end> near token N` | `application` 块结束后还有内容，或漏了 `}` | 检查括号与文件末尾 |
| `Duplicate UI setting theme` / `Duplicate integration setting auth` | 同一键写了两遍 | 合并为一次 |
| `Unsupported … setting X` | 键名拼写错误或该块不支持该键 | 对照设置总表 |

## 覆盖清单

| 关键字 / 属性 | 覆盖位置 |
| --- | --- |
| `qiy v0;`、`application`、`@comment` | 本页 + [总览](/dsl/overview#词法规则) |
| `database`、`extension` | [database](#database) |
| `mode`、`integration`、`apiBase`、`auth`（宿主）、`response`、`pagination`、`tenant` | [mode 与 integration](#mode-与-integration) |
| `workspace`、`name`、`aliases`、`packages` | [workspace](#workspace) |
| `ui`、`library`、`theme`、`themes`、`colorMode`、`allowThemeSwitch`、`allowColorModeSwitch` | [ui](#ui) |
| `api`、`client`、`cors`、`origin` | [api](#api) |
| `features`、`overview`、`apiDocs`、`apiKeys` | [features](#features) |
| `realtime`、`mode`、`resource`、`events`、`roles`、`when … claim` | [realtime](#realtime) |
| `elysia`、`bearer`、`serverTiming`、`html`、`drizzle`、`jwt`、`static`、`graphqlAdapter`、`cron` | [elysia](#elysia) |
| `storage`、`provider` | [storage](#storage) |
| `auth`、`provider`、`providers`、`user`、`subjectField`、`roleField`、`usernameField`、`passwordField`、`profileField`、provider 映射 | [auth](#auth) |
| `env`、`variable`、`secret`、`development`、`production`、`example`、`required`、`generate` | [env](#env) |
| `messages` | 本节 + [多语言](/dsl/i18n) |
| `permission` | 本节 + [permission](/dsl/permissions) |
| `workflow` | [workflow](#workflow) |
| `scope`、`claim`、`tree` | [scope](#scope) |
| `pages`、`list/show/create/edit/delete roles`、`field … roles` | [pages](#pages) |
| `restrict`、`allow roles`、`when`、`mask`、`omit/null/redact` | [restrict](#restrict) |

## 相关

- [DSL 总览](/dsl/overview)：词法、顺序、校验流水线与 i18n 键
- [模块化模型](/dsl/modules)：用 `include` 拆分 `application`
- [entity 与 field](/dsl/entity) / [relation 与 index](/dsl/relation-index) / [enum / menu / dashboard](/dsl/enum-menu-dashboard)
- [认证与登录（auth）](/dsl/auth)、[权限（permission）](/dsl/permissions)、[realtime](/dsl/realtime)、[storage](/guide/storage)、[features](/dsl/features)
- [dataflow](/dsl/dataflow)、[action](/dsl/actions)、[chart](/dsl/charts)
