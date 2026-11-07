# DB view

`view` 声明一个只读数据库视图，投影现有实体的列。

```qiy
entity products {
  field id UUID @id;
  field name Text;
  field price Integer;
}

view product_names from products {
  columns id, name;
}
```

## 语法

```text
view <Name> from <Entity> {
  columns <field>, <field>, ...;
}
```

- `Name` 必须是合法标识符，不能与实体名/表名冲突；
- `Entity` 可以是实体名或表名；
- `columns` 至少一个，只能是源实体的真实列；
- 可以选择 `@computed` 字段（它们是数据库生成列）；
- 列不能重复；
- 视图本身只读。

## 生成结果

PostgreSQL 生成：

```ts
export const product_names = pgView("product_names").as((qb) =>
  qb.select({ id: products.id, name: products.name }).from(products)
);
```

SQLite / MySQL 分别使用 `sqliteView` / `mysqlView`；视图定义放在实体表之后，避免模块初始化顺序问题。

同时生成只读 REST：

- `GET /api/v1/<view>?page=1&pageSize=20`；
- 若视图包含 `id` 列，`GET /api/v1/<view>/:id`；
- GraphQL：`<view>(page, pageSize)` 与 `<view>ById(id)`（含 id 时）；
- Web：生成只读资源与侧边栏入口，列表可导出、查看列；包含 `id` 时可进入只读详情。不显示新建/编辑/删除/导入。

## 权限继承

视图的 REST 与 GraphQL 读路径继承源实体的行级规则：

| 源实体规则 | 视图读路径的效果 |
| --- | --- |
| `@softDelete` | 已软删除的源行不出现在视图列表/详情/计数里 |
| `scope` / `@tenant` | 按调用者 claim 过滤；claim 缺失 → 403 `Missing required data scope claim` |
| `restrict ... when` | 与源实体相同的行条件；缺 claim 按 `policy.missingClaim` 403 |
| `restrict ... mask` | 对视图中同名列执行相同的 `omit` / `null` / `redact` |

实现方式：视图只是单个实体的列投影，所以生成的 `views-routes.ts` 中 `viewReaders.<view>` 直接从源表选出视图的列，把源实体规则作为 `WHERE` 条件（可以用上源表的索引），按主键排序分页，再执行 mask；REST 与 GraphQL resolver 共用它。规则依赖的列不必出现在视图里，因此视图不要求选择 `id`；只有选择了 `id` 才生成详情接口。源实体没有这些规则时，视图只要求已认证（声明了 `auth` 时）。生成的 SQLite 应用带 `tests/sqlite-views.test.ts`，用一条可见、一条被规则隐藏的源行验证列表、计数和详情。

## 边界

- 当前 `view` 生成 **Drizzle schema + 只读 REST/GraphQL + Web 列表/详情**，不生成表单与变更端点。
- 需要 API 时，用生成器插件或在集成项目里挂载只读适配器；不要把它当成可变实体。
- SQLite / PostgreSQL / MySQL 均已实库验证：`drizzle-kit generate` 生成 view 迁移，`db:migrate` 后可查询；schema drift 检查会忽略 view，不会报告 `unexpected table`。
- 视图列没有字段注解或表单语义；行级规则来自源实体（见上），直接用 SQL 访问数据库视图时不经过这些规则。

## 校验

```bash
qiy check
qiy generate
```

`qiy check` 会校验 view 的源实体与列；`qiy generate` 输出 Drizzle view。
