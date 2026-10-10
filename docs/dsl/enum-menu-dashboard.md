# enum / menu / dashboard

## enum

```ts
enum userRole {
  value admin label "管理员" color red icon SafetyOutlined;
  value operator label "运营" color blue icon UserOutlined;
  value viewer label "只读" color default icon EyeOutlined;
}
```

枚举值后的 `label`、`color`、`icon` 顺序任意。字段引用枚举名时底层落为 `Text`，前端按 tag 渲染配色与图标。

## menu

```ts
menu {
  group operations @label("业务运营") {}
  group sales @label("销售") @parent(operations) {
    resource orders;
    resource order_items;
  }
}
```

属性：`@label` 显示名、`@icon` 图标、`@parent` 父分组。省略 `menu` 时生成扁平菜单。

## dashboard

```ts
dashboard {
  metric orderCount orders @label("订单总数") @span(8);
  metric orderTrend orders @label("近30天订单") @span(24) @type(trend) @groupBy(createdAt) @days(30);
}
```

`@span` 只能取 8、12、24；`@type` 为 `count`、`distribution`、`trend`。
