# application

```ts
application qiy-erp-admin {
  // 数据库
  database postgresql {
    extension pgvector;
  }

  // Refine UI 与主题
  ui {
    library antd;
    theme blue;
    themes blue, purple, green, orange, red;
    colorMode system;
    allowThemeSwitch true;
    allowColorModeSwitch true;
  }

  // 前端数据源
  api {
    client graphql;
    cors {
      origin "https://admin.example.com";
    }
  }

  // 服务端插件
  elysia {
    bearer;
    jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; }
    graphqlAdapter adapter yoga;
  }

  storage { provider s3; }
  auth { provider oidc; user users; subjectField externalSubject; roleField role; }
  workflow orderInventory;
}
```

## database

```ts
database postgresql { extension pgvector; }
database sqlite {}
database mysql {}
```

必须放在 `application` 开头。当前支持 PostgreSQL、SQLite 与 MySQL。

## workspace

`workspace` 是可选的现有 Bun 项目集成配置，属于 `.qiy` 模型本身。它只影响 `qiy init`，不会把凭据写入模型：

```qiy
workspace {
  name admin;
  aliases {
    server ops-api;
    web ops-console;
    deploy ops-admin;
  }
  packages {
    server "@example/ops-api";
    web "@example/ops-console";
  }
}
```

`name`、目录 alias 和 package name 都是可选的；未声明时分别回退到 `application` 名称、`<name>-server`、`<name>-web`、`<name>` 和默认 package name。`-n` 可以作为一次性 CLI 覆盖。package name 使用引号，目录 alias 使用小写字母、数字和连字符。

## ui

`ui` 控制生成的 Refine UI adapter、品牌色主题和明暗模式。当前正式支持 `antd`；`mui`、`mantine`、`chakra` 等名称会在生成前被拒绝，而不是生成混合 UI。

```qiy
ui {
  library antd;
  theme purple;
  themes purple, blue, green, orange;
  colorMode system;
  allowThemeSwitch true;
  allowColorModeSwitch true;
}
```

- `theme` 是默认主题，必须包含在 `themes` 中；
- 主题 key 支持 `blue`、`purple`、`green`、`orange`、`red`；
- `colorMode` 支持 `light`、`dark`、`system`；
- 启用切换后，Header 右上角生成主题和明暗模式控件，并使用 `localStorage` 保存选择；
- `system` 会监听浏览器 `prefers-color-scheme`；
- 生成页面优先使用 `@refinedev/antd` 的 `List`、`Show`、`Create`、`Edit` 和操作按钮，其次使用 Ant Design 原生组件，最后才使用 Qiy 自定义组件；
- 主题实现集中在 `apps/web/app/ui/`，业务页面不直接维护主题算法。

未声明 `ui` 时，默认使用 Ant Design、全部五个主题 key、`blue` 默认色和 `system` 明暗模式。

## api

```ts
api { client rest; }
api { client graphql; }
```

前端只能选一个客户端；服务端仍会同时提供 REST 端点。

## elysia

| 配置 | 说明 |
| --- | --- |
| `bearer;` | Bearer 令牌解析 |
| `serverTiming;` | Server-Timing 响应头 |
| `html;` | HTML 响应 |
| `drizzle;` | Drizzle 查询插件 |
| `jwt { name ...; secretEnv ...; }` | JWT；secret 从环境变量读取 |
| `static { assets "public"; prefix "/public-assets"; }` | 静态资源；prefix 必须以 `/` 开头 |
| `graphqlAdapter adapter native|yoga|apollo;` | GraphQL 适配器 |
| `cron { job ... pattern "..." task cleanupMissingAttachments; }` | 定时任务 |

## storage

```ts
storage { provider local; }
storage { provider s3; }
```

## auth

```ts
auth { provider oidc; user users; subjectField externalSubject; roleField role; }
```

`provider` 支持 `local`、`otp`、`oidc`、`oauth2`、`sso`、`okta`、`auth0`、`azure-ad-b2c`、`keycloak`、`google`、`kinde`；`user` 指向应用内的用户实体。外部身份 provider 使用唯一非空 Text `subjectField`，`local` 使用 `usernameField` + nullable Text `passwordField`，`otp` 只使用唯一非空 Text `usernameField`。

## env

Qiy 从模型生成 server 与 web 包各自的环境文件。独立 `create` 项目默认位于 `apps/server/`、`apps/web/`；`qiy init` 使用 `.qiy` 的 workspace alias，例如 `apps/ops-api/.env.production`、`apps/ops-console/.env.development`。环境文件位于 Admin 自己的包内；`qiy init` 不读取、覆盖或合并宿主根目录已有的 `.env`、`.env.example` 或 `.env.development`。启动脚本分别加载 development/production 文件。

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
}
```

变量名使用大写字母、数字和下划线。未配置的自定义变量在相应文件中留空；`required` 会生成待填写的空值；`generate` 仅可用于 secret 的 development 值，每次新建 admin 时生成随机值。标记为 `secret` 的变量不能在 `.qiy` 中写入字面值。`VITE_` 前缀变量写入 web 环境文件并进入浏览器 bundle，不能标记为 secret。开发和生产 server env 文件会被 Git/Docker 忽略；example 文件用于检查字段及复制示例，不包含真实 secret。

OIDC-family provider 会在 server 环境加入 `QIY_OIDC_ISSUER`、`QIY_OIDC_AUDIENCE`、`QIY_OIDC_JWKS_URL`、`QIY_OIDC_JWKS_TIMEOUT_MS`、`QIY_OIDC_JWKS_COOLDOWN_MS`、`QIY_OIDC_JWKS_CACHE_MAX_AGE_MS`，在 web 环境加入 `VITE_QIY_AUTHORIZATION_URL`、`VITE_QIY_TOKEN_URL`、`VITE_QIY_CLIENT_ID`、scope、redirect 和 logout URL。Web 使用 Authorization Code + PKCE，禁止 client secret。`otp` 会加入 `QIY_AUTH_SECRET`、`QIY_OTP_DELIVERY_URL`、`QIY_OTP_DELIVERY_TOKEN`、`QIY_OTP_DELIVERY_TIMEOUT_MS` 和仅开发使用的 `QIY_OTP_DEV_CODE`。

## workflow

```ts
workflow orderInventory;
```

生成订单提交、审批、出库、取消与库存预占事务链路。目前仅 PostgreSQL、且要求约定的 `orders`、`orderItems`、`inventoryItems` 实体。

## scope

```ts
scope orders customerId claim tenant.customerId;
```

声明资源级的单字段租户范围。读取与写入都会把该字段限制为已认证 claim。默认是"一个字段等于一个 claim"。

### 层级范围（tree）

```qiy
scope orders orgId claim org tree organizations parentId;
```

`tree <entity> <parentField>` 把 claim 从"一个节点"扩展成"该节点及其整棵子树"：

- `organizations` 是自引用实体（`parentId` 指向自身 `id`），生成时校验它存在、父字段存在，且 `orders.orgId` 与 `organizations.id`、`parentId` 类型一致；不一致直接失败。
- 行谓词变成 `WITH RECURSIVE` 的子树 CTE（SQLite / PostgreSQL / MySQL 8 都支持），下推到 `list`、`byId`、`deleteMany`、`aggregate`、`distribution`、`trend` 等**所有读取路径**；GraphQL 与 REST 共用同一 predicate。
- 子树查询以 **64 层**为深度上限，避免脏数据形成的环把查询拖死。子树 id 属于结构元数据，不重复套用行策略。
- claim 缺失仍然 fail-closed（403 `Missing required data scope claim`）；claim 指向不存在的节点时子树为空，返回空结果而不是回退成全量。
- **写入语义**：写入仍然落在调用者自己的节点（`scope` 字段被强制写成 claim 值），不会自动写入下级节点；需要"为下级节点写入"时应由 Dataflow 或宿主服务完成。
- **管理界面**：声明了 tree scope 的应用会额外生成组织树页面（`/<tree 资源>/tree`）：`web/app/tree.ts` 提供 `buildTree(records, parentField, labelField)`（缺失父节点、自引用、环都会进入 orphans 而不是死循环），`components/tree-view.tsx` 用 antd Tree 展示并支持点击进入详情，列表页工具栏出现 `Tree view` 入口。树数据仍走普通资源接口（列表不关闭分页时请用分页参数或接口全量拉取）。

## pages

```qiy
pages orders {
  list roles admin, operator;
  show roles admin, operator, viewer;
  create roles admin;
  edit roles admin;
  delete roles admin;
}
```

页面级规则：按资源、按**页面动作**限定允许的角色。它比 `restrict` 的 `allow roles` 更细——后者只决定"能不能用这个资源"，`pages` 决定"能不能打开这个页面/执行这个写操作"。

- 动作固定为 `list`、`show`、`create`、`edit`、`delete`；同一资源每个动作最多一次，未声明的动作**不受页面规则限制**（仍受 `restrict.roles` 与角色模型约束）。
- **服务端强制**：生成式授权的 guard 同时覆盖 REST 与 GraphQL，命中禁止规则时返回 403 `Page access denied`。REST 的动作推导：`GET /:resource`→list、`GET /:resource/:id`→show、`POST /:resource`→create、`PATCH /:resource/:id`→edit、`DELETE`→delete、`GET .../export`→list、`POST .../import`→create。GraphQL 用字段名推导（`orders`→list、`ordersById`→show、`ordersAggregate|Distribution|Trend`→list、`create*/update*/delete*`→create/edit/delete）。
- **界面一致**：生成的 Refine access-control provider 先按同一张表判断，因此被禁止的按钮/菜单与真实请求的 403 一致。
- 与 `restrict` 叠加：角色必须同时通过 `restrict.roles` 与对应的 `pages` 规则。

### 页面内字段布局（field）

```qiy
pages orders {
  show roles admin, operator;
  field internalNote roles admin;
}
```

- `field <name> roles ...` 限定该字段在**列表列、详情页、表单**中只对列出的角色渲染；未声明规则的字段对所有角色可见。
- 这是**界面层**规则：服务端仍以 `restrict` 的 `mask` 为最终的数据保护，字段规则只是不渲染。若需要真正隐藏数据，应同时声明 `mask`。
- 生成的 `resources.ts` 会为字段附加 `roles`，页面用 `canSeeField(field, role)` 过滤；生成的 `web/tests/field-rules.test.ts` 会按模型逐条断言角色矩阵（含"无规则字段对所有人可见"）。


## restrict

```qiy
restrict records {
  allow roles admin, operator;
  when ownerId claim user.id;
  when status in "draft", "pending";
  mask salary roles operator mode redact replacement "***";
  mask note claim absent compliance.level mode omit;
}
```

`restrict` 与 `scope` 叠加，不替代它。同一资源只能有一个块。行条件按 AND 组合并下推到 SQL，不在客户端过滤：

- `allow roles` 限定可以使用该资源的角色。未声明时不额外限制角色。admin 不会自动绕过这里的角色列表。
- `when <field> claim <claim>` 要求字段等于已认证 claim。claim 缺失或为空时请求返回 403，而不是返回空列表。claim 条件不能用在可空字段或主键上。
- `when <field> ==|!=|in|notIn <values>` 与字面量比较。`==`/`!=` 只能有一个值，`in`/`notIn` 最多 64 个。字段限于 Text、enum、Integer、Decimal、Money、Date、Time、DateTime。字面量不匹配时该行不可见，不因此让整个请求失败。
- `mask` 对匹配的角色和 claim 状态隐藏字段。`omit` 删除响应键，`null` 返回 null，`redact` 必须给出 `replacement`。同一字段只能有一个 mask。被 mask 的字段也不能通过 REST 或 GraphQL 写入。
- `when ( <条件> or <条件> ... )` 是**析取组**：组内 OR，组与其它 `when` 之间仍是 AND。例如 "我的租户 **或** 我自己的记录"：

```qiy
restrict orders {
  allow roles admin, operator;
  when ownerId claim user.id;
  when ( tenantId claim tenant or status in "draft" );
}
```

### 布尔表达式：AND / OR / NOT / 跨字段比较

`when` 也接受一般布尔表达式，优先级为 `not` > `and` > `or`，可用括号改变结合：

```qiy
restrict orders {
  when tenantId claim tenant;
  when amount > field cost;                    // 跨字段比较
  when not status in "closed";                 // 取反
  when ( ownerId claim user.id or ( status in "draft" and amount > field cost ) );
}
```

- 叶子仍只能是"字段 vs claim"或"字段 vs 字面量"，或"字段 vs 字段"：`<field> ==|!=|<|<=|>|>= field <otherField>`（`<`/`<=`/`>`/`>=` 只用于跨字段；字面量比较仍用 `==`/`!=`/`in`/`notIn`）。
- 跨字段两边必须是**同类可比字段**（Text/enum/UUID 文本类、Integer/Decimal/Money 数值类、Date/Time/DateTime 时间类），不能是主键；UUID 只允许 `==`/`!=`。类型不匹配在解析期失败。
- 缺 claim 的语义与析取组一致：只丢弃该分支；`not` 作用于不可用分支时**不会**变成"放行全部"——整个表达式无法求值时请求返回 403 `policy.missingClaim`。
- 生成的 SQL 用 `and(...)`/`or(...)`/`not(...)` 与 `eq/ne/lt/lte/gt/gte` 拼装，REST / GraphQL / 导出 / 写入可见性检查共用同一 predicate。

### `scope` 原子：把数据范围写进布尔表达式

`when` 里可以直接写 **`scope`**，表示"该行落在当前调用者的数据范围内"（即 `scope <resource> <field> claim <claim> [tree ...]` 解析出的范围；tree scope 时按子树展开）。它让 restrict 从"范围 AND 条件"升级为"范围 OR 其它条件"：

```qiy
scope orders region claim region tree regions parentId;
restrict orders {
  allow roles admin, operator;
  when ( scope or ownerId claim user.id );
}
```

- 语义：列表/详情/聚合/导出等**读路径**按表达式求值——在子树内 **或** 满足其它分支（例如本人记录）都可见。写入仍落在调用者自己的 scope 节点（原有 `scope` 写入强制不变），因此不能借表达式把数据写到范围外。
- 缺 claim 时 `scope` 分支被丢弃（与其它叶子一致）；如果整个表达式都无法求值，请求 fail-closed 返回 403。
- `scope` 只在声明了同资源 `scope` 时合法，否则生成期报错 `when scope requires a matching scope declaration`。
- 表达式里一旦出现 `scope`，生成代码会跳过仓储层原有的隐式 scope 过滤（否则会变成 AND 而覆盖 OR 语义）；没有 `scope` 原子的模型生成结果完全不变。

边界：聚合/分页/详情都已按并集语义处理；写操作仍以自身 scope 为准。

析取组的补充语义：组内 claim 缺失时**只丢弃该分支**（其它分支照常生效）；如果组内所有分支都因缺 claim 无法成立，请求返回 403 `policy.missingClaim`，不会退化成空条件。组至少需要两个条件，且不能与块内的其它行条件重复字段。生成 SQL 时使用 `or(...)`。

策略只从已认证 principal 推导，不接受请求体里的角色或 claim。GraphQL 使用同一套行条件和 mask，不能绕过 REST。**CSV 导出**（`GET /api/v1/:resources/export`）与列表共用同一条查询路径，因此同样受行谓词约束，且 `mode omit` 的字段整列不导出；写入落在自身行谓词之外时返回 403 `policy.outsideScope`。

Realtime 是共享 channel，无法按订阅者裁剪单条事件，因此：对**可订阅角色**生效的 `mask` 字段会在入队时从事件负载中删除；带行谓词（`when ...`）的资源**不能开启 Realtime**，生成阶段直接报错。

当前边界：策略条件仍是封闭谓词集合（单字段比较、析取组、上述 `and/or/not` 与跨字段比较），没有任意函数、子查询或跨资源策略统一；组织层级用 `scope ... tree` 表达。Dataflow 和 `orderInventory` 还不能应用同一行策略；如果它们操作受 `restrict` 保护的资源，生成会失败，避免命令接口绕过记录范围。已生成认证时，Web 访问控制会隐藏角色不允许的资源；字段脱敏仍以 API 响应为准，界面不会单独保存真实值。

实现提示：Elysia 的 `onRequest` 钩子是**全局**的，因此每个受限资源的"禁止写脱敏字段"守卫只在 `path.startsWith("/api/v1/<resource>")` 时生效——否则一个资源的守卫会拒绝另一个角色的无关请求（例如 GraphQL）。
