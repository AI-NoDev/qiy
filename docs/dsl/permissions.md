# 权限（permission / restrict / scope / pages）

Qiy 的授权模型是**四层叠加、全部 fail-closed** 的：

| 层 | 声明 | 回答的问题 | 生成物 |
| --- | --- | --- | --- |
| 认证 | `auth { ... }`（见 [auth](/dsl/auth)） | 你是谁？`principal.id/role/claims` 从哪来？ | `auth/guard.ts`、`auth/local.ts`、`auth/oidc.ts`、`auth/hybrid.ts` |
| 原子权限 / 权限组 / 校验式 | `permission field`、`permission group`、`permission from`、`permission verification` | 你**持有哪些**权限值？某个集合关系成立吗？ | `auth/permissions.ts`、`auth/permission-routes.ts` |
| 资源与记录策略 | `restrict`、`scope` | 这个资源你能用吗？**哪些行/哪些字段**你能看或写？ | `security/policy.ts`、各资源 `*.repository.ts`、`*.routes.ts` |
| 页面与命令策略 | `pages`、`dataflow allow`、`action allow` | 这个页面能打开吗？这条业务命令能执行吗？ | `auth/guard.ts`、`dataflows/index.ts`、`web/app/auth.ts` |

**角色不是独立概念**：`admin` / `operator` / `viewer` 三个字符串仍是本地密码会话的权威角色；`permission group admin { ... }` 只是把「角色名」当成权限组名，于是角色自动获得该组展开后的全部权限值。权限**只做加法，从不做减法**：角色组 ∪ 数据库列 ∪ 已验证 claim。

::: tip 与 application.md 的分工
`restrict` / `scope` / `pages` 的**逐关键字语法**以 [application](/dsl/application#restrict) 为准；本页负责**权限语义、运行时行为、生成物映射与安全边界**，并补齐那些只在生成器/运行时才能观察到的规则（fail-closed 细节、掩码写入拦截、与 dataflow/realtime 的互斥）。
:::

## 声明位置与前提

```qiy [app.qiy]
qiy v0;
application ops-admin {
  database sqlite {}
  api { client rest; }

  auth {
    provider local;
    user users;
    roleField role;
    usernameField email;
    passwordField passwordHash;
  }

  messages { default "zh-CN"; locale "zh-CN" { "perm.receive" "收货"; } }

  # 1) permission 块：紧跟 messages，必须在 workflow/enum/entity 之前
  permission field InventoryReceivePermission "inventory:receive" @label(t("perm.receive"));

  # 2) 所有 permission 声明必须连续，中间不能插入其它顶层块
  permission group admin { InventoryReceivePermission }
  permission from database field users.permissions;
  permission verification CanReceive {
    input { field permission Text; }
    return input.permission all included in self.permissions;
  }

  enum userRole { value admin; value operator; value viewer; }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
    field permissions Text @nullable;
  }

  entity inventory {
    field id UUID @id;
    field sku Text @unique;
  }

  # 3) scope / restrict 在 entity+relation 之后
  restrict inventory { allow roles admin, operator; }

  # 4) pages 在 restrict 之后
  pages inventory { delete roles admin; }
}
```

- `permission` 声明必须在 `messages` **之后**（`@label(t("key"))` 要能解析默认语言）、`workflow` / `enum` / `entity` **之前**（生成前要对照 `users` 表校验 `from database field`）。
- 解析器只在 `messages` 之后**连续读取** `permission` 块；被其它顶层块打断后再写 `permission` 会解析失败。
- 任何非空权限模型都要求存在生成式 `auth` 块，否则报 `Permission declarations require a generated auth block`；至少要声明**一个** `permission field`，只写组或校验式会报 `Permission declarations require at least one permission field`。
- 序列化（round-trip）顺序固定为：`storage` → `auth` → `env` → `messages` → `permission ...` → `workflow` → `enum` → `entity` → `relation` → `scope` → `restrict` → `pages` → `menu` → `dashboard`/`chart` → `dataflow` → `action`。

## 语法总览

```qiy
permission field    <Name> "<value>" [@label(...)] [@comment(...)] ;
permission group    <Name> [@label(...)] [@comment(...)] { A, B, ... } [;]
permission group    <Name> [@label(...)] [@comment(...)] = A & B & ... ;
permission from database field <entity>.<field> ;
permission from claim <provider> "<claim>" ;        // claim 也可写成裸标识符
permission verification <Name> [@label(...)] [@comment(...)] {
  input { field <name> Text|Array<String>; ... }
  return <expression> ;
}
```

| 形式 | 关键约束 |
| --- | --- |
| `field` | 值非空、不含空白、全局唯一；`@label`/`@comment` 各最多一次 |
| `group`（列表） | 成员可为权限字段或其它组；允许尾逗号；结尾 `;` 可省略 |
| `group`（并集） | `&` 是**并集**，没有交集运算符；必须以 `;` 结束 |
| `from database field` | 每个模型最多一条；列必须是 auth 用户实体的 `Text` 字段 |
| `from claim` | provider 必须是 `auth` 中配置的 OAuth/OIDC provider；可重复但同一 provider+claim 不能重复 |
| `verification` | 必须有 `return`；`input` 可省略；输入只有 `Text` 与 `Array<String>` 两种类型 |

## 原子权限：`permission field`

```qiy
permission field ApiGetUserPermission "api:getUser" @label("读取用户 API");
permission field InventoryReceivePermission "inventory:receive";
```

| 属性 | 必填 | 说明 |
| --- | --- | --- |
| 名称 | 是 | DSL 内引用名，标识符 `[a-zA-Z_][a-zA-Z_0-9-]*`；与组名、校验名共享命名空间 |
| 值（字符串） | 是 | 写入 claims / 数据库列 / 前端 `CanAccess` 的**权限值**；不含空白、全局唯一 |
| `@label("...")` / `@label(t("key"))` | 否 | 展示名，进入 IR 与 `docs/model`、`/system/overview` 权限模型页 |
| `@comment(...)` | 否 | 说明文案，进入 IR 与文档元数据 |

- 推荐权限值用 `<domain>:<action>`（如 `inventory:receive`），因为它是唯一在 claims、数据库列、OpenAPI `x-qiy-permissions`、命令 403 `missing` 里出现的字符串。
- 权限值**区分大小写**且按字符串精确比较；`inventory:receive` 与 `inventory:Receive` 是两个权限。
- `@label(t("key"))` 的 key 必须存在于 `messages.default` 语言，否则生成前报 `Missing default locale message for ...`。

**生成结果**：`auth/permissions.ts` 中写入 `PERMISSION_FIELD_VALUES`（名字 → 值）与 `PERMISSION_DECLARED_VALUES`（值集合），供 provider 展开与 `/auth/permissions` 使用。

## 权限组：`permission group`

```qiy
permission group UserApiPermissionGroup { ApiGetUserPermission, ApiPutUserPermission }
permission group ManagerRole { ApiPutUserPermission, ApiDeleteUserPermission }
permission group SuperAdminManager = UserApiPermissionGroup & ManagerRole;

permission group admin { SuperAdminManager, InventoryReceivePermission }
permission group operator { InventoryReceivePermission }
permission group viewer { ReportReadPermission }
```

| 项目 | 规则 |
| --- | --- |
| 成员 | 权限字段名或其它组名；未知成员报 `unknown member` |
| `&` 语义 | **并集**（union），`A & B` = A ∪ B；Qiy 不提供交集运算符 |
| 空组 | 报 `requires at least one member` |
| 重复成员 | 报 `duplicate member` |
| 自引用 / 环 | 报 `cannot reference itself` / `cyclic group reference G1 -> G2 -> G1` |
| 命名冲突 | 组名与权限字段名、其它组名、校验名冲突均报错 |
| 角色组 | 组名等于 `admin`/`operator`/`viewer` 时自动成为「角色组」：`role` 为 `admin` 的 principal 获得该组全部权限 |

组本身也是**可被授予的条目**：`permission from database field` 的列值、claim 值、`allow permission A` 里的 A 都可以是一个组名，展开时递归取并集。展开结果是排序去重的：

```json
{ "permissions": ["api:deleteUser", "api:getUser", "api:putUser"], "groups": ["ManagerRole", "SuperAdminManager", "UserApiPermissionGroup"] }
```

需要交集语义时不要试图用 `&` 表达，请在 `permission verification` 里写集合关系（例如两个集合都 `all included in self.permissions`）。

## provider 来源：`permission from`

生效权限是三个来源的**并集**：

| 来源 | 声明 | 运行时读取 | 说明 |
| --- | --- | --- | --- |
| 角色组 | 无需声明 | `principal.role` | 组名等于角色名即自动生效 |
| 数据库列 | `permission from database field users.permissions;` | auth 用户行上的 `Text` 列 | 每项是权限**值**或**组名** |
| OAuth claim | `permission from claim azure-ad-b2c "roles";` | **已验签 id_token** 的 claim | `local` / `otp` 会话没有 claims |

### `permission from database field`

```qiy
permission from database field users.permissions;
```

| 约束 | 说明 |
| --- | --- |
| 唯一 | 每个模型最多一条数据库来源，重复报 `duplicate database source declaration` |
| 实体 | 必须是 `auth` 的 `user` 实体（表名一致），否则报 `is not the auth user entity` |
| 列类型 | 必须是 `Text`，否则报 `must be a Text column` |
| 列可空 | 运行时会读取行；建议 `@nullable`，行缺失/列解析失败**只忽略该来源**，角色组与 claims 仍然生效 |

列内容契约：

```text
["inventory:receive","manager"]        # JSON 字符串数组（推荐）
inventory:receive,manager              # 逗号/空格分隔文本（兼容）
```

- 数组中的非字符串元素被丢弃；以 `[` 开头但 JSON 解析失败 → 该来源整体视为空（fail-closed）。
- 每个条目如果等于某个**已声明的权限值**则直接生效；否则尝试当作**组名**展开；两者都不是 → 忽略。

### `permission from claim`

```qiy
permission from claim azure-ad-b2c "roles";
permission from claim google "groups";
permission from claim keycloak "roles";
```

| 约束 | 说明 |
| --- | --- |
| provider | 必须是 `auth` 里配置的 OAuth/OIDC provider（`providers` 列表或单个 `provider`）；未配置报 `provider is not a configured OAuth/OIDC provider` |
| `local` / `otp` | 明确拒绝（`local and otp sessions do not carry claims`），它们不产生 claims |
| claim 名 | `^[A-Za-z_][A-Za-z0-9_.-]*$`（允许点号，便于 `realm.roles` 这类扁平化后的键） |
| 重复 | 同一 `provider + claim` 组合只能声明一次 |
| 数量 | 可以声明多条（例如同时映射 Azure `roles`、Google `groups`、自建 Dex 的 `roles`） |
| 运行期合并 | 求值时**只按 claim 名取值**，不区分 provider：只要 principal 的 claims 里有这个键（无论来自哪个已验签 Provider）就被读取并合并。`provider` 是声明期约束（必须是已配置 Provider），不是运行期隔离 |

claim 值规范化（与数据库列同构）：

| claim 值 | 结果 |
| --- | --- |
| 字符串数组 | 只保留字符串元素，去重 |
| 字符串 | 按逗号/空白切分后去重（`"a b,c"` → `a`, `b`, `c`） |
| 数字 / 布尔 / null / 对象 | 不产生任何权限 |

claims 来自**已验证的 id_token**（RS256/ES256、issuer、audience 校验通过），生成器把它扁平化为点号键（`org.id`、`realm_access.roles`），数组保留，嵌套对象最多递归 2 层，`iss/aud/exp/iat/nbf/jti/sub` 被丢弃。IdP 必须**真的签发**该 claim：Google 需要自定义 claim 映射到 `groups`，Azure AD B2C 自定义策略通常签发 `roles`，Dex 默认**不**签发 `roles`/`groups`，要在租户侧配置 mapper，否则该来源永远是空集。

::: warning API Key 请求没有 id_token claims
`Authorization: Bearer qiy_...` / `X-API-Key` 解析出用户行后，`claims` 只包含由 `scope ... claim <name>` 反查用户列得到的那几个键（例如 `org.id` ← `orgId` 列）。因此 **`permission from claim` 来源对 API Key 请求不生效**，API Key 只继承角色组 + 数据库列权限。用 API Key 调命令时，若有 `allow verification` 依赖 claim 集合（如 `self.groups`），结果会按空集计算（fail-closed）。
:::

## 权限校验块：`permission verification`

```qiy
permission verification CanAccessUserApi @label("能访问用户 API") {
  input { field permission Array<String>; }
  return input.permission all included in self.permissions;
}

permission verification CanShipOrders {
  return self.role = "admin" || self.role = "operator";
}

permission verification CanAdjustStock {
  input { field permission Text; }
  return input.permission all included in self.permissions;
}

permission verification CanManageUsers {
  input { field permission Array<String>; }
  return ! ( input.permission not some included in self.groups )
      && ( input.permission all included in self.permissions || self.role = "admin" );
}
```

### input 块

| 项目 | 规则 |
| --- | --- |
| 类型 | 只有 `Text`（单个字符串）与 `Array<String>`（字符串数组） |
| 必填性 | 声明即**必填**；调用方缺少字段 → 400 |
| 多余字段 | `input` 中未声明的字段被**忽略** |
| 重复 | 同名 input 重复声明报 `duplicate input` |
| 保留名 | `self` 不能做 input 名 |
| 类型错误 | `Text` 收到非字符串、`Array<String>` 收到非数组/含非字符串 → 400 |

### 表达式文法

```text
expression  := orExpr
orExpr      := andExpr ( "||" andExpr )*
andExpr     := unary ( "&&" unary )*
unary       := "!" unary | "(" orExpr ")" | comparison
comparison  := operand op operand
operand     := "self" "." ( "permissions" | "groups" | "role" )
             | "input" "." <name>
             | <quoted string>
op          := [ "not" ] ( "some" | "all" ) ( "included" "in" | "in" )
             | "="
             | "!="
```

优先级（高 → 低）：

| 优先级 | 运算符 | 结合性 |
| --- | --- | --- |
| 1 | `!`（一元） | 右结合 |
| 2 | `( ... )` | — |
| 3 | `&&` | 左结合 |
| 4 | `\|\|` | 左结合 |

`not` 只出现在 `some`/`all` 之前，`!` 才是逻辑否定；`! ( a not some included in b )` 是合法写法。

### 比较运算符

所有操作数在求值前归一化为**字符串集合**：`self.permissions` / `self.groups` / `input.*`（`Text` 提升为单元素集合）/ 字符串字面量（单元素集合）/ `self.role`（单元素集合）。集合比较与顺序无关。

| 运算符 | 别名 | 语义 | `missing`（拒绝时的诊断值） |
| --- | --- | --- | --- |
| `all included in` | `all in` | 左 ⊆ 右 | 左集合中不在右集合的元素 |
| `some included in` | `some in` | 左 ∩ 右 ≠ ∅ | 失败时为左集合元素 |
| `not all included in` | `not all in` | 左 ⊄ 右 | 无 |
| `not some included in` | `not some in` | 左 ∩ 右 = ∅ | 交集元素（「不该出现」的值） |
| `=` | — | 集合相等 | 对称差 |
| `!=` | — | 集合不相等 | 无 |

- 组合表达式失败时 `missing` 是各失败比较诊断的并集（排序去重），它只是**解释信息**；`allowed` 才是权威结论。
- `&&` 失败收集所有失败分支的 `missing`；`||` 成功时 `missing` 为空，失败时收集全部分支。
- 校验块**不能**做 `self.role some included in self.role` 这类「角色集合 vs 角色集合」的成员判定，会报 `role membership comparison requires a non-role set`；角色请用 `=` / `!=` 与字面量比较。

### 校验块在哪里被求值

| 位置 | 输入来源 | 说明 |
| --- | --- | --- |
| `POST /api/v1/auth/verify-permission` | 请求体 `input` | 通用验收接口 |
| `dataflow ... allow verification Name;` | flow 的 `input` 字段（同名、`@required`、`Text` 或 enum） | 请求期在命令路由内求值，拒绝 403 |
| `action ... allow verification Name;`（仅 `navigate`） | 无（校验块不能有 input） | 只控制按钮/页面可见性，服务端仍需路由守卫 |
| Web `CanAccess` | `/auth/me` 的 `permissions`/`groups`/`role` | 只对**无 input** 的校验块在浏览器求值；有 input 时按钮回退为角色列表 |

## 生效权限解析与 HTTP 接口

声明了权限模型时，生成服务端多出：

| 端点 | 认证 | 行为 |
| --- | --- | --- |
| `GET /api/v1/auth/permissions` | Bearer / API Key | `{ permissions: string[], groups: string[] }`（排序去重） |
| `POST /api/v1/auth/verify-permission` | 同上 | `{ verification, input? }` → `{ allowed: true }` / `{ allowed: false, missing: [...] }`；未知校验名/缺输入/类型错误 400；未认证 401 |
| `GET /api/v1/auth/me` | 同上 | `{ ...principal, permissions, groups }`；principal 含 `id`、`name`、`role`，OIDC 会话还含 `claims` |

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/auth/permissions
# { "permissions": ["inventory:receive","report:read"], "groups": ["admin","operator"] }

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"verification":"CanAccessUserApi","input":{"permission":["api:getUser"]}}' \
  http://localhost:3000/api/v1/auth/verify-permission
# { "allowed": false, "missing": ["api:putUser"] }
```

- 数据库读取失败（缺表/缺行/列不可解析）**不会**让 `/auth/me` 500：该来源被忽略，角色组与 claims 继续生效。
- 权限校验接口本身不做角色检查（任何已认证 principal 都可以自检）；它**不能**用来给别的用户判定权限。

## 命令策略（allow）

命令授权有两种写法，互斥且必须写在正确的对象上：

```qiy [examples/self/modules/dataflows.qiy]
dataflow receiveInventory @label("收货") {
  allow permission InventoryReceivePermission;   // 必须持有列出的全部权限值
  ...
}

dataflow shipSalesOrder @label("发货") {
  allow verification CanShipOrders;              // 用 flow input 求值校验表达式
  ...
}

dataflow reserveStock @label("预占库存") {
  allow roles admin, operator;                   // 旧写法，继续支持（仅 admin/operator）
  ...
}
```

| 规则 | dataflow | action（`navigate`） | action（绑定 dataflow） |
| --- | --- | --- | --- |
| `allow roles` | 只接受 `admin`/`operator`，空列表/重复/未知角色报错 | `admin`/`operator`/`viewer` 非空子集 | **禁止**（提示声明在 dataflow 上） |
| `allow permission` | A/B 可为权限字段或组名，生成期展开为**权限值** | 允许，控制按钮/页面可见性 | **禁止** |
| `allow verification` | 校验块可以有 input，但每个 input 必须在 flow `input` 中有同名 `@required` `Text`/enum 字段 | 校验块**不能有 input**，否则报 `requires inputs and cannot guard a navigate action` | **禁止** |
| 默认 | 未声明 allow 时 `admin, operator` | 未声明时沿用资源默认权限 | 继承 dataflow |

运行时（命令路由内、事务之前）：

- 未认证 → 401；不在角色白名单 → 403 `{ error: "Command execution is restricted" }`。
- `allow permission` 缺权限 → 403 `{ error: "Missing required permissions: ...", errorKey: "command.forbidden", missing: [...] }`。
- `allow verification` 不满足 → 403 `{ error: "Permission verification <Name> denied this command", errorKey: "command.forbidden", missing?: [...] }`；校验名未知 → 403；输入形状错误 → 400。
- **admin 不绕过**显式白名单：`allow roles operator;` 也会拒绝 admin。
- `/api/v1/commands` 已从通用角色守卫中豁免（guard 只做认证），授权完全由命令路由执行，因此持有权限的**非** admin/operator 用户也能执行命令。
- 角色/权限/校验检查发生在**幂等回执查询与事务之前**；拒绝不写业务数据、审计或回执。回放时重新检查，已有成功回执不赋予访问权。

Web 端（`web/app/auth.ts`）：

- `commandPolicies` 记录每条命令的 `roles`、`permissions`（已展开为权限值）、以及**无 input** 的 `verification` 表达式。
- `qiyAccessControlProvider` 在身份带 `permissions` 时优先按权限/校验表达式判断；服务端未提供权限元数据时回退角色 allow list。
- 有 input 的 `allow verification` 无法在浏览器求值 → 按钮可见性回退角色列表，**服务端仍强制校验**。

## 资源与记录策略：`restrict`

语法与逐项语义见 [application · restrict](/dsl/application#restrict)。这里给出权限视角的参数表与运行时规则。

```qiy
restrict orders {
  allow roles admin, operator;                        // 资源级角色白名单
  when tenantId claim tenant.id;                      // 行条件（AND）
  when status == "open", "draft";                     // 字面量（in 语义请用 in）
  when ( scope or ownerId claim user.id );            // 布尔表达式
  mask total roles operator, viewer mode redact replacement "***";
  mask internalNote claim absent internal.audit mode null;
}
```

| 设置 | 取值 | 默认 | 语义 |
| --- | --- | --- | --- |
| `allow roles` | `admin`/`operator`/`viewer` 非空、不重复 | 不限制角色 | 决定「能否使用该资源」；admin 也受此限制 |
| `when <field> claim <claim>` | 字段非空、非主键、非 nullable；claim 允许点号 | — | 行条件，`==` 比较；claim 缺失按 `missing: deny` → 403 |
| `when <field> == \| != "<值>"` | 单值 | — | 行条件；类型须为 Text/enum/Integer/Decimal/Money/Date/Time/DateTime |
| `when <field> in \| notIn "<v1>", "<v2>"` | 最多 64 个值、不重复 | — | 行条件；值为 `hide` 语义 |
| `when <a> <op> field <b>` | `<`/`<=`/`>`/`>=`/`==`/`!=`；两侧可比较类一致 | — | 跨字段比较；UUID 只支持 `==`/`!=` |
| `when scope` | 需要同资源 `scope` 声明 | — | 数据范围原子，可与其它分支 `or` |
| `when A and B` / `or` / `not` / `( ... )` | 括号、`not`、`and`、`or` | — | 一般布尔表达式，AND 到 `rows`/`groups` 之上 |
| `mask <field>` | 非主键、非 Vector | `mode omit` | 字段脱敏，见下 |

运行时（`security/policy.ts`）：

| 情形 | 结果 |
| --- | --- |
| 角色不在 `allow roles` | 403 `policy.resourceDenied` |
| `claim` 行条件缺 claim（`deny`） | 403 `policy.missingClaim` |
| 字面量行条件（`hide`） | 生成恒假谓词（`__qiy_policy_never_matches__`）→ 行不可见，不报错 |
| 析取组所有分支都因缺 claim 被丢弃 | 403 `policy.missingClaim`（fail-closed，不退化成「全部可见」） |
| 表达式整体无法求值（`scope` 缺 value 等） | 403 `policy.missingClaim` |
| `not (缺 claim 的分支)` | 视为不可满足，**不会**变成「全放开」 |
| 写了被 mask 的字段 | 400 `policy.maskedField`（掩码是读写双向的） |
| 导入包含被 mask 的列 | 400 `Masked fields cannot be imported: …`（`import.maskedField`） |
| 对被 mask 字段做 aggregate | 403 `policy.maskedField` |
| 读响应 | `mask(record)` 按角色/claim 生效：`omit` 删键、`null` 置 null、`redact` 替换为固定字符串 |

- 行条件**下推到 SQL**（列表/详情/聚合/趋势/导出/更新/删除同一份条件），不做客户端过滤。
- `rows` 之间 AND；每个 `groups[i]` 内部 OR、与 `rows` AND；`expressions` 再 AND 到最外层。
- `restrict` 的 `mask` 是**唯一**真正隐藏数据的字段机制；`pages` 的字段规则只是不渲染。

::: warning 与 dataflow / realtime 的互斥
- **带 `restrict` 块的资源不能出现在任何 dataflow 里**（context 加载或 create 目标都算）。注意判定条件是「有没有 `restrict` 块」，不只是行谓词：即使只写了 `allow roles` 或 `mask`，生成期也会报 `Restrict <resource>: dataflow <name> cannot use a restricted resource until command authorization applies the same row policy`。需要「限定范围内执行命令」时，请把范围放进命令自己的 `require`/context 校验，或把命令拆到另一个没有 `restrict` 的资源上。
- **realtime 不能订阅带 `restrict` 行谓词（`when`）的资源**：生成期报 `restrict row predicates cannot be enforced on a shared channel`。只有 `roles`/`mask` 的 `restrict` 可以叠加 realtime（`mask` 会在入队前裁剪负载）。
:::

## 数据范围：`scope`

语法见 [application · scope](/dsl/application#scope)。

```qiy
scope warehouses orgId claim org.id;
scope warehouses orgId claim org.id tree organizations parentId;
```

| 属性 | 规则 |
| --- | --- |
| resource | 实体名或表名；每资源最多一条 |
| field | 必须是 `UUID` 或 `Text`（生成器不禁止主键，但通常用外键/租户列而不是主键） |
| claim | `^[a-zA-Z_][a-zA-Z0-9_.-]*$`，从 `principal.claims` 取值 |
| `tree <entity> <parentField>` | 该实体必须存在，`parentField` 为 UUID/Text；scope 字段类型必须与树主键、父字段**类型一致** |
| 本地/混合认证 | 每个 scope claim 必须在 users 上有对应列（claim `org.id` → 字段 `orgId`，点号后的首字母大写），否则生成期报 `Data scope claim org.id needs a matching field on users (expected orgId) to resolve local password sessions`；该列用于 API Key 与本地会话派生 claim |

运行时：

| 位置 | 行为 |
| --- | --- |
| 读（列表/详情/聚合/趋势/导出/GraphQL） | 追加 `field = claim 值`（tree 时为「子树展开」）；claim 缺失 → 403 `Missing required data scope claim: <claim>` |
| claim 指向不存在的节点 | 子树为空 → 返回空结果，不回退成全量 |
| 写入（create/update） | scope 字段被**强制**写成 claim 值；客户端提交的同名字段被覆盖 |
| dataflow | 不允许 `update` scope 字段（`cannot update scope field`）；`create` 时 scope 字段由 principal 推导（`create scope field ... is derived from the authenticated principal`） |
| `restrict { when ( scope or ... ) }` | 表达式含 `scope` 时跳过仓储层隐式 scope 过滤（否则会变成 AND 覆盖 OR 语义），按表达式求值 |
| API Key | 由用户行反查 claim 列（`org.id` ← `orgId`），因此 scope 对 API Key 同样生效 |

## 页面规则：`pages`

```qiy
pages orders {
  list   roles admin, operator, viewer;
  show   roles admin, operator, viewer;
  create roles admin, operator;
  edit   roles admin, operator;
  delete roles admin;
  field totalCost roles admin;      // 仅界面：非 admin 不渲染该字段
}
```

| 属性 | 规则 |
| --- | --- |
| 动作 | 固定 `list` / `show` / `create` / `edit` / `delete`，每动作最多一次 |
| 角色 | 非空、不重复，仅 `admin`/`operator`/`viewer` |
| 未声明动作 | 不受页面规则限制（仍受 `restrict.roles` 与角色模型约束） |
| `field <name> roles ...` | 只影响 UI 渲染（`canSeeField`）；**不会**过滤 API 响应，需要真正隐藏请用 `mask` |
| 空块 | 至少一个动作或一个字段规则，否则 `requires at least one page action or field rule` |

三层落地：

1. **服务端 guard**（`auth/guard.ts`）：REST 路由按方法/路径映射为页面动作（`GET` 列表→`list`、`GET /:id`→`show`、`POST`→`create`、`PATCH|PUT`→`edit`、`DELETE`→`delete`；`export` 读→`list`；`import` 读→`list`、写→`create`），GraphQL 按根字段映射；不通过返回 403 `Page access denied`。
2. **Web**：`qiyAccessControlProvider` 先查资源角色策略，再查页面规则；页面守卫组件 `resource-page-guard.tsx` 用 `CanAccess` 包裹四个 CRUD 路由，直接输入 URL 也返回 403 `Result`。
3. **API 文档**：`/api/v1/openapi.json`、`/api/v1/docs/model` 按 `pages` 裁剪操作；`viewer` 在文档里只保留 `list`/`show`。

## 映射总表：声明 → 生成物

| DSL | 生成物 | 生效点 |
| --- | --- | --- |
| `auth { ... }` | `auth/guard.ts`、`auth/local.ts`、`auth/oidc.ts`、`auth/hybrid.ts`、`auth/password.ts` | 每个请求 → `Principal \| null` |
| `permission field/group/from` | `auth/permissions.ts`（`PERMISSION_FIELD_VALUES`/`PERMISSION_GROUPS`/`PERMISSION_CLAIM_SOURCES`）、`auth/permission-routes.ts` | `/auth/permissions`、`/auth/verify-permission`、`/auth/me`、命令路由 |
| `permission verification` | `PERMISSION_VERIFICATIONS`（表达式已序列化为数据） | 校验接口、`allow verification`、Web `CanAccess`（无 input 时） |
| `restrict` | `security/policy.ts`（`policies` 字面量 + `resolvePolicy`）、资源 `*.repository.ts`/`*.routes.ts` | 行条件下推、掩码读写、资源级 403 |
| `scope` | `security/policy.ts`（`scopeResources`/`scopeHelpers`）、`resolveScope()`、树 helper | 读写路径的隐式范围过滤 |
| `pages` | `auth/guard.ts` 的 `PageRules`、`web/app/auth.ts` 的 `pageRules`、`resources[].fields[].roles` | REST/GraphQL 守卫、页面守卫、字段渲染、文档过滤 |
| `dataflow allow` | 命令路由内的 403 判定；Web `commandPolicies` | `/api/v1/commands/<name>`、按钮可见性 |
| `action allow` | Web `commandPolicies` + 业务页路由守卫 | 按钮与 `/…/:id/<action>` 页面 |
| `features apiKeys` | `qiy_api_keys` 表、`auth/api-keys.ts`、`withApiKeyAuthentication` | Bearer/`X-API-Key` 认证兜底 |

## i18n 与错误消息

- `permission field/group/verification` 支持 `@label("...")` / `@label(t("key"))` 与 `@comment(...)`；`t()` 引用的 key 必须在 `messages.default` 语言存在。默认语言的文案写入 IR，同时保留 `labelKey` 供前端翻译；`/system/overview` 的「权限模型」页签展示字段/组/校验与当前用户有效权限。
- 生成错误使用**稳定英文 key**（前端可按 key 翻译）：

| `errorKey` | 触发 | HTTP |
| --- | --- | --- |
| `command.forbidden` | `allow permission` 缺权限 / `allow verification` 拒绝 | 403 |
| `policy.denied` | 通用策略拒绝（默认值） | 403 |
| `policy.resourceDenied` | 角色不在 `restrict.roles` | 403 |
| `policy.missingClaim` | 行条件/表达式缺 claim | 403 |
| `policy.maskedField` | 写或聚合被 mask 的字段 | 400 / 403 |
| `policy.misconfigured` | 策略引用了不存在的列（生成缺陷） | 500 |

- 业务错误文案（`require ... @error(t("key"))`）返回默认语言文本 + `errorKey`，前端按当前语言翻译；见 [dataflow · 业务错误翻译](/dsl/dataflow#业务错误翻译)。

## 与 API 文档、访问密钥的关系

- `GET /api/v1/openapi.json` 与 `/api/v1/docs/model` 是**按当前主体过滤**的文档（`features.apiDocs`，`/docs/model` 还服务于功能总览）：admin 全量；非 admin 看不到用户资源；`restrict.roles` 与 `pages` 进一步裁剪；`viewer` 只保留 `list`/`show`。
- 文档里每个操作的 `x-qiy-roles`、`x-qiy-permissions`、`x-qiy-verification` 记录**声明值**（权限字段/组名），用于审计与人工核对。
- 带 `allow verification` 的命令在文档中**只对 admin** 展示（verification 依赖运行时输入，文档阶段无法判定）。
- API Key 继承用户角色与权限（角色组 + 数据库列 + scope 派生 claim），**不**继承 id_token claims；`apiKeys` 见 [features](/dsl/features) 与 [API 文档与访问密钥](/guide/api-docs-and-keys)。

## 安全注意事项

1. **按钮隐藏不是授权**。`when`、`pages`、`CanAccess` 都只是交互体验；写操作最终由服务端 `restrict`/`scope`/`allow`/`require` 判定。
2. **权限只做加法**。任何来源都只能增加权限值；要「降权」，改角色、改数据库列或改 IdP claim，不要指望在 DSL 里做减法。派生权限无法通过 `mask` 撤销。
3. **admin 不绕过显式白名单**。`restrict { allow roles operator; }`、`allow roles operator;` 都会拒绝 admin；依赖「admin 总能进」的运维路径要显式加上 admin。
4. **admin 只在文档层短路**：`/api/v1/openapi.json` 的过滤对 admin 返回全部；但 `restrict` 的行条件与 `allow roles` 一样会核验 admin（`mayUseResource` 不特判 admin），因此「仅 operator 可见」的资源 admin 也进不去。
5. **字段掩码是读写双向的**，并覆盖生成的读路径（列表/详情/聚合/导出/实时负载）；但数据库列仍是明文——**备份、数据库直连、应用日志、外部系统不在 `mask` 保护范围内**。被 mask 的字段也不能被导入（`Masked fields cannot be imported`）。
6. **`restrict` 块与 dataflow 互斥、行谓词与 realtime 互斥**，不要用「命令里看不到」当作行级隔离；命令绕过会被生成期直接拒绝（有意的 fail-closed 设计）。
7. **共享 channel 不能做行级隔离**：realtime 只做字段级 mask 裁剪；需要行级隔离时用 `when <field> claim <claim>` 分段通道，而不是 `restrict` 行谓词。
8. **API Key 等同会话**：泄露即等同该用户全部权限（含角色组与数据库列权限）；只在服务端保存 HMAC-SHA256，前端永不持久化完整 key。撤销/过期立即 401。
9. **文档是权限过滤后的**：不要把 OpenAPI 当成「完整攻击面清单」；`allow verification` 与行级 scope 不会体现在文档结构里。
10. **默认值要显式**：`restrict` 未声明 `allow roles` 时不限制角色；`pages` 未声明的动作不受限制；`dataflow` 未声明 `allow` 时默认 `admin, operator`。发布前请逐条确认。
11. **`role` 字段是权威**：本地会话的角色来自 users 行；修改角色后旧 JWT 里的 `role` 仍会 stale（JWT 12 小时有效），但 `findUserById` 会重新读行并把最新 `role` 放进 principal——不要假设 token 载荷等于当前权限。
12. **权限值即契约**：claims、数据库列、`x-qiy-permissions`、403 `missing` 都直接用权限值字符串；改值等于破坏外部 IdP/脚本集成。

## 校验错误一览

解析期（parser）与生成前（`validatePermissionModel` / 生成器校验）会拒绝：

| 分类 | 错误（节选） |
| --- | --- |
| 权限字段 | `value cannot be empty`、`value cannot contain whitespace`、`duplicate value`、`duplicate declaration` |
| 权限组 | `unknown member`、`duplicate member`、`requires at least one member`、`cannot reference itself`、`cyclic group reference`、`name already used by a permission field` |
| 来源 | `duplicate database source declaration`、`provider is not a configured OAuth/OIDC provider`、`local and otp sessions do not carry claims`、`must be a Text column`、`is not the auth user entity` |
| 校验块 | `requires a return statement`、`unknown input`、`unknown self set`、`duplicate input`、`input name self is reserved`、`role membership comparison requires a non-role set`、`empty logical expression`、`duplicate declaration` |
| 表达式 | `expected self.*, input.* or a quoted string`、`expected some/all included in, = or !=`、`expected included in or in`、`Array requires String (Array<String>)`、`unsupported input type` |
| 引用 | `unknown permission field or group`、`unknown permission verification`、`has no matching dataflow input`、`must be @required`、`requires a Text or enum dataflow input` |
| 前提 | `Permission declarations require a generated auth block`、`Permission declarations require at least one permission field`、`Permission claim sources require at least one OAuth/OIDC provider` |
| 互斥 | `dataflow <x> cannot use a restricted resource`、`allow roles` / `allow permission` 在 dataflow action 上重复声明 |
| restrict / scope / pages | 见 [application](/dsl/application#restrict) 与下文「常见错误」 |

## 完整示例：权限 + 范围 + 行策略 + 页面 + 命令

```qiy [app.qiy]
qiy v0;
application warehouse-admin {
  database postgresql {}
  api { client rest; }
  features { overview true; apiDocs true; apiKeys true; }

  auth {
    providers local, oidc;
    user users;
    subjectField subject;
    roleField role;
    usernameField email;
    passwordField passwordHash;
    provider oidc { subjectField oidcSubject; claim oidcSub; }
  }

  messages { default "zh-CN"; locale "zh-CN" { "perm.receive" "收货"; } }

  permission field InventoryReceivePermission "inventory:receive" @label(t("perm.receive"));
  permission field ReportReadPermission "report:read";
  permission group operator { InventoryReceivePermission, ReportReadPermission }
  permission group admin { InventoryReceivePermission, ReportReadPermission }
  permission group viewer { ReportReadPermission }
  permission from database field users.permissions;
  permission from claim oidc "roles";
  permission verification CanReceiveStock {
    input { field permission Text; }
    return input.permission all included in self.permissions;
  }

  enum userRole { value admin; value operator; value viewer; }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
    field subject Text @unique;
    field oidcSubject Text @unique @nullable;
    field orgId UUID @nullable;
    field permissions Text @nullable;
  }

  entity warehouses {
    field id UUID @id;
    field orgId UUID;
    field code Text @unique;
    field budget Decimal(12, 2) @nullable;
  }

  entity inventory {
    field id UUID @id;
    field warehouseId UUID;
    field sku Text @unique;
    field status Text;
    field quantity Integer;
    field unitCost Decimal(12, 2) @nullable;
  }

  scope warehouses orgId claim org.id;
  scope inventory warehouseId claim org.id;

  # warehouses 没有 dataflow，因此可以安全声明 restrict（行策略 + 字段掩码）
  restrict warehouses {
    allow roles admin, operator, viewer;
    mask budget roles viewer mode omit;
  }

  pages inventory {
    list   roles admin, operator, viewer;
    show   roles admin, operator, viewer;
    create roles admin, operator;
    edit   roles admin, operator;
    delete roles admin;
  }

  # inventory 被命令使用，保持无 restrict 块（否则生成期拒绝该 dataflow）
  dataflow receiveStock @label("收货") @confirm("确认收货？") {
    allow permission InventoryReceivePermission;
    idempotency required;
    audit "inventory.received";
    input {
      field inventoryId UUID @required;
      field quantity Integer @required @comment("本次收货数量");
    }
    context {
      item = entity inventory by id input.inventoryId @required;
    }
    step validate {
      require input.quantity > 0 @error("数量必须大于 0");
    }
    step apply {
      update item { quantity = input.quantity; }
      emit "inventory.received" { inventoryId = item.id; quantity = input.quantity; }
    }
    result { return item; }
  }

  action receiveStock {
    resource inventory;
    dataflow receiveStock;
    placement list, show;
    when status != "archived";
  }
}
```

要点：`inventory` 被 `dataflow` 使用，所以**不能**声明 `restrict`；`warehouses` 只被 CRUD 使用，可以声明 `restrict`（角色 + 掩码），也可能同时叠加 realtime（只要没有 `when` 行谓词）。

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Permission declarations require a generated auth block` | 有 `permission` 但没 `auth` | 加 `auth` 块；否则删掉权限声明 |
| `provider is not a configured OAuth/OIDC provider` | claim 来源写了未配置的 provider（含 `local`/`otp`） | 把该 provider 加进 `providers`，或改用数据库列 |
| 命令 403 且 `missing` 为空 | `allow verification` 用了集合否定（`not all in`）或无诊断值的运算符 | 看 `allowed` 结论；`missing` 只是解释 |
| 非 admin 看不到命令按钮 | `allow permission` 未生效 / `permissions` 元数据缺失 | 检查 `/auth/me` 是否带 `permissions`；检查数据库列/claims 里的值是否**权限值或组名** |
| 非 admin 在 API 文档里看不到 `allow permission` 命令 | 该主体未持有展开后的全部权限值 | 检查 `/auth/me` 的 `permissions` 是否包含这些值（组会递归展开）；文档过滤与命令执行使用同一套判定 |
| `dataflow ... cannot use a restricted resource` | 命令的 context/create 使用了任何带 `restrict` 块的资源 | 把该资源从命令中移出，或去掉它的 `restrict` 块 |
| `restrict row predicates cannot be enforced on a shared channel` | 同一资源同时声明了 realtime 与行谓词 | 用 `when <field> claim <claim>` 分段通道，或关掉该资源 realtime |
| `page access denied` | `pages` 规则不允许该角色执行该动作 | 调整 `pages`；注意 `export` 走 `list`、`import` 走 `create` |
| `Missing required data scope claim: org.id` | principal 缺 scope claim（本地密码会话只有 DB 提供的 claim） | 用 OIDC claim、给 users 行补 scope 列，或改用 API Key |
| 写被 mask 的字段返回 400 | `mask` 是读写双向的 | 去掉该 mask 或允许对应角色写 |
| 组环 / 自引用 | 组互相引用 | 展平成列表形式或用并集重写 |

## 覆盖清单

| 构造 | 覆盖位置（本页章节） |
| --- | --- |
| `permission field` / 值规则 / `@label` / `@comment` | 原子权限：`permission field` |
| `permission group`（列表 / `&` 并集）/ 环 / 角色组 | 权限组：`permission group` |
| `permission from database field`（列契约 / 解析 / 忽略） | provider 来源：`permission from` |
| `permission from claim`（provider 约束 / 值规范化 / 运行期合并） | provider 来源：`permission from` |
| 生效权限并集（角色组 ∪ 数据库 ∪ claims） | 生效权限解析与 HTTP 接口 |
| `permission verification` / `input` / 表达式文法 / 优先级 / 6 种比较 / `missing` | 权限校验块：`permission verification` |
| `/auth/permissions`、`/auth/verify-permission`、`/auth/me` | 生效权限解析与 HTTP 接口 |
| `dataflow allow roles/permission/verification`、403 契约、Web `CanAccess` | 命令策略（allow） |
| `restrict` 的 `allow roles` / `when`（claim/值/`in`/跨字段/布尔/`scope`）/ `mask` | 资源与记录策略：`restrict` |
| `scope`（field / claim / tree / 写入强制 / `scope` 原子 / API Key claims） | 数据范围：`scope` |
| `pages`（5 个动作 + 字段规则 + 三层落地） | 页面规则：`pages` |
| 声明 → 生成物映射 | 映射总表：声明 → 生成物 |
| `errorKey`、i18n | i18n 与错误消息 |
| OpenAPI / API Key 交互 | 与 API 文档、访问密钥的关系 |
| 全部校验错误 | 校验错误一览 |

## 进阶用法

**1）三层权限组**：原子权限 → 能力组 → 角色组，迁移时只改角色组。

```qiy
// 原子权限字段（Inventory* / PurchaseApprovePermission / SalesShipPermission / ReportReadPermission）见上文
permission group InventoryTeam  { InventoryReceivePermission, InventoryPutawayPermission }
permission group OrderTeam      { PurchaseApprovePermission, SalesShipPermission }
permission group admin   { InventoryTeam, OrderTeam, ReportReadPermission }
permission group operator { InventoryTeam, ReportReadPermission }
permission group viewer  { ReportReadPermission }
```

**2）数据库列做「个人加授」**：角色组提供基线，`users.permissions` 列给个别用户加权限（只加不减）。

```qiy
permission from database field users.permissions;
# 某行值：["purchasing:approve","InventoryTeam"]
```

**3）用校验块表达交集**：

```qiy
permission verification CanApproveAndShip {
  return input.approve all included in self.permissions
      && input.ship all included in self.permissions;
}
```

**4）区域 OR 本人（`scope` 原子 + 其它分支）**：

```qiy
scope orders region claim region tree regions parentId;
restrict orders {
  when ( scope or ownerId claim user.id );
}
```

表达式里出现 `scope` 时，仓储层的隐式 scope 过滤会被跳过（否则会变成 AND 覆盖 OR），写入仍强制落在调用者自己的节点。

**5）发布前的一致性检查**：

1. `GET /api/v1/auth/permissions` 对 admin/operator/viewer 各取一次，确认组展开符合预期；
2. `POST /api/v1/auth/verify-permission` 跑一遍 `all in` / `some in` / `=` 的边界样本；
3. `GET /api/v1/openapi.json` 用每个角色各看一次，确认命令与资源可见性符合预期（注意 `allow permission` 命令的文档偏差）；
4. 用 `restrict` 的 `mask` 校验列表/详情/导出/实时四条读路径；
5. 确认命令里引用的资源没有 `restrict` 块。

## 相关

- [认证（auth）](/dsl/auth)：provider、会话、混合登录、onboarding、个人中心、环境变量。
- [application](/dsl/application#restrict)：`scope` / `restrict` / `pages` 的逐关键字语法。
- [dataflow](/dsl/dataflow)：`allow` 的位置、`require` 失败与 403/409 契约。
- [actions](/dsl/actions)：`when`、`page manual` 与按钮可见性。
- [realtime](/dsl/realtime)：共享 channel 的字段裁剪与分段通道。
- [features](/dsl/features)：OpenAPI 过滤与 API Key 生命周期。
- 仓库测试：`tests/permissions.test.ts`（解析/序列化/校验/集合语义/provider 解析/生成集成）、生成项目的 `apps/server/tests/permissions.test.ts`（运行时 provider、真值表、HTTP、`/auth/me`）、`tests/resource-policy.test.ts`、`tests/local-scope-claims.test.ts`。
- 完整示例：[examples/self/modules/permissions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/permissions.qiy)、[examples/self/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/self/app.qiy)。
