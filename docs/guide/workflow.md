# 业务工作流

V0 以数据与配置为中心；复杂业务联动属于 V1，通过显式声明的工作流生成事务代码，而不是让用户手写重复逻辑。

## 声明

```ts
application qiy-erp-admin {
  workflow orderInventory;
}
```

声明后，PostgreSQL 的 ERP 模型会生成订单提交、审批、出库、取消四个动作，以及多仓库存预占与释放、事务边界与状态条件校验、持久化幂等回执和前端详情页的对应操作按钮。

## 状态机

```text
draft --submit--> submitted --approve--> approved --ship--> shipped
  |                    |                      |
  +-------------------- cancel <---------------+
```

状态枚举的颜色、icon 与 label 来自模型声明，UI 不需要额外映射表。

:::warning 当前限制

`orderInventory` 目前要求存在 `orders`、`orderItems`、`inventoryItems` 实体，且要求 PostgreSQL。它是一个真实业务压力测试切片，用来验证「模型到事务、API、UI」的完整链路，而不是任意业务流程 DSL。

:::

## dataflow（受限可执行）

Qiy 的 `dataflow` 已可生成最小服务端命令：受限 input、按主键 context load、`require`、同事务 `update` 和 result 会生成到 `POST /api/v1/commands/<dataflow>`。它还没有生成确认弹窗、权限注解、审计、事件、幂等或任意查询；详情和精确语法见 [dataflow](/dsl/dataflow)。`workflow orderInventory;` 仍是更完整的 ERP 事务压力测试切片。
