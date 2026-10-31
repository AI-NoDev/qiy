# entity 与 field

`entity` 是 Qiy 模型的核心构件：一个实体生成一套数据库表 + Drizzle schema + REST/GraphQL 资源 + Refine 列表/新建/编辑/详情页面。字段决定列、表单控件、筛选、排序、显示模板和 i18n 标签。

```qiy
entity products table products @label("产品") @icon(AppstoreOutlined) {
  field id UUID @id;
  field code Text @unique @code("PRD-{YYYYMM}-{seq:4}");
  field title Text @label("名称") @filter(contains, startsWith, eq);
  field price Decimal(12, 2) @nullable;
  field status productStatus @label("状态");
  field embedding Vector(1536) @nullable @extension(pgvector);

  index products_code_uq btree(code) @unique;
}
```

## 语法

```text
entity <Name> [table <tableName>] [@annotation(...)]... {
  field <name> <Type>[(<params>)] [@attribute[(<value>)]...] ;
  index <name> <method>(<field> [<opclass>], ...) [@unique] [@concurrently] [@comment(...)] ;
}
```

| 语法槽 | 说明 | 默认 |
| --- | --- | --- |
| `<Name>` | 实体名（API/GraphQL 名称、关系端点、权限资源名） | 必填 |
| `table <tableName>` | 物理表名与 Web 路由名（`/<tableName>`） | 与 `<Name>` 相同 |
| 实体注解 | 见[实体注解矩阵](#实体注解矩阵) | 全部可选 |
| 块内容 | 只允许 `field` 与 `index`；其他 token 报 `Expected field or index` | 至少一个字段 |
| 分号 | 每个 `field` / `index` 必须以 `;` 结尾；块本身不加 `;` | — |

- 实体名必须是标识符（`[a-zA-Z_][a-zA-Z_0-9-]*`），且不能是 JavaScript 保留字（`class`、`enum`、`default` …），否则 `validateDatabaseIR` 报 `Entity X: invalid name or tableName`。
- 实体名与表名各自全局唯一：重名报 `Entity X: duplicate entity or table name`。
- `tableName` 必须是 `^[a-z][a-z0-9_-]*$`（小写、可含 `_`/`-`），否则生成期报 `X: route path must be lowercase and URL-safe`。
- 生成 V0 CRUD 要求每个实体**有且只有一个** `id UUID @id`：缺失/改名/改类型都会报 `X: V0 CRUD requires exactly one UUID primary key named id`（Web 侧另报 `X: V0 dashboard requires a UUID id field`）。

## 实体注解矩阵

所有实体注解都写在实体名之后、`{` 之前，顺序任意（`@comment` 可与任意注解混排）。

| 注解 | 参数 | 默认 | 生成效果 | 校验与会话 |
| --- | --- | --- | --- | --- |
| `@label("…")` | 字符串或裸标识符 | 实体名 | 菜单、面包屑、列表标题的显示文本；`qiy.resources.<table>.label` 的兜底值 | 重复声明不报错，后者覆盖 |
| `@icon(IconName)` | Ant Design `*Outlined` 图标名 | `user`→`UserOutlined`、`order`→`ShoppingOutlined`、`warehouse`→`DatabaseOutlined`，否则 `TableOutlined` | 菜单图标、页面图标（`resources.ts` 的 `icon`） | 必须匹配 `^[A-Z][a-zA-Z0-9]*Outlined$`，否则 `Invalid Ant Design icon X` |
| `@comment("…")` | 字面量或 `t("key")` | 无 | Drizzle schema 的文件级 JSDoc（含 `i18n: key` 行）、repository/service 注释、`resources.ts` 的 `comment`/`commentKey` | `t()` 的 key 必须在 `messages` 默认语言中存在，否则 `Missing default locale message for comment: <key>` |
| `@singular("…")` | 字符串 | `@label` → 实体名 | 新建/编辑/详情/抽屉标题、按钮单数文案；`qiy.resources.<table>.singular` | 重复声明报 `Entity X: duplicate @singular annotation` |
| `@plural("…")` | 字符串 | `@label` → 实体名 | 菜单、列表标题、面包屑复数；`qiy.resources.<table>.plural` | 重复报 `duplicate @plural annotation` |
| `@display("…")` | 显示模板 | 第一个可读字段（见[自然显示字段](#自然显示字段与回退链)） | 关联下拉选项、抽屉兜底标题、关联表默认文本 | 模板语法与字段引用在解析期校验；重复报 `duplicate @display annotation` |
| `@tableDisplay("…")` | 显示模板 | `@display` 模板 | 本实体作为其他表外键列时的单元格文本 | 同上；重复报 `duplicate @tableDisplay annotation` |
| `@relationDetail("…")` | 显示模板（可含 `<b>` 等白名单标签） | `@display` 模板 | 外键抽屉顶部的摘要块正文 | 同上；重复报 `duplicate @relationDetail annotation` |

> 注解里的字符串请用引号。裸值只在纯 ASCII 标识符形态下可解析（`@icon(AppstoreOutlined)` 合法，`@label(产品)` 会在词法阶段报 `Unexpected Qiy syntax`）。

## 字段类型

字段类型是**闭集**，只支持下表 11 种类型与已声明的 `enum` 名称：

| 写法 | IR 类型 | 数据库列（PostgreSQL 示例） | 说明 |
| --- | --- | --- | --- |
| `UUID` | UUID | `uuid` | 主键（必须叫 `id`）、外键 |
| `Text` | Text | `text` | 字符串，也是枚举的存储类型 |
| `Email` | Email | `text` | 邮箱语义；REST 使用 email 格式校验，表单为 email 输入 |
| `URL` | URL | `text` | URL 语义；REST 使用 uri 格式校验，表单为 url 输入 |
| `JSON` | JSON | `jsonb`（SQLite text JSON 模式 / MySQL json） | 任意 JSON 对象或数组；GraphQL 使用 JSON scalar，表单为 JSON textarea |
| `Text[]` / `Integer[]` | Array + itemType | `jsonb`（SQLite text JSON / MySQL json） | 标量数组；表单为 tags 输入，GraphQL `[String!]` / `[Int!]` |
| `Integer` | Integer | `integer` | 32 位整数 |
| `Boolean` | Boolean | `boolean`（SQLite 用 integer boolean 模式） | 表单渲染为 Switch，API/GraphQL 使用布尔值 |
| `Decimal(p[, s])` | Decimal | `numeric(p, s)` | 精度必填；`s` 缺省 0 |
| `Money(p[, s])` | Money | `numeric(p, s)` | 与 Decimal 同构，语义用于金额 |
| `Date` | Date | `date`（string 模式） | 传输 `YYYY-MM-DD` |
| `Time` | Time | `time` | 传输 `HH:mm[:ss]`，服务端规范化为 `HH:mm:ss` |
| `DateTime` | DateTime | `timestamp with time zone` | 传输 ISO date-time |
| `File` | File | `text`（storage key） | 单个受保护文件 |
| `Files` | Files | `jsonb`（`string[]`） | 多个 storage key |
| `Vector(n)` | Vector | `vector(n)` | 需 PostgreSQL + `pgvector` |
| `<enumName>` | Text + `enumName` | `text` | 引用已声明 `enum`，前端渲染为 Tag |

类型参数规则：

- `Vector` 只接受一个整数：`Vector(1536)`；也可用 `@dimension(1536)` 声明。
- `Decimal`/`Money` 接受 `(precision)` 或 `(precision, scale)`；也可用 `@precision` / `@scale`。
- 其他类型带括号会报 `Field type Text has no parameters`。
- 枚举字段不支持类型参数，且不能再叠加 `@code`（报 `@code requires a Text field without an enum`）。

类型级校验（`validateDatabaseIR`）：

| 规则 | 错误信息 |
| --- | --- |
| `Vector` 需要 `database postgresql` + `extension pgvector` + `@extension(pgvector)` | `Vector requires PostgreSQL and a declared pgvector extension` |
| `dimension` 必须是正整数且 ≤ 16000 | `Vector dimension must be a positive integer` / `pgvector vector dimension cannot exceed 16000` |
| `precision > 0`；MySQL ≤ 65、PostgreSQL ≤ 1000 | `precision must be a positive integer` / `<dialect> precision cannot exceed N` |
| `0 ≤ scale ≤ precision`；MySQL ≤ 30 | `scale must be between zero and precision` / `mysql scale cannot exceed 30` |
| 非 Vector 字段不能有 `dimension`；非 Decimal/Money 不能有 `precision`/`scale` | `dimension requires Vector` / `precision and scale require Decimal or Money` |
| `Files` 不能做主键、不能 `@unique` | `Files cannot be a primary key` / `Files cannot be unique` |
| 字段名全局唯一、列名（`@column` 后）唯一 | `invalid or duplicate field name` / `duplicate column name` |

### 日期与时间（Date / Time / DateTime） {#日期与时间date--time--datetime}

| 类型 | 存储（PG / MySQL / SQLite） | REST / GraphQL / CSV | 表单控件 | 列表/详情 |
| --- | --- | --- | --- | --- |
| `Date` | `date` / `date` / `text` | `YYYY-MM-DD` | `DatePicker` | 本地化日期 |
| `Time` | `time` / `time` / `text` | `HH:mm[:ss]`（存 `HH:mm:ss`） | `TimePicker` | 本地化时间 |
| `DateTime` | `timestamptz` / `datetime` / `timestamp_ms` | ISO date-time，例如 `2026-11-30T08:30:00.000Z` | `DatePicker showTime` | 本地化日期 + 时间 |

- 非法值（`2026-02-31`、`25:61:00`）返回 **400** 并指出字段名。
- 排序按字符串比较（ISO 形状天然有序）；`Date` / `Time` 不能作为 dashboard trend 的 `groupBy`（trend 只接受 `DateTime`）。
- 显示模板与详情页统一用 `Intl.DateTimeFormat` 按当前语言格式化，无法解析的历史值回退原字符串。

## 字段属性矩阵

属性写在类型之后、`;` 之前，顺序任意，可连写。布尔属性支持 `@x`（等价 `true`）与 `@x(false)`。

| 属性 | 允许类型 | 形态 | 默认 | 作用与生成效果 | 校验错误 |
| --- | --- | --- | --- | --- | --- |
| `@id` | UUID | `@id` / `@id(false)` | 无 | 主键；生成 `.primaryKey()`，ID 由服务端生成且表单不渲染 | 多于/少于一个 `id UUID @id` 时报 V0 CRUD 错误 |
| `@nullable` | 全部 | `@nullable` / `@nullable(false)` | 非空 | 生成可空列；请求体可省略；`setNull` 关系要求它 | — |
| `@softDelete` | DateTime + `@nullable` | `@softDelete` | 无 | 软删除时间戳；delete 改为写入当前时间，list/one/update 默认排除已删除行 | 非 DateTime、非 nullable、重复声明报错 |
| `@tenant("claim")` | UUID / Text / Integer | `@tenant` 或 `@tenant("tenant.id")` | `tenantId` | 租户列；自动生成 principal scope，值来自认证 claim，表单/写入只读 | 非标量、nullable、重复、无 auth 或与显式 scope 冲突都报错 |
| `@computed("…")` | Text | 字符串模板，`{field}` 引用其他 Text 字段 | 无 | 只读派生字段；不建列，list/one/create/update 响应中计算；表单只读 | 非 Text、nullable、主键、自引用、未知或非 Text 引用报错 |
| `@unique` | 除 `Files` | `@unique` / `@unique(false)` | 非唯一 | 生成唯一约束（`.unique()`）；可作为 relation 目标字段 | `Files cannot be unique` |
| `@label("…")` | 全部 | 字符串或裸值 | 字段名 | 列头、详情字段名、表单 label、筛选占位符；`qiy.resources.<table>.fields.<field>.label` | 重复声明后者覆盖 |
| `@comment("…")` | 全部 | 字面量或 `t("key")` | 无 | schema JSDoc（含 `i18n: key`）、资源元数据 `comment`/`commentKey` | `t()` key 缺失 → `Missing default locale message for comment: <key>` |
| `@icon(Icon)` | 全部 | Ant Design `*Outlined` | 无 | 字段元数据 `icon`，供生成页面/扩展使用 | 必须匹配 `^[A-Z][a-zA-Z0-9]*Outlined$`，否则 `Invalid Ant Design icon X` |
| `@visible(bool)` | 全部 | 布尔 | `!primaryKey && type !== Vector` | 三个可见性开关的**共同缺省值** | 见下节 |
| `@listVisible(bool)` | 全部 | 布尔 | `@visible` 的值 | 列表列是否默认出现（列选择器仍可切换） | — |
| `@formVisible(bool)` | 全部 | 布尔 | `@visible` 的值 | 新建/编辑表单是否渲染 | 非空、非生成、非 Vector 字段若隐藏 → `required field cannot be hidden from the create form` |
| `@showVisible(bool)` | 全部 | 布尔 | `@visible` 的值 | 详情页/抽屉是否渲染该字段 | — |
| `@sortable(bool)` | 全部 | 布尔 | `true`（`Files` 默认 `false`） | 列表列是否可排序；服务端拒绝未授权排序字段 | 排序被禁用时 REST 返回 400 `Unsupported sort field` |
| `@filterable(bool)` | 全部 | 布尔 | `true`（`Files` 默认 `false`） | 是否允许筛选；决定服务端可接受的 filter 字段 | 400 `Unsupported filter field` |
| `@filter(mode, …)` | 全部 | 逗号列表 | 按类型推导（见下） | 启用过滤并**限定**可选 operator；列表页生成 operator 选择器 | 未知 operator → `Unsupported filter mode X`；重复 → `Duplicate filter mode X` |
| `@upload(binary\|base64\|both)` | File / Files | 标识符 | `binary` | 上传通道（原始二进制/JSON base64/两者） | 其他类型报 `only valid for File and Files fields`；非法模式报 `File upload mode must be ...` |
| `@maxBytes(n)` | File / Files | 整数 | `26214400`（25 MiB，每个文件） | 单文件大小上限 | 非 File/Files 报错；越界（1…104857600）报 `File maxBytes must be between 1 and 104857600` |
| `@maxFiles(n)` | File / Files | 整数 | `File` 恒为 1；`Files` 为 6 | 一次可提交的文件数量 | `File` 只接受 1；`Files` 1…20 |
| `@mime("a/b", …)` | File / Files | 引号字符串列表（可重复声明并合并） | `["*/*"]` | 允许的 MIME 类型 | 非 File/Files、空列表、重复、非法形态都会报错 |
| `@extension(name)` | Vector | 标识符 | 无 | 绑定数据库扩展（必须已在 `database` 中声明） | `undeclared extension X` |
| `@code("模板")` | Text（非枚举、非主键） | 字符串 | 无 | 服务端按模板渲染业务编码；见 [generated-values](/dsl/generated-values) | 非 Text/枚举/主键、与 `@generated` 互斥、模板非法都会报错 |
| `@generated(uuid)` | UUID（非主键） | `@generated` 或 `@generated(uuid)` | 无 | 服务端生成 UUIDv4 | 其他取值报 `only uuid is supported`；非 UUID 字段报 `requires a UUID field` |
| `@column("name")` | 全部 | 字符串 | 字段名 | 物理列名 | 与其它列重名报 `duplicate column name` |
| `@dimension(n)` / `@precision(n)` / `@scale(n)` | Vector / Decimal / Money | 整数 | 见类型参数 | 类型参数的替代写法；重复声明后者覆盖 | 类型不匹配时该属性被忽略（不报错），但仍受类型校验约束 |

补充：

- **属性顺序任意**，但同一属性重复声明时，除下面几种情况外都是“后者覆盖、不报错”：`@code`/`@generated` 互斥、`@code` 重复、`@generated` 重复、`@filter` 重复 operator、`@mime` 重复类型都会显式报错。
- **`Files` 的排序/过滤默认值**：解析器把 `Files` 的 `sortable`/`filterable` 默认值强制为 `false`（JSON key 数组没有有意义的排序/过滤语义）；显式写 `@sortable(true)` / `@filterable(true)` 仍会生效，但不建议。
- **副作用的默认值**：`@upload`/`@maxBytes`/`@mime`/`@maxFiles` 只影响 File/Files，其他类型使用会直接报错，不做静默降级。

## 可见性与默认值

`resources.ts` 中每个字段最终得到 7 个布尔/模式值，默认链如下：

| 元数据 | 默认链 |
| --- | --- |
| `visible` | `field.visible ?? (!primaryKey && type !== "Vector")` |
| `listVisible` | `field.listVisible ?? field.visible ?? (!primaryKey && type !== "Vector")` |
| `formVisible` | `field.formVisible ?? field.visible ?? (!primaryKey && type !== "Vector")` |
| `showVisible` | `field.showVisible ?? field.visible ?? (!primaryKey && type !== "Vector")` |
| `sortable` | `field.sortable ?? true` |
| `filterable` | `field.filterable ?? true` |
| `filterModes` | `@filter(...)` → 枚举 `["eq"]` → Text `["contains","startsWith","endsWith","eq"]` → 其他 `["eq","gt","gte","lt","lte","between","in"]` |

由此产生的固定行为：

- 主键与 `Vector` 默认在三个视图都隐藏；`File`/`Files` 默认全部可见。
- 服务端生成的字段（`@code` / `@generated` / 无 relation 的非主键 UUID）在 `resources.ts` 里带 `autoGenerated: true`：新建表单不渲染（底部显示只读提示 `qiy.autoGenerated`），编辑表单用禁用输入框显示当前值，列表/详情正常显示。
- 非空字段若被 `@formVisible(false)`/`@visible(false)` 隐藏，生成期直接失败（无法创建记录）。
- 列表默认列 = 所有 `listVisible` 字段，**按声明顺序**；用户可在列选择器里调整并持久化到 `localStorage`。
- 字段顺序即声明顺序：schema 列顺序、表单顺序、详情顺序、列表顺序、CSV 列顺序都沿用声明顺序；没有 `@order` 属性。

## 实体显示注解（Django 风格） {#实体显示注解-django-风格}

`@display` / `@tableDisplay` / `@relationDetail` 共用一套极小模板语言：

```text
普通文本                 原样输出并 HTML 转义
{$.fieldName}            插值：UUID、Text、枚举、Integer、Decimal、Money、Date、Time、DateTime
<b>{$.name}</b></br>…    白名单标签（br b strong i em span small p div）+ Django 风格换行
```

校验规则（解析期 `validateEntityDisplayTemplates` + 生成期带关系信息再校验一次）：

| 规则 | 错误信息 |
| --- | --- |
| 模板不能为空 | `<entity>: @display template must be a non-empty string` |
| 占位符必须写成 `{$.field}` | `has a malformed placeholder at offset N; write {$.fieldName} or remove the brace` |
| 只能引用已声明字段 | `references unknown field X` |
| 不能插值 `File`/`Files`/`Vector` | `cannot interpolate File field X; use Text, enum, UUID, ...` |
| 不能插值外键源字段 | `cannot interpolate foreign key field X; reference a scalar field instead` |
| 标签必须在白名单内且小写 | `contains unsupported tag <x>` / `tag <X> must be lowercase` |
| 不支持自闭合（`br` 除外） | `does not support self-closing <b/>; write <b>…</b>` |
| 标签必须配对 | `closing tag </b> does not match <i>` / `has an unclosed <b> tag` |
| 不接受属性/事件/脚本 | 带属性会让标签无法匹配，报 `has an unterminated tag at offset N; only br, b, … are allowed` |
| 悬空的 `<` / `>` | `has a stray ">" at offset N` |

渲染行为：文本与插值都 HTML 转义；枚举渲染当前语言的枚举值 label；Decimal/Money 按本地化数字格式；日期时间按 `Intl.DateTimeFormat`；`<br>`、`<br/>`、`</br>` 都规范化为一个换行；模板本身不参与 i18n（语言中性），单复数靠 `qiy.resources.<table>.singular|.plural`。

### 自然显示字段与回退链

未声明 `@display` 时，生成器按以下字段名顺序取**第一个**可读字段生成 `{$.<field>}`：

```text
name → title → displayName → code → number → sku → email → label → inventoryKey
```

`File`/`Files`/`Vector` 字段不参与该回退。都没有时不生成模板，界面回退到原始值（通常是 `id`）。`@tableDisplay` 缺省沿用 `@display`，`@relationDetail` 缺省沿用 `@display`；三者互相独立。

## 列表过滤器

`@filter(...)` 同时控制三处：生成的列表页 UI、Refine DataProvider 的请求、REST/GraphQL 服务端的接受范围。

```qiy
entity products {
  field id UUID @id;
  field name Text @filter(contains, startsWith, endsWith, eq);
  field amount Integer @filter(eq, gte, lte, between, in);
  field createdAt DateTime @filter(gte, lte, between);
  field status productStatus;            // 枚举默认只有 eq
  field attachment Files @nullable;       // Files 默认不可筛选
}
```

| operator | 语义 | 输入形态 |
| --- | --- | --- |
| `eq` / `gt` / `gte` / `lt` / `lte` | 等值/比较 | 单值 |
| `contains` / `startsWith` / `endsWith` | 文本包含/前缀/后缀 | 单值 |
| `between` | 区间（含端点） | 逗号分隔两个值 |
| `in` | 集合 | 逗号分隔多个值 |

- 服务端按字段声明的 operator 白名单校验，未声明字段/operator 返回 **400**（`Unsupported filter field` / `Unsupported filter operator`）。
- REST DataProvider 保留 Refine 的嵌套 `and`/`or` 条件组：服务端递归校验每个叶子、限制 **8 层深度**、**50 个叶子**，再映射为 Drizzle 条件；GraphQL 使用平铺 `QiyFilterInput`（顶层 AND）。
- 日期/时间字段在 `eq/gt/gte/lt/lte` 下渲染对应 picker；`in`/`between` 仍是逗号分隔文本。

## i18n

资源与字段的翻译键由**声明的标识符**推导（改 label 文案不会破坏翻译），词典缺失时回退到 DSL 原文（`translate(key, {}, fallback)`）：

- `qiy.resources.<tableName>.label` / `.singular` / `.plural`
- `qiy.resources.<tableName>.fields.<field>.label`
- `qiy.enums.<enum>.values.<value>`（枚举字段的 Tag 文本）

注意 `<tableName>` 用的是 `table` 名而不是实体名——`entity products table catalog_products` 的键是 `qiy.resources.catalog_products.*`。完整键表（含菜单、图表、命令与界面 chrome 文案）见 [DSL 总览 · i18n 键](/dsl/overview#i18n-键)，词典语法见 [多语言](/dsl/i18n)。

## 生成结果

| 产物 | 内容 |
| --- | --- |
| `apps/server/src/schema.ts` | 每个实体一张 Drizzle 表：类型映射、`.notNull()`、`.primaryKey()`、`.unique()`、外键 `.references()`（含 `onDelete`，自关联用显式回调类型）、`@comment` 的 JSDoc |
| `apps/server/src/repositories/` | 按字段元数据生成 sortable/filterable 白名单与 filter operator 表；行校验、CSV 导入导出列 |
| `apps/server/src/contracts/` | TypeBox/GraphQL 输入类型：枚举→字符串联合、`Vector`→`[Float!]`、`Files`→`[String!]`、非空→`!` |
| `apps/web/app/resources.ts` | 资源与字段元数据（label/labelKey/comment/type/nullable/visible×4/sortable/filterable/filterModes/enumValues/relation/upload 策略/autoGenerated/roles/icon/dimension） |
| `apps/web/app/routes/<table>/` | list / create / edit / show 页面；列选择器、筛选器、外键单元格、抽屉 |
| `apps/web/app/date-fields.ts` | 日期/时间字段的表单值与传输值互转 |
| `apps/web/tests/` | 列可见性、字段规则、i18n 键、上传策略等断言 |

## 进阶示例

```qiy
enum orderStatus {
  value draft label "草稿" color default;
  value paid label "已支付" color green;
  value shipped label "已发货" color blue;
  value closed label "已关闭" color red;
}

entity orders @label("订单") @singular("订单") @plural("订单")
  @display("{$.code} · {$.customerName}")
  @tableDisplay("{$.code}")
  @relationDetail("<b>{$.code}</b></br>{$.customerName}</br>{$.placedAt}") {
  field id UUID @id;
  field code Text @unique @code("SO-{YYYYMMDD}-{seq:5}");
  field customerName Text @label("客户");
  field placedAt DateTime @label("下单时间") @filter(gte, lte, between);
  field amount Money(14, 2) @label("金额") @filter(eq, gte, lte, between);
  field status orderStatus @label("状态");
  field note Text @nullable @listVisible(false);
  field contract File @nullable @upload(binary) @mime("application/pdf") @maxBytes(10485760);

  index orders_code_uq btree(code) @unique;
  index orders_status_placed_idx btree(status, placedAt);
}
```

创建后 `code` 形如 `SO-20261130-00001`，`status` 在列表渲染成带颜色的 Tag，`note` 默认不出现在列表里但可在列选择器中打开，`contract` 是受保护的下载链接。

## 常见错误

| 错误 | 原因 | 修复 |
| --- | --- | --- |
| `Unsupported field type String` | 类型是闭集，没有 `String`/`Boolean`/`Email`/`URL`/`Json`/`Date[]` | 用 `Text`、`Integer`、`Text` + `@mime` 等受支持组合表达；布尔用 `Integer` 或枚举 |
| `Field type Text has no parameters` | 给非 `Vector`/`Decimal`/`Money` 类型加了括号 | 去掉括号；Text 没有长度参数，需要长度限制时写在业务校验或数据库迁移里 |
| `Unsupported field attribute @required` | 字段没有 `@required` 属性 | 非空由 `@nullable` 的反面表达，默认就是必填 |
| `Field id: @code requires a Text field without an enum` | 把 `@code` 用在 UUID/枚举字段 | 换成 `Text` 字段 |
| `Field externalId: @generated(uuid) requires a UUID field` | 对 Text 字段用 `@generated` | 用 `@code("...")` 或改成 UUID |
| `Entity X: duplicate @display annotation` | 同一实体重复声明显示注解 | 每个注解只写一次 |
| `... cannot interpolate foreign key field customerId` | 显示模板引用了外键源字段 | 引用目标实体的标量字段，或改为 `{$.customerName}` |
| `required field cannot be hidden from the create form` | 非空字段被 `@visible(false)`/`@formVisible(false)` 隐藏 | 要么加 `@nullable`，要么保持表单可见 |
| `Invalid Ant Design icon Xxx` | 图标名不是 `*Outlined` | 使用 `AppstoreOutlined`、`UserOutlined` 等 Ant Design 图标名 |
| `X: V0 CRUD requires exactly one UUID primary key named id` | 缺 `field id UUID @id` 或改名 | 每个实体保留唯一 `id UUID @id` |

## 相关

- [relation 与 index](/dsl/relation-index)：外键、自关联、索引与性能
- [自动生成值与业务编码](/dsl/generated-values)：`@code` / `@generated` 完整语法与运行时
- [enum / menu / dashboard](/dsl/enum-menu-dashboard)：枚举值配色、菜单与概览指标
- [注解总览](/dsl/annotations)：全部 `@annotation` 的集中索引
- [权限（permission）](/dsl/permissions)：字段级脱敏用 `restrict` 的 `mask`，字段本身不声明权限
- [模块化模型](/dsl/modules)：把实体拆到多个 `.qiy` 文件
