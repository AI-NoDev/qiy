# chart（多视图图表）

`chart` 把概览页从"一排指标卡"升级为可声明布局的多视图图表页：每个 chart 声明一个数据源和 Rows/Cols 布局，布局里放一个或多个视图（view）；`chart panels` 再把 chart 引用排成 dashboard 行/列。

```qiy
chart const UserCount {
  source users;
  Row {
    Col span 12 { view stat @label("用户总数") { aggregate count; } }
    Col span 12 { view pie @label("按角色") { groupBy role; } }
  }
}

chart const MovementTrend {
  source stock_movements;
  Row {
    Col span 24 { view line @label("近 30 天库存流水") { dateField occurredAt; days 30; } }
  }
}

chart panels Overview {
  Row {
    Col span 8 { chart UserCount; }
    Col span 16 { chart MovementTrend; }
  }
}
```

## 语法

```text
chart [const] <Name> [@label("...")] {
  source <entity 或 table 名>;
  Row {
    Col [span 1..24] {
      view <stat|bar|line|pie|table> [@label("...")] {
        <statements>
      }
    }
    ...
  }
  ...
}

chart panels <Name> [@label("...")] {
  Row {
    Col [span 1..24] {
      chart <ChartName>;
      ...
    }
  }
}
```

- `chart const <Name>` 与 `chart <Name>` 等价，`const` 只是可选别名；`chart panels <Name>` 是面板块。
- chart 与 dashboard 共用同一个声明位置（`menu` 之后、`dataflow` 之前），两者可以按任意顺序书写；同一个项目可以同时有 `dashboard { metric ... }` 和 chart 块（旧语法继续工作）。
- `source` 接受实体名或 `table` 名，生成时统一归一化为表名（API 资源名）。
- `Row` 必须至少有一个 `Col`；chart 的 `Col` 省略 `span` 时默认 24，panel 的 `Col` 省略 `span` 时默认 8。每行 span 之和必须 ≤ 24。
- chart 至少要有一个 Row 和至少一个 view；panel 至少有一个 Row，每个 panel `Col` 至少引用一个 chart。

## 视图类型

| kind | 语句 | 数据来源 | 说明 |
| --- | --- | --- | --- |
| `stat` | `aggregate count\|sum\|avg\|min\|max;` + 非 count 时的 `field <field>;` | 列表 total（count）或 `/aggregate`（SQL 聚合） | 单个统计数字；`sum/avg/min/max` 的字段只能是 Integer/Decimal/Money |
| `bar` | `groupBy <enum field>;` | `/distribution` | 枚举分布，水平条形图 |
| `pie` | `groupBy <enum field>;` | `/distribution` | 同一枚举分布的环形图 |
| `line` | `dateField <DateTime field>; days <1..365>;` | `/trend` | 按天计数趋势（当前只支持 count）；`days` 省略时按 30 天渲染 |
| `table` | `columns <field>, <field>, ...;` | 列表（前 5 行） | 只读预览表，无行操作；列不能是 Vector；外键列仍显示目标记录文本 |

视图限制会被生成前校验拒绝：未知视图类型、未知语句、缺少必需语句、`stat count` 带 `field`、非数字聚合字段、`groupBy` 非枚举字段、`dateField` 非 DateTime、line 使用非 count 聚合、table 没有列、span 越界或行 span 超过 24 等都会给出带 chart 名和视图类型的错误信息。

## 校验规则

- `source` 必须指向已声明实体；未知实体、未知字段直接报错。
- 视图标签 `@label(...)` 用于生成时的回退文案；运行时通过 `qiy.charts.<chart>.label`（chart/panel 标题）与 `qiy.charts.<chart>.views.<index>.label`（视图标题）翻译，index 按布局顺序（Row → Col → 视图堆叠顺序）从 0 编号。
- chart 与 panel 的名称在同一个命名空间内唯一（重复会报错，因为两类标题共用 `qiy.charts.<name>.label` 键）。
- panel 引用的 chart 必须存在；未被任何 panel 引用的 chart 不会渲染（可复用/暂存），如果完全没有 panel 则按 12 栅格平铺渲染全部 chart。
- 不写任何 chart 时，概览页继续使用旧的 `dashboard { metric ... }` 指标卡（没有 dashboard 块时按实体生成默认计数卡）。

## 生成的渲染

生成端新增 `apps/web/app/charts.ts`（chart/panel 布局元数据 + `flattenChartViews` / `flattenPanelCharts` 等纯函数）与 `apps/web/app/components/charts.tsx`（渲染器）：

- `ChartDashboard` 按 panel 声明顺序渲染行/列；每个 chart 卡片里的 Row/Col 布局按 DSL 复现，多个视图在同一个 `Col` 内从上到下堆叠。
- `stat` 用列表 total 或 `/aggregate`，`bar`/`pie` 用 `/distribution`，`line` 用 `/trend`，`table` 用列表前 5 行；每个视图独立处理 loading/error，图表卡片包在 `CanAccess` 里，数据 scope 与页面权限仍由接口和 access control 保证。
- 概览页（`/`）在存在 chart 时渲染 `ChartDashboard`，否则回退旧指标卡；`app/dashboard.ts` 在 chart 页面下生成空指标列表。
- 图表渲染不引入新的图表依赖：bar 用 Ant Design `Progress`，line 用内联 SVG `polyline`，pie 用内联 SVG 环形图，table 用 Ant Design `Table`。
- 生成测试 `apps/web/tests/charts.test.ts` 校验布局顺序、span ≤ 24、视图 index 与 `qiy.charts.*` 键一致、panel 引用存在；生成 `model-i18n` 测试覆盖 chart/panel/view 标题的 zh-CN / en-US 词典。

完整示例见 `examples/self/modules/charts.qiy`（17 个资源的供应链 + ERP + WMS demo 的概览页）。
