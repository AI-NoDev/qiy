# 业务工作流

复杂业务联动通过模型显式声明，生成事务代码，而不是让用户手写重复逻辑。有两种声明方式，生成的都是同一套服务端命令（`POST /api/v1/commands/<name>`）：

| 方式 | 用途 |
| --- | --- |
| [`statemachine`](/dsl/statemachine) | 记录在有限状态之间流转：声明状态字段、初始状态和 transition，自动生成守卫、命令和按钮 |
| [`dataflow`](/dsl/dataflow) + [`action`](/dsl/actions) | 任意事务命令：自己声明输入、加载、校验、写入、事件和 adapter 调用 |

两者可以并用：状态用状态机管理，状态之外的写入用 dataflow。

## 状态机

```qiy
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

```text
draft --submit--> submitted --approve--> approved --ship--> shipped
  |                    |
  +----> cancelled <---+
```

生成结果：

- 每个 transition 一个命令（`orderLifecycleSubmit` 等）：在事务内加载并锁定记录，状态不在 `from` 中返回 409 `state.invalidTransition`，否则写入 `to`、记审计、写 outbox 事件。
- 每个命令都需要 `Idempotency-Key`，重试回放第一次的结果。
- 列表与详情页按当前状态显示对应按钮（`when status == "draft"` / `when status in "draft", "submitted"`）。
- `status` 只能由 transition 改变：新建从 `initial` 开始，编辑表单、通用 PATCH、CSV 导入都不能改它；手写 dataflow 写这个字段会在解析期报错。

完整规则见 [DSL：statemachine](/dsl/statemachine)。

## dataflow

状态机只改状态。一次命令要写多个字段、创建子记录、调用外部 adapter 时，用 `dataflow`：input、按主键 context 加载、`require`、同事务 `create`/`update`/`delete`/`emit`/`call`、审计、幂等回执和 `result`，批量执行再加 `/batch`。`emit` 只写事务性 outbox，不直接调用消息 broker。

```qiy
dataflow recordShipment @label("登记物流") {
  allow roles admin, operator;
  idempotency required;
  audit "order.shipmentRecorded";
  input {
    field orderId UUID @required;
    field trackingNumber Text @required;
  }
  context { order = entity orders by id input.orderId @required; }
  step guard {
    require order.status == "shipped" @error("errors.order.notShipped");
  }
  step record {
    update order { trackingNumber = input.trackingNumber; }
    emit "order.shipmentRecorded" { orderId = order.id; }
  }
  result { return order; }
}

action recordShipment {
  resource orders;
  dataflow recordShipment;
  placement show;
  when status == "shipped";
}
```

详见 [DSL：dataflow](/dsl/dataflow) 与 [DSL：action](/dsl/actions)。

## 与权限的关系

| 规则 | 说明 |
| --- | --- |
| 角色 | transition 与 dataflow 的 `allow roles` / `allow permission` / `allow verification`；省略时所有 `full`/`write` 角色可执行 |
| 数据范围 | 资源有 `scope` 时按 claim 过滤：缺少 claim → 403，范围外的记录 → 404 |
| `restrict` 行策略 | 命令暂不应用行策略，因此受 `restrict` 保护的资源不能被 statemachine 或 dataflow 使用（生成期报错） |
| 按钮可见性 | 只是界面规则；服务端以命令的 `allow`、守卫和 `require` 为准 |

## 当前限制

- transition 只改状态，不能附加写入步骤。状态变化同时需要跨表写入（例如库存扣减）时，拆成状态机 + 独立 dataflow，或在宿主代码中实现。
- 命令不应用 `restrict` 行策略（见上表）；进度见 [ROADMAP](https://github.com/AI-NoDev/qiy/blob/main/ROADMAP.md)。

## 相关

- [DSL：statemachine](/dsl/statemachine)：状态字段归属、生成结果与校验错误。
- [DSL：dataflow](/dsl/dataflow)：通用事务命令、幂等、事件、批量。
- [DSL：actions](/dsl/actions)：把命令挂到列表/详情按钮。
- [权限（permission）](/dsl/permissions)：`allow permission` / `allow verification`、`restrict`/`scope`。
- [迁移到 0.38](/guide/migration-0.38)：从 `workflow orderInventory` 迁移。
- 示例：[examples/erpadmin/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/erpadmin/app.qiy)。
