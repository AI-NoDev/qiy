# 业务工作流

V0 以数据与配置为中心；复杂业务联动属于 V1，通过显式声明的工作流或 `dataflow` 生成事务代码，而不是让用户手写重复逻辑。

目前有两条路：

| 方式 | 用途 | 通用性 |
| --- | --- | --- |
| `dataflow` + `action` | **推荐**：你自己声明输入、加载、校验、写入、事件 | 通用（任何实体、任何状态） |
| `workflow orderInventory;` | 内置的 ERP 订单/库存压力测试切片 | 固定实体、固定动作，仅 PostgreSQL |

`dataflow` 的完整语法见 [DSL：dataflow](/dsl/dataflow)，按钮绑定见 [DSL：actions](/dsl/actions)。

## 声明

```qiy
application qiy-erp-admin {
  database postgresql {}
  workflow orderInventory;
}
```

- `workflow` 只接受 `orderInventory`，其它值报 `Unsupported workflow <name>`；重复声明报 `Duplicate workflow`。
- 声明位置在 `messages` / `permission` 之后、`enum` / `entity` 之前（见 [application](/dsl/application)）。
- `mode integration` 的模型不允许包含 `workflow`（也不允许其它生成式服务端功能）。

声明后，PostgreSQL 的 ERP 模型会生成：

- 订单提交、审批、出库、取消四个动作（REST 端点 + 详情页操作按钮）；
- 多仓库存预占与释放、事务边界与状态条件校验；
- 持久化幂等回执（`order_idempotency` 表）；
- 订单与库存的关联查询。

## 前置实体

`orderInventory` 要求模型里存在 `orders`、`orderItems`、`inventoryItems` 三个实体（字段契约由该切片固定），并且数据库方言为 **PostgreSQL**。它不是一个通用工作流 DSL：新增业务动作请用 `dataflow`。

## 状态机

```text
draft --submit--> submitted --approve--> approved --ship--> shipped
  |                    |
  +----> cancelled <---+
```

- 状态枚举的颜色、icon 与 label 来自模型声明，UI 不需要额外映射表。
- 只有 `draft` 和 `submitted` 可以取消；`approved` 必须继续出库，当前不生成「审批撤销」流程。
- 提交时的库存预占、取消时的释放、出库时的扣减都在服务端事务内执行。
- 幂等：同一订单/操作者/请求键回放首次结果；不同请求内容 409。

## 与权限的关系

| 规则 | 说明 |
| --- | --- |
| 角色 | 工作流动作沿用生成的角色守卫与账号角色 |
| 数据范围 | 有 `scope` 时按 claim 过滤；缺少 claim → 403 `Missing required data scope claim` |
| `restrict` 行策略 | **不支持**：声明 `restrict orders/orderItems/inventoryItems { when … }` 会报 `Restrict <resource>: orderInventory does not apply row policy yet` |
| 命令授权 | 工作流不是 dataflow，不参与 `allow permission`/`allow verification` |

需要「按权限控制审批」时，请把这部分业务改用 `dataflow`（`allow permission PurchaseApprovePermission;`）。

## 验收

```sh
bun tools/verify-postgres-erp.ts qiy-erp-pg
```

在隔离数据库中执行迁移并做真实数据库验收：并发幂等提交、审批角色、租户 claim 缺失与跨租户拒绝、后续商品库存不足时回滚已有预占、取消释放及重复取消拒绝、预占数据异常时出库失败保留原状态。脚本会创建并最终删除临时数据库，不触碰 ERP 数据库；测试注入身份，不等同于真实登录或浏览器操作验收。

:::warning 当前限制

`orderInventory` 是一个真实业务压力测试切片，用来验证「模型 → 事务 → API → UI」的完整链路，而不是任意业务流程 DSL。真实 IdP、浏览器端完整审批体验与多对多模型仍未完成；进度见 [V3 状态](https://github.com/AI-NoDev/qiy/blob/main/openwiki/v3-status.md)。

:::

## dataflow（推荐的通用方式）

`dataflow` 已可生成受限服务端命令：input、按主键 context 加载、`require`、同事务 `create`/`update`/`delete`/`emit`/`call`、审计、幂等回执和 `result`，统一生成到 `POST /api/v1/commands/<dataflow>`（批量再加 `/batch`）。`emit` 只写事务性 outbox，不直接调用消息 broker。

```qiy
dataflow approveOrder @label("审批订单") @confirm("确认审批？") {
  allow permission PurchaseApprovePermission;
  idempotency required;
  audit "order.approved";
  input { field orderId UUID @required; }
  context { order = entity orders by id input.orderId @required; }
  step guard {
    require order.status == "submitted" @error("errors.order.notSubmitted");
  }
  step approve {
    update order { status = "approved"; }
    emit "order.approved" { orderId = order.id; }
  }
  result { return order; }
}
```

详见 [DSL：dataflow](/dsl/dataflow) 与 [权限](/dsl/permissions#命令策略allow)。

## 相关

- [DSL：dataflow](/dsl/dataflow)：通用事务命令、幂等、事件、批量。
- [DSL：actions](/dsl/actions)：把命令挂到列表/详情按钮。
- [权限（permission）](/dsl/permissions)：`allow permission` / `allow verification`、`restrict`/`scope`。
- [application](/dsl/application)：`workflow` 的位置与相关块。
- 示例：[examples/erpadmin/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/erpadmin/app.qiy)。
