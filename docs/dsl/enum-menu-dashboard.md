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

生成前端把 `menu` 块渲染成真正的多层可折叠子菜单（`apps/web/app/components/menu.tsx` 的 `QiySider` + `buildMenuTree`）：分组顺序、组内资源顺序都按声明保留；`@parent` 生成二级子菜单；未分组的资源追加在根级，因此不写 `menu` 的旧模型仍是扁平菜单。分组名通过 `qiy.menu.<group>.label` 翻译（`modules/messages.qiy` 中声明的 zh-CN / en-US 词典）。侧边栏本身可折叠并记住状态（`localStorage` 的 `qiy.ui.sider-collapsed`）：展开宽度 248px，折叠后只显示图标（悬停显示分组/资源 tooltip），当前路由所属子菜单默认展开，移动端仍使用抽屉式侧边栏。完整示例见 `examples/self/modules/menu.qiy`。

## dashboard

```qiy
dashboard {
  metric orderCount orders @label("订单总数") @span(8) @comment(t("dashboard.orders"));
  metric orderTrend orders @label("近30天订单") @span(24) @type(trend) @groupBy(createdAt) @days(30) @comment("按 UTC 日期统计");
}
```

`@span` 只能取 8、12、24；`@type` 为 `count`、`distribution`、`trend`。`@comment` 接受字面量或消息 key，并在 Dashboard 卡片中按当前语言显示。重复注释、缺失默认语言消息和未知注解会在生成前失败。
