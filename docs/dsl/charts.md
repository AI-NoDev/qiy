# chart（多视图图表与响应式面板）

`chart` 把概览页声明成"图表 + 面板"两层：

- **chart**：一个数据视图（`const`/`pie`/`bar`/`line`/`table`）。同名 chart 用不同 kind 重复声明，就得到同一张卡片的多个视图（卡片右上角出现视图切换下拉）。
- **chart panels**：把一个或多个 chart 按 `grid <cols> <rows>` 声明的网格摆放，每个 chart 用 `larger`/`medium`/`small` 等变体给出 `x y w h` 栅格坐标；多个 panel 时页面右上角出现面板切换下拉。

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

## chart 声明

```text
chart [const|pie|bar|line|table] <Name> {
  icon  = "TeamOutlined";     # 可选，Qiy 图标名（qiyIcons）
  title = "用户总数";          # 可选，回退标题；i18n key: qiy.charts.<name>.label
  data  = ...;                # 必填，数据迷你语言（见下表）
  labels = <enum field>;      # pie/bar 可选；或 labels { value "Text"; }
}
```

- kind 可省略，默认 `const`（统计卡）。`const` 就是统计视图。
- 属性是 `key = value;` 形式；分号只在最后一个属性前可省略（`}` 之前）。`labels` 的映射块可写成 `labels { ... }` 或 `labels = { ... }`。
- **同名 chart 重复声明即多视图**：每个声明是 chart 的一个 view（`pie` + `bar`、`const` + `table` 等）；同名同 kind 重复声明会报错。
- 同名视图共享图表标题；每个 view 可通过 `qiy.charts.<chart>.views.<kind>.label` 单独翻译标题。
- `labels = <enum field>`：饼图/条形图的数值文案使用该枚举字段的 value label；再加 `qiy.charts.<chart>.labels.<value>` 词典即可覆盖（优先级：词典 > `labels` 显式映射 > 枚举 label > 原始值）。
- `labels { admin "管理员"; }`：显式映射（仍可用 `qiy.charts.<chart>.labels.admin` 覆盖），适合分组字段只有原始字符串、没有枚举元数据的场景。

## data 数据迷你语言

| data | 视图 kind | 映射接口 | 说明 |
| --- | --- | --- | --- |
| `count <entity>` | `const` | 列表 total | 单一计数 |
| `count <entity> group by <enum field>` | `pie` / `bar` | `/distribution` | 枚举分布 |
| `sum\|avg\|min\|max <entity>.<numeric field>` | `const` | `/aggregate` | 数字聚合；字段必须是 Integer/Decimal/Money |
| `sum\|avg <entity>.<field> group by <enum field>` | — | — | 当前**不支持**（生成前报错），用 `count ... group by` 或 table 视图 |
| `trend <entity>.<DateTime field> days <1..365>` | `line` | `/trend` | 按天计数趋势（只支持 count） |
| `list <entity> columns a, b, c` | `table` | 列表（前 5 行） | 只读预览，列必须是已存在标量字段（不能是 Vector） |

`<entity>` 可写实体名或 `table` 名，生成时统一归一化为表名。数据与 kind 不匹配、实体/字段不存在、枚举/日期类型不符、聚合字段非数字、`days` 越界、缺少 `columns` 等都会给出带 chart 名和 view kind 的报错。

## chart panels 声明

```text
chart panels <Name> {
  title = "概览";              # 可选，i18n key: qiy.charts.<panel>.label
  grid <cols> <rows>;         # 必填；cols 1..24，rows 1..200
  <ChartName> {
    <variant> <x> <y> <w> <h>;
    ...
  }
}
```

- `x`/`y` 是 0 基原点，`w`/`h` 是占用的栅格单元数（**定义的数字就是 CSS 栅格单元**，不是固定像素）。校验 `x + w <= cols`、`y + h <= rows`、`x,y >= 0`、`w,h >= 1`。
- 变体是响应式断点（同一 chart 每个变体只能出现一次）：

| 变体 | 生效视口 |
| --- | --- |
| `larger` / `large` / `lg` / `xl` | ≥ 1200px |
| `medium` / `md` | ≥ 768px |
| `small` / `sm` / `xs` | < 768px |

- 未知变体会报错并列出支持的集合；页面按当前视口选择最大可用变体，缺失时回退到最近的已声明大小（先找更小的，再找更大的）。
- 多个 panel 按声明顺序渲染，页面右上角的 `视图` / `View` 下拉切换 panel，选择结果写入 `localStorage` 的 `qiy.charts.panel`；只有一个 panel 时不显示页面级选择器。
- 每个 panel 至少引用一个 chart，每个引用至少一个变体；重复引用同一 chart、引用不存在的 chart、panel/chart 名称冲突都会报错。未出现在任何 panel 的 chart 不会渲染；完全没有 panel 时按 12 栅格平铺渲染全部 chart。
- 不写任何 chart 时，概览页继续使用旧的 `dashboard { metric ... }` 指标卡。

## i18n 键

| key | 用途 |
| --- | --- |
| `qiy.charts.<name>.label` | chart 卡片标题 / panel 标题 |
| `qiy.charts.<chart>.views.<kind>.label` | 视图标题（kind = `const`/`pie`/`bar`/`line`/`table`） |
| `qiy.charts.<chart>.labels.<value>` | 饼图/条形图数值文案覆盖 |
| `qiy.chartView` | 视图/面板选择器的无障碍标签（内置为 视图 / View） |
| `qiy.chartViewKind.<kind>` | 视图类型标签（统计/饼图/柱状图/折线图/表格） |

## 生成的页面

- `apps/web/app/charts.ts`：chart/panel/placement 元数据 + 纯函数（`selectChartPlacement` 变体选择、`chartViewportCategory`、panel 选择持久化、`findChart`、`defaultChartView`）。
- `apps/web/app/components/charts.tsx`：`ChartDashboard`/`ChartCard`。面板用 CSS Grid（`grid-template-columns: repeat(cols, …)` + 每张卡片 `grid-column: x+1 / span w`、`grid-row: y+1 / span h`）渲染；`matchMedia` 监听断点切换变体；多视图卡片右上角是视图类型下拉，多面板页面右上角是面板下拉。
- 数据：`const` 用列表 total 或 `/aggregate`，`pie`/`bar` 用 `/distribution`，`line` 用 `/trend`，`table` 用列表前 5 行（AntD Table，无编辑操作）。每个视图独立 loading/error，卡片包在 `CanAccess` 中，scope/权限仍由接口保证。
- 渲染不引入重型图表依赖：条形图用 AntD `Progress`，饼图/折线图用内联 SVG，表格用 Ant Design `Table`。
- 生成测试 `apps/web/tests/charts.test.ts` 覆盖视图分组、栅格边界、变体选择、panel 持久化；`apps/web/tests/charts-render.test.tsx` 用 SSR + mock 数据覆盖五种视图、视图选择器只在多视图时出现、页面选择器只在多面板时出现。

完整示例见 `examples/self/modules/charts.qiy`。
