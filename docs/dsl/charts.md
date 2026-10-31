# chart（多视图图表与响应式面板）

`chart` 把概览页声明成两层：

- **chart**：一个数据视图，kind 为 `const`（统计卡）、`pie`、`bar`、`line`、`area`、`table`。同名 chart 用不同 kind 重复声明，就得到同一张卡片的多个视图（卡片右上角出现视图切换下拉）。`line` 与 `area` 都使用 `trend` 数据；`area` 渲染填充面积。
- **chart panels**：把一个或多个 chart 按 `grid <cols> <rows>` 声明的网格摆放；每个 chart 用 `larger`/`medium`/`small` 等变体给出 `x y w h` 栅格坐标。多个 panel 时页面右上角出现面板切换下拉。

```qiy
chart const UserCount {
  icon = "TeamOutlined";
  title = "用户总数";
  data = count users;
}

chart pie UserStatusCount {
  icon = "PieChartOutlined";
  title = "用户状态分布";
  data = count users group by role;
  labels = role;
}

chart bar UserStatusCount {          // 同名不同 kind = 同一张卡片的第二个视图
  icon = "BarChartOutlined";
  title = "用户状态分布";
  data = count users group by role;
  labels { admin "管理员"; operator "运营"; viewer "只读"; }
}

chart line MovementTrend {
  icon = "LineChartOutlined";
  title = "库存流水趋势";
  data = trend stock_movements.occurredAt days 30;
}

chart table InventoryTable {
  title = "按仓库的库存记录";
  data = list inventory columns inventoryKey, warehouseId, quantity, reserved;
}

chart panels Overview {
  title = "概览";
  grid 24 24;
  UserCount {
    larger 0 0 6 2;
    medium 0 0 12 2;
    small 0 0 24 3;
  }
  UserStatusCount {
    larger 6 0 12 2;
    medium 12 0 12 3;
    small 0 3 24 4;
  }
}
```

## 语法

`chart` 与 `chart panels` 都写在 `application {}` 内、`menu` 之后、`dataflow` 之前。它们与旧的 `dashboard { metric ... }` **共用同一位置**，可以交错书写（解析器在一个循环里读取 `dashboard`/`chart`），但同一模型里图表优先于旧指标卡，见 [菜单与 Dashboard · 概览页选择](/guide/menu-dashboard#概览页选择chart-优先)。

```text
chart [const|pie|bar|line|area|scatter|table] <ChartName> {
  icon  = "<IconName>" ;       // 可选
  title = "<文本>" ;            // 可选
  data  = <数据表达式> ;        // 必填，每个声明恰好一次
  color = "#1677ff" ;          // 可选，条/线/面积/散点主色
  legend = false ;             // 可选，pie/bar 是否显示图例
  labels = <enumField> ;       // 可选（pie/bar），或
  labels [=] { <value> "<文本>" ; ... } ;   // 显式映射
}

chart panels <PanelName> {
  title = "<文本>" ;            // 可选
  grid <cols> <rows> ;          // 必填，恰好一次
  <ChartName> {                 // 至少一个 chart 引用
    <variant> <x> <y> <w> <h> ; // 每个引用至少一个摆放
    ...
  }
  ...
}
```

### 词法与标点规则

- 标识符 `[a-zA-Z_][a-zA-Z_0-9-]*`；字符串用双引号或单引号；`#` 与 `//` 都是行注释。
- chart 视图属性是 `key = value;`。`;` 可以省略，但**仅当**下一个 token 是 `}`（`chartPropertySemicolon`）。属性之间漏分号会报 `expected ; after the property value`。
- 唯一例外是 `labels`：`labels { ... }` 不写 `=`；`labels = { ... }`、`labels = role;` 也接受。其余属性必须写 `=`。
- `icon`、`title` 的值来自 `value()`：带引号的字符串，或不带引号的标识符（`title = Overview;` 合法但会得到字面量 `Overview`）。推荐始终使用引号。
- 同名 chart 的多个声明可以完全重复属性，但同一 chart 内**同一 kind 只能出现一次**。
- `panels`、`title`、`grid` 不能作为普通 chart 的名字（`panels` 保留给 `chart panels`，`title`/`grid` 是 panel 内的保留 token）。
- 数据表达式按空格分词，`group by`、`columns`、`days` 是关键字；`trend users.createdAt days 30` 由 `trend`、实体、`.`、字段、`days`、整数依次解析。
- `bar` / `pie` 支持 `count <entity> group by <enum>`，也支持 `sum|avg|min|max <entity>.<numericField> group by <enum>`；散点使用 `list <entity> columns <numericX>, <numericY>`。

## 参数表：chart 视图

| 属性 | 必填 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| kind（位置参数） | 否 | `const` / `pie` / `bar` / `line` / `area` / `scatter` / `table` | `const` | 省略 kind 即统计卡；`stat` 旧名称已删除 |
| `icon` | 否 | 字符串 | 无 | Ant Design `*Outlined` 图标名；只有生成到 `app/icons.tsx` 的图标才会真正渲染，见[图标](#图标) |
| `title` | 否 | 字符串 | chart 名 | 卡片标题（chart 级）；视图标题另见 `views.<kind>.label` |
| `data` | **是** | 数据迷你语言 | 无 | 每个声明必须且只能出现一次 |
| `labels` | 否 | 枚举字段或映射块 | 无 | 只对 `pie`/`bar` 有意义；其他 kind 会被静默忽略 |
| `color` | 否 | `#rrggbb` | 主题色 | bar/line/area/scatter 主色 |
| `legend` | 否 | `true` / `false` | `true` | pie/bar 是否显示图例 |

### 多视图（同名声明）语义

一个 chart 的多个声明按**书写顺序**成为 `views`：

- 同名不同 kind → 同一张卡片的多个视图；默认视图是**第一个声明**（`views[0]`）。
- 同名同 kind → 报错 `Chart <name>: duplicate <kind> view`。
- 不写 kind 的两个同名声明都默认 `const`，因此第二个会报重复 `const` 视图。
- chart 级 `title`/`icon` 取**第一个声明了该属性的视图**（`chart.title ??= view.title`、`chart.icon ??= view.icon`），不是"第一个视图的全部属性"。所以第一个视图没有 `title`、第二个有时，卡片标题来自第二个。
- 视图标题回退链：`view.title` → chart 级 `title` → chart 名。
- 每个视图可以单独覆盖视图标题：`qiy.charts.<chart>.views.<kind>.label`。
- 卡片头部的图标与标题是 **chart 级**的，切换视图不会换图标或卡片标题；视图标题只出现在卡片内部（见[生成结果](#生成结果)）。

```qiy
chart pie ProductStatus {
  title = "按状态分布";
  data = count products group by status;
  labels = status;
}
chart bar ProductStatus {
  title = "按状态分布（柱状）";
  data = count products group by status;
  labels = status;
}
```

生成 `charts.ts` 时，`ProductStatus` 是一个 chart、两个 view；页面默认显示 `pie`，下拉可切到 `bar`。

## data 数据迷你语言

| `data` 写法 | 允许的 kind | 生成调用的接口 | 结果 |
| --- | --- | --- | --- |
| `count <entity>` | `const` | 列表 `page=1&pageSize=1` 的 `total` | 单一计数 |
| `sum\|avg\|min\|max <entity>.<field>` | `const` | `GET /api/v1/<entity>/aggregate?field=<field>&op=<op>` | 数字聚合（SQL） |
| `count <entity> group by <enumField>` | `pie` / `bar` | `GET /api/v1/<entity>/distribution?field=<enumField>` | 枚举分布 |
| `trend <entity>.<dateTimeField> days <1..365>` | `line` | `GET /api/v1/<entity>/trend?field=<field>&days=<n>` | 按天计数趋势 |
| `list <entity> columns <a>, <b>, ...` | `table` | 列表 `page=1&pageSize=5` | 只读预览前 5 行 |

解析器接受的操作集合是 `count`、`sum`、`avg`、`min`、`max`、`trend`、`list`；实际允许的操作由 kind 决定，kind/操作不匹配在**解析阶段**就以 `Chart <chart> <kind> view: ...` 报错：

| kind | 接受 | 拒绝（示例错误） |
| --- | --- | --- |
| `const` | 无分组的 `count`；`sum/avg/min/max` | `count ... group by` → `count data cannot group by (use pie or bar)`；`trend`/`list` → `const views require count or sum/avg/min/max data` |
| `pie` / `bar` | `count <entity> group by <enum field>` | 缺 `group by` / 非 count → `pie/bar views require "count <entity> group by <enum field>" data` |
| `line` | `trend` | 其他 → `line views require "trend <entity>.<DateTime field> days <n>" data` |
| `table` | `list` | 其他 → `table views require "list <entity> columns ..." data` |

### 实体与字段校验

- `<entity>` 可以写**实体名**或 `table` 名；校验时归一化为表名（生成代码与数据请求都用表名）。未知实体：`unknown entity <name>`。
- `<field>` 必须是该实体的**字段名**（不是列名、不能带表前缀）。未知字段：`unknown field <name>`。
- `group by` 字段必须是枚举字段：`group by field <name> must be an enum field`。
- `sum`/`avg`/`min`/`max` 字段必须是 `Integer`、`Decimal` 或 `Money`：`aggregate field <name> must be Integer, Decimal or Money`。
- `trend` 字段必须是 `DateTime`：`trend field <name> must be a DateTime field`。
- `days` 必须是 `1..365` 的整数；缺失或 0 报 `trend data requires "days <1..365>"`，越界报 `days must be between 1 and 365`。
- `list` 至少一个列；缺失报 `list data requires "columns <field>, ..."`。每个列都必须存在，且不能是 `Vector`：`cannot render a Vector column (<name>)`。
- `sum/avg ... group by ...` 在语法层能解析，但**任何 kind 都不支持**：`const` 报 `sum ... group by is not supported`，`pie`/`bar` 因要求 `count` 而报 pie/bar 规则错误。需要"按枚举求和的分布"时改用 `count ... group by`、`table` 视图或手写扩展页。
- 图表数据视图复用列表/分析接口，因此服务端 `scope`、`restrict`、`pages`、`mask` 与角色守卫仍然生效；图表不绕过任何数据权限。

## labels：分布数值文案

`labels` 只影响 `pie`/`bar` 的**数值文案**（图例行/图例项），不影响计数。

```qiy
chart pie ProductStatus {
  data = count products group by status;
  labels = status;                     // 使用 status 枚举的 value label
}

chart bar ProductStatus {
  data = count products group by status;
  labels {                             // 显式映射（值可以是字符串或标识符键）
    active "在售";
    inactive "停用";
  }
}
```

规则与优先级：

1. 生成元数据时，`pie`/`bar` 即使**不写** `labels`，也会从 `group by` 枚举自动展开全部枚举值（label = 枚举 value label，labelKey = `qiy.charts.<chart>.labels.<value>`）。
2. `labels = <enumField>` 用另一个枚举字段的 value label 作为回退文案；该字段同样必须是枚举字段（`labels field <x> must be an enum field`）。
3. `labels { ... }` 只包含显式列出的值；未列出的值在运行时原样显示原始字符串。
4. 运行时解析顺序：`qiy.charts.<chart>.labels.<value>` 词典 → 生成元数据里的 label（显式映射文案或枚举 value label）→ 原始值。即**词典永远优先于 DSL 文案**。
5. `labels` 的 key 只按 **chart 名**生成，不区分视图：同一个 chart 的 `pie` 与 `bar` 共享 `qiy.charts.<chart>.labels.<value>`。给 bar 的显式映射写一套中文、再用词典覆盖时，两个视图会一起被覆盖。
6. `labels` 写在 `const`/`line`/`table` 视图上不会报错，也不会生成元数据，属于静默忽略。
7. `labels { }` 空映射报 `labels mapping needs at least one entry`；重复值报 `duplicate labels mapping <value>`；每个条目的文案必须是**带引号的字符串**，并以 `;` 结束。

## 默认值与校验（chart 视图）

- kind 默认 `const`；chart 级 `title` 默认 chart 名，视图 `title` 回退 chart `title`；`icon` 默认无。
- 未知属性：`Chart <chart> <kind> view: unknown property <p>; expected icon, title, data or labels`。
- 重复属性：`Chart <chart> <kind> view: duplicate <p> property`。
- 缺 `data`：`Chart <chart> <kind> view: missing data property`。
- 未知操作：`unknown data operation <op>; expected count, sum, avg, min, max, trend or list`。
- 所有错误都带 chart 名与 kind，便于在大型模型里定位。

## chart panels 语法与参数

```text
chart panels <PanelName> {
  title = "<文本>" ;      // 可选；重复写不报错，后写覆盖先写
  grid <cols> <rows> ;    // 必填；cols 1..24，rows 1..200
  <ChartName> { <variant> <x> <y> <w> <h> ; ... }
}
```

| 元素 | 必填 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | 否 | 字符串 | panel 名 | panel 标题；i18n key `qiy.charts.<panel>.label` |
| `grid cols` | **是** | 1..24 | 无 | CSS 栅格列数 |
| `grid rows` | **是** | 1..200 | 无 | CSS 栅格行数上限；决定 `y + h` 的合法范围 |
| chart 引用 | **是**（≥1） | 已声明的 chart 名 | 无 | 每个引用至少一个摆放；同一 panel 内不能重复引用 |
| `<variant>` | **是**（≥1） | 见下表 | 无 | 同一 chart 的同一 variant 只能出现一次 |
| `x` / `y` | **是** | ≥0 的整数 | 无 | 0 基原点 |
| `w` / `h` | **是** | ≥1 的整数 | 无 | 占用的列数/行数 |

### 响应式变体

| variant | 归类 | 生效视口 |
| --- | --- | --- |
| `larger` / `large` / `lg` / `xl` | larger | ≥ 1200px |
| `medium` / `md` | medium | ≥ 768px |
| `small` / `sm` / `xs` | small | < 768px |

- 未知变体报错并列出全集：`unknown variant <v>; expected one of larger, xl, lg, large, medium, md, small, sm, xs`。
- 同一 chart 内**同名 variant** 报 `duplicate <variant> placement`；但**同一归类下的不同别名**（如 `larger` + `large`）不会报错，运行时只取该归类中**第一个声明**的摆放，后面的别名等同死代码。建议每个归类只写一个变体（`larger`/`medium`/`small` 最清晰）。
- 每个归类内 `x y w h` 各自独立，互不覆盖。

### 坐标与校验

- `x + w <= cols`、`y + h <= rows`、`x,y >= 0`、`w,h >= 1`；越界错误形如 `placement larger exceeds 24 grid columns` / `grid rows must be between 1 and 200`。
- 校验只做**边界**，不做**重叠**检测：两个 chart 可以摆在同一组单元格上，CSS Grid 会把它们叠在同一个区域（按 DOM/声明顺序绘制）。需要并排时自行保证 `x` 区间不重叠。
- `grid` 重复报 `duplicate grid property`；缺 `grid` 报 `missing grid property`；panel 没有任何 chart 报 `needs at least one chart`；chart 引用没有任何摆放报 `chart <name> needs at least one placement`。
- panel 内重复引用同一 chart 报 `duplicate chart <name>`；引用未声明的 chart 报 `unknown chart <name>`。
- chart 名与 panel 名共享命名空间：同名报 `Chart <name>: name already used by a chart panel` 或 `Duplicate chart or panel name <name>`；panel 也不能重名。
- 同一个 chart 可以出现在多个 panel 中，每个 panel 有自己的摆放，互不影响。

### panel 数量与页面选择

- 多个 panel 按**声明顺序**渲染为下拉选项；页面右上角显示选择器，选择结果写入 `localStorage` 的 `qiy.charts.panel`。
- 只有一个 panel 时不显示页面级选择器，但 panel 标题仍然渲染。
- 已存值不存在于当前模型（改名、删 panel）时回退 `panels[0]`；`localStorage` 不可用（SSR、隐私模式、配额）时静默回退。
- 存储值只在组件**首次挂载**时读取；SSR 首屏没有 `localStorage`，因此服务端渲染总是先出 `panels[0]`，客户端 hydration 后再切到已存 panel（可能有一次可见切换）。
- 未出现在任何 panel 里的 chart **不会渲染**；完全没有 `chart panels` 时，所有 chart 用 `Row`/`Col`（`xs=24`、`lg=12`）平铺，不走栅格坐标。

## 生成结果

```text
apps/web/app/charts.ts                  # chart/panel/placement 元数据 + 纯函数
apps/web/app/components/charts.tsx      # ChartDashboard / ChartCard / 五种视图
apps/web/app/routes/home.tsx            # 概览页：有 chart 时渲染 ChartDashboard
apps/web/app/dashboard.ts               # 旧 metric 元数据（无显式指标且无 chart 时自动生成；有 chart 时即使有指标也不渲染）
apps/web/tests/charts.test.ts           # 分组/栅格/变体/持久化断言
apps/web/tests/charts-render.test.tsx   # SSR 渲染五种视图与两种选择器
```

`charts.ts` 导出：

| 导出 | 用途 |
| --- | --- |
| `charts` / `chartPanels` | 生成元数据（视图、标签、grid、placements） |
| `hasChartDashboard` | `charts.length > 0` |
| `findChart(name)` | 按名称查找 chart |
| `defaultChartView(chart)` | `views[0]` |
| `chartViewKinds` / `chartVariantNames` / `chartVariantBreakpoint` / `chartViewportBreakpoints` | 常量表 |
| `chartViewportCategory(width)` | `>=1200` larger、`>=768` medium、否则 small |
| `selectChartPlacement(placements, category)` | 变体选择（见下） |
| `chartPanelStorageKey` / `readStoredChartPanel` / `storeChartPanel` / `resolveChartPanel` | `qiy.charts.panel` 持久化 |
| `chartViewKindLabelKey(kind)` | `qiy.chartViewKind.<kind>` |

### 变体选择算法

`selectChartPlacement` 先按归类取**第一个**摆放，然后：

1. 从当前视口归类开始，向更小的归类找（larger → medium → small）；
2. 找不到再向更大的归类找（small → medium → larger）；
3. 都没有时返回 `placements[0]`（理论上不会发生，解析器要求至少一个摆放）。

例：只声明 `medium` 时，large 视口用 `medium`；只声明 `larger` 时，手机用 `larger`；同时声明 `small` 与 `larger` 时，中等视口用 `small`。

### 渲染结构

- 面板容器：`display:grid; grid-template-columns: repeat(cols, minmax(0,1fr)); gap:16px; grid-auto-rows:minmax(0,auto)`。
- 每张卡片：`grid-column: x+1 / span w`、`grid-row: y+1 / span h`，`min-width:0`。数字就是栅格单元，不是像素。
- 行高由内容决定（`auto`），`h` 只是跨行数；同一行内多张卡片的高度会互相影响，因此 `h` 不是固定像素高度。
- 卡片头：`chart.title`（`qiy.charts.<chart>.label`）+ 第一个声明的图标；多视图时右侧视图下拉。
- 视图内部：
  - `const`：`Statistic`，标题用视图标题；`count` 显示本地化整数，`sum`/`avg`/`min`/`max` 追加 `操作 · 字段` 后缀（`qiy.aggSum` 等 + 字段 label），`Money`/`Decimal` 固定两位小数。
  - `pie`：内联 SVG 圆环图 + 图例；`bar`：每行 `Progress` 百分比；两者都显示计数。
  - `line`：内联 SVG 折线 + 首尾日期 + 最大值（`qiy.aggMax`）。
  - `table`：Ant Design `Table`，只读、无分页、最多 5 行，列头走字段 label；底部链接到资源列表。
- 数据视图包在 `CanAccess resource=<entity> action="list"` 中；panels 模式下整个网格单元还额外包一层 `CanAccess`。没有 panel 时只有卡片内部包 `CanAccess`，因此无权限时可能只显示空卡片头。
- 图表不引入重型图表库：条形图用 AntD `Progress`，饼图/折线图用内联 SVG，表格用 AntD `Table`，因此 SSR 与无浏览器环境可以直接渲染。

### 图标

- `icon` 必须是 Ant Design 的 `*Outlined` 图标名。生成器会把 chart 级与每个视图的 `icon` 同样收集进 `qiyIcons`（与实体、字段、枚举值、菜单分组、旧 dashboard metric 的图标合并去重），因此 chart 专用的图标也会被导入和渲染。
- 生成期只校验名字格式：不是 `[A-Z][a-zA-Z0-9]*Outlined` 会直接报 `Invalid Ant Design icon <name>`。如果名字格式正确但 Ant Design 并没有导出它，生成仍会成功，随后在生成项目的 typecheck/build 阶段以未导出成员错误暴露。

## 数据端点与取值

| 视图 | 客户端调用 | 服务端端点 | 响应形状 |
| --- | --- | --- | --- |
| `const` + `count` | `useList({ resource, pagination: { currentPage: 1, pageSize: 1 } })` | `GET /api/v1/<table>` | `{ data, total }`，取 `total` |
| `const` + 聚合 | `useCustom` → DataProvider `custom` | `GET /api/v1/<table>/aggregate?field&op` | `{ value, operator }` |
| `pie` / `bar` | `useCustom` → `custom` | `GET /api/v1/<table>/distribution?field` | `[{ value, count }]`（DataProvider 包装为 `{ items }`） |
| `line` | `useCustom` → `custom` | `GET /api/v1/<table>/trend?field&days` | `[{ day, count }]`（包装为 `{ items }`） |
| `table` | `useList({ resource, pagination: { currentPage: 1, pageSize: 5 } })` | `GET /api/v1/<table>` | `{ data, total }`，只展示前 5 行 |

`<table>` 是实体的表名：`data` 里写实体名或表名都可以，但生成元数据与请求统一使用表名。

- REST 与 GraphQL 两种 `api.client` 都支持这些调用；GraphQL 下 `const` 计数仍走列表 `total`，聚合/分布/趋势走生成的 `*Aggregate`/`*Distribution`/`*Trend` 查询。
- DataProvider 的 `custom` 只接受已声明资源的 `distribution`/`trend`/`aggregate` URL，并在客户端预检字段类型（数字、枚举、DateTime、`days` 1..365）；不合法会抛 `Unknown aggregate field` 等错误。服务端仍会再校验并应用数据权限。
- 表格预览的 `total` 可能是全量总数，但界面只显示 5 行；需要完整数据请点"查看<资源>"。

## 加载、错误与空状态

每个视图独立请求、独立状态：

| 状态 | 表现 |
| --- | --- |
| loading | `Spin size="small"`（统计卡在值位置显示 `…`） |
| error | `Alert type="error" showIcon message={String(error)}` |
| 空分布/趋势 | `Empty`（简单插图），不显示 0 值图例 |
| 空表格 | AntD Table 的 `emptyText` = `qiy.noData` |
| 无任何 chart | `ChartDashboard` 自身显示 `Empty` + `qiy.noData`；概览页只在 `charts.length > 0` 时才挂载它，因此正常模型会走旧指标卡兜底 |

`pie`/`bar` 的百分比以当前返回项计数之和为分母；全为 0 时进度为 0。折线图最大值为 0 时所有点落在底部基线。

## 主题与暗色模式

- 卡片、表格、`Statistic`、`Progress`、`Select` 都使用 Ant Design token，随 `ui` 主题与亮/暗算法变化；卡片图标颜色使用 `token.colorPrimary`。
- **图表图形本身不跟随主题**：饼图调色板（`#1677ff`、`#52c41a`、`#faad14`、`#eb2f96`、`#722ed1`、`#13c2c2`、`#fa541c`、`#8c8c8c`）与折线 `#1677ff` 是硬编码浅色值。暗色模式下线条/色块仍然可见，但不会变成主题色，也不会按暗色算法调整对比度。
- `styles.css` 只对图表容器做尺寸/布局（`.qiy-chart-pie svg`、`.qiy-chart-line`、`.qiy-chart-grid-cell > .ant-card` 等），不含颜色覆盖。
- 主题、色彩模式与 `localStorage` 键见 [UI 与主题](/guide/ui-theming)。

## i18n

图表页涉及的所有键：

| key | 用途 | 回退 |
| --- | --- | --- |
| `qiy.charts.<chart>.label` | 卡片头部标题 | chart 级 `title` → chart 名 |
| `qiy.charts.<chart>.views.<kind>.label` | 视图内部标题（`const` 的 Statistic 标题、pie/bar 的副标题、line 的副标题）；`table` 视图不使用 | 视图 `title` → chart `title` → chart 名 |
| `qiy.charts.<chart>.labels.<value>` | 分布数值文案覆盖（pie/bar 共享） | 显式映射文案 / 枚举 value label → 原始值 |
| `qiy.charts.<panel>.label` | panel 标题与 panel 下拉选项 | panel `title` → panel 名 |
| `qiy.chartView` | 视图选择器与 panel 选择器的 `aria-label` | 内置"视图 / View" |
| `qiy.chartViewKind.<kind>` | 视图下拉选项文案（`const`/`pie`/`bar`/`line`/`table`） | 内置中英文"统计/饼图/柱状图/折线图/表格" |
| `qiy.noData` | 空状态、表格空文案 | 内置"暂无数据 / No data" |
| `qiy.viewResource` | 表格底部链接，插值 <code v-pre>{{resource}}</code> | 内置"查看{{resource}}" |
| `qiy.aggSum` / `qiy.aggAvg` / `qiy.aggMin` / `qiy.aggMax` | 统计卡后缀、折线图最大值 | 内置"求和/平均/最小值/最大值" |
| `qiy.resources.<table>.fields.<field>.label` | 表格列头、统计卡字段名 | 字段声明 label |
| `qiy.overview` / `qiy.overviewDescription` / `qiy.quickAccess` | 概览页标题、说明、快速访问卡片 | 内置 |

注意：

- 视图下拉的选项文案是 **kind 名称**（`qiy.chartViewKind.<kind>`），不是视图标题；`views.<kind>.label` 只影响卡片内部。
- panel 与 chart 共用 `qiy.charts.<name>.label` 命名空间；名称唯一性已在解析期保证，不会互相覆盖。
- chart 的 `data` 实体在生成元数据里是**表名**，所以字段 label 键里的 `<entity>` 是表名。

## 示例：完整最小模型

下面是一个可直接生成的完整模型（SQLite、无认证），覆盖多视图 chart 与 panel：

```qiy
qiy v0;

application chart-demo {
  database sqlite {}

  enum taskStatus {
    value open label "待处理";
    value done label "已完成";
  }

  entity tasks @label("Tasks") @icon(TableOutlined) {
    field id UUID @id;
    field title Text @label("Title");
    field status taskStatus;
    field createdAt DateTime @nullable;
  }

  chart const TaskTotal {
    icon = "TableOutlined";
    title = "任务总数";
    data = count tasks;
  }

  chart pie TaskByStatus {
    title = "任务状态";
    data = count tasks group by status;
    labels = status;
  }

  chart bar TaskByStatus {
    title = "任务状态";
    data = count tasks group by status;
    labels { open "待处理"; done "已完成"; }
  }

  chart line TaskTrend {
    title = "近 30 天新增";
    data = trend tasks.createdAt days 30;
  }

  chart table TaskTable {
    title = "任务预览";
    data = list tasks columns title, status, createdAt;
  }

  chart panels Tasks {
    title = "任务概览";
    grid 12 10;
    TaskTotal { larger 0 0 3 2; small 0 0 12 2; }
    TaskByStatus { larger 3 0 6 4; small 0 2 12 3; }
    TaskTrend { larger 9 0 3 4; small 0 5 12 2; }
    TaskTable { larger 0 4 12 4; small 0 7 12 3; }
  }
}
```

## 进阶用法

### KPI 页：三个统计 + 分布 + 趋势

```qiy
chart const OrdersTotal {
  icon = "TableOutlined";
  title = "订单总数";
  data = count orders;
}
chart const OrdersAmount {
  title = "订单金额";
  data = sum orders.total;
}
chart const OrdersAvgAmount {
  title = "平均订单金额";
  data = avg orders.total;
}
chart pie OrdersByStatus {
  title = "订单状态分布";
  data = count orders group by status;
  labels = status;
}
chart line OrdersTrend {
  title = "近 30 天订单";
  data = trend orders.createdAt days 30;
}

chart panels Kpi {
  title = "经营概览";
  grid 24 8;
  OrdersTotal { larger 0 0 6 2; medium 0 0 12 2; small 0 0 24 2; }
  OrdersAmount { larger 6 0 6 2; medium 12 0 12 2; small 0 2 24 2; }
  OrdersAvgAmount { larger 12 0 6 2; medium 0 2 12 2; small 0 4 24 2; }
  OrdersByStatus {
    larger 18 0 6 4;
    medium 12 2 12 4;
    small 0 6 24 4;
  }
  OrdersTrend {
    larger 0 2 18 4;
    medium 0 6 24 4;
    small 0 10 24 4;
  }
}
```

### 混合布局：两个 panel、不同栅格与别名

```qiy
chart panels Compact {
  title = "紧凑视图";
  grid 12 6;
  OrdersTotal { large 0 0 4 2; md 0 0 6 2; xs 0 0 12 2; }
  OrdersByStatus { large 4 0 8 4; md 6 0 6 4; xs 0 2 12 4; }
  OrdersTrend { large 0 4 12 2; md 0 4 12 2; xs 0 6 12 2; }
}

chart panels Wide {
  title = "宽屏视图";
  grid 24 6;
  OrdersTotal { larger 0 0 8 2; medium 0 0 12 2; small 0 0 24 2; }
  OrdersByStatus { larger 8 0 8 4; medium 12 0 12 4; small 0 2 24 4; }
  OrdersTrend { larger 16 0 8 4; medium 0 4 24 4; small 0 6 24 4; }
}
```

两个 panel 共享同一批 chart；页面右上角的下拉切换 panel，选择写入 `qiy.charts.panel`。

### 多视图 + 单视图混排

一个 chart 有多个视图时卡片右上角出现视图下拉；单视图 chart 没有下拉。多个 panel 时页面级下拉与卡片级下拉同时存在，二者都用 `qiy.chartView` 作为无障碍标签。

## SVG、SSR 与无头环境

- 图表不使用 canvas 或第三方图形库，`renderToStaticMarkup` 可以渲染饼图/折线图/表格/统计卡；生成的 `charts-render.test.tsx` 就是这样断言五种视图与两种选择器的。
- 服务端没有 `window`：视口归类固定从 `small` 开始，`readStoredChartPanel()` 返回 `undefined`、`storeChartPanel` 为空操作，`ChartDashboard` 使用第一个 panel。hydration 后再按真实视口与存储值修正。
- `matchMedia` 缺失时（部分无头环境）`useChartViewportCategory` 保持初始值，不抛错。
- 数据获取依赖 Refine 的 `useList`/`useCustom`，因此 SSR 首屏需要可用的 data provider（或测试 mock）；否则只会渲染 loading/error 状态。

## 常见错误

| 报错 | 原因 | 修复 |
| --- | --- | --- |
| `Chart X const view: count data cannot group by (use pie or bar)` | `const` 写了 `group by` | 改 kind 为 `pie`/`bar`，或去掉 `group by` |
| `Chart X const view: sum ... group by is not supported` | 聚合 + 分组 | 不支持；改用 `count ... group by`/`table`/扩展页 |
| `Chart X const view: aggregate field name must be Integer, Decimal or Money` | 聚合字段类型不对 | 换成 `Integer`/`Decimal`/`Money` 字段 |
| `Chart X pie view: group by field name must be an enum field` | 分组字段没有枚举 | 用枚举字段，或把 `labels` 改成显式映射 + 其他视图 |
| `Chart X pie view: pie/bar views require "count <entity> group by <enum field>" data` | pie/bar 写了聚合/趋势/列表 | 改成 `count ... group by` |
| `Chart X line view: trend field qty must be a DateTime field` | 趋势字段不是 DateTime | 换成 DateTime 字段 |
| `Chart X line view: days must be between 1 and 365` | `days 0` 或 >365 | 传 1..365 |
| `Chart X table view: unknown field missing` | 列不存在 | 用该实体的字段名 |
| `Chart X table view: cannot render a Vector column (embedding)` | 表格列是 Vector | 去掉该列 |
| `Chart panel P: placement larger exceeds 24 grid columns` | `x + w > cols` | 调小 `x`/`w` 或加大 `grid cols` |
| `Chart panel P: grid rows must be between 1 and 200` | rows 越界 | 改到 1..200 |
| `Chart panel P: unknown chart Missing` | panel 引用了未声明的 chart | 先声明 chart，或修正名字 |
| `Chart panel P: chart C needs at least one placement` | chart 引用没有变体 | 至少写一个 `<variant> x y w h;` |
| `Chart name panels is reserved for chart panels blocks` | chart 叫 `panels` | 改名 |
| `Chart MainPanel: name already used by a chart panel` | chart 与 panel 同名 | 改名 |
| `Chart X pie view: duplicate labels mapping active` | `labels` 映射重复值 | 去重 |
| 卡片没有图标 | `icon` 不是 Ant Design 实际导出的 `*Outlined` 名字 | 换成 Ant Design 存在的 `*Outlined` 图标并重新生成 |
| `Invalid Ant Design icon X` | `icon` 不符合 `*Outlined` 命名格式 | 改用正确的 `*Outlined` 名字 |

## 已知问题与歧义

以下行为来自当前生成器/解析器实现，发布前值得确认：

1. **非 pie/bar 的 `labels` 静默忽略**：`const`/`line`/`table` 上的 `labels` 能通过解析，但不生成元数据、不报错。
2. **同归类别名**：`larger` 与 `large` 可同时声明，只有第一个生效；解析器只拒绝完全相同的 variant 名。
3. **panel 重复 `title`**：不报错，后写覆盖先写。
4. **重叠不检测**：两个 chart 可以占用同一批单元格，渲染时叠在一起。
5. **无 panel 时 `CanAccess` 层级不同**：panels 模式给整个卡片包 `CanAccess`，无 panel 模式只包卡片内容，可能留下空卡片头。
6. **chips/表视图标题不显示**：`table` 视图的 `views.table.label` 不会出现在界面上；只有卡片头标题可见。

> chart / chart view 的 `icon` 会随生成物收集进 `qiyIcons`（早期“图标缺失”问题已修复）；不符合 `*Outlined` 格式的名字在生成期报 `Invalid Ant Design icon`，格式正确但 Ant Design 未导出的名字在生成项目的 typecheck/build 阶段报未导出成员。

## 相关

- [菜单与 Dashboard](/guide/menu-dashboard)：`menu` 分组、旧 `dashboard { metric ... }`、概览页选择与系统管理页面链接。
- [多语言（messages / i18n）](/dsl/i18n)：消息块语法、模型派生 key、chrome 词典、回退链。
- [UI 与主题](/guide/ui-theming)：主题注册表、亮/暗/跟随系统、持久化键。
- [Refine Providers](/guide/refine-providers)：图表所用的 list/aggregate/distribution/trend 请求如何经过 DataProvider。
- [application](/dsl/application)：`ui`、`features`、`api` 等配置块的位置与语义。
- 可运行示例：[`examples/self/modules/charts.qiy`](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/charts.qiy)。
