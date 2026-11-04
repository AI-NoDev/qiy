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
- 不能选择 `@computed` 字段；
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

应用声明了 `auth` 时这些端点要求已认证；没有按实体 policy 做行级过滤。

## 边界

- 当前 `view` 生成 **Drizzle schema + 只读 REST/GraphQL + Web 列表/详情**，不生成表单与变更端点。
- 需要 API 时，用生成器插件或在集成项目里挂载只读适配器；不要把它当成可变实体。
- SQLite / PostgreSQL / MySQL 均已实库验证：`drizzle-kit generate` 生成 view 迁移，`db:migrate` 后可查询；schema drift 检查会忽略 view，不再报告 `unexpected table`。
- 视图列没有字段注解、权限或表单语义；权限仍应通过底层实体或数据库账号控制。

## 校验

```bash
qiy check
qiy generate
```

`qiy check` 会校验 view 的源实体、列和 computed 限制；`qiy generate` 输出 Drizzle view。
