# 权限（permission）

`permission` 块把「权限值」从业务代码里抽出来，成为可被 DSL 校验、可被 provider 解析、可被命令与 HTTP 接口复用的声明式模型。角色没有独立语义：**权限组（permission group）就是角色**，二者只是命名不同；`permission group admin { ... }` 定义本地 `role: admin` 用户的权限集合，因此既有 `role` 字符串完全向后兼容。

权限声明放在 `messages` 之后、`workflow` / `enum` / `entity` 之前（这样 `@label` 可以引用消息字典，声明也能在解析结束时对照 `users` 表校验）。生成结果需要 `auth` 块。

## 原子权限

```qiy [app.qiy]
permission field ApiGetUserPermission "api:getUser" @label("Read user API");
permission field ApiPutUserPermission "api:putUser";
permission field ApiDeleteUserPermission "api:deleteUser";
```

- `name` 是 DSL 内引用名（标识符），字符串是写入 provider / claims / 数据库列的**权限值**；
- 权限值不能为空、不能包含空白，且必须唯一（重复值会让组展开产生歧义）；
- 可选 `@label("...")` / `@label(t("key"))` 与 `@comment(...)` 仅作为文档/i18n 元数据，进入 IR 并随序列化往返。

## 权限组

```qiy [app.qiy]
permission group UserApiPermissionGroup { ApiGetUserPermission, ApiPutUserPermission }
permission group ManagerRole { ApiPutUserPermission, ApiDeleteUserPermission }
permission group SuperAdminManager = UserApiPermissionGroup & ManagerRole;

permission group admin { SuperAdminManager, InventoryReceivePermission }
permission group operator { InventoryReceivePermission, InventoryAdjustPermission }
permission group viewer { ReportReadPermission }
```

- 组成员可以是权限字段，也可以是其他组；
- `&` 是**并集**运算符：`SuperAdminManager` 同时持有 `UserApiPermissionGroup` 与 `ManagerRole` 的全部权限。这里不实现交集；需要交集语义时请用校验表达式（`all included in` 两个集合）表达；
- 组名与权限字段名共享命名空间，重复或互相引用会报错；自引用和任意环（`G1 -> G2 -> G1`）在生成前拒绝；
- 组名等于角色名（`admin` / `operator` / `viewer`）时即「角色组」，本地密码会话按角色名直接解析。

## provider 来源

生效权限是以下来源的**并集**（只做加法，不做减法）：

| 来源 | 声明 | 说明 |
| --- | --- | --- |
| 角色组 | 无需声明 | 组名等于 `principal.role` 的组；本地密码会话由此获得基础权限 |
| 数据库列 | `permission from database field users.permissions;` | `users` 必须是 auth 用户实体，列必须是 `Text`，存放 JSON 字符串数组（也接受逗号/空格分隔文本）；每一项是权限值或组名；行缺失/列解析失败会被忽略（角色与 claims 仍然生效） |
| OAuth claim | `permission from claim azure-ad-b2c "roles";` | provider 必须是 auth 块里配置的 OAuth/OIDC provider；claim 来自**已验证的 id_token**（`local` / `otp` 会话没有 claims）；claim 值可以是字符串数组，或空格/逗号分隔的字符串；每一项按权限值或组名展开，未知值忽略 |

claim 来源可重复（如同时映射 `azure-ad-b2c "roles"`、`google "groups"` 和自建 Dex 租户的 `"roles"`）。当前生成的 OIDC 认证器只信任已验签 token 的 claim，并保留字符串数组类型的 claim；IdP 需要真正签发对应 claim 才会生效（Dex 默认不签发 `roles`/`groups`，需在租户侧配置 mapper —— 见 [examples/self](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/permissions.qiy) 的说明）。

## 权限校验块（verification）

校验块把「当前 principal 是否满足某个集合关系」写成封闭表达式，可用于 HTTP 验收接口与 dataflow 的 `allow verification`。

```qiy [app.qiy]
permission verification CanAccessUserApi {
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
```

- `input` 块可省略；输入类型只有 `Text`（单个字符串）与 `Array<String>`（字符串数组），声明后即**必填**，类型错误返回 400；
- 可用集合：`self.permissions`（生效权限值）、`self.groups`（生效组名）、`self.role`（单值）、`input.<field>`，以及字符串字面量；
- 逻辑运算：`&&`、`||`、`!` 和括号；`&&` 优先级高于 `||`；
- 比较运算（两侧都归一化为字符串集合）：

| 运算符 | 别名 | 语义 | 失败时的 `missing` |
| --- | --- | --- | --- |
| `all included in` | `all in` | 左集合 ⊆ 右集合 | 左集合中不在右集合的元素 |
| `some included in` | `some in` | 左右集合交集非空 | 左集合元素（此时与右集合无交集） |
| `not all included in` | `not all in` | 左集合不是右集合的子集 | 无 |
| `not some included in` | `not some in` | 左右集合不相交 | 交集元素（即「不该出现」的值） |
| `=` | — | 集合相等 | 对称差 |
| `!=` | — | 集合不相等 | 无 |

组合表达式失败时 `missing` 是各失败比较诊断的并集（最佳努力的可解释信息），`allowed` 才是权威结论；所有集合比较与顺序无关。

## HTTP 接口

生成服务端在 `auth` 且声明了权限时提供：

- `GET /api/v1/auth/permissions`（已认证）→ `{ permissions: string[], groups: string[] }`；
- `POST /api/v1/auth/verify-permission`（已认证）

  ```json
  { "verification": "CanAccessUserApi", "input": { "permission": ["api:getUser"] } }
  ```

  成功：`{ "allowed": true }`；拒绝：`{ "allowed": false, "missing": ["api:putUser"] }`；未知校验名/缺少或类型错误的输入：400；未认证：401。`input` 中未声明的字段被忽略。

- `GET /api/v1/auth/me` 在原有 `{ id, name, role }` 基础上追加 `permissions` 与 `groups`（向后兼容）。

未认证请求由 guard 返回 401；权限校验接口本身不做角色检查。

## dataflow / action 的 allow 形式

```qiy [modules/dataflows.qiy]
dataflow receiveInventory @label("Receive goods") {
  allow permission InventoryReceivePermission;   // 必须持有列出的全部权限
  ...
}

dataflow shipSalesOrder @label("Ship order") {
  allow verification CanShipOrders;              // 用 flow input 求值校验表达式
  ...
}

dataflow reserveStock @label("Reserve stock") {
  allow roles admin, operator;                   // 旧写法，继续支持
  ...
}
```

- `allow permission A, B;`：A/B 可以是权限字段或组名；生成期展开为权限值，请求期要求 principal 的生效权限包含全部值。拒绝返回 403，body 含 `error`、`errorKey: "command.forbidden"` 与 `missing`；
- `allow verification Name;`：校验块声明的每个 input 必须在 flow 的 `input` 中有同名、`@required` 的 `Text` 或枚举字段（`Array<String>` 由单个值提升为单元素数组）；生成期校验，请求期用 flow 输入求值；拒绝同 403；
- 每个 dataflow 只允许一种 `allow`（roles / permission / verification 互斥）；`action` 上不重复声明（会提示在 dataflow 上声明），但手写 `navigate` action 可用 `allow permission` / `allow verification` 控制按钮可见性；
- 命令路由现在自行执行 allow 规则；guard 只负责认证（`/api/v1/commands` 从通用角色守卫中豁免），因此持有权限的非 admin/operator 角色也能执行命令。**资源 CRUD 的 `restrict.roles` / `pages` / action `roles` 仍是角色规则**（未迁移；可后续用同样机制表达）。

### Web 端

生成的 `app/auth.ts` 中：

- `commandPolicies` 记录每条命令的 `roles`，以及 `allow permission` 展开后的 `permissions`、无输入 `allow verification` 的表达式；
- `qiyAccessControlProvider` 在身份（`/auth/me`）带 `permissions` 时优先按生效权限判断命令可见性；服务端未提供权限元数据时回退到旧的角色 allow list；
- 有输入的 `allow verification` 无法在浏览器端求值，按钮可见性回退角色列表，服务端仍强制校验。

## 兼容与迁移

- 既有 `allow roles admin, operator;`、`restrict { allow roles ... }`、`pages ... roles ...`、action `roles` 全部保持原有语义；
- 未声明任何 `permission` 块时，生成结果与之前一致（不生成 provider、`/auth/permissions`、`/auth/verify-permission`，`/auth/me` 不追加字段）；
- `role` 字符串仍是本地密码会话的权威角色；权限只做加法，因此把角色组声明成 permission group 是推荐迁移路径。

## 校验错误

解析/生成前会拒绝：未知组成员、重复权限名/值、组环与自引用、未知 `self.*` 集合、未知 `input.*` 字段、非法运算符或不平衡括号、未配置的 claim provider、非 `Text` 或不属于 auth 用户实体的数据库列、未知的 dataflow `allow permission` / `allow verification`、校验输入与 flow 输入不匹配，以及没有 `auth` 却声明权限。

仓库测试：`tests/permissions.test.ts`（解析/序列化/校验/集合语义/provider 解析/生成集成），生成的 `apps/server/tests/permissions.test.ts`（生成运行时 provider、真值表、HTTP 与 `/auth/me`）。完整示例见 [examples/self/modules/permissions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/permissions.qiy)。
