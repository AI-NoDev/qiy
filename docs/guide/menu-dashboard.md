# 菜单与 Dashboard

## 多级菜单

```ts
menu {
  group masterData @label("主数据") @icon(AppstoreOutlined) {
    resource users;
    resource customers;
    resource products;
  }
  group operations @label("业务运营") @icon(AppstoreOutlined) {}
  group inventory @label("库存") @icon(DatabaseOutlined) @parent(operations) {
    resource warehouses;
    resource inventory_items;
  }
  group sales @label("销售") @icon(ShoppingOutlined) @parent(operations) {
    resource orders;
    resource order_items;
  }
}
```

不写 `menu` 时自动生成一层扁平菜单；写了 `menu` 就以分组为准。`@parent` 支持多级嵌套，资源名可以是实体名或 `table` 名。

生成的侧边栏由 `app/components/menu.tsx` 的 `QiySider` 渲染：它把 `resources` 元数据和 `menuGroups` 组装成嵌套的 Ant Design `Menu.SubMenu`，因此分组是真正可折叠的子菜单，而不是把资源平铺成一行。侧边栏展开宽度 248px，可折叠为 72px 的图标模式（Ant Design 在折叠时自动为条目显示 tooltip、为子菜单显示弹出层），折叠状态写入 `localStorage` 的 `qiy.ui.sider-collapsed`，刷新和导航后保持；当前路由所属分组默认展开。角色可见性仍由 `CanAccess` 包裹每个分组/资源，与 Refine 默认侧边栏一致。移动端（`lg` 断点以下）继续使用抽屉式侧边栏。分组文案通过 `qiy.menu.<group>.label` 翻译，未声明时回退 `@label`。

## 图表概览页（chart）

新的图表 DSL 用 `chart` / `chart panels` 声明概览页：每个 chart 声明数据视图（同名不同 kind = 多视图卡片），panel 用 `grid` 栅格和响应式变体摆放 chart：

```qiy
chart const UserCount {
  icon = "TeamOutlined";
  title = "用户总数";
  data = count users;
}
chart pie UserStatusCount {
  title = "用户状态分布";
  data = count users group by role;
  labels = role;
}
chart bar UserStatusCount {          // 同一张卡片的第二个视图
  title = "用户状态分布";
  data = count users group by role;
  labels = role;
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
    medium 12 0 12 2;
    small 0 3 24 4;
  }
}
```

视图类型 `const`（统计）/ `pie` / `bar` / `line` / `table`，分别复用列表 total、`/aggregate`、`/distribution`、`/trend` 与列表接口；`grid <cols> <rows>` + `larger/medium/small <x> <y> <w> <h>` 定义卡片栅格坐标（数字就是栅格单元数），多个 panel 时页面右上角出现面板切换器，多视图卡片右上角出现视图类型切换器。有 chart 时概览页渲染 `ChartDashboard`，否则回退下面的旧 `dashboard { metric ... }` 指标卡。完整语法、校验和生成结果见 [chart（多视图图表）](/dsl/charts)。

## Dashboard 指标

```ts
dashboard {
  metric orderCount orders @label("订单总数") @icon(ShoppingOutlined) @span(8);
  metric customerCount customers @label("客户数") @icon(UserOutlined) @span(12);
  metric orderStatusBreakdown orders @label("订单状态") @span(12) @type(distribution) @groupBy(status);
  metric orderTrend orders @label("近30天订单") @span(24) @type(trend) @groupBy(createdAt) @days(30);
}
```

| 属性 | 取值 |
| --- | --- |
| `@span` | `8`、`12`、`24` |
| `@type` | `count`（默认）、`distribution`、`trend` |
| `@groupBy` | 分布或趋势的分组字段 |
| `@days` | 趋势的时间窗口 |

`distribution` 与 `trend` 由服务端聚合，接口直接返回统计结果。

## 枚举与显示

```ts
enum orderStatus {
  value draft label "草稿" color default icon EditOutlined;
  value submitted label "已提交" color blue icon SendOutlined;
  value shipped label "已出库" color cyan icon SendOutlined;
  value cancelled label "已取消" color red icon CloseOutlined;
}
```

`@label` 提供显示名，枚举值可单独配置 `label`、`color`、`icon`。icon 使用 Ant Design 图标名，与 Refine 默认 antd 组件库一致。
