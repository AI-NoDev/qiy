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
| `@column` | `@column("physical_name")` |
| `@extension` | `@extension(pgvector)` |
| `@dimension` / `@precision` / `@scale` | 整数 |

## 校验规则

- Vector 必须 `@extension(pgvector)` 且 `dimension > 0`；
- Decimal / Money 必须 `precision > 0` 且 `0 <= scale <= precision`；
- 枚举名必须已通过 `enum` 声明；
- 未实现的类型或属性会直接报错，不做静默降级。
