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
  |                    |
  +----> cancelled <---+
```

状态枚举的颜色、icon 与 label 来自模型声明，UI 不需要额外映射表。

只有 draft 和 submitted 可以取消；approved 必须继续出库，当前不生成审批撤销流程。提交时的库存预占、取消时的释放和出库时的扣减都在服务端事务内执行。

:::warning 当前限制

`orderInventory` 目前要求存在 `orders`、`orderItems`、`inventoryItems` 实体，且要求 PostgreSQL。它是一个真实业务压力测试切片，用来验证「模型到事务、API、UI」的完整链路，而不是任意业务流程 DSL。源码仓库可用 `bun tools/verify-postgres-erp.ts qiy-erp-pg` 在隔离数据库中执行迁移和实库验收；脚本会创建并最终删除临时数据库，不触碰 ERP 数据库。

实库验收覆盖并发幂等提交、审批角色、租户 claim 缺失与跨租户拒绝、后续商品库存不足时回滚已有预占、取消释放及重复取消拒绝，以及预占数据异常时出库失败保留原状态。测试注入身份，不等同于真实登录或浏览器操作验收。

:::

## dataflow（受限可执行）

Qiy 的 `dataflow` 已可生成受限服务端命令：input、按主键 context load、`require`、同事务 `create`/`update`/`delete`/`emit`、审计、幂等回执和 result 会生成到 `POST /api/v1/commands/<dataflow>`。`emit` 只写事务性 outbox，不直接调用消息 broker；详情和精确语法见 [dataflow](/dsl/dataflow)。`workflow orderInventory;` 仍是更完整的 ERP 事务压力测试切片。
