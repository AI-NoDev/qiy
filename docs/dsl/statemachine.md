# 状态机（statemachine）

`statemachine` 把一个 enum 字段声明为**受控状态**：字段只有初始值和 transition 两种来源，通用的新建/编辑接口、CSV 导入和表单都不能改它。每个 transition 编译成一个 [dataflow](/dsl/dataflow) 命令和一个 [action](/dsl/actions) 按钮，所以角色、权限、数据范围、行锁、幂等、审计、事件、GraphQL 与 API 文档都沿用 dataflow 的实现，不需要另学一套运行时。

```qiy
enum orderStatus {
  value draft label "草稿";
  value submitted label "已提交";
  value approved label "已审批";
  value shipped label "已出库";
  value cancelled label "已取消";
}

entity orders {
  field id UUID @id;
  field status orderStatus;
}

statemachine orderLifecycle {
  resource orders;
  field status;
  initial draft;
  transition submit { from draft; to submitted; label "提交订单"; }
  transition approve { from submitted; to approved; label "审批"; allow roles admin; }
  transition ship { from approved; to shipped; label "出库"; confirm "确认出库？"; }
  transition cancel { from draft, submitted; to cancelled; label "取消订单"; confirm "确认取消该订单？"; }
}
```

## 语法

```text
statemachine <Name> {
  "resource" <entity> ";"
  "field" <enumField> ";"
  "initial" <state> ";"
  ( "transition" <name> "{"
      "from" <state> ( "," <state> )* ";"
      "to" <state> ";"
      [ "label" doc ";" ]
      [ "confirm" doc ";" ]
      [ "allow" ( "roles" role ("," role)* | "permission" ref ("," ref)* | "verification" <Name> ) ";" ]
    "}" )+
}
```

`doc` 可以是字符串字面量或 `t("key")`。`statemachine`、`dataflow`、`action` 三类声明位于 `chart` 之后，彼此之间可以任意交错（见 [application · 块顺序](/dsl/application#块顺序与基数)）。

## 属性表

| 属性 | 必填 | 语义与校验 |
| --- | --- | --- |
| `resource` | 是 | 实体名或表名；实体需要主键；资源的 `restrict` 同样生效（看不到的记录 404，迁移到被值谓词排除的状态在生成期报错） |
| `field` | 是 | 该实体上**非空**的 enum 字段；一个字段只能属于一个状态机 |
| `initial` | 是 | 新记录的状态，必须是 enum 值；会成为字段的默认值。字段已写 `@default` 时必须与 `initial` 相同 |
| `transition <name>` | 至少 1 个 | 名称是标识符，同一状态机内不重复 |
| `from` | 是 | 允许发起该 transition 的状态，至少一个、不重复 |
| `to` | 是 | 目标状态，不能同时出现在 `from` 里 |
| `label` | 否 | 按钮与命令名称，默认用 transition 名 |
| `confirm` | 否 | 确认弹窗文案 |
| `allow` | 否 | 与 dataflow 的 `allow` 相同；省略时所有 `full`/`write` 角色可执行，`read` 角色不能出现在 `allow roles` 里 |

## 生成结果

以 `orderLifecycle.submit` 为例（命令名 = 状态机名 + 首字母大写的 transition 名）：

| 产物 | 内容 |
| --- | --- |
| 命令 | `POST /api/v1/commands/orderLifecycleSubmit`，body `{ "recordId": "<id>" }`，必须带 `Idempotency-Key`；GraphQL `runOrderLifecycleSubmit` |
| 守卫 | 在事务内加载记录（PostgreSQL/MySQL 用 `SELECT … FOR UPDATE` 锁行），状态不在 `from` 中 → 409 `{ error, errorKey: "state.invalidTransition" }`，不写任何数据 |
| 写入 | 把字段改为 `to`；有 `@version` 时版本号加一 |
| 审计 | `audit_events.action = "orders.submit"` |
| 事件 | outbox 事件 `orders.submit`，payload `{ id, status }`；配置了 [realtime](/dsl/realtime) 时同样推送 |
| 按钮 | 列表与详情页的 action，`when status == "draft"`；多个 `from` 时为 `when status in "draft", "submitted"` |
| 字段 | 从 REST/GraphQL 的 create/update 输入、CSV 导入和表单中移除；`initial` 成为列默认值；列表、详情、筛选照常显示 |

- 同一个 `Idempotency-Key` 重试会回放第一次的结果，而不是因为状态已经变化返回 409。
- `scope` 声明的数据范围同样生效：缺少 claim → 403，跨范围的记录 → 404。
- 守卫失败的 `errorKey` 是 `state.invalidTransition`。在 `messages` 中提供这个 key 即可翻译；未提供时显示英文原文（例如 `submit is not allowed while status is not draft`）。
- 生成的命令属于生成产物：`qiy generate --sync` 会重写，不要手改。

## 字段归属

状态机字段**只能**由 transition 改变：

- 通用接口：create/update 的 schema 不含该字段，请求里带上会被忽略；只带该字段的 PATCH 返回 400（没有可更新字段）。
- 手写的 dataflow 中，`update` 或 `create` 写这个字段会在解析期报错：`Dataflow <name>: orders.status belongs to a statemachine; change it with a transition instead`。
- 需要「改状态 + 写其他字段」时，transition 之外再声明一个 dataflow 写其他字段，并用 action 的 `when status == "…"` 控制按钮出现的时机。

## 与 dataflow 的分工

| 需求 | 写法 |
| --- | --- |
| 记录在有限状态之间流转，按钮随状态出现 | `statemachine` |
| 一次命令写多个字段、创建子记录、调用 adapter、发自定义事件 | `dataflow` + `action` |
| 状态流转的同时扣减库存等跨表写入 | 当前需要拆开：状态用 `statemachine`，库存写入用独立的 `dataflow`；transition 不支持附加步骤 |

## 校验错误

| 错误（节选） | 触发 |
| --- | --- |
| `Statemachine <m>: unknown resource <r>` / `unknown field <e>.<f>` | 资源或字段不存在 |
| `Statemachine <m>: <e>.<f> must be an enum field` | 字段不是 enum |
| `Statemachine <m>: <e>.<f> cannot be @nullable; every record has a state` | 字段可空 |
| `Statemachine <m>: <e>.<f> already has a state machine` | 两个状态机管同一字段 |
| `Statemachine <m>: unknown initial state <enum>.<s>` | `initial` 不是 enum 值 |
| `Statemachine <m>: <e>.<f> has @default(<v>) but the initial state is <s>; remove the @default` | `@default` 与 `initial` 冲突 |
| `Statemachine <m>: declare at least one transition` | 没有 transition |
| `Statemachine <m>: transition <t>: unknown state <enum>.<s>` | `from`/`to` 不是 enum 值 |
| `… duplicate from state` / `… to <s> is also a from state` | `from` 重复或包含 `to` |
| `… generated command <name> collides with a declared dataflow or action` | 生成的命令名已被占用 |
| `Duplicate statemachine <m>` | 状态机重名 |
| `Dataflow <m><T>: writes <r>.<field> = <state>, which the record policy of <r> hides` | transition 的目标状态被 `restrict` 的值谓词排除 |
| `application mode integration cannot configure generated server features …` | integration 模式下声明了状态机 |

## 相关

- [dataflow](/dsl/dataflow)：transition 编译成的命令的完整语义（幂等、审计、outbox、批量）。
- [action](/dsl/actions)：按钮、`when … in`、确认框与可见性。
- [业务工作流](/guide/workflow)：何时用状态机、何时用 dataflow。
- [迁移到 0.38](/guide/migration-0.38)：`workflow orderInventory` 迁移到状态机。
- 示例：[examples/erpadmin/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/erpadmin/app.qiy)、`tests/fixtures/kitchen-sink/modules/commands.qiy`。
