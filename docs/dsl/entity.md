# entity 与 field

```ts
entity products table products @label("产品") @icon(AppstoreOutlined) {
  field id UUID @id;
  field title Text;
  field price Decimal(12, 2);
  field embedding Vector(1536) @nullable @extension(pgvector);
}
```

`entity` 名称默认作为资源名，`table` 可指定物理表名；`@label` 与 `@icon` 控制菜单与页面显示。

## 类型

| 写法 | IR 类型 | 备注 |
| --- | --- | --- |
| `UUID` | UUID | 主键、外键 |
| `Text` | Text | 字符串 |
| `Integer` | Integer | 整数 |
| `Decimal(p, s)` | Decimal | 精度与小数位 |
| `Money(p, s)` | Money | 业务金额 |
| `DateTime` | DateTime | 时间戳 |
| `File` | File | 受保护文件 |
| `Vector(n)` | Vector | 需要 pgvector |
| 枚举名 | Text + enumName | 引用已声明的 enum |

## 字段属性

| 属性 | 形态 |
| --- | --- |
| `@id` | `@id;` 或 `@id(false);` |
| `@nullable` | `@nullable;` / `@nullable(true);` |
| `@unique` | `@unique;` / `@unique(false);` |
| `@label` | `@label("中文名")` |
| `@icon` | `@icon(AppstoreOutlined)` |
| `@visible` / `@listVisible` / `@formVisible` / `@showVisible` | 布尔值 |
| `@sortable` / `@filterable` | 布尔值 |
| `@filter` | `@filter(contains,startsWith,eq)`；同时启用字段过滤并限制可选 operator |
| `@column` | `@column("physical_name")` |
| `@extension` | `@extension(pgvector)` |
| `@dimension` / `@precision` / `@scale` | 整数 |

## 校验规则

- Vector 必须 `@extension(pgvector)` 且 `dimension > 0`；
- Decimal / Money 必须 `precision > 0` 且 `0 <= scale <= precision`；
- 枚举名必须已通过 `enum` 声明；
- 未实现的类型或属性会直接报错，不做静默降级。

## 列表过滤器

`@filter(...)` 控制生成列表页、Refine DataProvider、REST/GraphQL 契约和 Drizzle 查询允许使用的 operator。列表页会为字段生成 operator 选择器，多个字段条件按 AND 组合；`between` 和 `in` 的输入使用逗号分隔。

```qiy [modules/catalog.qiy]
entity products {
  field id UUID @id;
  field name Text @filter(contains,startsWith,endsWith,eq);
  field amount Integer @filter(eq,gte,lte,between,in);
  field createdAt DateTime @filter(gte,lte,between);
}
```

当前 operator：`eq`、`contains`、`startsWith`、`endsWith`、`gt`、`gte`、`lt`、`lte`、`between`、`in`。REST 继续兼容旧的等值对象过滤参数；高级条件使用 clause 数组。GraphQL 使用 `QiyFilterInput`，未提供 operator 时默认为 `eq`。服务端会按字段声明重复校验，不接受前端自行构造的未授权字段或 operator。

当前多个条件只支持顶层 AND；嵌套 AND/OR 条件树和保存的用户筛选视图仍在 V3 待办中。
