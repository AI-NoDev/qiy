# Refine Providers

Qiy 生成的 Web package 不是一个"能跑就行"的骨架：`DataProvider`、`AuthProvider`、`AccessControlProvider`、`LiveProvider`、`AuditLogProvider` 与通知/i18n/路由/命令面板一起，构成一层**由模型推导出来的 Refine provider 层**。这一页讲的就是这层：每个 provider 由哪个文件实现、由哪条 DSL 开关决定、请求和判定到底怎么走、哪些边界必须自己补。

三条贯穿全页的规则：

- **provider 是生成物，不是手写代码。** 想改行为先改模型（`api`、`auth`、`permission`、`restrict`、`pages`、`realtime`、`features`）；生成器重跑后这些文件会被重写。
- **服务端才是授权边界。** 前端 provider 负责"体验正确"（按钮、菜单、页面、字段、事件），服务端负责"事实正确"（角色、页面规则、行谓词、脱敏、命令 allow）。
- **适配器有未托管的位置。** `mode integration` 的 `app/host/*` 与 `app/extensions/*` 不写入生成清单，`qiy init --sync` 不会覆盖。

## 生成路径与装配方式

```text
apps/web/app/root.tsx                          # Refine 根节点：注入全部 provider
apps/web/app/data-provider.ts                  # DataProvider（REST 或 GraphQL）
apps/web/app/api-error.ts                      # qiyApiError：errorKey → 本地化 message
apps/web/app/resources.ts                      # provider 与页面共用的资源配置
apps/web/app/auth.ts                           # AuthProvider + AccessControlProvider
apps/web/app/auth/oidc-client.ts               # 单一 IdP：Authorization Code + PKCE
apps/web/app/auth/oidc-multi.ts                # 多 Provider / 混合：provider 列表 + 回调 + 绑定
apps/web/app/auth/account.ts                   # 个人中心：identities / unbind
apps/web/app/providers/live-provider.ts        # LiveProvider（仅 realtime）
apps/web/app/providers/audit-log-provider.ts   # AuditLogProvider（仅 auth）
apps/web/app/components/audit-history.tsx      # useLogList 审计面板
apps/web/app/messages.ts                       # 项目文案（含 errorKey 词条）
apps/web/app/i18n.ts                           # i18nProvider
apps/web/app/ui/index.tsx                      # antd App/ConfigProvider + 通知 provider
apps/web/app/components/menu.tsx               # 侧边栏（受 AC 过滤）
apps/web/app/components/resource-page-guard.tsx # 页面级 CanAccess
apps/web/app/routes.ts                         # 路由表（四个 guard layout）
```

装配发生在两处：

1. `templates/admin/apps/web/**` 提供基础模板（`renderAppTemplate`）。
2. `tools/generate-web.ts` 的 `generateWeb()` 在模板之上覆盖/追加文件，并用占位符替换注入 provider：

```tsx
// apps/web/app/root.tsx（生成后，节选）
<Refine
  dataProvider={dataProvider}
  liveProvider={qiyLiveProvider}                 /* 仅在声明 realtime 时注入 */
  auditLogProvider={auditLogProvider}            /* 仅在声明 auth 时注入 */
  authProvider={qiyAuthProvider}
  accessControlProvider={qiyAccessControlProvider}
  routerProvider={routerProvider}
  notificationProvider={notificationProvider}    /* useQiyNotificationProvider() */
  i18nProvider={i18nProvider}                    /* createI18nProvider(locale, applyLocale) */
  resources={resources}
  options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, mutationMode: "pessimistic" }}
/>
```

`root.tsx` 同时用 `<RefineKbarProvider>` 包住 `<Refine>`，并在 Refine 上下文内渲染 `<RefineKbar />`；外层是 `QiyUiProvider`（antd `ConfigProvider` + `App`）与 `Authenticated` 外壳。

生成文件清单写入项目根的 `.qiy-generated.json`（`files` 数组），`qiy init --sync` 只重写登记在册的路径。`app/extensions/**`、integration 模式的 `app/host/**` 以及任何你新增的文件都不在清单中。

## Provider 矩阵

| Provider | 生成文件 | 导出符号 | DSL 开关 | 缺失条件 |
| --- | --- | --- | --- | --- |
| `DataProvider` | `app/data-provider.ts` | `dataProvider`、`createDataProvider`、`createGraphQLDataProvider` | `api { client rest; }` / `api { client graphql; }`，运行期可被 `VITE_QIY_API_TRANSPORT` 覆盖 | 永不缺失；integration 模式改为再导出 `app/host/data-provider.ts` |
| `AuthProvider` | `app/auth.ts` | `qiyAuthProvider`、`qiyAuthToken`、`fetchCurrentIdentity`、`clearIdentityCache` | `auth { provider …; }` 或 `auth { providers …; }` | 无 `auth` 时不生成该文件 |
| `AccessControlProvider` | `app/auth.ts` | `qiyAccessControlProvider` | 同 `auth`，规则来自 `restrict`、`pages`、`actions`/`dataflow allow`、`permission` | integration 模式换成 `app/host/access-control.ts` |
| `LiveProvider` | `app/providers/live-provider.ts` | `qiyLiveProvider`、`createQiyLiveProvider` | `realtime { … }`（必须同时有 `auth`） | 无 `realtime` 时不生成、不注入 |
| `AuditLogProvider` | `app/providers/audit-log-provider.ts` | `auditLogProvider`、`createAuditLogProvider` | 有 `auth` 即生成 | 无 `auth` 时不生成 |
| `NotificationProvider` | `app/ui/index.tsx` | `useQiyNotificationProvider`（即 `@refinedev/antd` 的 `useNotificationProvider`） | 无开关 | 永不缺失；必须渲染在 antd `App` 内 |
| `i18nProvider` | `app/i18n.ts` | `createI18nProvider`、`resolveLocale`、`getAntdLocale` | `messages { default …; locale …; }` | 永不缺失 |
| `routerProvider` | `app/root.tsx` + `app/routes.ts` | `@refinedev/react-router` 默认导出 | 资源 / `features` / `actions` 决定路由 | 永不缺失 |
| `kbar` | `app/root.tsx` | `RefineKbarProvider`、`RefineKbar` | 无开关（`@refinedev/kbar`） | 永不缺失 |

provider 依赖的辅助模块：

| 模块 | 作用 |
| --- | --- |
| `app/resources.ts` | `resources`、`resourceNames`、`getResource`、`menuGroups`；字段的 `type`、`enumValues`、`relation`、`liveMode`、`listVisible/formVisible/showVisible/roles` 都从这里来 |
| `app/api-error.ts` | `qiyApiError(payload, statusCode, locale)`：把服务端 `errorKey` 投影成本地化 message，并保留 `statusCode`/`errorKey` |
| `app/messages.ts` | `projectMessages`、`projectMessage`、`defaultMessageLocale`；errorKey 与项目文案的唯一来源 |
| `app/auth/oidc-client.ts` | 单一 OIDC：`beginOidcLogin`、`completeOidcLogin`、`beginOidcSilentRenew`、`oidcSession`、`clearOidcSession`、`beginOidcLogout` |
| `app/auth/oidc-multi.ts` | 多 Provider / 混合：`fetchAuthProviders`、`beginProviderLogin`、`completeProviderCallback`、`beginProviderBind`、`registerOAuthUser`、`clearSession` |
| `app/auth/account.ts` | `fetchIdentities`、`unbindProvider`（个人中心） |

`templates/admin/apps/web/app/data-provider.ts` 与生成的 `app/data-provider.ts` 并不相同：生成版多出 `dataflowCommands` 白名单、复用 `qiyApiError`，并把 `filters` 编码为**通用操作符数组**（见下文）。判断行为时以生成文件为准。

## DataProvider

文件：`apps/web/app/data-provider.ts`。模块末尾决定用哪个实现：

```ts
// 生成器把 __QIY_DEFAULT_API_TRANSPORT__ 替换成模型里的 api.client
export const dataProvider = (import.meta.env.VITE_QIY_API_TRANSPORT ?? "rest") === "graphql"
  ? createGraphQLDataProvider()
  : createDataProvider();
```

- `getApiUrl()`：REST 返回 `/api/v1`，GraphQL 返回 `/graphql`。
- 所有请求都带 `Authorization: Bearer {token}`（token 取自 `localStorage["qiy.access_token"]`，无 token 时省略头）。没有 refresh、没有 CSRF、没有自动重试。
- 资源名先过白名单：`resource` 不在 `resourceNames` 里时**在发请求前**就抛 `Unknown resource: {resource}`。

### 资源与 URL 对照

| Refine 方法 | REST 请求 | 返回给 Refine |
| --- | --- | --- |
| `getList` | `GET /api/v1/{resource}?page=2&pageSize=20&sort=sku&order=desc&search=abc&filters=…` | `{ data, total }` |
| `getOne` | `GET /api/v1/{resource}/:id` | `{ data }` |
| `getMany` | 每 100 个 id 一条：`GET /api/v1/{resource}?page=1&pageSize=100&filters=[{"field":"id","operator":"in","value":"a,b,…"}]` | `{ data }`（丢弃 `total`） |
| `create` | `POST /api/v1/{resource}`，`Content-Type: application/json` | `{ data }`（服务端 201） |
| `update` | `PATCH /api/v1/{resource}/:id`，JSON body | `{ data }` |
| `deleteOne` | `DELETE /api/v1/{resource}/:id` | `{ data }` |
| `deleteMany` | `DELETE /api/v1/{resource}?ids=a,b` | `{ data }`（数组） |
| `custom`（命令） | `POST /api/v1/commands/{flow}` 或 `POST /api/v1/orders/:uuid/submit` 等 | `{ data }` |
| `custom`（图表） | `GET /api/v1/{resource}/distribution?field=status`、`/trend?field=createdAt&days=30`、`/aggregate?field=price&op=sum` | `{ data: { items } }` 或 `{ data: { value, operator } }` |

`:id` 会经 `encodeURIComponent` 编码。表里写的是 Refine 方法，不是 HTTP 方法名。

### 分页、排序、搜索、过滤的映射

| Refine 入参 | 查询参数 | 服务端约束 |
| --- | --- | --- |
| `pagination.currentPage`（默认 1） | `page` | 最小 1 |
| `pagination.pageSize`（默认 20） | `pageSize` | 最大 **100**，超出返回 422；列表页固定用 10 |
| `sorters[0]`（只用第一个） | `sort` + `order`（`desc` 或 `asc`） | `sort` 必须是可排序列，否则 400 `Unsupported sort field` |
| 字段名为 `q` 或 `__search` 的过滤器 | `search` | 最长 200；列表页的搜索框就是用 `__search` |
| 其余带 `field` 的过滤器 | `filters`（JSON 字符串） | 最多 50 条子句、最长 2000 字符；字段/操作符必须在白名单 |

`filters` 有两种可接受形态，生成版 DataProvider 发的是第二种（数组）：

```text
// 旧形态（对象，隐含 eq）——生成版仅在没有任何子句时不会发
{"status":"approved"}

// 新形态（数组，支持操作符与 and/or 嵌套）
[{"field":"status","operator":"eq","value":"approved"},
 {"operator":"and","filters":[{"field":"price","operator":"gte","value":"10"},
                              {"field":"price","operator":"lte","value":"20"}]}]
```

- 数组里的 `value` 允许是字符串数组，DataProvider 会用逗号拼成 `a,b`；列表页的高级筛选正是这样发送 `in`/`between`。
- `q`/`__search` 不会进 `filters`，只映射到 `search`。
- 可用的操作符按字段类型白名单给出：`eq`、`contains`、`startsWith`、`endsWith`、`gt`、`gte`、`lt`、`lte`、`between`、`in`。`id` 字段固定支持 `eq/gt/gte/lt/lte/between/in`（`getMany` 依赖其中的 `in`）。
- 未知字段 → 400 `Unsupported filter field`；不合法操作符 → 400 `Unsupported filter operator`；`filters` 不是合法 JSON → 400 `Invalid filters`。

### `getMany`：id 集合、分块与 30 秒合并缓存

外键列不再逐格 `getOne`：列表页把同一目标资源的 FK 值分组，用 `useMany` 一次取回。DataProvider 侧有三层保护：

| 机制 | 实现 |
| --- | --- |
| id 归一化 | `normalizeGetManyIds()`：转字符串、去重、丢空值，并**截断到 `maxGetManyIds = 200`** |
| 分块 | 每 `getManyChunkSize = 100` 个 id 发一条列表请求（用 `page=1`、`pageSize=chunk.length`、`filters` 的 `id in (...)`），结果合并 |
| 合并缓存 | 键为 `resource` 加上排序后的 id 列表（用竖线连接），TTL `30_000` ms；并发的相同请求共享同一个 in-flight Promise |
| 失效 | `create`、`update`、`deleteOne`、`deleteMany` 以及任何命令型 `custom` POST 会整体 `clear()` 缓存与 in-flight 表 |

```text
GET /api/v1/products?page=1&pageSize=3&filters=%5B%7B%22field%22%3A%22id%22%2C%22operator%22%3A%22in%22%2C%22value%22%3A%22a%2Cb%2Cc%22%7D%5D
→ { "data": [ … ], "total": 3 }   // DataProvider 只把 data 交给 Refine
```

需要注意的边界：

- 超过 200 个 id 的部分**被静默丢弃**，不会分页补齐。UI 侧 `relation-batch.tsx` 也用同一上限（`maxRelationBatchIds = 200`）并按资源排序分片，所以正常页面不会触发。
- 缓存只在 REST 实现里；GraphQL 的 `getMany` 逐块查询，没有 30 秒缓存与 in-flight 合并。
- 缓存不感知服务端的行级权限变化，只由写操作失效。跨用户/跨角色的数据变更依赖 React Query 的 `staleTime` 与页面重新挂载。
- 关系批量查询的 React Query 侧还叠加了 `staleTime: 60_000`、`gcTime: 300_000`、`refetchOnMount: false`，所以一个页面最多为每个目标资源发一次 `getMany`。

### 错误对象与本地化

```ts
// apps/web/app/api-error.ts（生成版核心逻辑）
export function qiyApiError(payload, statusCode, locale = document.documentElement.lang) {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const errorKey = typeof body.errorKey === "string" ? body.errorKey : undefined;
  const fallback = typeof body.error === "string" ? body.error : "API error " + statusCode;
  const message = errorKey ? projectMessage(locale, errorKey) ?? fallback : fallback;
  return Object.assign(new Error(message), { statusCode, ...(errorKey ? { errorKey } : {}) });
}
```

- 抛出的永远是 `Error` 实例，且带 `statusCode`；服务端给了 `errorKey` 时还带 `errorKey`，`message` 走 `messages.ts` 词典（找不到词条则退回服务端 `error` 文本）。
- `AuthProvider.onError` 只认 `statusCode === 401`；页面与通知直接展示 `message`，所以 `errorKey` 词条就是"给用户看的中文"。
- 服务端 403 行谓词拒绝返回 `policy.outsideScope` 之类的 `errorKey`；命令与导入导出还有 `import.*`/`export.*` 词条。

典型的 `statusCode`：

| 场景 | 状态 | 响应体 |
| --- | --- | --- |
| 未带/带错 token | 401 | `{ "error": "Authentication required" }` |
| 角色/页面规则/行谓词拒绝 | 403 | `{ "error": "Permission denied" }` 或带 `errorKey` |
| 未知/不可过滤字段、非法过滤器 | 400 | `{ "error": "Unsupported filter field" }` |
| 空 PATCH | 400 | `{ "error": "Empty update" }` |
| 记录不存在 | 404 | `{ "error": "Not found" }` |
| body 校验失败（Elysia schema） | 422 | 校验详情 |

### GraphQL 与 REST 的差异

| 维度 | REST | GraphQL |
| --- | --- | --- |
| 端点 | `/api/v1/{resource}` | `POST /graphql` |
| 列表 | 查询参数 | `query QiyList($page, $pageSize, $search, $sort, $order, $filters)`，选择集取自 `resources.ts` 的字段列表 |
| 详情 | `/api/v1/{resource}/:id` | `{apiName}ById(id:)` |
| 写操作 | `POST` / `PATCH` / `DELETE` | `create{Name}`、`update{Name}`、`delete{Name}`、`delete{Name}Many` mutation |
| 图表 | REST 分析端点 | `{apiName}Distribution` / `{apiName}Trend` / `{apiName}Aggregate` 字段 |
| 命令 | `POST /api/v1/commands/{flow}` | **仍走同一个 REST 命令端点**（DataProvider 内部复用 `workflowCommand`） |
| `getMany` | id 分块 + 30 秒合并缓存 | id 分块，无合并缓存 |
| 过滤器 | 受字段白名单约束 | 所有操作符透传，由服务端 GraphQL schema 校验 |
| 错误 | `qiyApiError`，带 `statusCode` + `errorKey` | `Error`，只带 `statusCode`（响应含 `errors` 时固定 400），**没有 `errorKey` 本地化** |
| 实时 | Ably `LiveProvider` | 仍是 Ably `LiveProvider`；额外可选 SSE / `graphql-ws` 订阅客户端 |

GraphQL 列表的 `filters` 变量形如 `[{ field, operator, value }]`（生成版会把非 `eq` 操作符一起传出）。`deleteMany` 在 GraphQL 里是 `delete{Name}Many(ids: [ID!]!)`，与 REST 的 `?ids=` 语义一致。

### `custom` 的白名单

`custom` 不是通用逃生口，它只接受两类 URL：

- **命令**：`method === "post"`，且 URL 是 `/api/v1/commands/{flow}`（flow 在 `dataflowCommands` 集合内）或 `/api/v1/orders/:uuid/(submit|approve|ship|cancel)`。命令请求可带 `meta.idempotencyKey`，会写入 `idempotency-key` 请求头；只有 dataflow 命令带 JSON body。
- **分析**：`method === "get"`，URL 必须匹配 `/api/v1/{resource}/(distribution|trend|aggregate)`，且 `resource` 在白名单内。

其他 URL 直接抛 `Unknown workflow command` / `Unknown analytics resource`（GraphQL 侧是 `Unknown analytics field` / `Unknown aggregate field`）。占位符与字段还会二次校验：

| 分析 | 参数 | 校验 |
| --- | --- | --- |
| `aggregate` | `query.field`、`query.op`（默认 `sum`） | `op` ∈ `sum/avg/min/max`；字段必须是 `Integer`/`Decimal`/`Money` |
| `distribution` | `query.field` | 字段必须声明了枚举值 |
| `trend` | `query.field`、`query.days` | 字段必须是 `DateTime`；`days` 为 1–365 的整数 |

### 与实时刷新的接口

`resources[].liveMode` 来自 `realtime` 块：声明过的资源取块的 `mode`（`auto` / `manual`），其余为 `off`。生成路由里只有详情页把它交给数据 hook：

```tsx
// apps/web/app/routes/show.tsx
const { result, query } = useOne({ resource: name ?? "", id: id ?? "", liveMode: resource?.liveMode ?? "off", queryOptions: { enabled: !!resource && !!id } });
```

列表页的 `useTable` **没有**传 `liveMode`，而 Refine 的默认值是 `off`（`defaultRefineOptions.liveMode`），因此生成的列表页不会自动订阅；需要列表实时刷新时显式传 `useTable({ liveMode: resource.liveMode })`（详情见下文 LiveProvider 一节）。

## AuthProvider

文件：`apps/web/app/auth.ts`。除 `AuthProvider` 本体外，同文件还导出 `AccessControlProvider`、`qiyAuthToken()`（供审计 provider 复用 token）与 `fetchCurrentIdentity()`（给不能使用 hook 的路由模块）。

### 登录模式

| 模式 | 判定（生成器） | 登录页 | 浏览器侧实现 |
| --- | --- | --- | --- |
| 本地密码 | `provider local` | `AuthPage`（关闭注册/忘记密码/记住我） | `POST /api/v1/auth/login` |
| OTP | `provider otp` | 两阶段（标识 → 验证码） | `POST /api/v1/auth/otp/request`、`POST /api/v1/auth/otp/verify` |
| 单一 OIDC | 无 local 且 provider ∈ `oidc/oauth2/sso/okta/auth0/azure-ad-b2c/keycloak/google/kinde` | 单按钮 + 一次性静默续期 | `auth/oidc-client.ts`：浏览器 PKCE 直达 `VITE_QIY_TOKEN_URL` |
| 多 Provider | `providers` 多个且不含 `local` | `GET /api/v1/auth/providers` 渲染按钮列表 | `auth/oidc-multi.ts`：回调经服务端 `POST /api/v1/auth/exchange` |
| 混合 | `providers` 含 `local` 且有 OAuth | 一张页：密码表单 + Provider 按钮 | 表单走本地登录；按钮走 `oidc-multi`，回调经 `/auth/exchange`，新身份进 onboarding |
| 宿主集成 | `mode integration` 且 `integration.authTransport` 不是 `none` | `app/extensions/host-login.tsx` | `authProvider={qiyIntegrationAuthProvider}` 委托 `window.qiyHostAuth` |

单一 OIDC 与多 Provider 的差别不只是按钮数量：单一 OIDC 使用浏览器公共客户端（`code_verifier` + `client_id`，**没有 client secret**）直接向 `VITE_QIY_TOKEN_URL` 换 token；多 Provider / 混合模式一律把 code 交给生成服务端 `/auth/exchange`，由服务端持 secret 换 token 并验 `id_token`。

### 方法一览

| 方法 | 行为 | 返回值 |
| --- | --- | --- |
| `login` | 见下面的入参表 | `{ success: true, redirectTo? }` 或 `{ success: false, error: { name, message } }` |
| `logout` | 清身份缓存 → 清 token/流程态 → 单一 OIDC 额外跳 IdP 登出 | `{ success: true, redirectTo: "/auth/login" }` |
| `check` | 只做本地判断（见下文），不发请求 | `{ authenticated: boolean, redirectTo? }` |
| `getIdentity` | `GET /api/v1/auth/me`，60 秒缓存 + in-flight 合并 | `{ id, name, role, claims?, permissions?, groups? }` 或 `null` |
| `getPermissions` | `loadIdentity()` 后返回 `identity.role` | **角色字符串**（不是权限数组）或 `null` |
| `onError` | 清身份缓存；`statusCode === 401` → 登出 | `{ logout: true, redirectTo: "/auth/login" }` 或 `{}` |
| `register` / `forgotPassword` / `updatePassword` | **未生成** | — |

`login` 接受的入参（其余字段忽略）：

| 入参 | 模式 | 说明 |
| --- | --- | --- |
| `username` / `email` | 本地密码、混合 | 取 `username ?? email` 作为登录名，正好对应 `AuthPage` 的 email 字段与模型的 `usernameField` |
| `password` | 本地密码、混合 | 登录只校验已有哈希；8 字符下限只在设置密码（onboarding / `auth:set-password`）时生效 |
| `identifier` + `challengeToken` + `code` | OTP | 三件套齐全才走 OTP 验证 |
| `providerName` | 混合 | Provider 的 `id`；命中后调用 `beginProviderLogin()` 并返回 `{ success: true }`（随后浏览器离开页面） |
| — | 单一 OIDC | 忽略凭据，直接 `beginOidcLogin()` |

本地登录成功后写入 `localStorage["qiy.access_token"]` 并 `redirectTo: "/"`；失败时 `error.message` 用服务端 `error` 文本（默认 `Invalid username or password`）。

### 身份缓存

| 项 | 值 | 影响 |
| --- | --- | --- |
| TTL | `identityCacheTtlMs = 60_000` | 同一 token 下 `can()`/`useGetIdentity` 只请求一次 `/auth/me` |
| 键 | 当前 `qiy.access_token` | 换 token 自动失效 |
| in-flight | 同一 token 的并发调用共享一个 Promise | 一次导航里多个 guard 不会打出一串 `/auth/me` |
| 清除时机 | `logout()`、`onError()`（任何错误，不只 401）、显式 `clearIdentityCache()` | 登录/登出/401 后立刻重新取身份 |
| 缓存 null | `!response.ok` 时把 `null` 也缓存 60 秒 | 短暂的 500/网络抖会让人"匿名"一分钟，需要时调 `clearIdentityCache()` |

### 令牌与存储键

| 键 | 存储 | 写入时机 |
| --- | --- | --- |
| `qiy.access_token` | `localStorage` | 所有生成式认证模式登录成功 |
| `qiy.id_token` | `localStorage` | 单一 OIDC、多 Provider（回调保存，用于 RP logout） |
| `qiy.expires_at` | `localStorage` | 单一 OIDC、多 Provider（`Date.now() + expires_in * 1000`） |
| `qiy.oidc.verifier` / `qiy.oidc.state` / `qiy.oidc.return_to` / `qiy.oidc.provider` / `qiy.oidc.mode` | `sessionStorage` | PKCE 流程开始，回调后清除 |
| `qiy.oidc.silent_attempt` | `sessionStorage` | 单一 OIDC：每轮重定向只允许一次静默续期 |
| `qiy.oauth.onboarding` | `sessionStorage` | 混合模式：暂存待完成的 onboarding（token + profile + provider） |
| `qiy.locale` / `qiy.ui.theme` / `qiy.ui.color-mode` / `qiy.ui.sider-collapsed` / `qiy.views.{resource}` / `qiy.charts.panel` | `localStorage` | UI 状态，与认证无关 |

注意：多 Provider 模式的 `logout()` 只删 `qiy.access_token`，`qiy.id_token`、`qiy.expires_at` 会留在 `localStorage`。`check()` 不读这两项，所以不影响判定，但需要清理时自己补（或改用混合模式，混合模式走 `clearSession()` 一次清干净）。

### Provider 回调、绑定与解绑

服务端端点契约（`templates/admin/apps/server/src/auth/oidc.ts`、`account.ts`、`local.ts` 生成）：

| 端点 | 认证 | 行为 |
| --- | --- | --- |
| `GET /api/v1/auth/providers` | 公开 | `{ providers, local }`；每项只含公开字段 `id/label/authorizationUrl/tokenUrl/clientId/scope/redirectUri/logoutUrl` |
| `POST /api/v1/auth/exchange` | 公开 | `{ provider, code, codeVerifier, redirectUri }` → 已有身份返回会话；新身份返回 `{ needsOnboarding, onboardingToken, provider, profile }` |
| `POST /api/v1/auth/oauth/register` | onboarding token | `{ onboardingToken, username, email?, password }` → 建 users 行并返回会话 |
| `POST /api/v1/auth/bind` | Bearer | `{ provider, code, codeVerifier, redirectUri }` 或 `{ onboardingToken }`；身份属于别的账号 → 409 |
| `POST /api/v1/auth/unbind` | Bearer | `{ provider }`；会成为最后一个登录方式 → 409 |
| `GET /api/v1/auth/identities` | Bearer | `{ user, password: { set }, providers, loginMethodCount }` |
| `POST /api/v1/auth/login` | 公开 | `{ username, password }` → `{ accessToken, tokenType, expiresIn: 43200, id, name, role }` |
| `POST /api/v1/auth/otp/request` / `otp/verify` | 公开 | challenge → 12 小时会话 |
| `GET /api/v1/auth/me` | Bearer | `{ id, name, role, claims?, permissions?, groups? }` |

三条浏览器流程：

1. **首次 Provider 登录（混合/多 Provider）**：登录页按钮 → `beginProviderLogin()` 跳 IdP → `/auth/callback`（`/oauth/*` 同义）→ `completeProviderCallback()` 校验 `state` → `/auth/exchange`。已有身份：写入 `qiy.access_token` 后回到 `return_to`；新身份：把 `onboardingToken` 暂存到 `sessionStorage` 并跳到 `/auth/onboarding?token=…`。
2. **Onboarding**：onboarding 页用 `decodeOnboardingToken()` 只为**预填**读 claim（服务端独立验签），提交后 `registerOAuthUser()` 调 `/auth/oauth/register`，成功后写入会话并回到 `/`。默认角色来自 `QIY_OIDC_DEFAULT_ROLE`。
3. **绑定 / 解绑**：`/profile` 里对未绑定 Provider 调 `beginProviderBind(providerId)`（`mode=bind`）→ 回调走 `/auth/bind` → 回到 `/profile?linked={provider}` 并弹 toast；解绑走 `POST /auth/unbind`，UI 在"这是最后一个登录方式"时禁用按钮，服务端再拒一次（409）。

单一 OIDC 模式没有 onboarding，也没有绑定/解绑：`/auth/exchange` 不在它的流程里，IdP 里合法但系统里没有 users 行的身份会表现为"无身份 → 各页面 403"。上线前先建好用户行并填好身份列。

### 重定向行为

| 时机 | 去向 |
| --- | --- |
| 未认证访问受保护路由 | `/auth/login`（`<Authenticated>` 的 fallback `Navigate`） |
| 本地密码 / OTP 登录成功 | `/` |
| Provider 登录成功 | `sessionStorage["qiy.oidc.return_to"]`（非 `/auth/*`、`/oauth/*` 的当前路径）或 `/` |
| 需要 onboarding | `/auth/onboarding?token=…` |
| 绑定完成 | `/profile?linked={provider}` |
| API 401 | `onError` → 登出 → `/auth/login` |
| API 403 | 保持会话，`onError` 返回 `{}`，页面/通知展示拒绝原因 |
| 单一 OIDC 主动登出 | 有 `VITE_QIY_LOGOUT_URL` 时跳 `post_logout_redirect_uri=/auth/login`（带 `id_token_hint`） |

`onError` 的调用方是 Refine 的 `useOnError`（列表/详情/表单/自定义 mutation 的查询错误都会走到），不是每个 `fetch`。

### `check()` 到底验证了什么

| 模式 | `check()` 的判定 |
| --- | --- |
| 本地密码 / OTP / 多 Provider / 混合 | `localStorage["qiy.access_token"]` 是否存在 |
| 单一 OIDC | token 存在 **且**（没有 `qiy.expires_at`，或 `expires_at - 60_000 > now`） |

它**不**验证：签名与 issuer、token 是否被服务端吊销、用户行是否仍存在、角色/权限是否变化、账号是否被禁用。这些都是服务端每个请求重新判定的事。因此：

- 过期 token 在本地密码/OTP/多 Provider/混合模式下仍会被当作"已登录"，直到第一个 API 返回 401 触发 `onError`。
- 单一 OIDC 模式会在登录页尝试一次 `prompt=none` 静默续期；`login_required`/`interaction_required`/`consent_required`/`account_selection_required` 视为"需要交互"直接回登录页，不计为失败。

### SSR 与预渲染

生成 Web 是 SPA：`react-router.config.ts` 导出 `{ ssr: false }`。provider 里的 `typeof window === "undefined"` 判断服务于预渲染/测试，而不是"服务端渲染时已登录"：

- `check()` 在无 `window` 时恒返回 `{ authenticated: false, redirectTo: "/auth/login" }`。
- DataProvider 的 `authHeaders()` 在无 `window` 时返回空对象（不会发 Bearer）。
- `createQiyLiveProvider()` 在无 `window` 且未注入 Ably 客户端时返回 `undefined`。
- 路由模块里的 loader/action 不要假设能拿到 auth hook；需要在非 hook 位置读身份时用 `fetchCurrentIdentity()`。

### 角色与权限如何浮现

- `/auth/me` 只在声明了权限模型时才返回 `permissions` 与 `groups`（角色组 ∪ 数据库列 ∪ 已验证 claim 的展开结果）。
- `getPermissions()` 返回**角色字符串**；`useGetIdentity()` 拿到的 `role` 被列表/详情/表单用于字段布局（`canSeeField`）。
- 命令级权限（`dataflow allow permission`、`action allow permission`）在 `AccessControlProvider.can()` 里用 `identity.permissions` 判定，见下一节。

## AccessControlProvider

文件：`apps/web/app/auth.ts`。`can()` 是一个**顺序判定**，命中即返回：

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 无身份（`/auth/me` 失败或无 token） | `{ can: false, reason: "Authentication required" }` |
| 2 | `restrict {resource} { allow roles … }` 且角色不在列表 | `{ can: false, reason: "Resource access is restricted" }` |
| 3 | `pages {resource} { {action} roles … }` 命中该 action | 按角色放行/拒绝 |
| 4 | 命令策略（`action allow` / `dataflow allow`）命中 `resource` + `action` | 见下 |
| 5 | `action === "audit"` | 仅 `admin` |
| 6 | 角色 `admin` | `{ can: true }` |
| 7 | 资源是 `auth.userEntity` 对应的表 | 拒绝（`User administration is restricted`） |
| 8 | 角色 `operator`，或 action 是 `list`/`show` | `{ can: true }` |
| 9 | 其他 | 拒绝，reason 带角色与动作 |

命令策略的判定细节：

| 情况 | 判定 |
| --- | --- |
| 策略带 `verification` | 在浏览器用同一表达式求值（`permissions`/`groups`/`role` 三个集合与字面量比较，支持 `and`/`or`/`not`） |
| 策略带 `permissions`，且 `/auth/me` 返回了 `permissions` 数组 | 必须持有**全部**权限值；不再看 `roles` |
| 策略带 `permissions`，但身份没有 `permissions` 数组 | 退回 `roles` 白名单 |
| 只有 `roles` | 按 `roles` 白名单 |

这就是为什么"角色不在 `roles` 但持有权限值"的用户也能看到命令按钮：一旦权限元数据存在，权限值优先。服务端在同一命令路由里用同一套 allow 规则重新判定，前端只是提前隐藏。

### `can()` 的消费点

| 位置 | 机制 | 动作 |
| --- | --- | --- |
| 侧边栏 | `useMenu()` 按 AC 过滤资源，`QiySider` 只渲染允许的资源 | `list` |
| 资源页 | `resource-page-guard.tsx` 用 `CanAccess` 包住四个 layout | `list` / `create` / `show` / `edit` |
| 列表工具栏 | `CreateButton`（`@refinedev/antd`） | `create` |
| 列表行 | `ShowButton` / `EditButton` / `DeleteButton` | `show` / `edit` / `delete` |
| 批量删除 | `useCan({ action: "delete" })` 控制 `rowSelection` 与批量按钮 | `delete` |
| 详情页头部 | `CanAccess action="edit"` 包住编辑按钮 | `edit` |
| 详情页审计面板 | `CanAccess action="audit"` 包住 `AuditHistory` | `audit` |
| 新建/编辑表单 | `CanAccess` + `canSeeField(field, role)` | `create` / `edit` |
| 业务按钮 | `BusinessActions` / `BatchBusinessActions` 的 `CanAccess action={action.name}`，`params` 为 `{ id }` 或 `{ ids }` | 动作名 |
| 手动业务页 | `routes/actions/{name}.tsx` 的 `CanAccess` | 动作名 |
| 命令面板 | `@refinedev/kbar` 生成每个 action 前调用 `can()` | 资源动作（列表/新建/查看/编辑） |

按钮类隐藏依赖 provider 的 `options`：

```ts
options: {
  buttons: { enableAccessControl: true, hideIfUnauthorized: true },
  queryOptions: { staleTime: 30_000 },   // integration 模式为 0
}
```

`staleTime` 决定 `useCan()` 结果在 React Query 里复用多久；再加上身份缓存 60 秒，**前端**的角色变化最多延迟约一分钟生效，**服务端**下一次请求就生效。

### 字段与数据范围

| 声明 | 前端效果 | 是否安全边界 |
| --- | --- | --- |
| `@listVisible` / `@formVisible` / `@showVisible` / `@visible` | 该字段是否出现在表格、表单、详情 | 否 |
| 页面字段 `roles` | `canSeeField()` 只在指定角色下渲染 | 否 |
| `restrict … mask … mode omit` | 服务端**整列消失**（导出同规则） | 是 |
| `restrict … mask … mode null/redact` | 服务端返回掩码值 | 是 |
| `restrict … when …`（行谓词） | 服务端只返回/只允许改自己范围内的行；越界写 403 `policy.outsideScope` | 是 |
| `scope {resource} {field} claim {claim}` | 服务端按 claim 追加行过滤；缺 claim 直接 403 | 是 |

**隐藏字段不是权限。** 任何写到前端的字段都在浏览器里；真正的保护只有 `mask`、行谓词和 `scope`。

## LiveProvider

文件：`apps/web/app/providers/live-provider.ts`，仅在声明 `realtime` 时生成（同时 `realtime` 要求有 `auth`，且拒绝 `mode integration`）。

| 项 | 行为 |
| --- | --- |
| 传输 | Ably Realtime JS SDK 2.x；`QIY_ABLY_API_KEY` 只在服务端 |
| 授权 | `POST /api/v1/realtime/token`（Bearer 会话）→ Ably TokenRequest，subscribe-only、按角色 capability |
| 通道 | `qiy:{table}`；声明了 `when {field} claim {claim}` 的资源是分段通道 `qiy:{table}:{claimValue}` |
| 通道解析 | 客户端不假设通道名：从 token 的 `capability` 里找 `qiy:{table}` 或 `qiy:{table}:*`，找不到才退回基础名 |
| 事件类型 | `subscribe({ types })` 对应资源声明的 `created`/`updated`/`deleted`；回调里的 `type` 取消息名，消息无名时为 `*` |
| 记录级裁剪 | `params.id` / `params.ids` 存在时，只有 `payload.id` 或 `payload.data.id` 命中才回调 |
| 负载 | `message.data` 是对象时原样给 Refine，否则包成 `{ data }`；`date` 取消息时间戳 |
| 取消 | `unsubscribe(subscription)` 调 `channel.unsubscribe(types, listener)` |
| SSR | 无 `window` 且未注入客户端时 `createQiyLiveProvider()` 返回 `undefined` |

`resources[].liveMode` 来自 `realtime` 块的 `mode`：`auto` 让 Refine 自动失效相关查询，`manual` 只把事件交给 `onLiveEvent`（生成代码没有接 `onLiveEvent`，所以 `manual` 需要你自己在页面里处理）。如上一节所述，生成路由只给详情页传了 `liveMode`：

```tsx
// apps/web/app/routes/list.tsx —— 需要列表实时刷新时自己补
const { tableProps } = useTable({ resource: name ?? "", liveMode: resource?.liveMode ?? "off", pagination: { currentPage: 1, pageSize: 10 } });
```

`/api/v1/realtime/token` 的失败语义：未认证 401、无任何 channel 权限 403（`Realtime subscription is not permitted`）、`QIY_REALTIME_DISABLED=1` 时 503。dataflow 的 `emit` 不走这条通道，而是发到 `qiy:event:{event}`，需要单独订阅。投递语义（at-least-once、死信、重放、脱敏时机）见 [realtime](/dsl/realtime)。

## AuditLogProvider

文件：`apps/web/app/providers/audit-log-provider.ts`，有 `auth` 即生成；`root.tsx` 同时给每个资源加上 `meta: { audit: [] }`。

| 方法 | 行为 |
| --- | --- |
| `get` | `GET /api/v1/audit-logs/?resource=…&resourceId=…&action=…&actorId=…&page=…&pageSize=…`，`cache: "no-store"`，Bearer 取自 `qiyAuthToken()` |
| `create` | 直接抛错：审计事件由服务端在业务事务里写 |
| `update` | 直接抛错：审计历史不可变 |
| 资源名校验 | 不在 `resourceNames` 里时抛 `Unknown audit resource`（不发请求） |
| action 映射 | Refine 的 `create`/`update`/`delete` → `{resource}.created` / `.updated` / `.deleted`，其他字符串原样传 |

服务端 `/api/v1/audit-logs/` 的契约：

| 情况 | 结果 |
| --- | --- |
| 未认证 | 401 |
| 非 `admin` | 403 `Audit history is restricted to administrators` |
| 未知资源 | 400 `Unknown audit resource` |
| 该资源声明了 `scope`（被分段/租户隔离） | 403 `Tenant audit history requires persisted scope metadata`（fail-closed，宁可不给看） |
| 正常 | `{ data: [...], total }`，`Cache-Control: no-store`，`pageSize` 上限 100 |

返回行形如 `{ id, resource, action, createdAt, author, meta: { id } }`：`author` 是对 users 表的左连接投影（`{ id, name, deleted }` 或 `null`），删号后历史的 actor id 仍在，`name` 退回 actor id，`deleted: true` 表示 users 行已不在。

面板用法：详情页在 `CanAccess action="audit"` 内渲染 `AuditHistory`，内部就是 `useLogList({ resource, meta: { id: recordId, page, pageSize: 10 } })`。因为 `can({ action: "audit" })` 只对 admin 放行，非 admin 看不到这个卡片，服务端也会再拒一次。

## 通知、i18n、路由与命令面板

### NotificationProvider

`app/ui/index.tsx` 把 `@refinedev/antd` 的 `useNotificationProvider` 以 `useQiyNotificationProvider` 导出，`root.tsx` 在 `QiyUiProvider`（antd `App` + `ConfigProvider`）内部调用它并传给 `<Refine notificationProvider>`。

- 生成页面用 `useNotification()` 或 Refine mutation 的默认 `successNotification`/`errorNotification`；错误文案来自 `qiyApiError` 的 `message`。
- 必须渲染在 antd `App` 内，否则 `useNotificationProvider` 拿不到 `message`/`notification` 实例。
- 不要在生成页里改用 antd 的静态 `message`（它不共享主题与 `App` 上下文）；生成的例外只有宿主登录扩展。

### i18nProvider

`app/i18n.ts` 的 `createI18nProvider(locale, setLocale)` 返回 Refine `I18nProvider`：

| 项 | 值 |
| --- | --- |
| 语言列表 | `supportedLocales`，来自模型的 `messages { locale …; }` |
| 默认语言 | `defaultMessageLocale`，来自 `messages { default …; }` |
| 引擎 | i18next 单实例；`keySeparator: false`、`nsSeparator: false`、关闭 HTML 转义 |
| 键空间 | Refine 内置文案（`notifications.*`、`buttons.*`…）+ 生成 chrome（`qiy.*`）+ 项目文案（`projectMessages`） |
| `translate(key, options, defaultMessage)` | 支持插值参数；`__proto__`/`prototype`/`constructor` 片段直接返回 fallback |
| `changeLocale(next)` | 校验语言列表 → 切引擎 → 持久化 `qiy.locale` |
| antd 语言包 | `getAntdLocale(locale)` 交给 `ConfigProvider` |

模型文案键规则（`qiy.resources.{table}.label` 等）见 [i18n](/dsl/i18n)；`errorKey` 词条写在同一个 `messages` 块里，因此服务端错误也能本地化。

### routerProvider

`app/root.tsx` 直接 `import routerProvider from "@refinedev/react-router"`，路由表在 `app/routes.ts`：

```text
auth/login, auth/callback, oauth/*, auth/onboarding, profile
/                                (index → 概览)
/system/overview, /system/api-docs, /system/api-keys   (按 features 生成)
/:resource                     → guard-list  → list.tsx
/:resource/new                 → guard-create → create.tsx
/:resource/:id                 → guard-show   → show.tsx
/:resource/:id/edit            → guard-edit   → edit.tsx
```

每个资源页都套了一层 `ResourcePageGuard`，所以直接输入 URL 也绕不过 `CanAccess`。

### 命令面板（kbar）

`@refinedev/kbar` 的 `RefineKbarProvider` 包住 `<Refine>`，`<RefineKbar />` 渲染在 Refine 上下文内，快捷键是 Ctrl/⌘+K。

- 面板内容由 Refine 从 `resources` 自动生成：每个资源的列表、新建动作，以及带记录上下文时的查看/编辑动作；label 走 i18n。
- 生成前会调用 `AccessControlProvider.can()`，被拒的动作不会出现在面板里（与菜单/按钮一致）。
- 没有额外的命令注册表；要加自定义命令，用 `useRegisterActions` 在自己的未托管组件里注册。

## 扩展、宿主模式与移植

### 优先改模型

| 想改变 | 改哪里 |
| --- | --- |
| REST / GraphQL | `api { client rest; }` 或 `api { client graphql; }` |
| 登录方式 | `auth { provider …; }` / `auth { providers …; }` |
| 页面可见性 | `pages {resource} { … }`、`restrict … allow roles` |
| 命令按钮与权限 | `dataflow` 的 `allow`、`action … allow permission/verification` |
| 行级隔离与脱敏 | `scope`、`restrict … when/mask` |
| 实时刷新 | `realtime { … }`（含 `mode`、`events`、`roles`） |
| 会话语言 | `messages { default …; locale …; }` |
| 系统管理页 | `features { overview/apiDocs/apiKeys }` |

重跑 `qiy create --sync` / `qiy init --sync` 后 provider 层随之更新，不需要手改。

### 用工厂注入（不改判定逻辑）

四个 provider 都是工厂 + 单例：

```ts
// 生成文件里就是这样装配的
export const dataProvider = (import.meta.env.VITE_QIY_API_TRANSPORT ?? "rest") === "graphql"
  ? createGraphQLDataProvider()
  : createDataProvider();
export const qiyLiveProvider = createQiyLiveProvider();       // 仅 realtime
export const auditLogProvider = createAuditLogProvider();    // 仅 auth
```

工厂都接受依赖注入，适合在自己的入口/测试里复用同一套逻辑：

```ts
// 自己的未托管模块（自有入口或测试）；按实际目录调整 import 路径
import { createDataProvider } from "../data-provider";

const dataProvider = createDataProvider(async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) window.dispatchEvent(new Event("qiy:session-expired"));
  return response; // 响应体仍由 qiyApiError 转成带 statusCode 的 Error
});
```

- `createDataProvider(fetcher)` / `createGraphQLDataProvider(fetcher)`：`fetcher` 默认为 `fetch`，替换它就能统一加日志、埋点、重试或把请求转发到别的 origin。
- `createAuditLogProvider(fetcher)`：同上，方便在宿主里换成带自有审计端点的 fetch。
- `createQiyLiveProvider(fetcher, injected)`：`injected` 可传一个已建好的 Ably 客户端（测试里用假客户端，SSR 时返回 `undefined`）。
- `getMany` 的 30 秒缓存是**实例内**状态：`createDataProvider()` 返回新实例即新缓存；`dataProvider` 单例的缓存跟随模块生命周期。

### 宿主集成模式

`mode integration` 不生成 server，也不生成第二套认证：provider 装配改为宿主适配器，三者都是**未托管**文件（`qiy init --sync` 不覆盖）：

| 文件 | 角色 |
| --- | --- |
| `app/data-provider.ts` | 只是一行 `export { dataProvider } from "./host/data-provider";` |
| `app/host/data-provider.ts` | 由 `integration { apiBase; response; pagination; tenant; }` 生成基线，并导出 `hostRequest`、`hostRecords`、`hostRecord`、`hostTotal`、`apiBase`、`responseContract`、`paginationStyle` |
| `app/host/auth.ts` | `qiyIntegrationAuthProvider`、`qiyIntegrationFetch`（bearer / cookie+CSRF / portal、租户头、origin 白名单、禁止重定向）、`window.qiyHostAuth` 类型 |
| `app/host/access-control.ts` | `qiyIntegrationAccessControlProvider`：只信 `window.qiyHostAuth.can()`，缺失或抛错一律拒绝，`staleTime: 0` |

下面是一个完整的宿主侧 DataProvider 扩展（在生成的基线上补批量读、批量删、自定义端点）：

```ts
// apps/host-admin/app/host/data-provider.ts（未托管，同一文件内继续写）
// 1) 把生成基线里的 `export const dataProvider = { … }` 改名为 `const baselineDataProvider = { … }`
// 2) 在文件末尾追加下面的对象作为唯一导出；hostRequest/hostRecords/apiBase 等助手已在同文件定义
export const dataProvider: DataProvider = {
  ...baselineDataProvider,                       // 保留 getList/getOne/create/update/deleteOne 基线
  getApiUrl: () => apiBase,

  getMany: async ({ resource, ids }) => {
    const unique = [...new Set(ids.map(String))].filter(Boolean);
    if (unique.length === 0) return { data: [] };
    // 宿主若支持 id 集合过滤，一条请求即可
    const payload = await hostRequest(resource + "?ids=" + unique.map(encodeURIComponent).join(","));
    return { data: hostRecords(payload) };
  },

  deleteMany: async ({ resource, ids }) => {
    await hostRequest(resource + "/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    return { data: ids.map((id) => ({ id })) };
  },

  // 宿主自己的聚合/报表端点：Refine 的 custom 是唯一入口
  custom: async ({ url, method, payload, query }) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) search.set(key, String(value));
    const body = await hostRequest(url + (search.size > 0 ? "?" + search : ""), {
      method: (method ?? "get").toUpperCase(),
      ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    });
    return { data: body };
  },
};
```

`responseContract` 与 `hostTotal` 在列表分页需要自己算 total 时仍然有用（`hostTotal(payload, data.length)`）。

宿主模式的边界：

- 会话、刷新、CSRF、租户归属、服务端权限都由宿主负责；Qiy 只保证浏览器侧的传输契约与 UI 一致性。
- `hostRequest` 抛出的错误保留 `statusCode`，`onError` 直接透传给可选的 `window.qiyHostAuth.onError(error)`；没有钩子时 401 跳 `/auth/login`（**不**调用宿主 logout），403 与 5xx 不跳转。
- Cookie 模式要求同源；非 GET 请求必须有可读 CSRF cookie。
- 详细契约见 [集成现有 Bun 项目](./existing-bun-project)。

### 把生成代码搬到现有项目

只想借用 provider 层时，最小可运行集合是四个文件：

```text
app/data-provider.ts      # 依赖 ./resources 与 ./api-error
app/api-error.ts          # 依赖 ./messages 的 projectMessage/defaultMessageLocale
app/messages.ts           # errorKey → 文案
app/resources.ts          # resourceNames / resources[].{name,apiName,fields}
```

`resources.ts` 是硬依赖，至少要满足 DataProvider 的用法：

| 被使用处 | 需要的形状 |
| --- | --- |
| `urlFor` / 白名单 | `resourceNames` 包含全部 `tableName` |
| 分析字段校验 | `resources[].fields[].{name,type,enumValues}` |
| GraphQL 选择集与 `apiName` | `resources[].apiName`、`fields[].name` |
| 关系批量 | `fields[].relation.resource`（目标表名） |

注意事项：

- 复制的是**生成版**（含 `dataflowCommands`、`qiyApiError`、通用 `filters` 编码），不是 `templates/admin/apps/web/app/data-provider.ts` 的模板版。
- 端口/代理：生成的 Web `vite.config.ts` 把 `/api`、`/graphql` 反代到 `QIY_API_PROXY`（默认 `http://localhost:3000`）。搬到现有项目时要么保持同源前缀 `/api/v1`，要么改 `urlFor` 里的 `api` 常量，别指望 provider 读环境变量拼 origin。
- 保留 `maxGetManyIds`/`getManyChunkSize` 与缓存失效逻辑，否则外键列会退化成 N+1 请求。
- 手改这些文件后不要再对同一路径跑 `--sync`；把它们移出生成清单或改到 `app/extensions/` 下的自有实现。

## 常见错误与排查

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| 登录后所有页面 403，`/auth/me` 却正常 | 角色不在 `restrict … allow roles` 或 `pages` 规则里 | 看 `qiyAccessControlProvider.can()` 落入哪个分支，补角色/规则 |
| 菜单只剩概览 | `viewer` 被 `restrict` 挡住，或资源没有 `list` 权限 | 同上；菜单只显示 `can(list)` 为真的资源 |
| 直接输入 `/{resource}/new` 出现 403 Result | 页面守卫按 `create` 判定并拒绝 | 正常行为；授权或调整 `pages` |
| 列表 422 | `pageSize > 100` / `page` 非整数 | 用服务端分页（默认 10 或 20） |
| 400 `Unsupported filter field` | 过滤了不可过滤字段 | 用 `resourceFields` 的 `filterable`/`filterModes` 生成筛选器 |
| 400 `Invalid filters` | 手拼 `filters` 时 JSON/形状不对 | 用数组形态 `[{ field, operator, value }]` |
| 外键列显示"—"或只显示 id | `getMany` 失败（id 超过 200 个、字段不支持 `in`、或命中 30 秒缓存里的旧集合） | 看网络面板的 `filters=` 请求；确认 id 数与字段白名单，必要时重新挂载页面 |
| 页面一直空白/`/auth/me` 请求很多 | 身份缓存被错误清除，或 token 每次重写 | 检查 `logout`/`onError` 调用频率与 `qiy.access_token` 是否被反复设置 |
| API 401 后立刻回登录页 | `onError` 的 401 分支 | 正常行为；token 过期或被吊销 |
| 403 之后也被登出 | 某处把 403 也当 401 处理（自定义 fetch 包装） | `onError` 只在 401 登出，保持这个契约 |
| 多 Provider 登录成功但页面全 403 | 系统里没有对应 users 行（多 Provider 模式不做 onboarding） | 提前建用户行并填好 Provider 身份列，或改用混合模式 |
| 混合模式首次 OAuth 登录跳到 onboarding | 新身份 | 正常；填完表单会创建账号 |
| `POST /auth/bind` 409 | 该 Provider 身份已绑定到别的账号 | 用原账号登录，或先在那边解绑 |
| `POST /auth/unbind` 409 | 会成为最后一个登录方式 | 先设置密码或绑定另一个 Provider |
| 审计面板 403 | 非 admin；或该资源声明了 `scope` | 用 admin 查看；租户审计需要持久化 scope 元数据 |
| 审计面板 400 `Unknown audit resource` | 传了实体名而不是表名 | 用 `resource.name`（tableName） |
| 列表不实时刷新 | 列表 `useTable` 没传 `liveMode` | 显式传 `liveMode: resource.liveMode` |
| 详情页收不到事件 | 角色不在 `realtime.roles`；分段通道 claim 缺失 | 看 `/api/v1/realtime/token` 的 capability；补角色/claim |
| `/api/v1/realtime/token` 503 | `QIY_REALTIME_DISABLED=1` | 取消该变量 |
| 命令按钮报 `Unknown workflow command` | 调了未声明的命令 URL，或 method 不是 `post` | 命令必须走 `dataflow`/`actions` 声明 |
| GraphQL 错误没有中文文案 | GraphQL 错误不带 `errorKey` | 已知差异；需要本地化就用 REST 客户端或自己映射 |
| 退出登录后仍残留 `qiy.id_token` | 多 Provider 模式的 `logout` 只删 access token | 自己清或改用混合模式 |
| `--sync` 后自定义 provider 被覆盖 | 该文件在 `.qiy-generated.json` 的 `files` 里 | 把自定义代码放到未托管文件（`app/host/`、`app/extensions/`） |

## 验收清单

以下用默认端口（`apps/server/.env*` 的 `PORT`，`.env.example` 为 3000；示例项目开发环境是 8001）。Web 开发服务器把 `/api`、`/graphql` 反代到 `QIY_API_PROXY`（默认 `http://localhost:3000`），所以浏览器侧请求是同源的。

### curl 探测

```bash
API=http://localhost:3000
TOKEN=...        # POST /api/v1/auth/login 拿到的 accessToken
ID=...           # 任一条 products 记录的 id
ID_A=...; ID_B=...   # 两条记录的 id，用来验证批量读/批量删

# 1) 健康检查与匿名拒绝
curl -s $API/api/v1/health
curl -s -o /dev/null -w '%{http_code}\n' $API/api/v1/products      # 期望 401

# 2) 登录与身份
curl -s -X POST $API/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@example.com","password":"admin-password"}'
curl -s $API/api/v1/auth/me -H "Authorization: Bearer $TOKEN"      # 期望 role/claims/permissions

# 3) 分页、排序、搜索、过滤
curl -s "$API/api/v1/products?page=1&pageSize=10&sort=sku&order=desc&search=abc" -H "Authorization: Bearer $TOKEN"
curl -s "$API/api/v1/products?page=1&pageSize=10&filters=%5B%7B%22field%22%3A%22active%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%22active%22%7D%5D" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/products?page=1&pageSize=101" -H "Authorization: Bearer $TOKEN"   # 期望 422

# 4) getMany 的 id 集合（等价于 DataProvider 发的请求）
curl -s "$API/api/v1/products?page=1&pageSize=2&filters=%5B%7B%22field%22%3A%22id%22%2C%22operator%22%3A%22in%22%2C%22value%22%3A%22ID_A%2CID_B%22%7D%5D" -H "Authorization: Bearer $TOKEN"

# 5) 写操作与错误形状
curl -s -X PATCH "$API/api/v1/products/$ID" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'          # 期望 400 Empty update
curl -s "$API/api/v1/products/00000000-0000-4000-8000-000000000000" -H "Authorization: Bearer $TOKEN"                                # 期望 404 Not found
curl -s -X DELETE "$API/api/v1/products?ids=$ID_A,$ID_B" -H "Authorization: Bearer $TOKEN"

# 6) 图表端点（aggregate 只接受数值字段）
curl -s "$API/api/v1/products/aggregate?field=price&op=sum" -H "Authorization: Bearer $TOKEN"
curl -s "$API/api/v1/products/distribution?field=active" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/products/aggregate?field=sku&op=sum" -H "Authorization: Bearer $TOKEN"         # 期望 400

# 7) 审计（admin）与拒绝（viewer）
curl -s "$API/api/v1/audit-logs/?resource=products&page=1&pageSize=10" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/audit-logs/?resource=products" -H "Authorization: Bearer $VIEWER_TOKEN"       # 期望 403

# 8) Provider 列表与实时 token
curl -s $API/api/v1/auth/providers
curl -s -X POST $API/api/v1/realtime/token -H "Authorization: Bearer $TOKEN"                                                        # 期望 TokenRequest

# 9) 命令（命令名取模型里声明的 dataflow，例如 receiveInventory；body 形状由该 flow 的 inputs 决定）
curl -s -X POST "$API/api/v1/commands/receiveInventory" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'idempotency-key: probe-1' -d '{"items":[{"id":"ID_A"}]}'
```

### 浏览器预期

| 检查 | 期望 |
| --- | --- |
| 未登录访问 `/` | 重定向到 `/auth/login` |
| 本地密码登录 | 成功后回 `/`，`localStorage` 里有 `qiy.access_token` |
| 混合/多 Provider 登录 | 点击 Provider 按钮后离开站点；回调后回到原路径或 `/`；新身份进 `/auth/onboarding` |
| 直接输入 `/{resource}/new`（无权限角色） | 403 `Result` 页面，不发该资源的请求 |
| 侧边栏 | 只出现 `can(list)` 为真的资源；分组/顺序与模型 `menu` 一致 |
| 列表行按钮 | 无权限时不渲染（不是禁用） |
| 详情页审计卡片 | 只有 admin 出现；非 admin 连卡片都没有 |
| 命令面板 Ctrl/⌘+K | 只列出 AC 允许的资源动作（被拒的资源/动作不出现） |
| 语言切换 | 菜单、标题、通知、表格按钮立即变化；刷新后保持（`qiy.locale`） |
| 主题/侧栏 | 刷新后保持（`qiy.ui.*`） |
| 详情页（realtime auto 资源） | 另一端改记录后自动刷新；列表页默认**不**刷新 |
| 退出登录 | 回到 `/auth/login`，`qiy.access_token` 消失，受保护页面不可达 |
| 401 场景 | token 失效后下一次请求触发登出并回登录页（不是 403 无限重试） |

## 相关

- [认证与权限（指南）](./auth)：认证模式、环境变量、会话与验收脚本。
- [API 与数据源](./api)：REST/GraphQL 端点、CSV 导入导出、保存视图。
- [DSL：认证](/dsl/auth)：`auth` 语法、Provider 配置表、生成文件清单。
- [DSL：权限](/dsl/permissions)：`permission`、`restrict`、`scope`、`pages` 与 `allow`。
- [DSL：realtime](/dsl/realtime)：通道、事件、授权、死信与运维端点。
- [DSL：features](/dsl/features)：`overview`/`apiDocs`/`apiKeys` 生成矩阵。
- [DSL：i18n](/dsl/i18n)：`messages` 与模型文案键。
- [API 文档与访问密钥](./api-docs-and-keys)：OpenAPI 过滤、API Key 与 `qiyApiError`。
- [文件存储](./storage)：文件字段的上传/下载端点（DataProvider 不处理文件）。
- [UI 与主题](./ui-theming)：`QiyUiProvider` 在 Refine 树中的位置。
- [集成现有 Bun 项目](./existing-bun-project)：`mode integration`、`app/host/*` 与 `--sync` 边界。
- 生成项目测试：`apps/web/tests/{data-provider,auth,audit-provider,live-provider}.test.ts`、`apps/server/tests/{local-auth,hybrid-auth,permissions,audit-read}.test.ts`。
