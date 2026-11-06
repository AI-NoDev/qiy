# 注解总览（@annotations）

本页是 Qiy DSL 中**全部** `@annotation` 的单一索引：可用位置、参数形态、默认值、i18n 行为、生成效果与校验错误。各构造的完整语法见对应章节，本页只做横向对照。

语言里共有 **48 个注解名**（同一个名字在不同位置含义不同，例如 `@label`、`@comment`、`@icon`、`@unique`、`@field` 出现在多个块中）。注解必须写在解析器允许的位置；写在别处会报 `Unsupported … attribute @X` 或 `Expected …`。

## 通用规则

- **参数形态**：
  - `documentation`：`("字面量")` 或 `(t("message.key"))`。
  - `string`：`("…")` 或裸标识符（`@icon(UserOutlined)`、`@label(Products)`）；裸值不能含空格或非 ASCII 字符。
  - `integer`：十进制非负整数（`@maxFiles(3)`、`@maxBytes(10485760)`）。
  - `number`：可带负号和小数的十进制数（`@min(0.01)`、`@max(-1)`）。
  - `boolean`：`@x`（等价 `true`）或 `@x(true)` / `@x(false)`；不是所有布尔注解都允许省略括号（见各表）。
  - `identifier`：枚举式取值（`@upload(binary)`、`@type(trend)`）。
- **`t("key")` 参考**：只有 `documentation` 位置支持。解析时立即到 `messages` 的默认语言里查 key，缺失报 `Missing default locale message for <purpose>: <key>`；因此 `messages` 必须写在实体/枚举之前（`application`/`database` 的注释延后解析）。
- **i18n**：`@label` 会派生稳定翻译键（见各表）；`@comment` 不派生键，但会把 `i18n: key` 写进生成的 JSDoc，并在元数据里保留 `commentKey`。
- **重复声明**：多数注解后者覆盖、不报错；显式报重复的是 `@singular`/`@plural`/`@display`/`@tableDisplay`/`@relationDetail`、`@code`、`@generated`、`@min`/`@max`/`@length`/`@pattern`/`@default`/`@version`、`@filter`（同一 operator）、`@mime`（同一类型），以及 `@comment`（在 enum / menu group / dataflow 等定义处）；`@order` 由步骤顺序唯一性检查兜底（`step order must be a unique positive integer`）。
- **未实现的注解一律报错**，不会静默忽略。

## 文档类注解

| 注解 | 可用位置 | 参数 | 默认 | i18n | 生成效果 | 校验错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `@comment(…)` | `application`、`database`、`enum`、枚举值、`entity`、`field`、`index`、`relation`、`menu group`、`permission field/group/verification`、`dataflow`、dataflow `input`/`context`/`step`、`action … page manual` | `documentation` | 无 | 保留 `commentKey`；schema JSDoc 写 `i18n: key`；枚举值说明按当前语言渲染 | 见各构造 | `Missing default locale message for <purpose>: <key>`；`duplicate @comment annotation`（enum/menu/dataflow 等定义处） |
| `@label(…)` | `entity`、`field`、`menu group`、`permission field/group/verification`、`dataflow` | `documentation`（支持 `t("key")`） | 实体名 / 字段名 / 分组名 | `qiy.resources.<table>.label`、`qiy.resources.<table>.fields.<field>.label`、`qiy.menu.<group>.label`；dataflow 的 `t()` 键被 action 继承 | 显示文本 | 位置错误：`Unsupported <construct> attribute @label` |
| `@icon(…)` | `entity`、`field`、`menu group` | `string` | 实体按名字启发（`user`/`order`/`warehouse`/其他）；菜单 `AppstoreOutlined`；其他无 | 无 | 图标渲染/元数据 | 必须匹配 `^[A-Z][a-zA-Z0-9]*Outlined$`，否则 `Invalid Ant Design icon X` |
| `@confirm(…)` | `dataflow` | `documentation` | 无 | `t()` 键会被 action 继承为 `confirmKey` | 生成命令按钮的二次确认文案 | `duplicate @confirm annotation`；action 上的 `confirm` 只对 dataflow 目标有效 |
| `@error(…)` | dataflow `step` 内的 `require … @error(…)` | `documentation` | 必填 | `t()` 键用于业务错误翻译 | 校验失败时返回的错误文案 | 缺失或写错位置都会在语法阶段失败（`Expected @ near token N`） |

## entity 注解

| 注解 | 参数 | 默认 | 生成效果 | 校验错误 |
| --- | --- | --- | --- | --- |
| `@label(…)` | `documentation` | 实体名 | 资源显示名 | 重复后者覆盖 |
| `@icon(…)` | `string` | 见启发式 | 菜单/页面图标 | 图标正则 |
| `@comment(…)` | `documentation` | 无 | schema JSDoc、`resources.ts` 注释 | `t()` key 缺失 |
| `@singular(…)` | `string` | `@label` | 单数标题/按钮 | `duplicate @singular annotation` |
| `@plural(…)` | `string` | `@label` | 菜单/列表标题 | `duplicate @plural annotation` |
| `@display(…)` | `string`（显示模板） | 自然显示字段 | 关联下拉/默认显示文本 | `duplicate @display annotation` + 模板校验 |
| `@tableDisplay(…)` | `string`（显示模板） | `@display` | 外键列单元格文本 | `duplicate @tableDisplay annotation` + 模板校验 |
| `@relationDetail(…)` | `string`（显示模板） | `@display` | 外键抽屉摘要（白名单 HTML） | `duplicate @relationDetail annotation` + 模板校验 |

## field 注解

| 注解 | 可用类型 | 参数 | 默认 | 生成效果 | 校验错误 |
| --- | --- | --- | --- | --- | --- |
| `@id` | UUID | 布尔（可裸写） | 无 | 主键；服务端生成 id | 每实体要求唯一 `id UUID @id` |
| `@nullable` | 全部 | 布尔（可裸写） | `false` | 可空列、可省略请求字段 | — |
| `@unique` | 除 `Files` | 布尔（可裸写） | `false` | 唯一约束/索引 | `Files cannot be unique` |
| `@label(…)` | 全部 | `documentation` | 字段名 | 列头/表单 label | 重复后者覆盖 |
| `@comment(…)` | 全部 | `documentation` | 无 | schema JSDoc（含 `i18n:`） | `t()` key 缺失 |
| `@icon(…)` | 全部 | `string` | 无 | 字段元数据图标 | 图标正则 |
| `@visible(bool)` | 全部 | 布尔（需括号） | `!pk && !Vector` | 三个可见性开关的缺省 | — |
| `@listVisible(bool)` | 全部 | 布尔（需括号） | `@visible` | 列表默认列 | — |
| `@formVisible(bool)` | 全部 | 布尔（需括号） | `@visible` | 表单渲染 | 非空字段隐藏 → `required field cannot be hidden from the create form` |
| `@showVisible(bool)` | 全部 | 布尔（需括号） | `@visible` | 详情/抽屉渲染 | — |
| `@sortable(bool)` | 全部 | 布尔（需括号） | `true` | 列排序 + 服务端白名单 | 400 `Unsupported sort field` |
| `@filterable(bool)` | 全部 | 布尔（需括号） | `true` | 筛选 + 服务端白名单 | 400 `Unsupported filter field` |
| `@filter(…)` | 全部 | 逗号列表：`eq, contains, startsWith, endsWith, gt, gte, lt, lte, between, in` | 按类型推导 | 限定 operator + 列表页筛选器 | `Unsupported filter mode X` / `Duplicate filter mode X` |
| `@upload(…)` | File / Files | `binary` / `base64` / `both` | `binary` | 上传通道 | 非 File/Files 报错；非法模式报 `File upload mode must be …` |
| `@maxBytes(n)` | File / Files | 整数 | `26214400` | 单文件上限 | 非 File/Files；越界报 `File maxBytes must be between 1 and 104857600` |
| `@maxFiles(n)` | File / Files | 整数 | `File`=1、`Files`=6 | 文件数量上限 | `File` 只接受 1；`Files` 1…20 |
| `@mime(…)` | File / Files | 引号列表，可重复 | `["*/*"]` | MIME 白名单 | 非 File/Files、空、重复、非法形态 |
| `@extension(…)` | Vector | `string` | 无 | 绑定数据库扩展 | `undeclared extension X` |
| `@code("…")` | Text（非枚举、非主键） | `string` | 无 | 服务端渲染业务编码 | 见 [generated-values](/dsl/generated-values#字段注解) |
| `@generated(uuid)` | UUID（非主键） | 可省略参数，或 `uuid` | `uuid` | 服务端生成 UUIDv4 | 非 UUID / 非 uuid / 与 `@code` 冲突 |
| `@min(n)` / `@max(n)` | Integer / Decimal / Money | `number`（可负、可带小数） | 无 | 闭区间上下界；服务端 400 `validation.min` / `validation.max`，表单同源校验 | 非数值类型；Integer 上非整数；小数位多于 `scale`；`@min` > `@max` |
| `@length(max)` / `@length(min, max)` | Text / Email / URL（非枚举） | 一或两个 `integer` | 无 | 按字符（code point）计长度；服务端 400 `validation.minLength` / `validation.maxLength`，表单显示字数 | 非文本或枚举；min > max；Email 上限 < 6、URL 上限 < 12 |
| `@pattern("regex", "示例")` | Text（非枚举、非 `@code`/`@computed`） | 两个引号字符串：正则（`u` 模式）与必填示例 | 无 | 服务端 400 `validation.pattern`；示例用作表单占位符和生成测试的样例值 | 缺示例；正则非法；示例不匹配正则或超出 `@length` |
| `@default(…)` | 标量类型 | 字符串、数字、`true`/`false`、枚举值名；DateTime 只接受 `now` | 无 | 列默认值（MySQL 文本列与 `now` 由 Drizzle 插入时填充）；create 输入变为可选；新建表单预填字面量；CSV 空单元格回落到默认值 | 类型不符；违反 `@min`/`@max`/`@length`/`@pattern`；非枚举成员；用在主键、`@computed`、`@code`、`@generated`、`@softDelete`、`@tenant` 上 |
| `@version` | Integer（非空） | 布尔（可裸写） | 无 | 乐观锁计数器：新建为 1，每次更新加 1；PATCH 带过期版本返回 409 `version.conflict`；Dataflow `update` 自动递增 | 非 Integer；每实体多于一个；与 `@nullable`、`@id`、`@unique`、`@computed`、`@tenant`、`@softDelete`、`@default`、`@min`、`@max` 同用；Dataflow 显式赋值 |
| `@column("…")` | 全部 | `string` | 字段名 | 物理列名 | 重名报 `duplicate column name` |
| `@dimension(n)` | Vector | 整数 | 类型参数 | 维度 | 类型不匹配被忽略，仍受 Vector 校验 |
| `@precision(n)` | Decimal / Money | 整数 | 类型参数 | 精度 | 同上 |
| `@scale(n)` | Decimal / Money | 整数 | 类型参数 | 小数位 | 同上 |

## index / relation 注解

| 注解 | 位置 | 参数 | 默认 | 生成效果 | 校验错误 |
| --- | --- | --- | --- | --- | --- |
| `@unique` | `index` | 布尔（可裸写） | 非唯一 | `uniqueIndex` | 向量索引不能唯一 |
| `@concurrently` | `index` | 布尔（可裸写） | 无 | 迁移后由 `db:migrate` 在事务外 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` | 仅 PostgreSQL（`concurrently requires PostgreSQL`） |
| `@comment(…)` | `index` / `relation` | `documentation` | 无 | schema JSDoc | `t()` key 缺失 |
| `@onDelete(…)` | `relation` | `restrict` / `cascade` / `setNull`；`@onDelete("")` 表示不生成 | 数据库默认 | 外键 `ON DELETE` 行为 | `Unsupported onDelete action X`；`setNull requires a nullable source field` |

## menu 注解

| 注解 | 位置 | 参数 | 默认 | 生成效果 | 校验错误 |
| --- | --- | --- | --- | --- | --- |
| `@label(…)` | `menu group` | `documentation` | 分组名 | 标题 | 位置错误报错 |
| `@icon(…)` | `menu group` | `string` | `AppstoreOutlined` | 图标 | 图标正则 |
| `@parent(…)` | `menu group` | 分组名 | 无 | 嵌套子菜单 | `unknown parent` / `cyclic parent` |
| `@comment(…)` | `menu group` | `documentation` | 无 | 分组说明 | `duplicate @comment annotation` |

概览页卡片用 `chart` 的属性（`title`、`icon`、`data`）声明，不使用注解，见 [chart](/dsl/charts)。

## permission / dataflow / action 注解

| 注解 | 位置 | 参数 | 默认 | 生成效果 | 校验错误 |
| --- | --- | --- | --- | --- | --- |
| `@label(…)` | `permission field` / `permission group` / `permission verification` | `documentation` | 声明名 | 权限表/API 文档展示名 | `unsupported annotation @X`；`duplicate @label annotation` |
| `@comment(…)` | 同上 | `documentation` | 无 | 说明元数据 | `duplicate @comment annotation` |
| `@label` / `@confirm` / `@comment` | `dataflow` | `documentation` | 无 | 命令元数据；action 继承 label/confirm | `duplicate @label/@confirm/@comment annotation` |
| `@required` | dataflow `input` / `context` | 仅裸写 `@required`（不支持 `(false)`） | `false` | 输入必填；context 绑定要求关联输入 `@required` | `context bindings must declare @required until optional-flow semantics are implemented` |
| `@order(n)` | dataflow `step` | 正整数 | 声明顺序（1 起） | 步骤执行顺序 | `step order must be a unique positive integer` |
| `@error(…)` | `require` 语句 | `documentation` | 必填 | 业务错误文案/翻译键 | 缺失即语法错误 |
| `@required`（field 上不存在） | — | — | — | — | `Unsupported field attribute @required`（字段必填由 `@nullable` 的反面表达） |

## 不存在的注解（常见误写）

| 误写 | 说明 |
| --- | --- |
| `@required`（字段） | 字段默认必填；用 `@nullable` 表达可空 |
| `@optional` | 同上，用 `@nullable` |
| `@searchable` / `@hidden` / `@readonly` | 用 `@filterable` / `@visible(false)` / 表单可见性表达 |
| `@order(...)`（字段/实体） | 顺序即声明顺序 |
| `@format(...)` | 用 `@pattern("regex", "示例")`；邮箱/网址用 `Email` / `URL` 类型 |
| `@enum(...)` / `@relation(...)` / `@index(...)` | 用顶层 `enum`/`relation` 与实体块内 `index` 声明 |
| `@plural`（字段）/ `@label`（枚举） | 枚举只有 `@comment`；枚举值用裸 `label` |
| `@transient` | 不支持；派生值用 `@computed`（见 [entity](/dsl/entity)），服务端生成值用 `@code` / `@generated` |
| `@primaryKey` | 用 `@id` |

## 注解与 i18n 键的对应

| 注解 | 派生键 | 回退 |
| --- | --- | --- |
| `entity @label` | `qiy.resources.<table>.label` | 声明的 label → 实体名 |
| `entity @singular` / `@plural` | `qiy.resources.<table>.singular` / `.plural` | label → 实体名 |
| `field @label` | `qiy.resources.<table>.fields.<field>.label` | label → 字段名 |
| 枚举值 `label` | `qiy.enums.<enum>.values.<value>` | label → 值名 |
| `@comment(t("key"))` | 不派生；直接使用给定键 | key 必须存在于默认语言 |
| `menu group @label` | `qiy.menu.<group>.label` | label → 分组名 |
| `dataflow @label(t("key"))` 被 action 继承 | `qiy.actions.<action>.label`（action 自身 label 优先） | action label → dataflow label |

## 覆盖清单

| 类别 | 注解 |
| --- | --- |
| 文档 | `@comment`、`@label`、`@icon`、`@confirm`、`@error`、`t("key")` 参考 |
| entity | `@singular`、`@plural`、`@display`、`@tableDisplay`、`@relationDetail` |
| field | `@id`、`@nullable`、`@unique`、`@visible`、`@listVisible`、`@formVisible`、`@showVisible`、`@sortable`、`@filterable`、`@filter`、`@upload`、`@maxBytes`、`@maxFiles`、`@mime`、`@extension`、`@code`、`@generated`、`@min`、`@max`、`@length`、`@pattern`、`@default`、`@version`、`@column`、`@dimension`、`@precision`、`@scale` |
| index / relation | `@unique`、`@concurrently`、`@onDelete` |
| menu | `@label`、`@icon`、`@parent` |
| permission / dataflow / action | `@label`、`@comment`、`@confirm`、`@required`、`@order`、`@error` |

## 相关

- [entity 与 field](/dsl/entity)：字段属性矩阵、值校验与默认值、乐观锁、显示模板
- [relation 与 index](/dsl/relation-index)：`@onDelete` / 索引属性
- [enum / menu](/dsl/enum-menu-dashboard)：枚举值属性与菜单注解
- [自动生成值与业务编码](/dsl/generated-values)：`@code` / `@generated`
- [多语言（messages / i18n）](/dsl/i18n)：`t("key")` 与模型 label 键
- [dataflow](/dsl/dataflow) / [action](/dsl/actions)：`@label`/`@confirm`/`@required`/`@order`/`@error`
