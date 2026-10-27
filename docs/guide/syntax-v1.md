# v1 友好语法（预览）

Qiy 正在验证一套更接近需求描述的语法。**v1 是预览能力**：默认模板仍是 v0，v1 只覆盖最小子集，通过预处理器转换为 v0 后走同一套生成、校验和运行时。

```qiy
qiy v1;

project shop
database sqlite

module Catalog {
  entity Product {
    name: text
    price: decimal(12, 2) nullable
  }

  entity Order {
    reference: text unique
    customer: Customer
    lines: OrderLine[]
  }

  entity OrderLine {
    sku: text
    quantity: integer
  }
}
```

生成与校验命令不变：

```bash
qiy explain app.qiy          # 规范化摘要（自动识别 v1）
qiy generate app.qiy out/    # 生成完整应用
qiy fmt app.qiy              # 空白规范化
```

## 已支持

| 能力 | 写法 |
| --- | --- |
| 项目名 | `project shop`（替代 `qiy v0;` + `application` 外壳） |
| 数据库 | `database sqlite` / `postgresql` / `mysql` |
| 模块 | `module Catalog { ... }`（仅组织作用，可省略） |
| 实体 | `entity Product { ... }`；PascalCase 自动转 `products` 表名，小写名保持不变 |
| 字段 | `name: text`、`price: decimal(12, 2)`、`active: text` |
| 修饰符 | `primary`、`nullable`、`unique`（可组合） |
| 自动主键 | 省略 `id` 时自动生成 `field id UUID @id;` |
| 一对一关系 | `customer: Customer` → `customerId` 外键 + `relation` |
| 一对多关系 | `lines: OrderLine[]` → 在子实体生成 `orderId` 外键 + `relation`（子实体需在本文件声明） |
| 多对多关系 | 双向数组（`tags: Tag[]` + `products: Product[]`）→ 自动生成 `products_tags` join 实体与两条 one 关系 |
| 注释 | `#` 行内/独立注释 |

类型别名：`uuid` → `UUID`、`text` → `Text`、`integer/int` → `Integer`、`decimal` → `Decimal`、`money` → `Money`、`date/time/datetime`、`file/files`、`vector(n)`。

## 配置块（v0 语法透传）

v1 允许直接写常用的 v0 配置块，内容按 v0 语法解析，按规范顺序输出：

```qiy
features {
  apiDocs true;
  apiKeys true;
}

enum role {
  value admin;
  value operator;
  value viewer;
}

auth {
  provider local;
  user users;
  subjectField id;
  roleField role;
  usernameField email;
  passwordField passwordHash;
}

menu {
  group system {
    resource users;
  }
}
```

支持的透传块：`workspace`、`ui`、`api`、`features`、`realtime`、`elysia`、`storage`、`auth`、`env`、`messages`、`permission`、`workflow`、`enum`，以及实体之后的 `menu`、`dashboard`、`chart`、`dataflow`、`action`。它们内部仍使用 v0 语法（实体名使用生成后的表名，如 `users`）。

## 尚未支持（明确报错）

- `include`（v1 用 `module` 组织，不走 v0 include）；
- 单向多对多（只在一侧写 `tags: Tag[]` 会被当作一对多；多对多需要双向数组，或显式建 join 实体）；
- 自定义 `relation` 名称、`onDelete`、显示模板、注解；
- `qiy add module` / `qiy add feature`（这两个命令写 v0；`qiy add entity` / `qiy add field` 支持 v1）。

需要这些能力时继续使用 v0。不同项目/入口文件可以选择 v0 或 v1，Qiy 按入口首行自动识别，不需要额外参数。

## 为什么先做预处理器

v1 先转换成 v0 文本，再进入现有 parser：

- 生成器、运行时、错误码、测试完全复用，风险低；
- v1 与 v0 可以逐文件共存、逐步迁移；
- 预处理器只负责语法糖，真正的语义校验仍由同一套 parser 完成；
- 等语法稳定后，再把 v1 解析并入 parser 主路径。

设计目标、取舍与完整提案见 [设计理念](./design-philosophy)。
