# DSL 用法手册（按目标分组）

这不是语法参考，而是**按目标组织的配方集**：每个配方给出「要达到什么、模型怎么写、会生成什么、哪里会踩坑、去哪看细节」。语法、参数全集与校验错误请点每节的参考链接，这里不重复。

- 想先跑通一个完整项目：看 [快速开始](/guide/getting-started) 与 [仓储系统最佳实践](/guide/best-practice-warehouse)。
- 想查某个关键字的全部取值：看 [DSL 总览](/dsl/overview) 与对应 `dsl/*` 页面。
- 本页所有配方都来自同一个可生成模型（`examples/self` 的精简版）：关键配方已用 `qiy generate` 验证，集成模式配方用解析器验证。

## 配方索引

| 分组 | 配方 | 解决的问题 |
| --- | --- | --- |
| 数据建模 | [主数据](#recipe-11) | 编码、名称、唯一约束、外键下拉、显示文本 |
| 数据建模 | [单据 + 明细](#recipe-12) | 一对多、级联删除、金额与数量 |
| 数据建模 | [自关联树](#recipe-13) | 组织/分类层级、树范围 |
| 数据建模 | [业务编码与 UUID](#recipe-14) | `@code` / `@generated` 与创建表单 |
| 权限 | [本地 + OAuth 混合登录](#recipe-21) | 一套登录页、两种身份来源 |
| 权限 | [权限值与校验](#recipe-22) | 权限组、claim、数据库列、verification |
| 权限 | [数据范围 scope](#recipe-23) | 一个字段绑定 claim、组织子树 |
| 权限 | [行策略、字段与页面](#recipe-24) | `restrict`、`mask`、`pages` |
| 自动化 | [Dataflow + Action](#recipe-31) | 事务型业务命令与按钮 |
| 自动化 | [校验、确认、幂等、审计](#recipe-32) | `require`、`confirm`、`idempotency`、`audit` |
| 自动化 | [手动业务页](#recipe-33) | `navigate` + `page manual` |
| 自动化 | [内置订单工作流](#recipe-34) | `workflow orderInventory` |
| 概览 | [多视图图表 + 面板](#recipe-41) | 图表页、响应式栅格、面板切换 |
| 概览 | [KPI、聚合与表格预览](#recipe-42) | `const`/`aggregate`/`table` |
| 多语言/主题 | [完整词典](#recipe-51) | 资源/字段/枚举/图表/命令/错误 |
| 多语言/主题 | [主题与色彩模式](#recipe-52) | `ui` 块 |
| 系统管理 | [功能总览、API 文档、密钥](#recipe-61) | `features` |
| 集成/部署 | [集成现有 API / Bun 项目 / 存储 / 部署](#recipe-71) | 宿主适配与上线 |

## 数据建模

### 配方 1.1：主数据 {#recipe-11}

**目标**：一张可维护的主数据表——业务编码唯一、显示文本友好、外键在表单里是下拉而不是裸 UUID、列表按外键过滤能走索引。

**前置**：已经声明 `enum`（若有）；`entity` 写在 `enum` 之后、`relation` 之前。

**模型**

```qiy
enum activeState {
  value active label "启用" color green icon CheckCircleOutlined;
  value inactive label "停用" color default;
}

entity Product table products
  @label("Products")
  @icon(AppstoreOutlined)
  @singular("Product")
  @plural("Products")
  @display("{$.sku} · {$.name}")
  @tableDisplay("{$.sku} · {$.name}")
  @relationDetail("<b>{$.name}</b></br>{$.sku}") {
  field id UUID @id;
  field sku Text @unique @code("SKU-{YYYY}{MM}-{seq:4}");
  field name Text @label("Name");
  field price Decimal(12,2) @nullable;
  field active activeState;
  field createdAt DateTime @nullable;

  index products_name_idx btree(name);
}

entity Organization table orgs @label("Organizations") @icon(TeamOutlined) {
  field id UUID @id;
  field name Text @label("Name");
  field parentId UUID @nullable;
}

relation orgParent Organization parentId Organization id one @onDelete(setNull);
```

**生成结果**

- `apps/server/src/db/schema.ts` 中的 `products`/`orgs` 表、唯一约束、索引与外键。
- 列表页外键列显示目标实体的 `@tableDisplay`/`@display` 文本（这里是 `sku · name`），而不是 UUID；点击打开抽屉。
- 新建/编辑表单里 `orgId`（示例中在 Organization 自关联）渲染为可搜索下拉。
- `@code` 字段在创建表单中隐藏，由服务端按模板生成。
- 资源路由是 `/products`；i18n key 用**表名** `products`。

**坑**

- `relation` 的两端写**实体名**（`Product`、`Organization`），不是表名 `products`/`orgs`；写表名会报 `Relation X: referenced entity does not exist`。
- 没有 `relation` 的 `UUID` 字段会被当成"系统生成引用"：创建时自动填随机 UUID、表单不显示。真实外键必须补 relation。
- `@code` 只能用于非枚举 `Text`、不能是主键，也不能与 `@generated` 同用。
- 目标字段必须 `@id` 或 `@unique`，两端都必须是 UUID。

**参考**：[entity 与 field](/dsl/entity) · [relation 与 index](/dsl/relation-index) · [自动生成值与业务编码](/dsl/generated-values)。

### 配方 1.2：单据 + 明细 {#recipe-12}

**目标**：采购单/订单这类"头 + 行"结构：明细随主单级联删除，金额用 `Decimal`，行数量用 `Integer`。

**前置**：沿用配方 1.1 的 `Product` 实体（明细行引用它）。

**模型**

```qiy
enum purchaseStatus {
  value draft;
  value approved;
  value received;
  value cancelled;
}

entity purchase_orders @label("Purchase orders") @icon(ShoppingCartOutlined) {
  field id UUID @id;
  field number Text @unique @code("PO-{YYYY}{MM}-{seq:4}");
  field status purchaseStatus;
  field total Decimal(12,2) @nullable;
  field orderedAt DateTime @nullable;

  index purchase_orders_status_idx btree(status);
}

entity purchase_order_lines @label("Purchase order lines") @icon(OrderedListOutlined) {
  field id UUID @id;
  field orderId UUID;
  field productId UUID;
  field quantity Integer;
  field unitPrice Decimal(12,2);
  field lineTotal Decimal(12,2) @nullable;

  index purchase_lines_order_idx btree(orderId);
}

relation lineOrder purchase_order_lines orderId purchase_orders id one @onDelete(cascade);
relation lineProduct purchase_order_lines productId Product id one @onDelete(restrict);
```

**生成结果**

- 明细表带 `ON DELETE CASCADE` 外键；删除主单时数据库级联删除明细。
- 列表页可用 `orderId` 过滤（有索引），外键列按目标 `@tableDisplay` 显示。
- `Decimal(12,2)` 在表单/详情中按两位小数显示；`Integer` 数量按整数处理。

**坑**

- 明细的 `orderId` 必须声明 relation，否则会被当成随机 UUID。
- `purchase_order_lines` 的显示文本默认回退；建议给明细加 `@display`/`@tableDisplay`，否则列表里只有主键。
- 订单合计不会自动汇总；需要 `lineTotal`/`total` 时用 Dataflow 计算并写入（见 [配方 3.1](#recipe-31)），或由服务端领域逻辑维护。
- 行表通常不需要独立菜单项；用 `menu` 只挂主单即可（明细从详情页进入）。

**参考**：[relation 与 index](/dsl/relation-index) · [数据建模指南](/guide/data-modeling)。

### 配方 1.3：自关联树 {#recipe-13}

**目标**：组织、分类、物料清单这类层级数据：`parentId` 指向自身，删除父节点时把子节点置空；配合 `scope ... tree` 让上级看到整棵子树。

**模型**

```qiy
entity orgs @label("Organizations") @icon(TeamOutlined)
  @display("{$.name}") @tableDisplay("{$.name}") {
  field id UUID @id;
  field name Text @label("Name");
  field parentId UUID @nullable;
  field externalId Text @nullable;
}

relation orgParent orgs parentId orgs id one @onDelete(setNull);

scope warehouses orgId claim org.id tree orgs parentId;
```

**生成结果**

- Drizzle 自关联使用显式返回类型的 `references` 回调；迁移里是 `ON DELETE SET NULL`。
- 声明 `scope ... tree` 后额外生成 `/<tree 资源>/tree` 页面与列表页 "Tree view" 入口；树数据仍走普通资源接口。
- 列表/详情里 `parentId` 渲染为可选的组织下拉；循环/缺失父节点在树页面进入 orphans 警告，不会死循环。
- 子树范围下推到 `list`、`byId`、`deleteMany`、`aggregate`、`distribution`、`trend`、导出等所有读路径。

**坑**

- `setNull` 要求源字段 `@nullable`，否则报 `setNull requires a nullable source field`。
- `tree` 的资源、父字段与 `scope` 字段类型必须一致（都 UUID）；`orgs` 必须是自引用实体。
- tree scope 只放宽**读**；写入仍落在调用者自己的节点。
- 子树查询有 64 层深度上限，脏数据成环不会拖死查询。

**参考**：[application · scope](/dsl/application#scope) · [relation 与 index · 自关联](/dsl/relation-index)。

### 配方 1.4：业务编码与 UUID {#recipe-14}

**目标**：让编码类字段由服务端生成、用户不可手填；外部 ID 由系统生成 UUID。

**模型**

```qiy
entity warehouses @label("Warehouses") @icon(DatabaseOutlined) {
  field id UUID @id;
  field code Text @unique @code("WH-{YYYY}{MM}-{seq:3}");
  field orgId UUID;
}

entity inventory @label("Inventory") @icon(TableOutlined) {
  field id UUID @id;
  field productId UUID;
  field warehouseId UUID;
  field quantity Integer;
  field reserved Integer @nullable;
  field status activeState;
  field externalId UUID @nullable @generated(uuid);
}
```

**生成结果**

- `code` 在创建时由服务端按 `WH-{YYYY}{MM}-{seq:3}` 生成，表单隐藏、编辑页只读；列表/详情正常显示。
- `externalId` 由服务端生成 UUIDv4（非主键、无 relation 的 UUID 默认也会生成；显式 `@generated` 只是把意图写清楚）。
- 主键 `id` 始终由服务端生成，无需 `@generated`。

**坑**

- `@code` 用于枚举字段、主键或与 `@generated` 组合都会在生成前失败。
- 外键源字段不能是 `@code`/`@generated`（会被当成可生成引用）。
- 模板里的 `{seq}` 依赖数据库计数与并发控制；上线前用真实并发验证，不要把它当严格连续编号。
- 时区由 `QIY_CODE_TIMEZONE` 决定；跨时区业务要固定该变量。

**参考**：[自动生成值与业务编码](/dsl/generated-values)。

## 权限与多角色

### 配方 2.1：本地 + OAuth 混合登录 {#recipe-21}

**目标**：一个登录页同时支持邮箱密码和 Google/Okta 等 OAuth；首次 OAuth 登录进入开通页设置密码；已登录用户可在个人中心绑定/解绑。

**前置**：`auth` 必须在 `messages` 之前、`env` 之后；用户实体的字段名要与 auth 块一致。

**模型**

```qiy
# auth 属于配置区：写在 enum/entity 之前；它引用的 users 实体在下方声明。
auth {
  providers local, google;
  user users;
  subjectField subject;
  roleField role;
  usernameField email;
  passwordField passwordHash;
  profileField oauthProfiles;
  provider google { subjectField googleSubject; }
}

enum userRole {
  value admin label "管理员" color red icon SafetyOutlined;
  value operator label "操作员" color blue icon UserOutlined;
  value viewer label "观察员" color default icon EyeOutlined;
}

entity users @label("Users") @icon(UserOutlined) {
  field id UUID @id;
  field subject Text @unique;
  field googleSubject Text @nullable @unique;
  field email Text @unique;
  field displayName Text @nullable;
  field role userRole;
  field passwordHash Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
  field oauthProfiles Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
  field permissions Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
  field orgId UUID @nullable;
}
```

**生成结果**

- 混合模式：一个登录页同时有密码表单和 provider 按钮；生成 `auth/oidc-multi.ts`、`auth/account.ts`、`/auth/callback`、`/oauth/*`、`/auth/onboarding`、`/profile`。
- 端点：`GET /api/v1/auth/providers`、`POST /api/v1/auth/login`、`POST /api/v1/auth/exchange`、`POST /api/v1/auth/oauth/register`、`GET /api/v1/auth/identities`、`POST /api/v1/auth/bind`、`POST /api/v1/auth/unbind`。
- 浏览器不保存 client secret；OAuth 中间态在 `sessionStorage`。
- 会话令牌存 `localStorage.qiy.access_token`。

**坑**

- `user` 要写**实体名**；实体叫 `User table users` 时必须写 `user User`，但 `features apiKeys` 等仍以表名解析——最省心的做法是让实体名等于表名（如本配方 `entity users`）。
- `usernameField` 必须是必填唯一 Text；`passwordField` 必须可空 Text；`subjectField` 必须必填唯一 Text；`roleField` 必须是含 admin/operator/viewer 的枚举。
- 只用 OAuth（不含 local）时没有密码表单与个人中心密码区；`providers` 列表永远不含 `local`/`otp`。
- OAuth 首次登录必须允许开通（onboarding），否则用户没有可用的本地账号行。
- provider 的 `subjectField` 映射必须指向该实体真实存在的字段。

**参考**：[DSL auth](/dsl/auth) · [认证与权限指南](/guide/auth) · [Refine Providers · AuthProvider](/guide/refine-providers#authprovider)。

### 配方 2.2：权限值与校验 {#recipe-22}

**目标**：把权限值声明成可校验模型：角色组、OAuth claim、数据库列三种来源做并集；用 verification 表达集合关系。

**前置**：必须先有 `auth`；权限声明放在 `messages` 之后、`workflow`/`enum`/`entity` 之前。

**模型**

```qiy
permission field InventoryRead "inventory:read" @label("Read inventory");
permission field InventoryAdjust "inventory:adjust" @label("Adjust inventory");

permission group operator { InventoryRead, InventoryAdjust }
permission group viewer { InventoryRead }
permission group admin { InventoryRead, InventoryAdjust }

permission from database field users.permissions;
permission from claim google "roles";

permission verification CanAdjust {
  return self.role = "admin" || self.role = "operator";
}

permission verification CanAccessInventory {
  input { field permission Array<String>; }
  return input.permission all included in self.permissions;
}
```

**生成结果**

- `GET /api/v1/auth/permissions` → `{ permissions, groups }`；`POST /api/v1/auth/verify-permission` 按 verification 求值；`GET /api/v1/auth/me` 追加 `permissions`/`groups`。
- dataflow/action 的 `allow permission` 在生成期展开为权限值，请求期要求全部持有；拒绝 403。
- Web `auth.ts` 的 `commandPolicies` 在 identity 带 `permissions` 时按权限值判断命令可见性。
- 功能总览的"权限模型"页签展示字段/组/校验与当前用户有效权限。

**坑**

- `permission from claim` 的 provider 必须是 auth 里配置的 OAuth provider；`local`/`otp` 没有 claim。
- `from database` 的列必须是 auth 用户实体的 Text 列（JSON 数组或逗号/空格分隔）。
- 组名与权限字段名共享命名空间；环、自引用、重复值都会在生成前失败。
- verification 的 input 必须在 dataflow 的 `input` 中有同名、`@required` 的 `Text` 或枚举字段；`Array<String>` 由单个值提升为单元素数组。
- 浏览器端只能求值"没有输入"的 verification；有输入的仍以服务端为准。
- `@label("literal")` 不会自动翻译；需要多语言用 `@label(t("key"))`。

**参考**：[权限（permission）](/dsl/permissions) · [认证与权限指南](/guide/auth)。

### 配方 2.3：数据范围 scope {#recipe-23}

**目标**：把租户/组织范围绑定到某个字段，让所有读路径自动加谓词；缺 claim 时 fail-closed。

**模型**

```qiy
scope warehouses orgId claim org.id;
```

```qiy
# 组织子树：claim 节点及其所有下级
scope warehouses orgId claim org.id tree orgs parentId;
```

**生成结果**

- `list`/`byId`/`aggregate`/`distribution`/`trend`/导出/删除都带同一谓词；GraphQL 与 REST 共用。
- 缺 claim 返回 403（例如 `Missing required data scope claim`），不会退化成全量。
- tree scope 生成 `WITH RECURSIVE` 子树 CTE，层级上限 64。
- 写入时 scope 字段被强制写成 claim 值，不能通过请求体越权。

**坑**

- `scope` 与 `restrict` 叠加而不是替代；两者同时存在时都必须通过。
- tree scope 要求树实体存在、父字段存在、类型一致。
- 写下级节点不会被 tree scope 自动允许——需要在 Dataflow/服务端显式处理。
- 数据 scope 不影响 OpenAPI 文档结构，只在真实请求时生效。

**参考**：[application · scope](/dsl/application#scope)。

### 配方 2.4：行策略、字段与页面 {#recipe-24}

**目标**：在角色之外再加行级/字段级/页面级规则：角色可读但敏感字段脱敏、某些页面动作只给 admin、某字段只对 admin 渲染。

**模型**

```qiy
restrict products {
  allow roles admin, operator, viewer;
  mask sku roles viewer mode omit;
}

restrict stock_movements {
  allow roles admin, operator;
  when warehouseId claim org.id;
  mask quantity roles operator mode redact replacement "***";
}

pages inventory {
  list roles admin, operator;
  show roles admin, operator;
  create roles admin;
  edit roles admin;
  delete roles admin;
  field quantity roles admin;
}
```

**生成结果**

- 行条件编译进 SQL（`eq`/`ne`/`in`/`and`/`or`/`not`/跨字段比较），REST、GraphQL、导出、写可见性检查共用。
- `mask`：`omit` 删除响应键、`null` 返回 null、`redact` 用替换串；被 mask 的字段 REST/GraphQL 也不能写。
- `pages`：服务端 guard 返回 403 `Page access denied`，前端 access control 同步隐藏按钮/页面。
- `field <name> roles ...`：列表列、详情、表单只对指定角色渲染；服务端仍以 `mask` 为数据保护。

**坑**

- **Dataflow 不能操作带行谓词（`when`）的资源**：生成阶段报 `Restrict X: dataflow Y cannot use a restricted resource...`。把行策略放在不被命令写入的资源上，或把规则下沉到服务端领域逻辑。
- `allow roles` 不自动放行 admin；admin 不在列表里同样被拒。
- `mask` 的 `replacement` 只在 `mode redact` 下合法；同一字段只能一个 mask。
- 页面字段规则只是"不渲染"，不是安全边界；真正隐藏数据要配 `mask`。
- 有行谓词的资源不能开 Realtime（共享 channel 无法按订阅者裁剪）。

**参考**：[application · restrict](/dsl/application#restrict) · [application · pages](/dsl/application#pages) · [realtime](/dsl/realtime)。

## 业务自动化

### 配方 3.1：Dataflow + Action {#recipe-31}

**目标**：一个"盘点调整"命令：读当前库存 → 校验数量 → 写库存流水 → 更新现存量 → 发事件；列表/详情出现按钮，成功失败有提示。

**前置**：需要 `inventory`、`stock_movements` 实体（配方 1.4）、`InventoryAdjust` 权限字段（配方 2.2）与 `errors.*` 默认语言消息；`dataflow` 在所有 `entity`/`relation`/`scope`/`restrict`/`pages`/`menu`/`chart` 之后，`action` 在 `dataflow` 之后。

**模型**

```qiy
dataflow adjustStock
  @label("盘点调整")
  @confirm("应用这次盘点结果？")
  @comment("Create an adjustment movement and set the counted on-hand quantity.") {
  allow permission InventoryAdjust;
  idempotency required;
  audit "inventory.adjusted";

  input {
    field inventoryId UUID @required;
    field productId UUID @required;
    field warehouseId UUID @required;
    field countedQuantity Integer @required @comment("盘点数量");
    field reason Text @required;
  }
  context {
    item = entity inventory by id input.inventoryId @required;
  }
  step validate {
    require item.quantity >= 0 @error(t("errors.inventory.nonNegative"));
    require input.countedQuantity >= 0 @error(t("errors.inventory.countedNonNegative"));
  }
  step record {
    create movement = entity stock_movements {
      productId = input.productId;
      warehouseId = input.warehouseId;
      type = "adjust";
      quantity = input.countedQuantity;
      reference = input.reason;
    }
    update item {
      quantity = input.countedQuantity;
    }
    emit "inventory.adjusted" {
      inventoryId = item.id;
      quantity = input.countedQuantity;
      source = "manual";
    }
  }
  result { return item; }
}

action adjustStock {
  resource inventory;
  dataflow adjustStock;
  placement list, show;
  when status == "active";
}
```

**生成结果**

- `apps/server/src/dataflows/index.ts` + `POST /api/v1/commands/adjustStock`；同时生成 `runAdjustStock` GraphQL mutation。
- 事务内按步骤执行：`require` 失败 409、未找到 404、缺 scope claim 403；任何写入后失败都会回滚。
- `audit` 在同一事务写审计；`emit` 写 `dataflow_outbox`；`idempotency required` 建幂等表并接受 `Idempotency-Key`。
- 列表/详情出现"盘点调整"按钮；`when status == "active"` 只对启用记录显示；确认文案来自 `@confirm`。
- 命令表单字段来自 input；`@comment` 成为字段说明，label 可用 `qiy.actions.adjustStock.inputs.countedQuantity.label` 翻译。

**坑**

- `create`/`update` 的值只能是 `input.<field>` 或**字符串字面量**；不能引用 context 字段（如 `productId = item.productId`）。需要 context 值时把它做成 input，或在后续步骤用该 context 更新。
- `create` 必须给所有非空、非主键、非 scope 字段赋值；不能赋值时把字段改为 `@nullable` 或提供 input。
- context 必须按实体 UUID 主键 + 必填 input 加载；不支持任意查询。
- 每个 dataflow 只能一种 `allow`；action 上不要再写 roles/permission/verification。
- 不能操作带行谓词的资源（见配方 2.4）。
- `emit` payload 允许 input/context/字面量，最多 32 个字段；重复键与密码字段被拒。

**参考**：[dataflow](/dsl/dataflow) · [action](/dsl/actions) · [业务工作流指南](/guide/workflow)。

### 配方 3.2：校验、确认、幂等、审计 {#recipe-32}

**目标**：让审批类命令具备：业务前置校验、可翻译错误、幂等重试、审计留痕；并且按钮只在合法状态出现。

**前置**：`purchase_orders` 实体（配方 1.2）、`CanAdjust` verification 与 `errors.purchaseOrder.notDraft` 消息（配方 2.2 / 5.1）。

**模型**

```qiy
permission verification CanAdjust {
  return self.role = "admin" || self.role = "operator";
}

dataflow approvePurchaseOrder @label("审批采购单") @comment("Approve a draft purchase order.") {
  allow verification CanAdjust;
  input {
    field purchaseOrderId UUID @required;
  }
  context {
    order = entity purchase_orders by id input.purchaseOrderId @required;
  }
  step validate {
    require order.status == "draft" @error(t("errors.purchaseOrder.notDraft"));
  }
  step approve {
    update order { status = "approved"; }
  }
  result { return order; }
}

action approvePurchaseOrder {
  resource purchase_orders;
  dataflow approvePurchaseOrder;
  placement list, show;
  confirm "审批这张采购单？";
  when status == "draft";
}
```

**生成结果**

- 校验失败返回 409，body 带默认语言 `error` 与 `errorKey`；前端按当前语言显示 `errors.purchaseOrder.notDraft`。
- 命令按钮只在 `status == "draft"` 且 verification 通过时出现；服务端仍再次校验。
- 失败的 `require` 不写业务数据、审计或幂等回执。

**坑**

- `when` 只支持一个当前资源的 Text/enum 字段、`==`/`!=` 与字符串字面量；记录缺字段时隐藏按钮。
- `@error("literal")` 不会翻译；要翻译必须 `@error(t("key"))` 且 key 在默认语言中。
- `@confirm` 是 dataflow 默认值；action 的 `confirm` 覆盖它，且 action 的 confirm key 是 `qiy.actions.<action>.confirm`。
- 服务端不会因为按钮隐藏而放行：直接调用命令仍会校验状态与权限。

**参考**：[dataflow · 当前可执行子集](/dsl/dataflow) · [dataflow · 业务错误翻译](/dsl/dataflow) · [多语言 · 业务错误 key](/dsl/i18n#业务错误-key)。

### 配方 3.3：手动业务页 {#recipe-33}

**目标**：有一个复杂页面（复核、看板、可视化编辑器）无法用 CRUD 表达时，让 Action 跳转到手写路由，由开发者维护页面内容。

**模型**

```qiy
action reviewInventory {
  resource inventory;
  navigate "/inventory/:id/review";
  placement show;
  label "库存复核";
  page manual @comment("实现库存复核页");
}
```

**生成结果**

- 详情页出现"库存复核"链接，跳到 `/inventory/<id>/review`。
- 生成 `apps/web/app/extensions/inventory-review.tsx` 之类的占位页（带 `@comment` 说明），由开发者实现。
- `apps/web/app/extensions/` 是**未托管**目录，`--sync` 不覆盖；路由已注册。

**坑**

- `navigate` 路径必须是安全绝对路由且包含 `:id`；否则生成失败。
- `page manual @comment(...)` 只对 navigate action 合法；dataflow action 写了会报错。
- navigate action 的 `label` 必填；`allow permission`/`allow verification` 只影响按钮可见性，服务端页面本身要自己做权限检查。
- 占位页只是脚手架，不要在生产里保留空实现。

**参考**：[action](/dsl/actions) · [模块化模型](/guide/modules)。

### 配方 3.4：内置订单工作流 {#recipe-34}

**目标**：不写 dataflow，直接获得订单提交/审批/出库/取消 + 库存预占的事务链路。

**模型**

```qiy
database postgresql {}

workflow orderInventory;

enum orderStatus {
  value draft;
  value submitted;
  value approved;
  value shipped;
  value cancelled;
}

entity Product table products @label("Products") {
  field id UUID @id;
  field name Text @label("Name");
}

entity orders @label("Orders") {
  field id UUID @id;
  field status orderStatus;
  field approvedBy UUID @nullable;
}

entity orderItems table order_items @label("Order items") {
  field id UUID @id;
  field orderId UUID;
  field productId UUID;
  field quantity Integer;
}

entity inventoryItems table inventory_items @label("Inventory items") {
  field id UUID @id;
  field productId UUID;
  field quantity Integer;
  field reservedQuantity Integer;
}

relation orderLine orderItems orderId orders id one @onDelete(cascade);
relation orderLineProduct orderItems productId Product id one @onDelete(restrict);
relation stockProduct inventoryItems productId Product id one @onDelete(restrict);
```

**生成结果**

- 订单详情的额外动作按钮（submit/approve/ship/cancel）、库存预占与回滚事务。
- 生成 `orderIdempotency`、`orderReservations`、订单工作的服务端路由/测试。
- 契约是固定的：实体名正好 `orders`、`orderItems`、`inventoryItems`；`orders` 需要 `status`（含五个状态值）与可空 `approvedBy`；`orderItems` 需要 `orderId`/`productId`/`quantity`；`inventoryItems` 需要 `productId`/`quantity`/`reservedQuantity`。

**坑**

- 实体名、字段名或类型不匹配时生成失败，错误会指出缺哪个字段/值。
- 必须是 PostgreSQL；SQLite/MySQL 直接报错。
- `orders`/`orderItems`/`inventoryItems` 不能同时声明行谓词（生成期拒绝）。
- 工作流与自定义 dataflow 是两套机制；不要用同名 action 重复实现。
- 升级前阅读 [workflow 指南](/guide/workflow) 与对应测试。

**参考**：[application · workflow](/dsl/application#workflow) · [业务工作流指南](/guide/workflow)。

## 概览与图表

### 配方 4.1：多视图图表 + 面板 {#recipe-41}

**目标**：一个仓储概览页：KPI 卡、状态分布（饼图/柱状图切换）、30 天流水、库存预览；响应式栅格，多 panel 切换。

**前置**：`inventory`、`stock_movements`、`purchase_orders` 实体（配方 1.2/1.4）；`chart`/`chart panels` 在 `menu` 之后、`dataflow` 之前，可与 `dashboard` 交错。

**模型**

```qiy
chart const InventoryTotal {
  icon = "TableOutlined";
  title = "库存记录数";
  data = count inventory;
}

chart pie InventoryByStatus {
  icon = "DatabaseOutlined";
  title = "库存状态分布";
  data = count inventory group by status;
  labels = status;
}

chart bar InventoryByStatus {
  icon = "DatabaseOutlined";
  title = "库存状态分布";
  data = count inventory group by status;
  labels {
    active "在用";
    inactive "停用";
  }
}

chart line MovementTrend {
  icon = "DashboardOutlined";
  title = "库存流水趋势";
  data = trend stock_movements.occurredAt days 30;
}

chart table InventoryTable {
  title = "库存预览";
  data = list inventory columns productId, quantity, reserved;
}

chart const PurchaseTotal {
  title = "采购金额";
  data = sum purchase_orders.total;
}

chart panels MainPanel {
  title = "仓储概览";
  grid 24 20;
  InventoryTotal {
    larger 0 0 6 2;
    medium 0 0 12 2;
    small 0 0 24 2;
  }
  InventoryByStatus {
    larger 6 0 12 3;
    medium 12 0 12 3;
    small 0 2 24 3;
  }
  PurchaseTotal {
    larger 18 0 6 2;
    medium 0 3 12 2;
    small 0 5 24 2;
  }
  MovementTrend {
    larger 0 3 12 4;
    medium 12 3 12 4;
    small 0 7 24 4;
  }
  InventoryTable {
    larger 12 3 12 4;
    medium 0 7 24 4;
    small 0 11 24 4;
  }
}
```

**生成结果**

- `apps/web/app/charts.ts` 元数据 + `components/charts.tsx` 渲染；概览页用 `ChartDashboard`。
- `InventoryByStatus` 是一张卡片、两个视图（pie/bar），卡片右上角出现视图下拉。
- 面板用 CSS Grid；`larger/medium/small` 随视口 1200/768 断点切换；卡片按 `x/y/w/h` 跨格。
- 每个视图独立 loading/error；分布/趋势/表格有各自空状态；表格只显示前 5 行并链接到资源列表。
- 多 panel 时页面右上角出现面板下拉，选择存 `qiy.charts.panel`。

**坑**

- `chart` 的 `icon` 不会自动加入 `app/icons.tsx`；只有模型其它位置用过的图标才会渲染，否则卡片没有图标（示例用默认图标规避）。
- `pie`/`bar` 必须 `count ... group by <枚举字段>`；不支持"按枚举求和"。
- 同名同 kind 重复声明会报错；多视图必须用不同 kind。
- `x + w <= cols`、`y + h <= rows`；不检测重叠，重叠会叠在一起。
- 没有 panel 时所有 chart 用 `xs=24 / lg=12` 平铺，不走坐标。
- 有 chart 时旧 `dashboard { metric ... }` 不再渲染。

**参考**：[chart（多视图图表）](/dsl/charts) · [菜单与 Dashboard](/guide/menu-dashboard#概览页选择chart-优先)。

### 配方 4.2：KPI、聚合与表格预览 {#recipe-42}

**目标**：只有数字和表格、不需要分布图时，用最小的 chart 组合做经营看板（基于配方 1.2 的 `purchase_orders`）。

**模型**

```qiy
chart const PurchaseCount {
  title = "采购单数";
  data = count purchase_orders;
}
chart const PurchaseAmount {
  title = "采购金额";
  data = sum purchase_orders.total;
}
chart const PurchaseAvgAmount {
  title = "平均采购金额";
  data = avg purchase_orders.total;
}
chart table RecentPurchases {
  title = "最近采购单";
  data = list purchase_orders columns number, status, total, orderedAt;
}
```

**生成结果**

- 三个统计卡：`count` 走列表 `total`，`sum`/`avg` 走 `/aggregate`；`Money`/`Decimal` 固定两位小数并带 `操作 · 字段` 后缀。
- 表格视图：只读、无分页、最多 5 行；关联字段按目标显示文本渲染，日期按当前语言格式化。
- 没有 `chart panels` 时按 `Row/Col` 两列平铺。

**坑**

- 聚合字段必须是 `Integer`/`Decimal`/`Money`，否则生成前报错。
- `sum ... group by` 不支持；需要"按枚举求和"请用 table 视图或手写页面。
- 表格列不能是 `Vector`；列名必须是字段名。
- 表格显示的是第一页前 5 行，不是"最新 5 行"；要排序请在服务端/扩展页实现。
- `table` 视图的 `title` 不显示，只有卡片头标题可见。

**参考**：[chart · data 数据迷你语言](/dsl/charts#data-数据迷你语言) · [chart · 生成结果](/dsl/charts#生成结果)。

## 多语言与主题

### 配方 5.1：完整词典 {#recipe-51}

**目标**：给资源、字段、枚举、菜单、图表、命令、错误和 chrome 按键补中英文；不写代码。

**前置**：`messages` 在 `auth`/`env` 之后、`permission`/`enum` 之前；`default` 指向存在的块。

**模型**

```qiy
messages {
  default "zh-CN";
  locale "zh-CN" {
    "qiy.resources.products.label" "产品";
    "qiy.resources.products.singular" "产品";
    "qiy.resources.products.plural" "产品";
    "qiy.resources.products.fields.sku.label" "SKU";
    "qiy.resources.products.fields.name.label" "名称";
    "qiy.enums.userRole.label" "用户角色";
    "qiy.enums.userRole.values.admin" "管理员";
    "qiy.menu.masterData.label" "主数据";
    "qiy.charts.InventoryByStatus.label" "库存状态分布";
    "qiy.charts.InventoryByStatus.views.pie.label" "按状态（饼图）";
    "qiy.charts.InventoryByStatus.views.bar.label" "按状态（柱状图）";
    "qiy.charts.InventoryByStatus.labels.active" "在用";
    "qiy.actions.adjustStock.label" "盘点调整";
    "qiy.actions.adjustStock.confirm" "应用这次盘点结果？";
    "qiy.actions.adjustStock.inputs.countedQuantity.label" "盘点数量";
    "errors.inventory.nonNegative" "现存量不能为负";
    "qiy.noData" "暂无数据";
    "qiy.overview" "概览";
  }
  locale "en-US" {
    "qiy.resources.products.label" "Products";
    "qiy.resources.products.singular" "Product";
    "qiy.resources.products.plural" "Products";
    "qiy.resources.products.fields.sku.label" "SKU";
    "qiy.resources.products.fields.name.label" "Name";
    "qiy.enums.userRole.label" "User role";
    "qiy.enums.userRole.values.admin" "Administrator";
    "qiy.menu.masterData.label" "Master data";
    "qiy.charts.InventoryByStatus.label" "Inventory by status";
    "qiy.charts.InventoryByStatus.views.pie.label" "By status (pie)";
    "qiy.charts.InventoryByStatus.views.bar.label" "By status (bar)";
    "qiy.charts.InventoryByStatus.labels.active" "In use";
    "qiy.actions.adjustStock.label" "Adjust stock";
    "qiy.actions.adjustStock.confirm" "Apply this count?";
    "errors.inventory.nonNegative" "On-hand quantity cannot be negative";
    "qiy.noData" "No data";
    "qiy.overview" "Overview";
  }
}
```

**生成结果**

- `apps/web/app/messages.ts`（项目词典）+ `app/i18n.ts`（内置 chrome + 回退链）。
- Header 语言下拉包含 `zh-CN`、`en-US` 与模型声明的其它语言；选择存 `qiy.locale`。
- 资源/字段/枚举/菜单/图表/命令的 label 按 key 解析；缺失回退 DSL 原文。
- `t("...")` 引用的 key 必须存在于默认语言，否则生成失败。

**坑**

- 资源 key 用**表名**；`entity Product table products` 写 `qiy.resources.products.*`。
- 菜单项优先读 `.plural`；只翻译 `.label` 会出现菜单不翻译。建议同时写 `.label`/`.singular`/`.plural`。
- 第三种语言只会得到英文 chrome（内置词典只有中英）；要完全本地化需补齐 `qiy.*` 键。
- 语言标签必须是规范 BCP 47；`zh-CN` 可以，`zh-cn`/`fr_fr` 不行。
- `qiy.requiredWithLabel` 用 AntD 的 `${label}`，不是 <code v-pre>{{label}}</code>。

**参考**：[多语言（messages / i18n）](/dsl/i18n) · [DSL 总览 · 消息与模型描述](/dsl/overview#消息与模型描述)。

### 配方 5.2：主题与色彩模式 {#recipe-52}

**目标**：把后台换成紫色品牌、只保留蓝/紫两套主题、默认跟随系统、允许用户切换。

**模型**

```qiy
ui {
  library antd;
  theme purple;
  themes purple, blue;
  colorMode system;
  allowThemeSwitch true;
  allowColorModeSwitch true;
}
```

**生成结果**

- `apps/web/app/ui/theme-config.ts` 写入配置；`ui/index.tsx` 提供 `QiyUiProvider` 与 Header 控件。
- 主题切换只改 `colorPrimary`；色彩模式切换 AntD `darkAlgorithm`/`defaultAlgorithm`，并写 `<html data-theme data-color-mode>`。
- 选择持久化：`qiy.ui.theme`、`qiy.ui.color-mode`；侧边栏折叠存 `qiy.ui.sider-collapsed`。

**坑**

- 主题 key 只有 blue/purple/green/orange/red；`theme` 必须在 `themes` 里。
- `themes` 只有一个时主题下拉不显示（即使 `allowThemeSwitch true`）。
- 用户已访问过时，存储里的旧选择优先于新默认值；改默认后需清理 storage 或换 key。
- 暗色下图表调色板/折线颜色是硬编码浅色，不会跟随主题。
- `app/ui/*` 与 `styles.css` 是托管文件，`--sync` 会覆盖；品牌定制放到宿主/扩展层。

**参考**：[UI 与主题](/guide/ui-theming) · [application · ui](/dsl/application#ui)。

## 系统管理

### 配方 6.1：功能总览、API 文档、访问密钥 {#recipe-61}

**目标**：给交付/运维/CI 提供只读的模型总览、可搜索的 OpenAPI 浏览器，以及个人 API Key。

**前置**：`features` 在 `api` 之后；`apiKeys` 需要 `auth`；页面入口对任意已登录用户可见，内容按权限过滤。

**模型**

```qiy
application supply-chain {
  database sqlite {}
  api { client rest; }

  features {
    overview true;   # 功能总览（默认 true）
    apiDocs true;    # /system/api-docs + OpenAPI
    apiKeys true;    # /system/api-keys + qiy_api_keys + X-API-Key
  }

  auth {
    providers local, google;
    user users;
    subjectField subject;
    roleField role;
    usernameField email;
    passwordField passwordHash;
    profileField oauthProfiles;
  }

  menu {
    group system @label("系统管理") @icon(SafetyOutlined) {
      resource users;
      resource orgs;
    }
  }
}
```

**生成结果**

- 三个页面：`/system/overview`（实体 Mermaid + Dataflow + 权限模型）、`/system/api-docs`（OpenAPI 3.1 浏览器 + curl 示例）、`/system/api-keys`（创建/撤销/一次性密钥/权限标签）。
- 菜单链接追加到 `system` 分组；分组不存在时自动创建。
- `GET /api/v1/openapi.json`（受保护）、`GET /api/v1/docs/model`；API Key 表与 Bearer/`X-API-Key` 认证。
- 功能总览页要求 `overview` 且至少一个 `apiDocs`/`apiKeys` 打开。

> 片段省略了 `users`/`orgs` 实体本身（见配方 2.1 与 1.3）；实际模型里 `auth` 在 `enum`/`entity` 之前，`menu` 在实体之后。`apiKeys` 依赖 `auth` 解析出的用户表。

**坑**

- `apiKeys true` 没有 `auth` 会解析失败。
- 三个页面不按角色隐藏入口；内容按当前身份过滤。不要把"入口可见"误当"数据可见"。
- 带 `allow verification` 的命令在 OpenAPI 里只对 admin 展示（无法在文档阶段求值）。
- 每个用户最多 10 个有效 key；完整密钥只显示一次。
- 改 `features` 后要重新生成；数据库迁移要包含 `qiy_api_keys`。

**参考**：[features](/dsl/features) · [API 文档与访问密钥](/guide/api-docs-and-keys)。

## 集成与部署

### 配方 7.1：集成现有 API 与 Bun 项目 {#recipe-71}

**目标**：不重建后端，只把 Qiy 后台挂到已有 API/身份系统上。

**模型**

```qiy
qiy v0;

application ops-console {
  database postgresql {}

  mode integration;

  integration {
    apiBase "/api/v2";
    auth bearer;
    pagination page;
    response {
      data "items";
      total "meta.count";
      error "message";
    };
    tenant {
      header "X-Tenant-Id";
      identity "tenantId";
    };
  }

  workspace {
    name ops-admin;
    aliases { web host-admin; }
    packages { web "@example/host-admin"; }
  }

  entity products {
    field id UUID @id;
    field title Text;
  }
}
```

> 集成模式的实体只用来描述宿主 API 的资源与字段；不会生成 server、Drizzle schema 或迁移。块形式的 `integration` 设置在 `}` 后仍需 `;`（`response { ... };`、`tenant { ... };`）。

**生成结果**

- `qiy init -f model.qiy` 把管理端挂到现有 Bun workspace，生成 host adapter 骨架、Web 包与部署示例，不生成第二套服务端。
- `mode integration` 拒绝 dataflow/realtime/permissions/scope/restrict 等生成式服务端能力（避免与宿主 API 冲突）。
- workspace alias/包名按声明生效。

**坑**

- 集成模式不是"改个 URL"：宿主 response envelope、分页、错误结构、认证 transport 都要在 adapter 里实现并测试。
- `integration apiBase` 必须是绝对 http(s) URL 或以 `/` 开头。
- `tenant` 只负责把身份键作为请求头转发，不实现租户隔离。
- 宿主已有 `apps/web` 别名冲突时按 [workspace 集成](/guide/existing-bun-project) 处理。

**参考**：[集成现有 Bun 项目](/guide/existing-bun-project) · [application · integration](/dsl/application)。

### 配方 7.2：存储、环境变量与部署 {#recipe-72}

**目标**：把文件上传切到 S3、用环境变量管理密钥，并按目标平台部署。

**前置**：`storage` 在配置区（`realtime` 之后、`auth` 之前），`env` 在 `auth` 之后、`messages` 之前；下面是片段，需放进 `application {}`。

**模型**

```qiy
storage { provider s3; }

env {
  variable DATABASE_URL {
    development "file:./dev.db";
    production required;
    example "postgresql://user:pass@localhost:5432/app";
  }
  variable PAYMENT_API_TOKEN {
    secret;
    development generate;
    production required;
    example required;
  }
}
```

**生成结果**

- S3 存储适配器与上传/下载路由；`File`/`Files` 字段按 provider 存取。
- server/web 各自的 `.env.development`、`.env.production`、`.env.example`；secret 不写入模型。
- `deploy/` 下的 Docker、Nginx、Kubernetes 与平台示例。

**坑**

- `secret` 变量不能有字面值；`VITE_` 变量会进浏览器 bundle，不能标 secret。
- 环境文件位于 admin 自己的包内；`qiy init` 不会覆盖宿主根 `.env`。
- 部署示例是起点，不是生产验收；迁移、备份、健康检查、回滚要按实际平台补齐。
- 切 S3 后本地开发也要配置 bucket/endpoint，否则上传 500。

**参考**：[文件存储](/guide/storage) · [application · env](/dsl/application#env) · [部署](/guide/deployment)。

## 组合顺序速查

解析器按固定顺序读取 `application {}` 的块；顺序错会报 `Expected ... near token`：

```text
database
mode
integration
workspace
ui
api
features
realtime
elysia
storage
auth
env
messages
permission
workflow
enum
entity
relation
scope
restrict
pages
menu
dashboard / chart（可交错，多个）
dataflow
action
```

实践建议：

1. 先 `database` + `enum` + `entity` + `relation`，跑通 CRUD。
2. 再加 `messages`（它必须靠前，但内容可以后补）。
3. 加 `scope`/`restrict`/`pages`，确认列表/详情符合预期。
4. 加 `menu` → `chart` → `dashboard`，调整概览页。
5. 最后加 `dataflow` + `action`，因为命令最依赖前面的实体/权限声明。
6. `features`/`ui`/`auth` 属于配置区，改动后重新生成并跑迁移。

## 生成前检查清单

- [ ] 每个 `entity` 有 UUID `id` 主键；路由表名小写 URL 安全。
- [ ] 每个真实外键都有 `relation`，且两端都是 UUID、目标字段 `@id`/`@unique`。
- [ ] `messages` 引用的 `t("key")` 都在默认语言里。
- [ ] `restrict` 行谓词没有和 dataflow/realtime 冲突。
- [ ] `scope` 字段类型与 claim/tree 实体一致。
- [ ] `pages` 动作只声明需要限制的，未声明动作不受页面规则限制。
- [ ] `menu` 的资源名是表名，且没有重复。
- [ ] `chart` 的 kind 与 data 匹配、`labels` 字段是枚举、panel 坐标不越界。
- [ ] `features.apiKeys` 有 `auth`。
- [ ] `ui.theme` 在 `ui.themes` 中。
- [ ] 重新生成后跑 `bun test`、`bun run typecheck`、迁移与一次真实登录。

## 相关

- 语法参考：[DSL 总览](/dsl/overview)、[application](/dsl/application)、[entity 与 field](/dsl/entity)、[relation 与 index](/dsl/relation-index)、[enum / menu / dashboard](/dsl/enum-menu-dashboard)、[chart](/dsl/charts)、[i18n](/dsl/i18n)、[permission](/dsl/permissions)、[dataflow](/dsl/dataflow)、[action](/dsl/actions)、[realtime](/dsl/realtime)、[storage](/dsl/storage)、[features](/dsl/features)。
- 指南：[数据建模](/guide/data-modeling)、[认证与权限](/guide/auth)、[业务工作流](/guide/workflow)、[菜单与 Dashboard](/guide/menu-dashboard)、[UI 与主题](/guide/ui-theming)、[Refine Providers](/guide/refine-providers)、[API 文档与访问密钥](/guide/api-docs-and-keys)、[文件存储](/guide/storage)、[部署](/guide/deployment)、[集成现有 Bun 项目](/guide/existing-bun-project)。
- 完整示例：[`examples/self`](https://github.com/AI-NoDev/qiy/blob/main/examples/self/app.qiy)（供应链 + ERP + WMS，含全部配方）。
