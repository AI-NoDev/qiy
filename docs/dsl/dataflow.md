# dataflow

`dataflow` 是 Qiy 的业务命令 DSL：它描述用户在后台点击“确认”“审批”“撤销”等动作后，服务端按什么顺序读取、校验和变更数据。当前 CLI 已实现一个**受限、可生成的子集**：生成 Elysia 命令端点，在同一事务内加载、校验、更新，并可写入审计、事务性 outbox 和持久化幂等回执。Dataflow 自身可以声明可国际化的名称、确认文案和说明；细粒度授权、外部调用和 broker 投递仍待实现。

## 流程元数据

```qiy
dataflow explainReview
  @label(t("review.action"))
  @confirm(t("review.confirm"))
  @comment(t("review.description")) {
  // input/context/step/result
}
```

- `@label(...)` 是面向操作人员的流程名称；绑定它的 Action 未声明 `label` 时自动继承；
- `@confirm(...)` 是默认确认文案；Action 可省略 `confirm` 或显式覆盖；
- `@comment(...)` 进入生成源码注释、REST OpenAPI endpoint 描述、GraphQL command input 与 mutation 描述；
- 三个注解都支持字面量或 `t("message.key")`。翻译 key 必须在默认 locale 中存在；生成 IR 保留默认语言 fallback 和 key；
- Dataflow 与 Action 都没有 label 时生成失败，避免出现无标题业务按钮。

完整多语言示例见 [documented-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/documented-inputs.qiy)。

## 当前可执行子集

独立生成项目可使用下列语法：

```qiy
dataflow revokeConnector {
  allow roles admin, operator;
  idempotency required;
  audit "connector.revoked";
  input {
    field connectorId UUID @required;
    field reason Text @required @comment("Operator-provided reason");
  }

  context {
    connector = entity connectors by id input.connectorId @required;
  }

  step validate @order(10) {
    require connector.status != "revoked"
      @error("errors.connector.alreadyRevoked");
  }

  step revoke @order(20) @comment("Write revoked state") {
    update connector {
      status = "revoked";
      revokedReason = input.reason;
    }
  }

  result { return connector; }
}
```

当前限制：

- input 支持 `UUID`、`Text`、`Integer`、`Decimal`、`Boolean` 和模型中已声明的 enum 名称；作为 context 主键来源的 input 必须带 `@required`；
- context 只支持按实体 UUID 主键从 `input.<field>` 加载，且必须带 `@required`；
- `require` 比较必填 input 或已加载 context；Text/enum 支持字符串相等/不等，非空 Integer 支持整数字面量的六种比较，见下方整数业务规则；
- `update` 支持 Text/enum 字符串字面量，也支持 Text、Integer 字段赋值为同类型必填 input（如 `revokedReason = input.reason;`、`quantity = input.quantity;`）；编译时拒绝未知、可选、类型不匹配的输入和向 enum 写入自由文本。不能写主键、scope 租户范围字段或本地认证 passwordField，不能重复写同一字段，不支持表达式或函数调用。Integer 请求范围为 -2147483648 至 2147483647，与 PostgreSQL/MySQL 的整数列保持一致；Elysia 可将数字字符串转换为整数，非数字字符串、非整数与越界值返回 422；
- step 的 `@order(<正整数>)` 必须唯一；生成器按排序后的步骤执行；
- `allow roles admin;` 或 `allow roles operator;` 声明命令角色白名单，也可写 `allow roles admin, operator;`；未声明时默认允许 admin/operator。当前只支持这两个内置角色，拒绝空列表、重复声明和未知角色；
- standalone 模式生成 `apps/server/src/dataflows/index.ts` 和 `POST /api/v1/commands/<dataflow>`。同时生成 `run<Dataflow>` GraphQL mutation；有 input 时生成强类型 `*CommandInput`，空 `input {}` 不生成非法空 input type，启用幂等时 mutation 要求 `idempotencyKey`。native、GraphQL Yoga 和 Apollo 都委托同一条 REST Dataflow Elysia 路由，因此事务、角色、scope、审计、outbox 与幂等逻辑只有一份。not-found 为 404，业务 `require` 失败为 409，缺失数据 scope claim 为 403；
- integration 模式不会生成服务端命令，包含 `dataflow` 的 integration 模型会明确拒绝，避免在宿主 API 旁生成第二套业务实现。

生成器为每个命令使用 `db.transaction(...)`；SQLite 回调使用同步查询，业务失败抛出异常以回滚。PostgreSQL/MySQL 的 context 查询使用 `FOR UPDATE` 锁定业务行，后续校验在锁内执行。`audit` 在同一事务写入事件；审计或回执插入失败也回滚数据变更。角色检查发生在幂等回执查询与事务之前：匿名返回 401，不在白名单内返回 403，均不写业务数据、审计或回执。admin 不绕过白名单，因此 `allow roles operator;` 也会拒绝 admin。回放时重新检查角色和数据 scope，已有成功回执不赋予访问权。

完整的本地认证与双角色命令示例见 [examples/dataflow/roles.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/roles.qiy)。通过该模型生成的 Refine 命令 action 自动继承角色白名单，服务端仍是最终授权边界；前端 `CanAccess` 同时传递当前记录 ID，成功/失败提示使用 Refine `useNotification`，文案走项目 i18n provider。自定义角色和 `allow permission` 尚未实现。

完整的整数写入示例见 [examples/dataflow/typed-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/typed-inputs.qiy)。生成的 SQLite 测试覆盖数量变更、幂等回放、非法输入无写入，以及业务、审计和回执失败时完整回滚。业务上下限可使用整数 `require`，见下面示例。Boolean input 已支持请求契约，但当前实体字段尚无 Boolean 类型，因此不能用它更新字段；Decimal 动态写入也未实现。

### 创建与删除

```qiy
// examples/dataflow/create-delete.qiy
step create {
  create review = entity reviews {
    userId = input.userId;
    note = input.note;
    status = "pending";
  }
}
result { return review; }
```

`create` 绑定新实体记录，后续步骤可以校验、更新、删除或返回该记录。UUID 主键由服务端生成；scope 字段从已认证用户的 claim 推导，禁止通过输入覆盖。所有非空、非主键、非 scope 字段必须赋值；nullable 字段可以省略。同类型必填 input 可写 UUID、Text、Integer、Decimal 或已声明 enum；字面量暂仅支持 Text/enum。禁止写本地认证密码字段，不接受任意表达式。

```qiy
// examples/dataflow/create-delete.qiy
step remove {
  delete review;
}
result { return review; }
```

`delete` 物理删除已加载或刚创建的记录；外键删除策略由数据库约束决定。删除后不能再次校验、更新或删除该绑定，允许返回删除前的快照。创建、更新、删除均属于同一事务，后续业务规则、审计或回执写入失败时全部回滚。已有成功回执在加载记录前查询，因此删除后的同键重试仍返回首次快照；角色和 scope 检查仍先执行，变更租户 claim 后复用原键返回 409。

`input {}` 和 `context {}` 可为空，用于无需读取已有记录的创建命令。完整示例同时展示创建审核记录、删除审核记录、纯创建用户，以及创建后更新并删除的组合命令。

### 事务性事件

```qiy
// examples/dataflow/emit.qiy
step commit {
  update order { status = "approved"; }
  emit "order.approved";
}
```

`emit` 接受非空固定事件名，也可带受控 payload：字段只能来自必填 input、已加载 context 字段或字符串/整数常量，最多 32 个字段，禁止重复键和敏感本地密码字段。例如：

```qiy
emit "order.approved" {
  orderId = order.id;
  requestedBy = input.orderId;
  source = "dashboard";
  priority = 2;
}
```

它在当前事务的 `dataflow_outbox` 表中保存事件、操作者、JSON 文本 payload 和创建时间。先执行数据库迁移；SQLite、PostgreSQL 与 MySQL 均生成该表。后续业务、审计、回执或 outbox 写入失败时，业务变更和事件一起回滚；启用幂等的同键成功回放不会重复写事件。

PostgreSQL/MySQL 实库测试覆盖 12 个同键并发请求只生成一条事件、payload 可解析、actor 与时间正确、受控 payload 字段正确、晚阶段失败不留事件，以及 outbox/审计/回执故障解除后的同键重试。此能力只持久化事件；worker、broker 连接、投递重试、消费者幂等与死信策略需要另行实现。任意动态对象、外部消息实时订阅尚未支持。

### 整数业务规则

```qiy
// examples/dataflow/guarded-inputs.qiy
step validate {
  require input.quantity >= 100 @error("inventory.quantityTooLow");
  require input.quantity <= 200 @error("inventory.quantityTooHigh");
  require item.quantity >= 0 @error("inventory.corruptStock");
}
step adjust {
  update item { quantity = input.quantity; }
  require item.quantity >= 100 @error("inventory.invalidUpdatedStock");
}
```

`require` 可比较必填 input 或 context 字段。Integer 支持 `==`、`!=`、`>`、`>=`、`<`、`<=`，右侧必须是有符号 32 位整数字面量，可为负数；nullable Integer 暂不支持。Text/enum 仅支持 `==`、`!=` 与字符串字面量。context 名称不能是保留的 `input`。规则在事务中按步骤顺序执行，失败返回 409；写入后的规则失败也会回滚，且不留下审计或幂等回执。错误暂返回声明的字符串，不自动翻译。

完整模型见 [guarded-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/guarded-inputs.qiy)。SQLite 自动测试为多个整数条件寻找共同合法输入，并生成输入规则失败、无写入与同键重试用例。上下文字段的初始夹具只使用首次写入前的规则。互相矛盾的整数条件会报告无法推导成功夹具；此生成测试机制不等同通用流程求解器，复杂场景仍需手写测试。字段间比较、算术、Boolean 与 Decimal 条件尚未支持。

枚举输入必须引用与目标字段相同的 enum，不能以任意 Text 输入替代。枚举字面量更新及 `require` 比较也会检查值是否已声明。示例 [examples/dataflow/enum-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/enum-inputs.qiy) 使用 `field decision reviewState @required;` 和 `update review { status = input.decision; }`；生成 Elysia 字面量联合类型契约和 Refine Action 的 Ant Design Select，选项使用 enum 的 label。未知状态、数字和对象被请求边界拒绝，不产生写入。enum 限定合法值集合，具体状态转换仍需业务策略，例如示例中的 pending 状态检查。

`idempotency required` 要求请求携带 1–128 个可打印 ASCII 字符的 `Idempotency-Key`。回执按操作者、命令、键哈希隔离：相同输入返回首次结果，不同输入返回 409。显式 action 自动传递该键，失败后相同输入重试保留键，输入变化或成功后换键。幂等表需要运行迁移；当前不自动清理回执。SQLite 已实测提交、回放、冲突、审计失败和回执失败回滚；PostgreSQL 与 MySQL 实库均已验证同键并发回放、不同键状态冲突、两张业务表联动、业务/审计/回执失败完整回滚和解除故障后的同键重试。此子集不覆盖消息投递、外部调用补偿或复杂并发状态机。

维护者可运行以下命令复验实库路径：

```sh
bun tools/verify-postgres-dataflow.ts <postgres-container>
bun tools/verify-mysql-dataflow.ts <mysql-container>
```

容器需发布本地数据库端口；PostgreSQL 使用容器的 `POSTGRES_USER` / `POSTGRES_PASSWORD`，MySQL 使用 `MYSQL_ROOT_PASSWORD`（仅用于创建、删除隔离测试库）。脚本创建独立临时数据库，生成并迁移新项目，运行 24 项 API/数据库测试与 server 类型检查，最后删除测试库，不操作原有业务库。包含整数和枚举实际存储、非法输入与数量业务上下限拒绝、创建/删除同键并发、租户隔离、同键重试、晚阶段回滚和事务性 outbox。认证使用测试注入的 admin/operator 和 tenant claim，包含无权限执行、降权后回放拒绝、缺失/其他租户 claim 拒绝和回执不能绕过当前 scope。测试专用 header 仅在夹具认证器使用，不进入生产认证。对应 CI 为 `.github/workflows/database-smoke.yml`，分别运行 PostgreSQL 16 和 MySQL 8.4；脚本及 CI 配置存在不等于某环境已验收，实际执行结果见 [V3 状态](https://github.com/AI-NoDev/qiy/blob/main/openwiki/v3-status.md)。

## 当前描述与消息支持

input、context 和 step 均可使用 `@comment("描述")` 或 `@comment(t("message.key"))`，消息在同一 application 的 `messages` 块声明，格式见 [DSL 总览](./overview#消息与模型描述)。input 描述进入 TypeBox/OpenAPI，并用于 Refine 命令确认表单的本地化字段名称；input/context/step 描述同时生成 JSDoc，翻译引用保留为 `i18n: key`，便于二次开发。空 step 的说明也保留，非空 step 的说明位于其首个操作之前。注释内容中的 `*/` 会转义，防止结束注释并插入代码；运行时描述保持原文。`action` 的 `label` 与 `confirm` 已支持字面量或 `t("key")`，列表、详情、弹窗、确认框和成功通知会随当前语言变化。流程自身的 `@label` / `@confirm` 仍属于下方目标语法。

### 业务错误翻译

```qiy
// examples/dataflow/localized-errors.qiy
step validate {
  require input.quantity >= 100 @error(t("inventory.quantityTooLow"));
}
```

`@error(t("key"))` 引用默认语言必须存在的消息；完整样例见 [localized-errors.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/localized-errors.qiy)。REST 拒绝请求时返回 HTTP 409，并包含默认语言的 `error` 文案和稳定 `errorKey`；GraphQL command 返回 GraphQL error，并在 `extensions.status` 与 `extensions.errorKey` 保留相同机器契约。生成的 Refine DataProvider 按当前界面语言翻译该 key，缺少当前语言时回退到默认语言；未知 key 使用 API 原文。API 客户端无需 i18n 即可显示默认文案。`@error("text")` 始终是字面量，不会把任意字符串猜测为翻译 key。

## 为什么不接受自由表达式

业务流程不能由前端串联多次 CRUD 来保证一致性；但也不能让 `.qiy` 直接执行任意 TypeScript/JavaScript。后者无法可靠做类型检查、权限审计、事务分析、代码生成或 LLM 校验。

因此 `dataflow` 采用封闭、声明式的命令集合。每一条语句都必须有明确的输入类型、读写对象、错误路径和生成语义。复杂的第三方调用或既有系统逻辑通过受控 `call` 适配器接入，并生成可手写实现的扩展点。

## 受控本地 `call`

`call` 用于把无法可靠生成、但必须参与事务成败判断的**同步本地校验**接入 Dataflow：

```qiy
// examples/dataflow/call.qiy
step approve {
  update review { status = "approved"; }
  call reviewPolicy {
    reviewId = review.id;
    status = review.status;
    reason = input.reason;
    source = "qiy-dashboard";
    priority = 1;
  }
}
```

payload 最多 32 个唯一字段，只能来自必填 input、当前未删除 context 字段、字符串/安全整数常量；本地密码字段禁止传入。Qiy 生成 `apps/server/src/dataflows/calls.ts` 类型契约和不受 `--sync` 管理的 `apps/server/src/extensions/dataflow-calls.ts` 实现入口。默认实现 fail-closed，开发者必须返回 `{ ok: true }`，或返回 `{ ok: false, error, errorKey? }` 以产生 HTTP 409/GraphQL command error。拒绝、抛错或之后的事务失败都会回滚此前数据库写入。

为了保持 Bun SQLite、PostgreSQL 和 MySQL 的同一事务语义，handler 必须是同步函数，不接受 Promise。它适合纯计算、进程内策略和同步校验，**不适合 HTTP、消息发送、支付或其他不可逆副作用**。这些行为应先用 `emit` 写入事务性 outbox，再由提交后的 worker 投递。完整示例见 [examples/dataflow/call.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/call.qiy)。

## 后续目标语法

下面示例混合了已实现的流程元数据和仍待实现的权限、时间函数及富审计语法。关键字和未实现部分可能继续微调；语义与边界不变。

```qiy
dataflow revokeConnector
  @label(t("actions.connector.revoke"))
  @confirm(t("confirm.connector.revoke"))
  @comment(t("flow.connector.revoke")) {

  input {
    field connectorId UUID @required @comment(t("connector.id"));
    field reason Text @required @maxLength(500) @comment(t("connector.revokeReason"));
  }

  context {
    connector = entity connectors by id input.connectorId @required
      @comment(t("flow.connector.load"));
    actor = principal;
  }

  step validate @order(10) @comment(t("flow.connector.validate")) {
    require connector.status != "revoked"
      @error(t("errors.connector.alreadyRevoked"));
    allow permission "connector:revoke";
  }

  step revoke @order(20) @transaction {
    update connector {
      status = "revoked";
      revokedAt = now();
    }
    audit "connector.revoked" {
      connectorId = connector.id;
      reason = input.reason;
      actorId = actor.id;
    }
    emit ConnectorRevoked { connectorId = connector.id; }
  }

  result {
    return connector;
  }
}
```

## 生命周期目标

生成器按下列固定生命周期处理每个命令：

1. **声明与编译**：当前已解析 `input`、`context`、`step`、`result`，并检查实体/字段引用、类型、步骤顺序和写入冲突。
2. **请求边界**：当前生成 Elysia TypeBox body 契约；只接受 `input` 声明的字段。OpenAPI 暴露 Dataflow REST body，GraphQL 生成强类型 command input/mutation，并复用同一 REST 命令实现；Zod 描述尚未生成。前端确认表单不属于 Dataflow 隐式行为，需要通过独立 `action` 声明生成。
3. **上下文加载**：当前按 `context` 在事务内加载实体。`@required` 缺失时返回 404；不会使用 `!` 这类后缀语法。
4. **校验与授权**：请求先验证 `allow roles`，再在事务内执行 `require` 并遵循已声明 data scope。`allow permission`、自定义角色和通用字段/动作权限尚未实现。
5. **事务写入**：当前所有受支持 `create`、`update`、`delete`、同步本地 `call`、`emit`、可选审计和幂等回执在同一个事务内执行；`call` 拒绝会回滚，`emit` 只写 `dataflow_outbox`，不直接调用外部 broker。
6. **结果与 UI**：当前返回最终 context。显式 `action` 可挂载到 Refine 列表/详情操作区，并生成确认表单、幂等键和本地化错误提示；批量业务 UI 尚未生成。客户端不拥有业务权威。
7. **可观测性**：已生成可选审计事件和持久化幂等键策略；结构化日志与审计关联 ID 尚未实现。

## 受控语句集

第一阶段只实现下列可静态验证的语句：

| 语句 | 语义 |
| --- | --- |
| `require` | 断言条件；失败返回声明的本地化业务错误 |
| `allow` | 要求 permission、role 或 scope |
| `create` / `update` / `delete` | 对已验证实体执行受控写入 |
| `audit` | 在同一事务记录审计事件 |
| `emit` | 在同一事务写入固定事件名的 outbox 记录，由 worker 投递 |
| `call` | 调用同步、类型化、默认拒绝的本地校验 adapter；失败回滚事务，禁止网络副作用 |
| `return` / `fail` | 返回契约化结果或明确失败 |

第一阶段不支持任意循环、动态 SQL、反射式字段访问、内嵌 JavaScript/TypeScript，或未声明的跨服务副作用。更丰富的查询语法会在数据权限、方言能力和 Dataflow IR 稳定后单独设计。

## 注释与国际化

所有可命名对象都将支持 `@comment(...)`。它可使用文字，也可使用 `t("entity.user.id")` 这类消息键：

```qiy
field email Text @comment(t("entity.user.email"));
step approve @comment("审核并写入审批记录") {
  // 设计中的 DSL
}
```

当前解析器接受 `//` 与 `#` 行注释；实体、字段、索引、关系、Dataflow input/context/step 和 manual Action 页支持文字及 `@comment(t("key"))`。实体/字段描述进入 GraphQL 类型与 CRUD 输入，字段和 Dataflow input 描述进入 TypeBox/OpenAPI 与 Refine 表单；manual 页说明可随语言切换。context/step 描述保留在 IR。Zod `describe`、完整 TypeScript 文档和步骤审计说明仍待实现。

国际化仍以 `.qiy` 模块为中心。当前可执行的消息声明为：

```qiy
messages {
  default "en-US";
  locale "en-US" { "entity.user.id" "User ID"; }
  locale "zh-CN" { "entity.user.id" "用户 ID"; }
}
```

当前选择性导入直接写在 `application` 中，不使用额外的 `i18n {}` 包装：

```qiy
application catalog-admin {
  database sqlite {}
  include "modules/catalog.qiy" @messages;
}
```

`@message` / `@messages` 已实现，只允许选择目标文件唯一的顶层 `messages` 块，并复用现有安全模块规则：只允许项目根内相对路径、拒绝 `..` 穿越、符号链接逃逸和循环引用。`@menu.operations` 等通用对象路径选择器仍是后续能力，当前会明确报错。

## `app.test.qiy` 声明式场景

当入口是 `app.qiy` 时，CLI 会自动查找同目录的 `app.test.qiy`。当前已实现的第一阶段运行器使用 `given → when dataflow → expect`，把场景编译为生成 Server 的 Bun 测试：

```qiy
// examples/dataflow/call.test.qiy
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

- `application` 必须与主模型一致；scenario、fixture alias、字段和 input 都在生成前检查重复与引用；
- `given` 必须提供实体全部非空字段，值必须符合 UUID/Text/Integer/Decimal/Date/Time/DateTime/enum 的受支持测试表示（`Date` 用 `"YYYY-MM-DD"`、`Time` 用 `"HH:mm:ss"`、`DateTime` 用毫秒时间戳）；
- `when dataflow` 只能调用主模型已声明的流程，必填 input 不可遗漏，输入可引用 fixture 的已给定字段；
- `expect status` 必填；还可写 `expect errorKey == "...";` 和多个 `expect alias.field == value;`；
- 场景测试复用生成的认证角色、幂等 header、事务路由和同步 `call` adapter 契约，不绕过生产 Dataflow 实现。

可在 `given` 后、`when` 前声明测试身份。省略 `identity` 时，为兼容已有测试，使用流程首个允许角色（默认 admin）和固定测试用户；声明 `identity anonymous;` 则向路由注入未登录身份。

```qiy [examples/dataflow/identity.test.qiy]
qiy test v0;
application dataflow-identity;
scenario matching-tenant {
  given review = entity reviews {
    id = "00000000-0000-4000-8000-000000000001";
    tenantId = "tenant-a";
    status = "pending";
  }
  identity {
    id = "operator-a";
    role = "operator";
    claims { "tenant.id" = review.tenantId; }
  }
  when dataflow approveReview { reviewId = review.id; }
  expect status == 200;
  expect review.status == "approved";
}
```

身份必须包含非空字符串 `id` 和 `admin`、`operator` 或 `viewer` 角色；id 和 claims 可引用 `given` 字段。claims 的 key 使用字符串，支持 `"tenant.id"` 这类声明的 scope key，其值按模型字段类型校验；允许省略 claim 来测试缺失权限。未知角色、重复设置、无效引用和不匹配的 scope 类型在生成前拒绝。完整的 [身份场景模型](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/identity.qiy) 与 [测试文件](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/identity.test.qiy) 包含匹配租户成功、匿名 401、viewer 403、缺少租户 403、跨租户记录 404，并检查拒绝后原数据未被修改。

这里测试的是认证器返回身份后的业务授权和数据隔离；不会签发或校验真实 JWT、Cookie 或 IdP 登录，不能替代认证 provider 验收。

自动执行器支持 SQLite、PostgreSQL 和 MySQL。SQLite 使用内存数据库；后两者复用生成的 Drizzle schema 与真实事务，必须先对隔离数据库执行迁移，再同时设置 `DATABASE_URL` 和 `QIY_TEST_DATABASE_URL` 为同一个连接，数据库名必须以 `qiy_test_` 开头。缺少显式测试连接时，场景在导入数据库和清理数据前拒绝执行。

```bash [apps/server]
# 只使用专用测试库；场景会清理模型表，绝不能指向业务数据库。
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/qiy_test_admin'
export QIY_TEST_DATABASE_URL="$DATABASE_URL"
bun run --bun drizzle-kit generate
bun run --bun drizzle-kit migrate
bun test tests/qiy-scenarios.test.ts
```

MySQL 使用 `mysql://` 连接。场景按显式 relation 的父表顺序插入夹具、按子表顺序清理；循环外键当前无法自动清理，生成时拒绝。测试前后清理整个模型的业务表及相关 Dataflow 辅助表，因此应使用独立数据库、避免并行共享。同步 `call` 使用返回成功的测试 adapter，不验证用户实现的策略。浏览器 Action 场景仍待实现。

### 删除与事件断言

```qiy [examples/dataflow/side-effects.test.qiy]
qiy test v0;
application dataflow-side-effects;
scenario delete-and-emit {
  given review = entity reviews {
    id = "00000000-0000-4000-8000-000000000001";
    status = "pending";
  }
  when dataflow removeReview { reviewId = review.id; }
  expect status == 200;
  expect exists review == false;
  expect outbox "review.deleted" count == 1;
}
```

`exists` 按 fixture 的主键检查数据库记录是否存在；`false` 不能与同一 fixture 的字段断言共存。`outbox` 按事件名统计当前隔离场景的 `dataflow_outbox` 记录，事件必须由模型中的 `emit` 声明，数量必须为非负整数。重复断言在生成前拒绝。事件持久化成功不代表已投递到 Ably 或其他外部服务。

完整的 [模型](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/side-effects.qiy) 与 [场景](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/side-effects.test.qiy) 覆盖删除并写入事件、无权限时没有副作用、更新/事件/删除后的规则失败使全部写入回滚。

## 集成模式边界

在独立生成项目中，当前受限 `dataflow` 会生成 Elysia 服务端命令；在既有 Bun/现有 API integration 模式中，包含 `dataflow` 的模型会明确拒绝，而不是生成看似可用的第二套业务实现。请在未托管的宿主 API/adapter 中实现既有 JWT、HttpOnly Cookie、领域服务和审计体系的命令契约。

完整的实施顺序和验收门槛见 [V3 状态与规划](https://github.com/AI-NoDev/qiy/blob/main/openwiki/v3-status.md)。
