# 定义数据模型

模型是 Qiy 的核心。一个 `entity` 会同时生成数据库表、API 资源、表单、列表、详情页和测试。

## 一个最小实体

```ts
entity products table products @label("产品") @icon(AppstoreOutlined) {
  field id UUID @id;
  field title Text;
  field price Decimal(12, 2);
  index products_title_idx btree(title);
}
```

| 层 | 产物 |
| --- | --- |
| 数据库 | Drizzle 表、migration、索引 |
| API | `GET/POST /api/v1/products`、`GET/PUT/DELETE /api/v1/products/:id` |
| 前端 | 列表页、创建/编辑表单、详情页、菜单项 |
| 测试 | API 契约测试、前端交互测试 |

## 字段类型

| 类型 | 说明 |
| --- | --- |
| `UUID` | 主键与外键的默认选择 |
| `Text` | 字符串；配合枚举使用 |
| `Integer` | 整数 |
| `Decimal(p, s)` / `Money(p, s)` | 定点小数，`precision > 0`，`0 <= scale <= precision` |
| `DateTime` | 时间戳 |
| `File` | 受保护的文件字段，生成上传/下载端点 |
| `Vector(n)` | 向量，必须声明 `@extension(pgvector)` |
| 枚举名 | 引用已声明的 `enum` |

## 字段属性

```ts
field email Text @unique @label("邮箱");
field externalSubject Text @unique @listVisible(false) @showVisible(false);
field role userRole @label("角色") @filterable(true);
field embedding Vector(1536) @nullable @extension(pgvector);
field legacyCode Text @column("legacy_code");
```

`@visible`、`@listVisible`、`@formVisible`、`@showVisible` 控制字段可见性，`@sortable` / `@filterable` 控制列表交互。

## 索引与关系

```ts
index products_title_idx btree(title);
index users_email_idx btree(email) @unique;
index inventory_warehouse_product_idx btree(warehouseId, productId) @unique;
index products_embedding_hnsw hnsw(embedding vector_cosine_ops);

relation orderCustomer orders customerId customers id one;
relation orderItemOrder orderItems orderId orders id one @onDelete(cascade);
relation inventoryProduct inventoryItems productId products id one @onDelete(restrict);
```

支持 `btree`、`hnsw`、`ivfflat`。向量索引只在 PostgreSQL + pgvector 下生成，其他方言会在生成前报错。关系会生成 Drizzle relations、外键约束、关联选择器和详情页关联列表；`@onDelete` 支持 `restrict`、`cascade`、`setNull`。

## 数据库与校验

```ts
database postgresql {
  extension pgvector;
}
```

支持 `postgresql`、`sqlite`、`mysql`。Vector 必须有 pgvector 扩展且 dimension 大于 0；Decimal / Money 的 precision 大于 0，scale 必须在 0 到 precision 之间。无效模型会在解析/类型检查阶段报错，不会静默生成错误 schema。

下一步：[API 与数据源](/guide/api)、[认证与权限](/guide/auth)。
