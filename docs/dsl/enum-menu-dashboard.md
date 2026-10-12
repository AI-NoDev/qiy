# enum / menu / dashboard

## enum

```qiy
enum userRole @comment(t("enum.userRole")) {
  value admin label "管理员" color red icon SafetyOutlined @comment(t("enum.userRole.admin"));
  value operator label "运营" color blue icon UserOutlined @comment("日常运营账号");
  value viewer label "只读" color default icon EyeOutlined;
}
```

枚举和枚举值均支持 `@comment("...")` 或 `@comment(t("message.key"))`。枚举值后的 `label`、`color`、`icon` 与 `@comment` 顺序任意。字段引用枚举名时底层落为 `Text`，前端按 tag 渲染配色、图标，并把枚举值说明作为当前语言的提示文本。生成的资源元数据同时保留枚举本身的说明。

## menu

```qiy
menu {
  group operations @label("业务运营") @comment(t("menu.operations")) {}
  group sales @label("销售") @parent(operations) @comment("销售业务入口") {
    resource orders;
    resource order_items;
  }
}
```

属性：`@label` 显示名、`@icon` 图标、`@parent` 父分组、`@comment` 分组用途说明。省略 `menu` 时生成扁平菜单。菜单说明保存在生成元数据中，供自定义布局、命令面板或二次开发使用。

## dashboard

```qiy
dashboard {
  metric orderCount orders @label("订单总数") @span(8) @comment(t("dashboard.orders"));
  metric orderTrend orders @label("近30天订单") @span(24) @type(trend) @groupBy(createdAt) @days(30) @comment("按 UTC 日期统计");
}
```

`@span` 只能取 8、12、24；`@type` 为 `count`、`distribution`、`trend`。`@comment` 接受字面量或消息 key，并在 Dashboard 卡片中按当前语言显示。重复注释、缺失默认语言消息和未知注解会在生成前失败。
