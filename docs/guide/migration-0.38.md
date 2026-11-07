# 迁移到 0.38

0.38.0 继续"同一件事只保留一种写法"：内置的 ERP 订单切片 `workflow orderInventory;` 删除，改用通用的 [statemachine](/dsl/statemachine)。被删除的写法在解析时报错，并在错误信息里指向本页。

| 变化 | 改用 | 影响 |
| --- | --- | --- |
| `workflow orderInventory;` | `statemachine` | 模型需改写；重新生成 + 迁移 |
| 生成的 `createApp(repositories, authenticate, includeWorkflows, includeStorage, …)` | 去掉第三个参数 | 只影响手写代码里直接调用 `createApp` 的地方 |
| Dataflow `allow roles` 写了 `read` 级别角色 | 去掉该角色 | 解析期报错 |
| `@computed` 只在 API 响应里计算 | 数据库生成列 | 模型不变；重新生成 + 迁移 |

升级步骤：

1. 按下面各节改写模型，运行 `qiy check` 直到没有错误。
2. 重新生成：`qiy generate app.qiy <输出目录> --sync`。被删除的工作流文件会随 `--sync` 一并删除。
3. 生成并审阅迁移（见下文"数据库"一节），再运行 `bun run db:migrate`（生产环境在 `apps/server` 下运行 `bun run db:migrate:production`）。

## workflow orderInventory

声明 `workflow` 会报：

```text
workflow orderInventory was removed in Qiy 0.38.0; declare a statemachine for the status field instead (for example statemachine orderLifecycle { resource orders; field status; initial draft; transition submit { from draft; to submitted; } }); see docs/guide/migration-0.38.md.
```

删除 `workflow orderInventory;`，在 `chart` 之后声明状态机。与 0.37 生成的四个动作等价的写法：

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

| 0.37 `orderInventory` | 0.38 `statemachine` |
| --- | --- |
| `POST /api/v1/orders/:id/submit`（approve/ship/cancel 同理） | `POST /api/v1/commands/orderLifecycleSubmit`，body `{ "recordId": "<id>" }`；GraphQL `runOrderLifecycleSubmit` |
| 只有提交需要 `Idempotency-Key`，回执存在 `order_idempotency` | 每个 transition 都需要 `Idempotency-Key`，回执存在通用的 `dataflow_idempotency` |
| 审计动作 `order.submitted` / `order.approved` / … | `orders.submit` / `orders.approve` / …（`<表名>.<transition>`），并写 outbox 事件 |
| 详情页 `OrderWorkflowActions` 组件 | 列表和详情页的通用 action 按钮，按状态显示 |
| 仅 PostgreSQL，实体与字段名固定 | 任意方言、任意实体的非空 enum 字段 |
| 审批时写 `approvedBy` | 不再自动写；需要时用 `audit_events` 的 `actorId`，或另写一个 dataflow |
| 提交时预占库存、出库时扣减、取消时释放（`order_reservations`） | **不再生成**，见下文 |

`status` 字段从此只能由 transition 改变：通用的新建/编辑接口、CSV 导入和表单都不再接受它，新订单固定从 `initial` 状态开始。

### 库存预占

`orderInventory` 的库存逻辑是为 ERP 示例写死的，无法用模型表达，因此随切片一起删除。需要库存联动时：

- 只需"出库时扣减"这类单行写入：声明一个 `dataflow`，用 `require` 校验库存行、`update` 写入数量，并用 action 的 `when status == "approved"` 控制按钮时机。
- 需要跨多行分配（多仓预占）：在宿主代码里实现，或通过 dataflow 的 `call` adapter 调用你自己的服务。transition 本身只改状态，不附加步骤。

## 数据库

重新生成后，`order_reservations` 和 `order_idempotency` 不再出现在 schema 中。运行 `bun run db:generate` 生成的迁移会删除这两张表：

- 如果需要保留历史预占或幂等回执，先导出数据再迁移。
- `orders.status` 增加了数据库默认值（`initial` 状态）。
- 已有订单的状态值不受影响；处于任何状态的订单都可以继续按新 transition 流转。

## createApp 参数

生成的 `apps/server/src/app.ts` 中 `createApp` 去掉了 `includeWorkflows` 参数：

```ts
// 0.37
await createApp(repositories, authenticate, false, false);
// 0.38
await createApp(repositories, authenticate, false);
```

生成的测试已同步更新；只有手写测试或脚本直接调用 `createApp` 并传了位置参数时需要修改。

## Web 命令传输

生成的 DataProvider 中，`custom({ method: "post" })` 只接受模型中声明的命令 URL（`/api/v1/commands/<name>` 及其 `/batch`），其他 URL 抛出 `Unknown command`（0.37 为 `Unknown workflow command`）。如果手写代码匹配了旧的错误文案，请一并修改。

## 计算字段

`@computed` 字段从响应时的内存计算改为数据库生成列（PostgreSQL 为 STORED，MySQL/SQLite 为 VIRTUAL）。模型无需修改；重新生成后运行 `bun run db:generate`，迁移会为每个计算字段 `ADD` 一列，已有行由数据库自动算出。

- 计算字段现在可以排序、筛选、建索引，也可以被 view 选择。
- Decimal/Money 结果按字段声明的 scale 四舍五入，并像其他 Decimal 字段一样以字符串返回（PostgreSQL/MySQL）；0.37 返回的是未舍入的数字。
- 数值表达式一律按小数相除；整数结果仍向零取整，引用为 null 或除数为 0 时仍为 null。
- 逻辑备份 `db:restore` 不写入生成列，由数据库重新计算。

## Dataflow 角色

Dataflow 的 `allow roles` 现在会在解析期检查角色的访问级别，`read` 级别的角色（默认模型里的 `viewer`）报 `Dataflow <name>: role viewer has read access and cannot run commands`。删除该角色即可；只读角色本来就无法执行命令。
