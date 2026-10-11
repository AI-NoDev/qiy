# dataflow

`dataflow` 是 Qiy 的业务命令 DSL：它描述用户在后台点击“确认”“审批”“撤销”等动作后，服务端按什么顺序读取、校验和变更数据。当前 CLI 已实现一个**受限、可生成的子集**：生成 Elysia 命令端点，在同一事务内加载、校验、更新，并可写入审计和持久化幂等回执。细粒度授权、领域事件与外部调用仍待实现。

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
- standalone 模式生成 `apps/server/src/dataflows/index.ts` 和 `POST /api/v1/commands/<dataflow>`。not-found 为 404，业务 `require` 失败为 409，缺失数据 scope claim 为 403；
- integration 模式不会生成服务端命令，包含 `dataflow` 的 integration 模型会明确拒绝，避免在宿主 API 旁生成第二套业务实现。

生成器为每个命令使用 `db.transaction(...)`；SQLite 回调使用同步查询，业务失败抛出异常以回滚。PostgreSQL/MySQL 的 context 查询使用 `FOR UPDATE` 锁定业务行，后续校验在锁内执行。`audit` 在同一事务写入事件；审计或回执插入失败也回滚数据变更。角色检查发生在幂等回执查询与事务之前：匿名返回 401，不在白名单内返回 403，均不写业务数据、审计或回执。admin 不绕过白名单，因此 `allow roles operator;` 也会拒绝 admin。回放时重新检查角色和数据 scope，已有成功回执不赋予访问权。

完整的本地认证与双角色命令示例见 [examples/dataflow/roles.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/roles.qiy)。通过该模型生成的 Refine 命令 action 自动继承角色白名单，服务端仍是最终授权边界；自定义角色和 `allow permission` 尚未实现。

完整的整数写入示例见 [examples/dataflow/typed-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/typed-inputs.qiy)。生成的 SQLite 测试覆盖数量变更、幂等回放、非法输入无写入，以及业务、审计和回执失败时完整回滚。业务上下限可使用整数 `require`，见下面示例。Boolean input 已支持请求契约，但当前实体字段尚无 Boolean 类型，因此不能用它更新字段；Decimal 动态写入也未实现。

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

容器需发布本地数据库端口；PostgreSQL 使用容器的 `POSTGRES_USER` / `POSTGRES_PASSWORD`，MySQL 使用 `MYSQL_ROOT_PASSWORD`（仅用于创建、删除隔离测试库）。脚本创建独立临时数据库，生成并迁移新项目，运行 14 项 API/数据库测试与 server 类型检查，最后删除测试库，不操作原有业务库。包含整数和枚举实际存储、非法输入与数量业务上下限拒绝、同键重试与晚阶段回滚。认证使用测试注入的 admin/operator 和 tenant claim，包含无权限执行、降权后回放拒绝、缺失/其他租户 claim 拒绝和回执不能绕过当前 scope。测试专用 header 仅在夹具认证器使用，不进入生产认证。对应 CI 为 `.github/workflows/database-smoke.yml`，分别运行 PostgreSQL 16 和 MySQL 8.4；脚本及 CI 配置存在不等于某环境已验收，实际执行结果见 [V3 状态](https://github.com/AI-NoDev/qiy/blob/main/openwiki/v3-status.md)。

## 当前描述与消息支持

input、context 和 step 均可使用 `@comment("描述")` 或 `@comment(t("message.key"))`，消息在同一 application 的 `messages` 块声明，格式见 [DSL 总览](./overview#消息与模型描述)。input 描述进入 TypeBox/OpenAPI，并用于 Refine 命令确认表单的本地化字段名称；context/step 描述目前保存于 IR，尚未全面生成代码注释。`@error(t(...))`、流程级 `@label` / `@confirm` 等仍属于下方目标语法。

## 为什么不接受自由表达式

业务流程不能由前端串联多次 CRUD 来保证一致性；但也不能让 `.qiy` 直接执行任意 TypeScript/JavaScript。后者无法可靠做类型检查、权限审计、事务分析、代码生成或 LLM 校验。

因此 `dataflow` 采用封闭、声明式的命令集合。每一条语句都必须有明确的输入类型、读写对象、错误路径和生成语义。复杂的第三方调用或既有系统逻辑通过受控 `call` 适配器接入，并生成可手写实现的扩展点。

## 后续目标语法

下面展示尚未实现的扩展格式。关键字和注解可能在实现时微调；语义与边界不变。

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
2. **请求边界**：当前生成 Elysia TypeBox body 契约；只接受 `input` 声明的字段。OpenAPI 会暴露生成的 Dataflow REST body；Zod 描述和 GraphQL command 尚未生成。前端确认表单不属于 Dataflow 隐式行为，需要通过独立 `action` 声明生成。
3. **上下文加载**：当前按 `context` 在事务内加载实体。`@required` 缺失时返回 404；不会使用 `!` 这类后缀语法。
4. **校验与授权**：请求先验证 `allow roles`，再在事务内执行 `require` 并遵循已声明 data scope。`allow permission`、自定义角色和通用字段/动作权限尚未实现。
5. **事务写入**：当前所有受支持 `update`、可选审计和幂等回执在同一个事务内执行；`create`、`delete`、`emit` 尚未实现。
6. **结果与 UI**：当前返回最终 context。显式 `action` 可挂载到 Refine 列表/详情操作区，并生成确认表单和幂等键；错误 i18n 和批量业务 UI 尚未生成。客户端不拥有业务权威。
7. **可观测性**：已生成可选审计事件和持久化幂等键策略；结构化日志与审计关联 ID 尚未实现。

## 受控语句集

第一阶段只实现下列可静态验证的语句：

| 语句 | 语义 |
| --- | --- |
| `require` | 断言条件；失败返回声明的本地化业务错误 |
| `allow` | 要求 permission、role 或 scope |
| `create` / `update` / `delete` | 对已验证实体执行受控写入 |
| `audit` | 在同一事务记录审计事件 |
| `emit` | 提交后发布领域事件 |
| `call` | 调用显式声明、可测试的外部适配器 |
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

选择性导入仍是规划语法，不能用于当前 CLI：

```qiy
i18n {
  include "modules/catalog.qiy" @messages;
  include "modules/catalog.qiy" @menu.operations;
}
```

导入必须复用现有安全模块规则：只允许项目根内相对路径、拒绝 `..` 穿越和循环引用，并对被选择的符号做存在性与重复 key 校验。

## 测试路线

在运行时语义稳定前，不把 `xxx.test.qiy` 误当成可以执行的承诺。实施分为三步：

1. Dataflow IR 解析、类型、权限、顺序、事务与引用的编译期负例测试。
2. 从每个 `dataflow` 生成 TypeScript API/UI 测试模板，并在 PostgreSQL 上验证提交、回滚、审计和幂等。
3. 再引入 `*.test.qiy` 声明式场景：`given`、`when`、`expect`，只覆盖已定义的命令和断言。

## 集成模式边界

在独立生成项目中，当前受限 `dataflow` 会生成 Elysia 服务端命令；在既有 Bun/现有 API integration 模式中，包含 `dataflow` 的模型会明确拒绝，而不是生成看似可用的第二套业务实现。请在未托管的宿主 API/adapter 中实现既有 JWT、HttpOnly Cookie、领域服务和审计体系的命令契约。

完整的实施顺序和验收门槛见 [V3 状态与规划](https://github.com/AI-NoDev/qiy/blob/main/openwiki/v3-status.md)。
