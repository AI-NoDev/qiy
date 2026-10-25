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
{$.fieldName}                 标量字段插值：UUID、Text、枚举、Integer、Decimal、Money、Date、Time、DateTime
<b> {$.name} </b></br>{$.code} 白名单 HTML 标签 + Django 风格换行
```

- 占位符只能引用本实体已声明的标量字段；未知字段、`File` / `Files` / `Vector`、以及外键列（如 `{$.customerId}`）都会在生成前报错。外键由生成的关联单元格负责显示目标记录文本，而不是原始 id。
- 枚举字段渲染为当前语言的枚举值 label；Decimal / Money 按本地化数字格式输出。
- Date / Time / DateTime 占位符使用与列表/详情页相同的本地化格式化函数（`Intl.DateTimeFormat`，跟随当前界面语言）；无法解析的存量文本回退显示原字符串，不会丢数据。
- 允许的标签：`br`、`b`、`strong`、`i`、`em`、`span`、`small`、`p`、`div`；不支持属性、事件处理器、`script`、其他标签、大小写混写或非 `br` 的自闭合写法。`<br>`、`<br/>`、`</br>` 都规范化为一个换行。
- 模板按标签配对校验；未闭合或错配、悬空的 `<` / `>`、`{name}` 这类非法占位符都会给出带实体和注解名的错误信息。
- 模板里的文本与占位符值都会 HTML 转义；模板本身的语言中性（字段引用和分隔符），不参与 i18n；单数/复数名通过 `qiy.resources.<resource>.singular` / `.plural` 翻译键切换语言。

生成后的列表页/详情页/关联表里，每个外键列显示目标实体的 `@tableDisplay` 文本并链接到该记录；点击打开 Drawer，正文与目标记录的详情页一致（`RecordDetails`：全部 `showVisible` 字段、枚举 Tag、外键继续链接、日期本地化、文件下载链接、空值占位），`@relationDetail` 摘要保留在字段详情上方，头部面包屑是「目标资源列表 → 当前记录详情页」，并有“打开详情”入口。列表页的外键值会按目标资源批量加载（`getMany` + `useMany`，`id in (...)` 过滤），详情页/抽屉正文/外键下拉仍按单条记录 `useOne` 加载。创建/编辑表单的外键下拉同样使用目标实体的显示文本，详见 [relation 与 index](/dsl/relation-index#外键批量查询getmany--usemany)。

## 类型

| 写法 | IR 类型 | 备注 |
| --- | --- | --- |
| `UUID` | UUID | 主键、外键 |
| `Text` | Text | 字符串 |
| `Integer` | Integer | 整数 |
| `Decimal(p, s)` | Decimal | 精度与小数位 |
| `Money(p, s)` | Money | 业务金额 |
| `Date` | Date | 日期，存储/传输 `YYYY-MM-DD` |
| `Time` | Time | 时间，存储/传输 `HH:mm:ss` |
| `DateTime` | DateTime | 时间戳（ISO date-time） |
| `File` | File | 受保护文件 |
| `Vector(n)` | Vector | 需要 pgvector |
| 枚举名 | Text + enumName | 引用已声明的 enum |

## 日期与时间（Date / Time / DateTime）

三种时间类型服务于不同粒度，存储与传输契约保持一致，跨 sqlite / PostgreSQL / MySQL 相同：

| 类型 | 存储 | REST / GraphQL / CSV 值 | 表单控件 | 列表 / 详情显示 |
| --- | --- | --- | --- | --- |
| `Date` | PostgreSQL `date`、MySQL `date`、SQLite `text` | `YYYY-MM-DD` | Ant Design `DatePicker`（`YYYY-MM-DD`） | 本地化日期 |
| `Time` | PostgreSQL `time`、MySQL `time`、SQLite `text` | `HH:mm[:ss]`，服务端存 `HH:mm:ss` | `TimePicker`（`HH:mm:ss`） | 本地化时间 |
| `DateTime` | 时间戳（`timestamp` / `datetime` / `timestamp_ms`） | ISO date-time，例如 `2026-11-30T08:30:00.000Z` | `DatePicker showTime`（`YYYY-MM-DD HH:mm:ss`） | 本地化日期+时间 |

- 生成表单按类型渲染正确 picker：日期只选日期、时间只选时间、日期时间带时间面板；编辑表单会把存库字符串转回 dayjs，提交时再转回上面的字符串契约（`app/date-fields.ts` 的 `toFormValue` / `toPayloadValue`）。
- 服务端对 `Date` / `Time` 做显式校验：非法值（如 `2026-02-31`、`25:61:00`）返回 **400** 并指出字段名；`HH:mm` 会被规范化为 `HH:mm:ss`。TypeBox 的 `date` format 过于宽松且没有本地时间 format，因此不使用它做最终校验。
- 列表、详情页、外键抽屉与显示模板统一通过 `formatFieldValue` 使用 `Intl.DateTimeFormat` 按当前语言格式化；无法解析的历史值回退为原字符串。
- 对 `Date` / `Time` / `DateTime` 的高级筛选在 operator 为 `eq/gt/gte/lt/lte` 时渲染对应的 picker；`in` / `between` 仍使用逗号分隔文本。
- 排序按字符串比较（零填充的 ISO 形状天然有序）；`Date` / `Time` **不会**参与 dashboard trend 指标，trend 的 `groupBy` 仍必须是 `DateTime`；CSV 导入按同样契约校验并返回行错误。
- 在 `.qiy` 测试场景（`given` fixture）中，`Date` / `Time` 值使用字符串字面量，并会按契约校验。

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

REST DataProvider 同时保留 Refine 的嵌套 `and`/`or` 条件组；服务端会递归验证每个叶子、限制深度为 8 层及总叶子数为 50，再映射为 Drizzle 条件。GraphQL 仍使用平铺 `QiyFilterInput`（顶层 AND），因为 GraphQL 不允许递归 input 定义。列表的保存视图已实现：浏览器本地视图 + 生成的服务端 `/api/v1/saved-views` 视图（同名发布 upsert、`mine` 所有权标记、本人/admin 删除规则），详见 [API：保存视图](../guide/api.md#保存视图服务端)。

## 与权限的关系

字段本身不声明权限。若要让 `users` 表额外承载权限（`permission from database field users.permissions;`），声明一个 `Text @nullable` 字段存放 JSON 字符串数组即可；角色组的解析仍是主路径，该列只做加法。完整语法见 [权限（permission）](/dsl/permissions#provider-来源)。
