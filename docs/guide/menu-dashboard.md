# 菜单与概览页

侧边栏与概览页由两组 DSL 决定：

| DSL | 位置 | 生成物 |
| --- | --- | --- |
| `menu { group ... }` | `pages` 之后、`chart` 之前 | `app/resources.ts` 的 `menuGroups` + `QiySider` 树 |
| `chart` / `chart panels` | `menu` 之后、`dataflow` 之前 | `app/charts.ts` + `ChartDashboard` |

两者都只描述界面结构；权限、数据范围仍由服务端接口与 Refine access control 决定。图表的完整语法见 [chart（多视图图表）](/dsl/charts)。

## 菜单

### 语法

```qiy
menu {
  group masterData @label("主数据") @icon(AppstoreOutlined) {
    resource suppliers;
    resource customers;
    resource products;
  }
  group operations @label("业务运营") @icon(AppstoreOutlined) {}
  group inventory @label("库存") @icon(DatabaseOutlined) @parent(operations) {
    resource warehouses;
    resource inventory;
  }
  group sales @label("销售") @icon(ShoppingOutlined) @parent(operations) {
    resource orders;
    resource order_lines;
  }
}
```

```text
menu {
  group <GroupName> [@label(<value>)] [@icon(<value>)] [@parent(<group>)] [@comment(<doc>)] {
    resource <resource>;
    ...
  }
  ...
}
```

- `menu` 块在 `application {}` 内**最多一个**；不写时生成扁平菜单。
- 一个分组可以没有任何 `resource`（纯容器分组，用于承载 `@parent` 子组）。
- `@label`、`@icon`、`@parent`、`@comment` 顺序任意、可省略；每个最多一次。
- `@comment` 支持字面量或 `t("key")`，进入生成元数据供二次开发使用，不渲染在侧边栏。
- `resource` 的值是**资源名（表名）**，不是实体名；`entity Order table orders` 应写 `resource orders;`。
- 解析器按固定顺序读取：`menu` 必须在 `pages`（若有）之后、`chart`（若有）之前。

### 参数表

| 元素 | 必填 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `group <name>` | **是** | 标识符，全模型唯一 | 无 | 侧边栏子菜单的 key（`menu-<name>`） |
| `@label(...)` | 否 | 字符串 | 组名 | 分组显式文案；i18n 优先 `qiy.menu.<group>.label` |
| `@icon(...)` | 否 | Ant Design `*Outlined` | `AppstoreOutlined` | 分组图标 |
| `@parent(...)` | 否 | 已声明的组名 | 无 | 嵌套到父分组；支持多级 |
| `@comment(...)` | 否 | 字面量 / `t("key")` | 无 | 元数据说明 |
| `resource <name>` | 否（可空组） | 资源名（表名） | 无 | 组内顺序即声明顺序 |

### 默认值与校验

解析与生成校验：

- 组名必须是标识符；`@label`/`@icon`/`@parent` 的值必须是合法 `value()`（字符串或标识符）。
- 未知注解：`Unsupported menu group attribute @<x>`。
- 重复 `@comment`：`Menu group <name>: duplicate @comment annotation`。
- 组内出现非 `resource` token：`Expected resource near token <n>`。

生成阶段校验：

- 组名非法或重复：`Menu group <name>: invalid or duplicate name`。
- 组内资源不存在：`Menu group <g>: unknown resource <r>`。
- 同一资源被两个组引用（或在同一组重复）：`Menu group <g>: duplicate resource <r>`。
- `@parent` 指向不存在的组：`Menu group <g>: unknown parent <p>`。
- 父链成环：`Menu group <g>: cyclic parent`。
- 图标不符合 `/^[A-Z][a-zA-Z0-9]*Outlined$/`：`Invalid Ant Design icon <name>`。

补充事实：

- 组内的 `resource` 顺序保留；**未出现在任何组**的资源追加到根级，所以"只给部分资源分组"是合法的：已分组的进子菜单，其余仍是根级条目。
- 一个资源最多属于一个组；想让它出现在两处需要自定义扩展（生成器的 `assignedResources` 会拒绝重复）。
- 菜单没有"隐藏资源"开关；不可见性由 `restrict.roles` / `pages` + access control 决定。

### 生成结果

```text
apps/web/app/resources.ts              # menuGroups: group -> resources（保持声明顺序）
apps/web/app/components/menu.tsx       # buildMenuTree + QiySider（纯函数 + 侧边栏）
apps/web/app/root.tsx                  # Refine resources 的 meta.parent 指向 menu-<group>
apps/web/tests/menu-tree.test.ts       # 排序/嵌套/未分组/隐藏资源断言
```

- `menuGroups` 的 `name` 是 `menu-<group>`；资源元数据带 `menuParent: "menu-<group>"`，Refine 的 `useMenu` 据此把资源挂到分组下。
- `buildMenuTree` 组装的树：
  1. 所有分组按**声明顺序**挂到根或 `@parent`；
  2. 每个组按**声明顺序**追加资源节点；
  3. 未分组资源按资源声明顺序追加到根；
  4. `features` 生成的页面链接追加到"系统管理"组（不存在时自动创建）；
  5. 最后在根级最前面插入概览入口（`qiy-overview`，`/`）。
- `selectedMenuKey` 取当前路径第一段；`openMenuKeys` 展开从根到当前项的所有子菜单。折叠状态下 `openKeys` 不生效，AntD 用弹出层显示子菜单。
- `QiySider` 是自定义 `ThemedLayout` sider：展开 248px、折叠 72px、`lg` 断点以下变抽屉；折叠状态持久化到 `localStorage` 的 `qiy.ui.sider-collapsed`（`collapsed`/`expanded`）。
- 退出登录按钮追加在菜单最后（仅已认证时）。

### 排序

| 顺序来源 | 规则 |
| --- | --- |
| 分组 | 声明顺序（`@parent` 只改变挂载位置，不改变同级顺序） |
| 组内资源 | `resource` 声明顺序 |
| 未分组资源 | 资源在模型中的声明顺序 |
| 概览 | 永远第一 |
| 系统管理页面链接 | 功能总览 → API 文档 → 访问密钥（生成的 `qiyMenuLinks` 顺序） |
| 退出登录 | 永远最后 |

### 图标

- 分组图标默认 `AppstoreOutlined`；`@icon` 必须是 Ant Design 的 `*Outlined` 名字。
- 生成器把菜单分组图标加入 `app/icons.tsx` 的 `qiyIcons`，因此真实存在的分组图标可用。
- 只做**名字格式**校验（`XxxOutlined`），不校验该图标是否真实存在；写一个格式正确但并不存在的 `FooOutlined` 会让生成的 `icons.tsx` 在类型检查/构建时报导入失败。可用 `grep Outlined node_modules/@ant-design/icons/lib/icons/index.d.ts` 或查阅 AntD 图标列表确认。
- 资源节点的图标来自实体的 `@icon`（默认 `TableOutlined`），同样进入 `qiyIcons`。

### 角色过滤

- 侧边栏用 Refine 的 `useMenu()` 计算可访问资源；`useMenu` 内部调用生成的 `qiyAccessControlProvider.can({ resource, action: "list" })`。
- 只有"当前角色允许 `list`"的资源才会保留；分组下所有资源都被过滤掉时，**整个分组隐藏**。
- 资源级规则来源：`restrict { allow roles ... }`、`pages <resource> { list roles ... }`、以及默认角色策略（`admin` 全放行；`users` 资源非 admin 不可见；`operator` 可执行任意动作；其他角色仅 `list`/`show`）。
- **概览入口**与**系统管理页面链接不是资源**，不经过 `useMenu` 过滤，始终显示；这些页面本身仍要求登录并按权限过滤内容（见 [features](/dsl/features)）。
- access control 只控制可见性/导航；直接访问 URL 或调用 API 仍由服务端守卫拒绝。

### i18n

| key | 用途 | 回退 |
| --- | --- | --- |
| `qiy.menu.<group>.label` | 分组文案 | `@label` → 组名 |
| `qiy.resources.<table>.plural` | 菜单资源节点文案（优先） | `@plural` → `@label` → 表名 |
| `qiy.resources.<table>.label` | 资源标题、面包屑（不直接用于菜单节点） | 实体 `@label` → 实体名 |
| `qiy.overview` | 概览菜单项与概览页标题 | 内置"概览 / Overview" |
| `qiy.docs.title` / `qiy.apiDocs.title` / `qiy.apiKey.title` | 系统管理页面链接 | 内置 |
| `qiy.buttons.logout` | 退出登录（Refine 键，可被项目 messages 覆盖） | 内置 |

**坑**：`QiySider` 对资源节点的解析是 `translate(pluralKey, {}, resource.label)`——即只查 `.plural` 词典，缺失时回退 DSL 里的 `@label` 原文，**不会**回退到 `.label` 词典。若只翻译 `.label` 而没写 `.plural`，菜单会保持原文。稳妥做法是给每个资源同时声明 `.label`、`.singular`、`.plural`（`examples/self/modules/messages.qiy` 就是这样做的）。

### 交互与移动端

- 当前路由的祖先分组自动展开；用户手动展开的分组在同一会话内保留。
- 折叠后只显示图标，AntD 为条目显示 tooltip、为子菜单显示浮层。
- `lg` 以下使用抽屉（Drawer）：点击遮罩或菜单项关闭；方向跟随 RTL。
- 侧边栏标题组件默认 `ThemedTitle`（显示 "Qiy Admin"），可从 `QiyThemedLayout` 的 `Title` prop 覆盖。

## 概览页

概览页（`/`）的主体只由 `chart` 决定：

| 模型情况 | 概览页主体 |
| --- | --- |
| 声明了 `chart` | `ChartDashboard`：多视图卡片 + `chart panels` 响应式栅格 |
| 没有 `chart` | 每个可写资源一张计数卡（`ResourceSummary`）：资源图标、复数名、总数，整卡链接到列表；只读资源（如 `view`）不出卡 |

计数卡用 `useList` 取 `page=1&pageSize=1` 的 `total`，包在 `CanAccess resource=<resource> action="list"` 中；标题走 `qiy.resources.<table>.plural` → `.label` → 实体 `@label`。

概览页固定结构：

- 标题：`qiy.overview`；说明：`qiy.overviewDescription`（内置中文"概览"/"从数据资源快速进入业务管理。"）。
- 主体：`ChartDashboard` 或计数卡 `Row`。
- 底部"快速访问"卡片：`qiy.quickAccess`，列出**前 4 个资源**的列表链接（`resources.slice(0, 4)`），每个包 `CanAccess list`。

图表的完整语法、校验、端点和 i18n 见 [chart（多视图图表）](/dsl/charts)。与菜单的衔接只有两点：chart 与 panel 的名称在全模型唯一且与菜单分组无关；面板选择存 `qiy.charts.panel`，视图选择不持久化。

## 示例：最小菜单 + 图表模型

```qiy
qiy v0;

application menu-demo {
  database sqlite {}

  enum activeState {
    value active label "启用";
    value inactive label "停用";
  }

  entity Product table products @label("Products") @icon(AppstoreOutlined) {
    field id UUID @id;
    field name Text @label("Name");
    field active activeState;
  }

  menu {
    group masterData @label("主数据") @icon(AppstoreOutlined) {
      resource products;
    }
  }

  chart const ProductCount { title = "产品数"; icon = "TableOutlined"; data = count products; }
  chart pie ProductActive { title = "启用分布"; data = count products group by active; labels = active; }
}
```

生成结果：侧边栏只有一个"主数据 → Products"分组；概览页是"产品数"统计卡 + "启用分布"饼图。删掉两个 `chart` 则回到每资源一张计数卡。

## 进阶用法

### 多级菜单 + 纯容器分组

```qiy
menu {
  group operations @label("业务运营") @icon(AppstoreOutlined) {}
  group purchasing @parent(operations) @label("采购") @icon(ShoppingCartOutlined) {
    resource purchase_orders;
    resource receipts;
  }
  group sales @parent(operations) @label("销售") @icon(ShoppingOutlined) {
    resource sales_orders;
    resource shipments;
  }
  group system @label("系统管理") @icon(SafetyOutlined) {
    resource users;
    resource orgs;
  }
}
```

`operations` 自身没有资源，只作为父容器；`features` 生成的页面链接会追加到 `system` 组。

### 分组 + 未分组混排

只给主数据分组，其余资源留在根级：

```qiy
menu {
  group masterData @label("主数据") @icon(AppstoreOutlined) {
    resource suppliers;
    resource products;
  }
}
```

生成结果：根级依次是 概览 → 主数据（子菜单）→ 其余资源 → 退出登录。

### 与 features 页面的关系

`features { apiDocs true; apiKeys true; }` 会生成三个页面链接，并追加到 `system` 分组；模型没有 `system` 分组时自动创建，`labelKey` 为 `qiy.menu.system.label`。因此建议显式声明 `group system`，这样分组名、图标与顺序都由模型控制。

## 常见错误

| 报错 | 原因 | 修复 |
| --- | --- | --- |
| `Menu group <g>: unknown resource <r>` | `resource` 用了实体名或拼错 | 改用表名 |
| `Menu group <g>: duplicate resource <r>` | 同一资源出现在两个组 | 只保留一处 |
| `Menu group <g>: unknown parent <p>` | `@parent` 指向未声明组 | 先声明父组或修正名字 |
| `Menu group <g>: cyclic parent` | 父链成环 | 打破环 |
| `Menu group <g>: invalid or duplicate name` | 组名非法/重复 | 改名 |
| `Invalid Ant Design icon <name>` | 图标不是 `XxxOutlined` 格式 | 换合法格式的 Ant Design 图标 |
| `Unsupported menu group attribute @x` | 未知注解 | 只用 label/icon/parent/comment |
| 分组不显示 | 组内资源都被角色过滤 | 检查 `restrict`/`pages`/角色 |
| 菜单项是原文而非译文 | 只写了 `.label`，没写 `.plural` | 同时声明 `.plural` |

## 相关

- [chart（多视图图表）](/dsl/charts)：图表语法、面板栅格、视图切换、i18n。
- [enum / menu](/dsl/enum-menu-dashboard)：`enum` / `menu` 的精简语法卡。
- [多语言（messages / i18n）](/dsl/i18n)：`qiy.menu.*`、`qiy.resources.*.plural`、chrome 键与回退链。
- [UI 与主题](/guide/ui-theming)：侧边栏折叠、主题与色彩模式持久化。
- [features](/dsl/features)：系统管理页面与菜单链接生成规则。
- [Refine Providers](/guide/refine-providers)：access control 如何过滤菜单、图表请求如何走 DataProvider。
- 示例：[`examples/self/modules/menu.qiy`](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/menu.qiy)、[`examples/self/modules/charts.qiy`](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/charts.qiy)。
