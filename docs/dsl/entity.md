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

## 实体显示注解（Django 风格）

每个实体都可以声明自己的显示文本，生成器用它替代裸 UUID / 单字段渲染：

```qiy
entity customers @label("Customers") @singular("Customer") @plural("Customers")
  @display("{$.code} · {$.name}")
  @tableDisplay("{$.code} · {$.name}")
  @relationDetail("<b>{$.name}</b></br>{$.code}") {
  field id UUID @id;
  field code Text @unique;
  field name Text;
}

relation salesOrderCustomer sales_orders customerId customers id one;
```

| 注解 | 作用 | 缺省回退 |
| --- | --- | --- |
| `@label("...")` | 资源名（既有行为） | 实体名 |
| `@singular("...")` | 单数名：新建/编辑标题、详情页标题、抽屉标题、按钮 | `@label` / 实体名 |
| `@plural("...")` | 复数名：菜单、列表页标题、面包屑 | `@label` / 实体名 |
| `@display("...")` | 记录默认显示文本：关联下拉选项、抽屉兜底标题、关联表 | 第一个 `name` / `title` / `displayName` / `code` / `number` / `sku` / `email` 等可读字段 |
| `@tableDisplay("...")` | 本实体作为其他表外键列时的文本 | `@display` |
| `@relationDetail("...")` | 外键抽屉正文（HTML 允许白名单标签） | `@display` |

所有注解都支持 `@comment(...)` 之外的普通带引号字符串；序列化会原样往返。注解是可选的，没有注解的模型行为与旧版本一致。

## 显示模板语法

模板只支持三类内容：普通文本、`{$.field}` 占位符、白名单标签。生成时校验、渲染时再次白名单过滤并转义所有插值，因此不会产生 XSS。

```text
{$.fieldName}                 标量字段插值：UUID、Text、枚举、Integer、Decimal、Money、DateTime
<b> {$.name} </b></br>{$.code} 白名单 HTML 标签 + Django 风格换行
```

- 占位符只能引用本实体已声明的标量字段；未知字段、`File` / `Files` / `Vector`、以及外键列（如 `{$.customerId}`）都会在生成前报错。外键由生成的关联单元格负责显示目标记录文本，而不是原始 id。
- 枚举字段渲染为当前语言的枚举值 label；Decimal / Money 按本地化数字格式输出。
- 允许的标签：`br`、`b`、`strong`、`i`、`em`、`span`、`small`、`p`、`div`；不支持属性、事件处理器、`script`、其他标签、大小写混写或非 `br` 的自闭合写法。`<br>`、`<br/>`、`</br>` 都规范化为一个换行。
- 模板按标签配对校验；未闭合或错配、悬空的 `<` / `>`、`{name}` 这类非法占位符都会给出带实体和注解名的错误信息。
- 模板里的文本与占位符值都会 HTML 转义；模板本身的语言中性（字段引用和分隔符），不参与 i18n；单数/复数名通过 `qiy.resources.<resource>.singular` / `.plural` 翻译键切换语言。

生成后的列表页/详情页/关联表里，每个外键列显示目标实体的 `@tableDisplay` 文本并链接到该记录；点击打开 Drawer，正文是目标实体的 `@relationDetail`（无模板时回退到可见字段的 Description 列表），并有“打开详情”按钮跳转详情页。创建/编辑表单的外键下拉同样使用目标实体的显示文本。

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
| `@upload` | 仅用于 `File` / `Files`：`@upload(binary)`、`@upload(base64)` 或 `@upload(both)` |
| `@maxBytes` | 仅用于 `File` / `Files`：1 到 104857600，默认 26214400（**每个文件**的上限） |
| `@mime` | 仅用于 `File` / `Files`：`@mime("application/pdf","image/*")`，可重复声明并合并 |
| `@maxFiles` | `File` 只接受 `@maxFiles(1)`；`Files` 接受 1 到 20，默认 6 |
| `@column` | `@column("physical_name")` |
| `@extension` | `@extension(pgvector)` |
| `@dimension` / `@precision` / `@scale` | 整数 |

## 校验规则

- Vector 必须 `@extension(pgvector)` 且 `dimension > 0`；
- Decimal / Money 必须 `precision > 0` 且 `0 <= scale <= precision`；
- 枚举名必须已通过 `enum` 声明；
- 上传策略只能用于 `File` / `Files`；未知模式、非法或重复 MIME、越界大小会在生成前报错；`File` 的 `maxFiles` 只能为 1，多文件必须用 `Files`；
- `Files` 存的是 key 数组，不能作为主键或唯一字段，且默认不可排序、不可过滤；
- 未实现的类型或属性会直接报错，不做静默降级。

## 单文件与多文件

- `File` 保存**一个** storage key（字符串），适合单张图片、单个合同等。
- `Files` 保存**一组** key（`@maxFiles` 上限内），适合附件列表、图集等：

```qiy
entity documents {
  field id UUID @id;
  field contract File @nullable @upload(binary) @mime("application/pdf") @maxFiles(1);
  field attachments Files @nullable @upload(base64) @mime("application/pdf","image/*") @maxFiles(5);
}
```

两者共用同一套上传路由与策略校验：每次上传仍然是一个文件一个对象，前端把返回的 key 收集成数组写入 `Files` 字段；服务端按 `maxFiles` 拒绝超长数组（422），并逐项校验 key 形态。

完整上传、认证、Attachment 元数据与 S3 说明见[文件存储](../guide/storage)。

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

REST DataProvider 同时保留 Refine 的嵌套 `and`/`or` 条件组；服务端会递归验证每个叶子、限制深度为 8 层及总叶子数为 50，再映射为 Drizzle 条件。GraphQL 仍使用平铺 `QiyFilterInput`（顶层 AND），因为 GraphQL 不允许递归 input 定义。保存的用户筛选视图仍在 V3 待办中。
