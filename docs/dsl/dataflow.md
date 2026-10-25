# dataflow（事务型业务命令）

`dataflow` 把一个业务操作（审批、收货、发货、撤销……）声明成**封闭、可静态检查、单事务**的服务端命令：先按主键加载上下文，再按步骤做条件校验与写入，最后返回一条记录。它替代「前端串联多次 CRUD」，但**不是**通用脚本语言：语句集固定、条件表达式受限、副作用受控。

一个 `dataflow` 生成：

- REST 端点 `POST /api/v1/commands/<name>`（批量时再加 `/batch`）；
- GraphQL `run<Name>` mutation（批量再加 `run<Name>Batch`）；
- OpenAPI 操作（`tags: ["Dataflow"]`）与受保护文档条目；
- （由 `action` 声明时）Refine 列表/详情按钮、确认表单、幂等键传递；
- 生成包内的 Bun 测试（含幂等回放、回滚、权限拒绝）。

与 `workflow` 的区别：`workflow orderInventory;` 是历史 ERP 压力测试切片（固定实体、固定四个动作，见 [业务工作流](/guide/workflow)），`dataflow` 才是通用命令 DSL。

## 语法总览

```qiy [app.qiy]
dataflow revokeConnector @label("撤销连接器") @confirm("确认撤销？") @comment("撤销一个活跃连接器") {
  allow roles admin, operator;          // 或 allow permission / allow verification
  idempotency required;                 // 可选
  audit "connector.revoked";            // 可选

  input {
    field connectorId UUID @required;
    field reason Text @required @comment("操作原因");
  }

  context {
    connector = entity connectors by id input.connectorId @required;
  }

  step validate @order(10) @comment("检查状态") {
    require connector.status != "revoked" @error("errors.connector.alreadyRevoked");
  }

  step revoke @order(20) {
    update connector { status = "revoked"; }
    emit "connector.revoked" { connectorId = connector.id; reason = input.reason; }
  }

  result { return connector; }
}
```

```text
dataflow <Name> ( "@label" "(" doc ")" | "@confirm" "(" doc ")" | "@comment" "(" doc ")" )* {
  ( "allow" ( "roles" role ("," role)* | "permission" ref ("," ref)* | "verification" Name ) ";"
  | "idempotency" "required" ";"
  | "audit" <string> ";"
  | "input" "{" ( "field" <name> <type> ( "@required" | "@comment" "(" doc ")" )* ";" )* "}"
  | "context" "{" ( <binding> "=" "entity" <Entity> "by" <pk> "input." <field> ( "@required" | "@comment" "(" doc ")" )* ";" )* "}"
  | "step" <Name> ( "@order" "(" <int> ")" | "@comment" "(" doc ")" )* "{" <statement>* "}"
  | "result" "{" "return" <binding> ";" "}"
  )+
}
```

`input`、`context`、`result` 三个块**必须存在**（可以为空块 `{}`，`result` 必须返回一个已声明绑定），且至少一个 `step`。序列化顺序固定：注解 → `allow` → `idempotency` → `audit` → `input` → `context` → `step...` → `result`。

## 流程注解

| 注解 | 作用 | 缺省 |
| --- | --- | --- |
| `@label("...")` / `@label(t("key"))` | 命令显示名；绑定它的 `action` 未声明 `label` 时继承 | 无（`action` 必须有 label，或从 flow 继承） |
| `@confirm("...")` / `@confirm(t("key"))` | 默认确认文案；`action` 可省略或覆盖 | 无（不弹确认框） |
| `@comment("...")` / `@comment(t("key"))` | 进入 JSDoc、OpenAPI `description`、GraphQL mutation 描述 | 无 |

- `t("key")` 的 key 必须存在于 `messages.default` 语言，否则生成前报 `Missing default locale message for ...`；默认语言文案写入 IR，同时保留 `labelKey`/`confirmKey` 供前端按当前语言翻译。
- 三个注解各最多一次，重复报 `duplicate @label annotation` 等；未知注解报 `unsupported annotation`。

## 授权：`allow`

```qiy
allow roles admin, operator;                 // 仅 admin/operator
allow permission InventoryReceivePermission;  // 需持有展开后的全部权限值
allow verification CanShipOrders;             // 用 flow input 求值校验式
```

| 形式 | 允许值 | 运行期行为 | 生成期校验 |
| --- | --- | --- | --- |
| `roles` | `admin`、`operator`（**不接受** `viewer`） | 未认证 401；不在白名单 403 `Command execution is restricted` | 空列表、重复、未知角色、重复 `allow` 都报错 |
| `permission` | 权限字段名或权限组名，逗号分隔 | 展开为权限值；缺任一 → 403 `errorKey: "command.forbidden"` + `missing` | 必须有 `permission` 声明；未知引用报错 |
| `verification` | 校验块名 | 用 flow 输入求值；不满足 → 403 `errorKey: "command.forbidden"` | 校验块存在；每个 input 必须在 flow `input` 中有同名 `@required` 的 `Text` 或 enum 字段 |

- 每个 dataflow 只允许**一种** `allow`（重复声明报 `duplicate allow declaration`）；未声明时默认 `admin, operator`。
- **admin 不绕过**显式白名单；`allow permission` / `allow verification` 的成功与否只看权限集合，不看角色。
- 检查发生在幂等回执查询与事务**之前**：拒绝不写业务数据、审计、回执。
- 完整权限语义见 [权限（permission）](/dsl/permissions#命令策略allow)。

## 幂等：`idempotency required`

```qiy
idempotency required;
```

- 请求必须带 `Idempotency-Key` 头：**1–128 个可打印 ASCII**（`\x21-\x7E`），缺失或非法 → 400 `A valid Idempotency-Key header is required`。
- 回执按 `(actorId, flow, sha256(key))` 唯一；请求内容哈希不同 → 409 `Idempotency key was already used with a different request`；相同 → 直接回放首次响应（不重复写业务、审计、事件）。
- 回执表 `dataflow_idempotency`（业务表 + `requestKeyHash` + `requestHash` + `response` JSON 文本）；自动迁移生成该表，但**不会自动清理**历史回执。
- 批量命令用 `<flow>:batch` 作为独立 flow 名，只写一条回执。
- 生成 `action` 会自动传递幂等键：失败后相同输入重试保留键，输入变化或成功后换新键。
- 只有 `required` 一种模式（不支持 `optional`）。

## 审计：`audit "<action>"`

```qiy
audit "connector.revoked";
```

- 动作名非空字符串（不做 i18n 翻译）。
- 在**同一事务**写入 `audit_events`：`actorId`（principal id，可空）、`action`、`resource`（result 绑定记录的实体表名）、`resourceId`（该记录主键）、`metadata`（`{ "flow": "<name>" }`）。
- 审计写入失败 → 整个命令回滚（不留业务数据、事件或回执）。

## `input`：请求契约

| 项目 | 规则 |
| --- | --- |
| 类型 | `UUID`、`Text`、`Integer`、`Decimal`、`Boolean`，或模型中已声明的 enum 名 |
| `@required` | 声明必填；缺省为可选。context 主键来源、`require`/`update`/`create`/`emit`/`call` 引用到的 input 必须 `@required` |
| `@comment(...)` | 进入 TypeBox/OpenAPI 描述与 Refine 表单字段名（支持 `t("key")`） |
| 默认值 | 无默认值语法；可选字段缺省时为 `undefined` |
| 请求边界 | 只接受声明的字段（`additionalProperties: false`）；`Integer` 范围 −2147483648…2147483647；类型不合法 → 422 |

```qiy
input {
  field decision reviewState @required;   // enum 输入：必须是同一个 enum
  field quantity Integer @required;
  field note Text;
}
```

## `context`：事务内加载

```qiy
context {
  order = entity sales_orders by id input.orderId @required;
  item  = entity sales_order_lines by id input.lineId @required;
}
```

| 项目 | 规则 |
| --- | --- |
| 加载方式 | **只能**按实体主键、从 `input.<field>` 读取（`by <pk> input.<field>`）；不支持任意 where |
| `@required` | 必须声明（`context bindings must declare @required until optional-flow semantics are implemented`；未来若实现可选加载会放宽） |
| 输入约束 | 对应 input 必须 `@required`，且是 UUID（主键类型） |
| 缺失记录 | 404 `{ error: "Not found", resource: "<table>" }` |
| 名称 | 不能叫 `input`（保留名）；不能与 `create` 绑定重名 |
| 行锁 | PostgreSQL/MySQL 用 `SELECT … FOR UPDATE` 锁行；SQLite 在单事务内同步执行 |

## `step`：有序步骤

- 每个 step 有一个名字与一个**唯一正整数** `@order`；省略时按声明顺序取 1、2、3…。
- 生成器按 `order` 排序执行；重复/非正/非整数报 `step order must be a unique positive integer`。
- `@comment(...)` 进入 JSDoc（空 step 也保留说明）。
- step 里的语句**顺序敏感**：`require` 看到的是此前 `update`/`create`/`delete` 之后的状态。

## 语句集

### `require`：业务断言

```qiy
require connector.status != "revoked" @error("errors.connector.alreadyRevoked");
require input.quantity >= 100 @error(t("inventory.quantityTooLow"));
require item.quantity >= 0 @error("inventory.corruptStock");
```

| 左值类型 | 允许运算符 | 右值 |
| --- | --- | --- |
| `Text` / enum | `==`、`!=` | 字符串字面量（enum 必须是已声明值） |
| `Integer`（非 nullable） | `==`、`!=`、`>`、`>=`、`<`、`<=` | 有符号 32 位整数字面量（可为负） |
| 其它（Decimal/Money/Date/Time/DateTime/Boolean/UUID/Vector） | **不支持** | — |

- 左值只能是 `input.<field>`（该 input 必须 `@required`）或已加载且未被删除的 context 字段。
- `@error(...)` 必填（字面量或 `t("key")`）；失败 → **409**，body 含默认语言 `error` 与稳定 `errorKey`。
- 字段间比较、算术、函数调用、Boolean/Decimal 条件都**不支持**。

### `update`：更新已加载记录

```qiy
update connector { status = "revoked"; revokedReason = input.reason; }
```

| 值来源 | 允许的目标字段类型 |
| --- | --- |
| 字面量（`"text"` / enum 名） | `Text`、enum |
| `input.<field>` | 与 input 类型一致的 `Text`、`Integer`、`UUID`，或同一个已声明 enum |

- 必须至少写一个字段；同一字段不能写两次（`duplicate update field`）。
- 禁止：主键（`cannot update primary key`）、`scope` 字段（`cannot update scope field`）、本地认证的 `passwordField`（`cannot update password field`）、已删除的 context（`cannot update deleted context`）。
- 写入后同一 step/后续 step 的 `require` 看到新值；写入后断言失败会回滚。

### `create`：新建记录

```qiy
create review = entity reviews {
  userId = input.userId;
  note = input.note;
  status = "pending";
}
```

| 项目 | 规则 |
| --- | --- |
| 绑定名 | 进入 context 命名空间，后续可 `require`/`update`/`delete`/`result` 引用；不能与已有 binding 或 `input` 重名 |
| 主键 | 自动生成（UUID）；**禁止**显式赋值（`create primary key ... is generated automatically`） |
| scope 字段 | 由已认证 principal 的 claim 推导，禁止通过输入覆盖 |
| 必填列 | 所有非空、非主键、非 scope 字段**必须**赋值；nullable 可省略。漏写报 `create requires value for <entity>.<field>` |
| 值来源 | 字面量仅 `Text`/enum；`input.<field>` 支持 `UUID`/`Text`/`Integer`/`Decimal` 与同名 enum |
| 密码字段 | 禁止写本地认证的 `passwordField` |

### `delete`：物理删除

```qiy
delete review;
```

- 只能删除已加载或刚创建的绑定；数据库外键策略决定级联/拒绝。
- 删除后不能再 `require`/`update`/`delete` 该绑定（`cannot use deleted context` / `context ... is already deleted`），但**允许**在 `result` 里返回删除前的快照。
- 删除与其它语句同事务：后续失败会回滚。

### `emit`：事务性事件

```qiy
emit "order.approved";
emit "order.approved" {
  orderId = order.id;
  requestedBy = input.reason;
  source = "dashboard";
  priority = 2;
};
```

| 项目 | 规则 |
| --- | --- |
| 事件名 | 非空固定字符串（不支持变量/拼接） |
| payload | 最多 **32** 个字段、键唯一 |
| 字段来源 | `@required` input、当前未删除 context 的字段、字符串/安全整数常量 |
| 禁止 | 本地认证密码字段；已删除/未知 context；未知 input/字段 |
| 落库 | 当前事务写入 `dataflow_outbox`（事件名、actor、payload JSON 文本、创建时间） |
| 实时联动 | 声明了 `realtime` 时**同时**写 `qiy_realtime_outbox`，channel 为 `qiy:event:<event>`，与业务写入同生共死 |

- `emit` 只持久化事件，**不**直接投递 broker；worker/消费者幂等/死信要另行实现。
- 启用幂等的同键成功回放**不会**重复写事件。

### `call`：受控同步本地校验

```qiy
call reviewPolicy {
  reviewId = review.id;
  status = review.status;
  reason = input.reason;
  source = "qiy-dashboard";
  priority = 1;
}
```

| 项目 | 规则 |
| --- | --- |
| 适配器名 | 标识符；同一 flow 可多次调用不同 adapter |
| payload | 最多 32 个字段、键唯一；来源与 `emit` 相同（必填 input / 未删除 context / 字符串或安全整数常量） |
| 禁止 | 密码字段；已删除 context；未知字段 |
| 生成契约 | `apps/server/src/dataflows/calls.ts` 类型契约 |
| 实现入口 | `apps/server/src/extensions/dataflow-calls.ts`（不受 `--sync` 管理） |
| 默认实现 | **fail-closed**：必须返回 `{ ok: true }` 或 `{ ok: false, error, errorKey? }` |
| 失败效果 | `{ ok: false }` → 409（带 `error`/`errorKey`）；抛错 → 事务回滚；调用后的任何失败也回滚此前写入 |
| 同步要求 | handler **不能返回 Promise**（三种数据库共享同一事务语义）；适合纯计算/进程内策略，**不适合** HTTP、支付、消息等不可逆副作用 |

## `result`：返回值

```qiy
result { return connector; }
result { return review; }   // 也可以是 create 绑定的记录
```

- 必须 `return` 一个已声明的 context 绑定（含 `create` 绑定），否则报 `result must return a declared context binding`。
- REST 成功响应体就是该记录的 JSON（200）；GraphQL 返回对应实体类型。
- 被删除的记录也可以返回（返回删除前快照）。

## 事务、原子性与失败映射

| 数据库 | 事务与锁 |
| --- | --- |
| SQLite | `db.transaction(...)` 同步执行；业务失败抛错回滚；单进程定位 |
| PostgreSQL | `db.transaction(...)`；context 用 `SELECT … FOR UPDATE` 锁行，后续校验在锁内执行 |
| MySQL | 同上，连接与事务由生成仓储管理 |

一个命令内**所有**效果同成同败：业务写入、审计、`emit` outbox、`call` 拒绝、幂等回执。幂等回执在事务内最后写入；该插入失败也会回滚业务数据（可安全重试）。

| HTTP | 场景 | body 关键字段 |
| --- | --- | --- |
| 200 | 成功 / 幂等回放 | 结果记录 |
| 400 | 缺/非法 `Idempotency-Key`；请求体形状错误 | `error` |
| 401 | 未认证 | `error: "Authentication required"` |
| 403 | 角色/权限/校验式拒绝；缺 scope claim | `error`、`errorKey`（`command.forbidden` 等）、`missing?` |
| 404 | context 加载不到记录 | `error: "Not found"`、`resource` |
| 409 | `require` 失败；`create` 无法写入；幂等键内容冲突 | `error`、`errorKey?`、`resource?` |
| 422 | 类型/范围不合法（Elysia 校验） | 校验错误详情 |
| 500 | 未预期异常 | `error` |

GraphQL 命令把同样的状态与 key 放进 `extensions.status` / `extensions.errorKey`，前端可统一处理。

### 业务错误翻译

- `require ... @error("text")` 始终是字面量，不会把任意字符串猜成翻译 key。
- `require ... @error(t("inventory.quantityTooLow"))` 的 key 必须在 `messages.default` 语言存在；默认语言文案写入 IR。
- REST 拒绝返回 **409** + 默认语言 `error` + 稳定 `errorKey`；GraphQL command 在 `extensions.status`/`extensions.errorKey` 保留同一机器契约。
- 生成的 Refine DataProvider 按当前界面语言翻译该 key（缺当前语言回退默认语言，未知 key 用 API 原文）；不带 i18n 的 API 客户端也能显示默认文案。
- 同样的机制适用于 `permission` 的 `@label(t(...))` 与 action 的 `label`/`confirm`。

## 生成结果

| 产物 | 内容 |
| --- | --- |
| `apps/server/src/dataflows/index.ts` | `createDataflowRoutes(authenticate)`：每个 flow 一个 `.post("/<name>")`，批量再加 `/batch` |
| OpenAPI | `POST /api/v1/commands/<name>`，`tags: ["Dataflow"]`，描述来自 `@comment`/`@label` |
| GraphQL | `run<Name>(input: <Name>CommandInput!, idempotencyKey: String!): <Entity>!`；批量 `run<Name>Batch(items: [...], idempotencyKey: String!)`；native/Yoga/Apollo 都委托同一 REST 路由 |
| Web（有 `action` 时） | 按钮、确认弹窗、必填输入表单、幂等键、本地化通知；`when` 控制可见性 |
| 迁移 | `dataflow_idempotency`（有 `idempotency required`）、`dataflow_outbox`（有 `emit`） |
| 测试 | 生成包内 dataflow 测试：成功、权限拒绝、幂等回放/冲突、业务失败回滚、审计与 outbox |

命令路由**自行执行 allow 规则**：`/api/v1/commands` 已从通用角色守卫中豁免，guard 只做认证。

## 批量执行（batch）

```qiy
dataflow archiveReview @label("归档所选") {
  input {
    field reviewId UUID @required;
    field reason Text @required;
  }
  context { review = entity reviews by id input.reviewId @required; }
  step archive { update review { status = "archived"; note = input.reason; } }
  idempotency required;
  result { return review; }
}

action archiveSelected {
  resource reviews;
  dataflow archiveReview;
  placement list;
  batch true;
}
```

- 端点 `POST /api/v1/commands/<name>/batch`，body `{ "items": [ {…}, … ] }`（1–100 项，ID 必须唯一，否则 400 `Batch item identifiers must be unique`）。
- 单事务顺序执行；任意一项失败 → 整批回滚，响应带 `item: { index, id }`（以及 `resource`/`errorKey`）。
- 只写一条幂等回执（flow 名 `<name>:batch`），相同 key + 相同 items 回放；顺序或内容不同 409。
- 生成 `action` 侧约束：只能 `placement list`、不能有记录级 `when`、必须绑定 `idempotency required` 的 flow、目标资源必须由**一个必填 UUID input** 加载。详见 [actions](/dsl/actions#批量)。

## 与 realtime 的联动

- `emit` 在写 `dataflow_outbox` 的同时写实时 outbox（`qiy:event:<event>`），两者与业务写入一起提交/回滚。
- `allow roles` 会转换为对应业务事件 channel 的 subscribe-only capability。
- 字段 `mask` 在入队前裁剪，所以被 mask 的字段不会出现在实时负载里。
- 细节见 [realtime](/dsl/realtime)。

## 进阶用法

**1）状态机 + 双表联动**

```qiy
dataflow approvePurchaseOrder @label("审批采购单") @confirm("确认审批？") {
  allow permission PurchaseApprovePermission;
  idempotency required;
  audit "purchase_order.approved";
  input {
    field orderId UUID @required;
    field quantity Integer @required;
  }
  context {
    order = entity purchase_orders by id input.orderId @required;
    item  = entity purchase_order_lines by id input.lineId @required;
  }
  step guard {
    require order.status == "submitted" @error("errors.purchaseOrder.notSubmitted");
    require input.quantity > 0 @error("数量必须大于 0");
  }
  step apply {
    update order { status = "approved"; }
    update item { quantity = input.quantity; }
    emit "purchase_order.approved" { orderId = order.id; quantity = input.quantity; }
  }
  result { return order; }
}
```

**2）创建后立刻使用**

```qiy
step draft {
  create review = entity reviews {
    orderId = input.orderId;
    status = "pending";
  }
}
step restrict {
  require review.status == "pending" @error("errors.review.unexpectedState");
  update review { status = "scored"; }
}
result { return review; }
```

**3）同步策略适配器（fail-closed）**

```qiy
step approve {
  update review { status = "approved"; }
  call reviewPolicy { reviewId = review.id; status = review.status; reason = input.reason; }
}
result { return review; }
```

在 `apps/server/src/extensions/dataflow-calls.ts`（不受 `--sync` 管理）里实现：

```ts
import type { DataflowCallHandlers } from "../dataflows/calls";

export const dataflowCallHandlers: DataflowCallHandlers = {
  reviewPolicy: (request) => {
    const reason = String(request.payload.reason ?? "").trim();
    if (!reason) return { ok: false, error: "A reason is required", errorKey: "review.reasonRequired" };
    return { ok: true };
  },
};
```

契约由 `apps/server/src/dataflows/calls.ts` 生成：`(request: { flow, actor: { id, role }, payload: Record<string, unknown> }) => { ok: true } | { ok: false, error, errorKey? }`，返回类型**不含 Promise**——handler 必须是同步函数。

**4）幂等 + 回放测试**：同一 `Idempotency-Key` 重放返回首次结果；换输入返回 409；`action` 在失败重试时保留 key、成功后换 key。

**5）业务错误本地化**：`@error(t("key"))` → REST 返回默认语言文案 + `errorKey`，Refine 通知按当前语言翻译；GraphQL 把 `errorKey` 放进 `extensions`。

## `app.test.qiy` 声明式场景

入口是 `app.qiy` 时，CLI 自动查找同目录 `app.test.qiy`，把 `given → when dataflow → expect` 编译成生成 Server 的 Bun 测试：

```qiy [examples/dataflow/call.test.qiy]
qiy test v0;
application dataflow-call;

scenario approve-review {
  given review = entity reviews {
    id = "00000000-0000-4000-8000-000000000001";
    status = "pending";
    note = "Requires policy approval";
  }
  when dataflow approveReview {
    reviewId = review.id;
    reason = "Approved by operator";
  }
  expect status == 200;
  expect review.status == "approved";
}
```

| 元素 | 规则 |
| --- | --- |
| `application` | 必须与主模型名称一致 |
| `given` | 至少一条；必须提供实体全部非空字段；值符合类型（`Date` `"YYYY-MM-DD"`、`Time` `"HH:mm:ss"`、`DateTime` 毫秒时间戳、enum 名） |
| `identity` | 可选。`identity anonymous;` 或 `identity { id = …; role = "operator"; claims { "tenant.id" = review.tenantId; } }`；id 非空、角色固定三种、claims 支持字段引用 |
| `when dataflow` | 只能调用已声明 flow；必填 input 不可遗漏；输入可引用 `given` 字段 |
| `expect status` | **必填**（100–599） |
| `expect errorKey == "…"` | 可选，断言稳定错误 key |
| `expect <alias>.<field> == value` | 可选，多条；重复断言报错 |
| `expect exists <alias> == false` | 断言记录已删除；不能与同 alias 的字段断言共存 |
| `expect outbox "<event>" count == <n>` | 断言 `dataflow_outbox` 中该事件数量；事件必须由模型 `emit` 声明 |

- 场景复用生成的认证角色、幂等 header、事务路由与 `call` 契约，不绕过生产实现；`call` 使用返回成功的测试 adapter。
- 自动执行器支持 SQLite（内存库）、PostgreSQL、MySQL（真实事务）。后两者需先迁移隔离库，并同时设置 `DATABASE_URL` 与 `QIY_TEST_DATABASE_URL`（数据库名必须以 `qiy_test_` 开头），否则拒绝执行；场景会清理模型表，**绝不能指向业务库**。
- 按显式 relation 的父表顺序插入、子表顺序清理；循环外键无法自动清理，生成期拒绝。浏览器 Action 场景尚未实现。

```bash [apps/server]
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/qiy_test_admin'
export QIY_TEST_DATABASE_URL="$DATABASE_URL"
bun run --bun drizzle-kit generate
bun run --bun drizzle-kit migrate
bun test tests/qiy-scenarios.test.ts
```

测试的是「认证器返回身份之后」的授权与隔离，不签发/校验真实 JWT、Cookie 或 IdP 登录。

## 校验错误一览

| 分类 | 错误（节选） |
| --- | --- |
| 结构 | `requires input, context, and result blocks`、`requires at least one step`、`duplicate input block`、`duplicate context block`、`duplicate result block`、`unsupported section <s>`、`unsupported action <a>`、`Duplicate dataflow <n>` |
| 注解 | `duplicate @label annotation`、`duplicate @confirm annotation`、`unsupported annotation @x` |
| input | `unsupported input type <t>`、`duplicate input field <f>`、`unsupported input annotation @x` |
| context | `unknown entity <e>`、`<e>.<k> must be a primary key`、`context <c> must load by an input field`、`requires input.<f> to be @required`、`context bindings must declare @required …`、`input is a reserved context name`、`duplicate context binding <b>` |
| step | `duplicate step <s>`、`step order must be a unique positive integer`、`unsupported step annotation @x` |
| require | `unknown field reference <ref>`、`require input must be @required`、`nullable Integer require is not supported`、`require comparisons support Text, enum and Integer fields only`、`Text and enum require support == and != string comparisons only`、`unknown enum value <e>.<v>`、`require integer literal must fit signed 32-bit range` |
| update | `unknown context binding <c>`、`cannot update deleted context <c>`、`update must write at least one field`、`unknown update field <e>.<f>`、`cannot update primary key`、`cannot update scope field`、`cannot update password field`、`unknown input field input.<f>`、`update requires input.<f> to be @required`、`input updates require matching Text, Integer or UUID fields…`、`literal updates currently support Text and enum fields only`、`duplicate update field <e>.<f>` |
| create | `unknown create entity <e>`、`duplicate or reserved created context <c>`、`create must write at least one field`、`unknown create field <e>.<f>`、`create primary key … is generated automatically`、`create scope field … is derived from the authenticated principal`、`create requires value for <e>.<f>`、`create input requires a matching UUID, Text, Integer, Decimal or declared enum field`、`create literals currently support Text and enum fields only` |
| delete | `unknown context binding <c>`、`context <c> is already deleted`、`cannot use deleted context <c>` |
| emit / call | `emitted event cannot be empty`、`emit payload supports at most 32 fields`、`duplicate emit payload field <f>`、`unknown emit input input.<f>`、`emit input must be @required`、`cannot emit from deleted or unknown context`、`unknown emit field <c>.<f>`、`cannot emit password field <e>.<f>`、`call payload supports at most 32 fields`、`unknown call input input.<f>`、`cannot pass password field to call <e>.<f>`、`emit integer literal must be a safe integer` |
| result | `result must return a declared context binding` |
| allow | `duplicate allow declaration`、`allow must be roles, permission or verification`、`unsupported command role <r>`、`allow permission requires permission declarations`、`unknown permission field or group <r>`、`allow verification requires permission declarations`、`unknown permission verification <v>`、`permission verification <v> input <i> has no matching dataflow input`、`must be @required`、`requires a Text or enum dataflow input` |
| 其它 | `idempotency must be required`、`audit action cannot be empty`、`duplicate idempotency declaration`、`duplicate audit declaration` |
| 跨块 | `Restrict <resource>: dataflow <name> cannot use a restricted resource …`、`Action <a>: dataflow <f> does not load resource <t>`、`Action <a>: batch actions require dataflow <f> to declare idempotency required`、`application mode integration cannot configure generated server features` |

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 400 `A valid Idempotency-Key header is required` | 声明了 `idempotency required` 但调用没带键 | 带头；用 `action` 时由生成代码自动带 |
| 409 且 `errorKey` 是业务 key | `require` 断言失败 | 按 key 补前端文案，或修正调用参数 |
| 404 `Not found` + `resource` | `context` 加载不到记录（ID 不存在或跨 scope） | 检查 ID 与数据范围 |
| 403 `command.forbidden` | `allow permission` / `allow verification` 不满足 | 检查 `/auth/me` 的 `permissions`/`groups`；见 [权限](/dsl/permissions) |
| `cannot update scope field` | 命令试图写 scope 租户列 | scope 列只能由 principal 推导；改设计 |
| `create requires value for <e>.<f>` | 漏写非空字段 | 补齐赋值或把字段改成 `@nullable` |
| `Dataflow <n> requires input, context, and result blocks` | 缺块（即使为空也要写 `input {}`） | 补空块 |
| `result must return a declared context binding` | `return` 了未声明名字 | 用 context/create 绑定名 |
| `literal updates currently support Text and enum fields only` | 用字面量写 Integer/Decimal/Date | 改用 `input.<f>`（类型一致）或改由 `call` 处理 |
| `call` 总是 409 | 扩展实现仍返回 fail-closed 默认值 | 在 `extensions/dataflow-calls.ts` 实现并返回 `{ ok: true }` |
| 生成期 `cannot use a restricted resource` | 命令读写了带 `restrict` 块的资源 | 去掉该资源的 `restrict`，或把命令拆到别的资源 |
| GraphQL mutation 报缺少幂等键参数 | 启用了幂等 | 传 `idempotencyKey` 参数（REST 用 `Idempotency-Key` 头） |

## 非目标（明确不做）

- ❌ 任意表达式、算术、函数调用、循环、动态 SQL、反射式字段访问、内嵌 JS/TS。
- ❌ 任意 `where` 加载、join、聚合读取（需要查询时用资源 REST/GraphQL 接口）。
- ❌ 异步/外部副作用：`call` 必须同步且无网络；HTTP、支付、消息发送请写 `emit` + 提交后 worker。
- ❌ 直接投递 broker / 消费者幂等 / 死信：`emit` 只落 outbox。
- ❌ 可选 context（`@required` 目前必须写）、字段间比较、Decimal/Boolean 条件、Decimal 动态写入。
- ❌ 嵌套事务、跨命令补偿、分布式事务。
- ❌ 在 integration（宿主 API）模式下生成命令：含 `dataflow` 的 integration 模型会被明确拒绝，避免生成第二套业务实现。
- ❌ 自定义角色：命令 `allow roles` 只有 `admin`/`operator`；需要更细粒度请用 `allow permission`。

## 相关

- [actions](/dsl/actions)：把 dataflow 挂到列表/详情按钮，`when`、确认、批量。
- [权限（permission）](/dsl/permissions)：`allow permission` / `allow verification` 语义与 provider 来源。
- [application](/dsl/application#restrict)：`restrict` / `scope` 与命令的互斥关系。
- [realtime](/dsl/realtime)：`emit` 与实时 outbox、订阅通道。
- [业务工作流](/guide/workflow)：`workflow orderInventory` 切片。
- [多语言（messages）](/dsl/application#messages)：`t("key")` 字典。
- 示例：[roles.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/roles.qiy)、[typed-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/typed-inputs.qiy)、[enum-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/enum-inputs.qiy)、[create-delete.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/create-delete.qiy)、[emit.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/emit.qiy)、[call.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/call.qiy)、[guarded-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/guarded-inputs.qiy)、[batch-actions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/batch-actions.qiy)、[browser-actions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/browser-actions.qiy)、[documented-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/documented-inputs.qiy)、[localized-errors.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/localized-errors.qiy)、[examples/self/modules/dataflows.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/dataflows.qiy)。
- 测试：`tests/dataflow-qiy.test.ts`、`tests/action-qiy.test.ts`、`tests/qiy-test.test.ts`；实库验收 `tools/verify-postgres-dataflow.ts`、`tools/verify-mysql-dataflow.ts`。
