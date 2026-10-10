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
