# enum / menu / dashboard

三个块共同定义“界面词汇”：`enum` 提供受控取值与配色，`menu` 定义侧边栏结构，`dashboard` 定义概览页的旧式指标卡（新项目请优先用 [chart](/dsl/charts)）。

## enum

### 语法

```text
enum <Name> [@comment("…" | t("key"))] {
  value <valueName> [label "…"] [color <color>] [icon <IconName>] [@comment("…" | t("key"))] ;
  ...
}
```

注意：枚举值的 `label`/`color`/`icon` **不带 `@`**，只有 `@comment` 带；四者顺序任意。

### 参数

| 槽位 | 取值 | 默认 | 生成效果 |
| --- | --- | --- | --- |
| `<Name>` | 标识符 | 必填 | 字段类型名、`qiy.enums.<enum>.*` 键前缀 |
| `@comment(...)`（枚举） | 字面量或 `t("key")` | 无 | `enumerations[].comment/commentKey` 元数据 |
| `value <name>` | 标识符 | 必填 | 存储值（底层 `Text`）、`qiy.enums.<enum>.values.<value>` |
| `label "…"` | 字符串或裸值 | 值名 | Tag 文本与下拉选项文案 |
| `color …` | 字符串或裸值 | 无 | Ant Design `Tag` 的 `color`（`default`/`green`/`red`/`blue` 或任意色值） |
| `icon …` | Ant Design `*Outlined` | 无 | Tag 图标 |
| `@comment(...)`（值） | 字面量或 `t("key")` | 无 | Tag 的鼠标悬停提示（按当前语言渲染） |

### 默认值与校验

- 枚举名与值名必须是合法标识符；重名报 `Enum X: invalid or duplicate name` / `X.value: invalid or duplicate value`。
- 值列表不能为空：`Enum X: values must be a non-empty array`（解析期允许空块，生成前失败）。
- 枚举只支持 `@comment`：其他注解报 `Enum X: unsupported annotation @Y`；枚举值同理。
- `color` 不做白名单校验（直接传给 antd Tag）；`icon` 必须匹配 `^[A-Z][a-zA-Z0-9]*Outlined$`，否则 `Invalid Ant Design icon X`。
- 枚举必须写在所有 `entity` 之前（字段要引用它）；引用未声明的枚举名会被当作类型报 `Unsupported field type X`。

### 生成结果

| 产物 | 内容 |
| --- | --- |
| `resources.ts` | `enumerations` 数组：枚举名、`labelKey`、每个值的 `label`/`labelKey`/`color`/`icon`/`comment`/`commentKey` |
| 列表/详情 | 枚举字段渲染成 `<Tag color=… icon=…>`，`title` 为值说明 |
| 表单/筛选 | 下拉选项使用值 label；`@filterable` 默认 `eq` |
| 服务端契约 | TypeBox/GraphQL 使用字符串联合（取值集合来自枚举） |
| 字段存储 | 引用枚举的字段在 IR 中是 `Text` + `enumName`，数据库列是文本 |

### 示例

```qiy
enum userRole @comment("账号角色") {
  value admin label "管理员" color red icon SafetyOutlined @comment("可管理用户与系统设置");
  value operator label "运营" color blue icon UserOutlined;
  value viewer label "只读" color default icon EyeOutlined;
}
```

### 进阶用法

- **枚举 + 角色**：`auth.roleField` 引用的枚举必须恰好包含 `admin`/`operator`/`viewer` 三个值（生成期校验 `Auth: roleField must be an enum with admin, operator and viewer values`）。
- **枚举 + 图表**：`chart pie UserStatusCount { data = count users group by role; }` 的 `group by` 字段必须是枚举字段；`dashboard` 的 `distribution` 指标同理。
- **枚举 + dataflow**：dataflow 输入类型可以直接写枚举名，`require` 比较的字符串必须是该枚举的已声明值（否则 `unknown enum value X.Y`）；`action` 的 `when field == "value"` 同样校验。
- **i18n**：`qiy.enums.userRole.label` 与 `qiy.enums.userRole.values.admin` 可在 `messages` 中覆盖；值 label 缺省回退到值名，再回退到 key。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Enum X: unsupported annotation @label` | 枚举级只有 `@comment`；值级用裸 `label` |
| `Enum productStatus.values: invalid or duplicate value` | 值名重复或不是标识符 |
| `Unsupported field type productStatus` | 枚举块写在了实体之后，或名字拼错 |
| `Enum X: values must be a non-empty array` | 至少声明一个 `value` |

## menu

### 语法

```text
menu {
  group <name>
    [@label("…")] [@icon(IconName)] [@parent(<groupName>)] [@comment("…" | t("key"))] {
    resource <tableName>;
    ...
  }
  ...
}
```

### 参数

| 参数 | 取值 | 默认 | 生成效果 |
| --- | --- | --- | --- |
| `<name>` | 标识符，全局唯一 | 必填 | 分组键（生成 `menu-<name>`）与 `qiy.menu.<name>.label` |
| `@label("…")` | 字符串或裸值 | 分组名 | 侧边栏分组标题 |
| `@icon(...)` | Ant Design `*Outlined` | `AppstoreOutlined` | 分组图标（折叠态仍可见） |
| `@parent(<group>)` | 另一个分组名 | 无 | 生成二级/多级子菜单 |
| `@comment(...)` | 字面量或 `t("key")` | 无 | `menuGroups[].comment/commentKey` 元数据 |
| `resource <tableName>` | 实体表名，可多条 | 必填（至少一条） | 组内资源顺序 |

### 默认值与校验

- 整个 `application` 最多一个 `menu` 块；块内只允许 `group`。
- 分组名必须是标识符且唯一（`Menu group X: invalid or duplicate name`）。
- `resource` 必须是已声明实体的**表名**（`Menu group X: unknown resource Y`）；同一资源在所有分组中最多出现一次（`Menu group X: duplicate resource Y`）。
- `@parent` 必须指向已声明分组（`unknown parent X`），且不能形成环（`cyclic parent`）。
- `@comment` 重复报 `Menu group X: duplicate @comment annotation`；其他属性报 `Unsupported menu group attribute @X`。

### 生成结果

- `resources.ts` 的 `menuGroups`：`{ name: "menu-<group>", label, labelKey, icon, parent?, comment?, resources: ["<tableName>", …] }`，顺序即声明顺序。
- `app/components/menu.tsx` 的 `buildMenuTree`：分组按声明顺序、组内资源按声明顺序；`@parent` 变成嵌套子菜单；**未分组的资源追加在根级**；没有 `menu` 块时是扁平菜单。
- 每个菜单项包在 `CanAccess` 里按角色过滤；**过滤后没有可见子项的分组不渲染**。
- 侧边栏展开宽 248px，折叠后只显示图标（tooltip 显示分组/资源名），折叠状态持久化到 `localStorage`；当前路由所属子菜单默认展开；移动端为抽屉式侧边栏。
- 存在系统管理页面（`features`）时，概览/文档/密钥链接会归入对应分组（默认 `System`），概览入口 `qiy-overview` 排在最前。

### 示例

```qiy
menu {
  group masterData @label("基础资料") @icon(AppstoreOutlined) {
    resource suppliers;
    resource customers;
    resource products;
  }
  group sales @label("销售") @icon(ShoppingOutlined) @parent(masterData) @comment("销售业务入口") {
    resource orders;
    resource order_lines;
  }
}
```

### 进阶用法

- **两级以上层级**：`@parent` 可以链式嵌套（`A` → `B` → `C`），生成器会检测环。
- **不写 `menu`**：保留旧行为——所有资源平铺成一级菜单；想只调整部分顺序时，写 `menu` 并把需要的资源放进去，其余资源仍会追加在根级。
- **角色过滤**：想让某分组只对管理员可见，不需要在菜单里写角色——用 `restrict … allow roles admin` 或 `pages … list roles admin`，`CanAccess` 会自动隐藏无权限项并移除空分组。
- **i18n**：`qiy.menu.<group>.label` 覆盖分组标题；未声明时回退 `@label`，再回退分组名。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `Menu group X: unknown resource orderItems` | 用 `table` 名；确认实体已声明 |
| `Menu group X: duplicate resource products` | 同一资源只能在一个分组里 |
| `Menu group X: unknown parent Y` | `@parent` 必须指向已声明分组 |
| `Menu group X: cyclic parent` | 去掉环（A→B→A） |
| 分组没显示 | 组内资源都被当前角色过滤掉了，检查 `restrict`/`pages` |

## dashboard

### 语法

```text
dashboard {
  metric <name> <resource>
    [@label("…")] [@icon(IconName)] [@span(8|12|24)]
    [@type(<count|distribution|trend|aggregate>)]
    [@groupBy(<field>)] [@days(<1..365>)]
    [@field(<field>)] [@agg(<sum|avg|min|max>)]
    [@comment("…" | t("key"))]
    ;
}
```

### 参数

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `<name>` | 标识符，唯一 | 必填 | 指标名与 `qiy.dashboard.<name>.label` |
| `<resource>` | 实体表名 | 必填 | 数据来源（`unknown resource` 报错） |
| `@label("…")` | 字符串或裸值 | 指标名 | 卡片标题 |
| `@icon(...)` | `*Outlined` | 无 | 卡片图标 |
| `@span(n)` | `8` / `12` / `24` | `8` | 卡片宽度（24 = 整行） |
| `@type(...)` | `count`/`distribution`/`trend`/`aggregate` | `count` | 指标类型 |
| `@groupBy(field)` | 字段名 | 无 | `distribution` 要枚举字段；`trend` 要 `DateTime` 字段 |
| `@days(n)` | 1…365 | 无 | 仅 `trend` 使用 |
| `@field(field)` | 字段名 | 无 | 仅 `aggregate`：数值字段（Integer/Decimal/Money） |
| `@agg(op)` | `sum`/`avg`/`min`/`max` | 无 | 仅 `aggregate` |
| `@comment(...)` | 字面量或 `t("key")` | 无 | 卡片副标题说明（按当前语言翻译） |

### 默认值与校验

| 类型 | 生成内容 | 校验 |
| --- | --- | --- |
| `count` | 资源总数（点击进入列表） | — |
| `distribution` | 按枚举分组的分布条，显示值 label/注释 | 缺 `@groupBy` 或字段不是枚举：`distribution requires an enum groupBy field`；`@groupBy` 只在 `distribution`/`trend` 下参与计算，其他类型忽略且不报错 |
| `trend` | 按天趋势（`@days` 天） | `@groupBy` 必须是 `DateTime`（`trend requires a DateTime groupBy field`）；`days` 越界报 `days must be between 1 and 365` |
| `aggregate` | 数值聚合（`Statistic`） | 缺 `@field` 或字段非数值：`aggregate requires a numeric field`；缺 `@agg`：`aggregate requires agg sum, avg, min or max` |

其他校验：

- 指标名必须合法且唯一（`Dashboard metric X: invalid or duplicate name`）。
- `@span` 只接受 8/12/24（解析期即报 `span must be 8, 12 or 24`）。
- `field`/`agg` 只允许出现在 `aggregate`（`field and agg require aggregate type`）；`days` 只允许 `trend`（`days requires trend type`）。
- `@comment` 重复报 `duplicate @comment annotation`；其他属性报 `Unsupported dashboard metric attribute @X`。
- `dashboard` 可以与 `chart` 混排（共享同一位置），但概览页优先渲染图表。

### 生成结果

- 概览页（`/`）的指标卡：`count` 统计总数并链接到列表；`distribution` 渲染百分比进度条并复用枚举 label/comment；`trend` 按天渲染；`aggregate` 显示数值 + `sum/avg/min/max` 标签。
- 每张卡片都包在 `CanAccess` 里，无权限资源不显示。
- 卡片标题使用 `qiy.dashboard.<name>.label`，说明文字使用 `@comment`/`commentKey`。

**首页回退行为**：

| 模型情况 | 概览页 |
| --- | --- |
| 有 `dashboard` 块 | 渲染声明的指标卡 |
| 无 `dashboard` 且无 `chart` | 自动为每个实体生成一个 `count` 指标（`span 8`，label/icon 取实体） |
| 无 `dashboard` 但有 `chart` | 指标为空，渲染图表面板 |
| 同时有 `dashboard` 与 `chart` | 图表面板优先，`dashboard` 指标不渲染 |

### 示例

```qiy
dashboard {
  metric orderCount orders @label("订单总数") @span(8) @comment(t("dashboard.orders"));
  metric orderStatus orders @label("订单状态分布") @span(8) @type(distribution) @groupBy(status);
  metric orderTrend orders @label("近 30 天订单") @span(24) @type(trend) @groupBy(createdAt) @days(30);
  metric orderAmount orders @label("订单金额") @span(8) @type(aggregate) @field(amount) @agg(sum);
}
```

### 进阶用法

- **与 chart 共存**：新项目建议直接用 [chart（多视图图表）](/dsl/charts)（饼/柱/折线/表格 + 响应式面板）；旧的 `dashboard { metric … }` 继续可用，适合少量单卡指标。
- **分组说明**：`distribution` 的每个值会显示枚举 `@comment`，适合把“状态含义”直接放到卡片上。
- **时间窗**：`trend` 的 `@days(n)` 控制窗口，数据点按天聚合；需要更长窗口时最大 365。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `distribution requires an enum groupBy field` | `@groupBy` 指向枚举字段 |
| `trend requires a DateTime groupBy field` | 用 `DateTime` 字段（不是 `Date`） |
| `aggregate requires a numeric field` | `@field` 指向 Integer/Decimal/Money |
| `days requires trend type` | `@days` 只配合 `@type(trend)` |
| `Dashboard metric X: unknown resource` | 用表名并确认实体存在 |

## 相关

- [chart（多视图图表）](/dsl/charts)：`chart` / `chart panels` 完整语法
- [entity 与 field](/dsl/entity)：枚举字段与筛选
- [application · features](/dsl/application#features)：系统管理页面与菜单分组
- [application · auth](/dsl/application#auth)：`roleField` 对枚举的要求
- [权限（permission）](/dsl/permissions)：菜单与卡片的角色过滤来源
