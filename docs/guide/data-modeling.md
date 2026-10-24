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
| `Date` | 日期，存储/API 契约 `YYYY-MM-DD`；表单渲染日期 picker |
| `Time` | 时间，存储/API 契约 `HH:mm:ss`；表单渲染时间 picker |
| `DateTime` | 时间戳（ISO date-time）；表单渲染带时间的日期 picker |
| `File` | 受保护的文件字段，生成上传/下载端点 |
| `Vector(n)` | 向量，必须声明 `@extension(pgvector)` |
| 枚举名 | 引用已声明的 `enum` |

日期/时间三种类型共用一套字符串契约与显示格式化：生成表单按 `Date` / `Time` / `DateTime` 分别渲染 `DatePicker`、`TimePicker`、`DatePicker showTime`，编辑时把字符串转回 dayjs、提交时转回契约字符串；列表/详情/显示模板用当前语言本地化输出；服务端对非法日期/时间返回带字段名的 400。完整规则见 [entity 与 field：日期与时间](/dsl/entity#日期与时间date--time--datetime)。

## 字段属性

```ts
field email Text @unique @label("邮箱");
field externalSubject Text @unique @listVisible(false) @showVisible(false);
field role userRole @label("角色") @filterable(true);
field embedding Vector(1536) @nullable @extension(pgvector);
field legacyCode Text @column("legacy_code");
```

`@visible`、`@listVisible`、`@formVisible`、`@showVisible` 控制字段可见性，`@sortable` / `@filterable` 控制列表交互。

## 业务编码与自动生成值

UUID 与业务单据号不应该由用户手工填写。给字段声明生成规则后，服务端在创建时渲染值，新建表单不显示该字段，编辑表单以只读方式显示，列表/详情页正常展示：

```qiy
entity orgs {
  field id UUID @id;
  field code Text @unique @code("ORG-{YYYY}{MM}-{seq:4}");
  field name Text;
  field parentId UUID @nullable;   // 自关联：见下方 relation
  field externalId UUID @nullable @generated(uuid);
}

relation orgParent orgs parentId orgs id one @onDelete(setNull);
```

- `@code("...")` 支持日期/时间 token（`{YYYY}`、`{YYYYMMDD}`、`{HHmmss}` 等）、`{seq}` / `{seq:4}`、`{count+1}` 别名、`{random:10}` 与 `{uuid}`；
- 含日期 token 时序号按天/月/秒等日期桶重置，`PO-{YYYYMMDD}-{seq:4}` 每天从 `0001` 开始；
- 日期 token 使用 `QIY_CODE_TIMEZONE`（缺省 `UTC`）；
- 创建时客户端传入的生成字段会被忽略，唯一约束冲突会重试并在耗尽后返回 409；
- **没有 relation 的 UUID 字段会被当作系统生成值**：真实外键必须声明 relation，否则不会渲染成关联下拉；自关联（`orgs.parentId -> orgs.id`）在三种方言都会生成带显式 `Any*Column` 回调的 Drizzle 引用。

完整语法、模板表、运行时时序与种子数据说明见 [自动生成值与业务编码](/dsl/generated-values)。

## 实体显示文本与外键列

外键列默认会显示目标记录的显示文本，而不是 UUID。为每个实体声明 Django 风格的显示注解即可控制这段文本：

```qiy
entity products @singular("Product") @plural("Products")
  @display("{$.sku} · {$.name}")
  @tableDisplay("{$.sku} · {$.name}")
  @relationDetail("<b>{$.name}</b></br>{$.sku}") {
  field id UUID @id;
  field sku Text @unique;
  field name Text;
}
```

- `@singular` / `@plural` 用于新建/编辑/详情标题与菜单、列表标题；
- `@display` 用于记录本身的默认显示文本（下拉选项、关联表兜底）；
- `@tableDisplay` 用于本实体作为其他表外键列时的文本；
- `@relationDetail` 用于点击外键链接后 Drawer 的正文。

模板语法只有 `{$.field}` 占位符与 `br`、`b`、`strong`、`i`、`em`、`span`、`small`、`p`、`div` 白名单标签；所有插值都会被转义，未知字段、外键字段、`File` / `Vector` 字段、非法标签都会在生成前报错。详情见 [entity 与 field](/dsl/entity#实体显示注解-django-风格)。单数/复数名可用 `qiy.resources.<resource>.singular` / `.plural` 翻译键做多语言。

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

## 用户表的权限列（可选）

权限 provider 可以把 `users` 表的一列作为额外权限来源。契约是：auth 用户实体上一个 `Text @nullable` 字段，内容为 JSON 字符串数组（也接受逗号/空格分隔文本），每项是权限值或权限组名；未知值忽略，行缺失或解析失败只影响该来源。

```qiy
entity users {
  field id UUID @id;
  field email Text @unique;
  field role userRole;
  field permissions Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
}

permission from database field users.permissions;
```

该列与角色组（`permission group admin/operator/viewer`）以及已验证 OAuth claims 取并集，只做加法；不需要额外权限时可以完全不声明，生成结果与旧版本一致。完整语法见 [DSL：权限](/dsl/permissions#provider-来源)。

下一步：[API 与数据源](/guide/api)、[认证与权限](/guide/auth)。
