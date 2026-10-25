# 模块化模型（include）

大型后台不必把所有实体、菜单与图表写进一个文件。`include` 把 `application` 的内容拆到多个相对 `.qiy` 片段中，生成前按文本展开，然后仍然走同一套语法与语义校验。

```qiy
qiy v0;

application catalog-admin {
  database sqlite {}

  include "modules/status.qiy";
  include "modules/entities.qiy";
  include "modules/relations.qiy";

  entity products { field id UUID @id; }
}
```

## 语法

```text
include "<relative-path>.qiy" [@messages | @message] ;
```

| 槽位 | 取值 | 说明 |
| --- | --- | --- |
| 路径 | 双引号或单引号字符串，以 `.qiy` 结尾 | 相对**当前文件所在目录**；绝对路径、`..`、非 `.qiy` 都拒绝 |
| 选择器 | `@messages` / `@message` | 只取目标文件中唯一的顶层 `messages` 块；其他选择器（如 `@menu.operations`）会报 `unsupported include selector` |
| 分号 | 必须 | `Expected ; after include path` |

`include` 只能出现在两个位置：

1. **入口文件**的 `application { ... }` 直接子项（`include statements must be direct children of the application or fragment`）；
2. **片段文件**的顶层（片段本身会被插入 `application` 内，因此其顶层就是 application 的直接子项）。

不能出现在 `entity`、`menu`、`dataflow`、`chart` 等块内部。

## 片段不是独立应用

片段是**纯内容**，不要写 `qiy v0;` 或 `application … {}`：

```qiy
# modules/status.qiy —— 正确
enum productStatus {
  value draft label "草稿";
  value active label "上架";
}

# 错误：片段里再写 application 会导致展开后语法错误
qiy v0;
application other { database sqlite {} }
```

Qiy 不支持一个入口文件里放多个 `application`，也不支持跨应用 include：一个 `qiy generate` / `qiy init` 只处理一个 `application`。

## 展开规则

1. 从入口文件的目录开始（项目根 = 入口文件所在目录），按字面顺序把每个 `include` 替换为目标文件的完整内容，前后各加一个换行。
2. 片段里的 `include` 递归展开；相对路径以**该片段自己的目录**为基准。
3. 展开只是文本替换：注释、空行、文件内顺序都保留。
4. 展开后的整段文本作为一个文件交给 `parseQiyProject`，因此**全局顺序与单文件完全一致**。
5. 任一环节失败都以 `文件:行号: 消息` 形式报错。

安全边界（全部 fail-closed）：

| 情况 | 错误信息 |
| --- | --- |
| 文件不存在 | `Qiy include file does not exist: …` / `Included file does not exist: …` |
| 绝对路径（含 Windows 盘符） | `include path must be relative to the current .qiy file` |
| 含 `..` | `include path cannot contain ..` |
| 非 `.qiy` 后缀 | `include path must reference a .qiy file` |
| 空路径 | `include path cannot be empty` |
| 解析结果逃出项目根 | `include path escapes the project root` |
| 符号链接指向项目根之外 | `Qiy include resolves outside the project root: …` |
| 循环引用 | `Qiy include cycle detected: a.qiy -> b.qiy -> a.qiy` |
| 未终止的字符串/块 | `Unterminated include path` / `Unterminated string literal` |
| 路径里的非法转义 | `Unsupported escape sequence \x in include path` |
| include 出现在嵌套块里 | `include statements must be direct children of the application or fragment` |
| 选择器未找到块 | `include selector @messages did not find a top-level messages block` |
| 选择器命中多个块 | `include selector @messages matched multiple top-level messages blocks` |
| 不支持的选择器 | `unsupported include selector @menu.operations; currently only @message and @messages are implemented` |

## 命名空间与重复检测

- **全局单命名空间**：所有片段与入口文件共享同一作用域，没有按文件隔离的命名。实体名、表名、枚举名、关系名、索引名（全局）、菜单分组名、指标名、dataflow/action 名都在展开后的整体上判重。
- 重复 include 同一文件（非循环）不会被去重，展开后会出现两份声明，通常报 `Entity X: duplicate entity or table name` 之类的重复错误。
- 循环引用靠 realpath 检测，同一文件用不同相对路径引用也会被识别。
- 片段可以覆盖入口文件的“位置约束”但**不能覆盖顺序**：展开后仍必须满足 `database → 配置块 → messages → permission → workflow → enum → entity → relation → scope → restrict → pages → menu → dashboard/chart → dataflow → action`。

## 推荐布局

```text
models/catalog/
├── app.qiy                     # qiy v0; + application + database + 配置块 + include + scope/restrict
└── modules/
    ├── messages.qiy            # messages（必须早于 enum/entity）
    ├── permissions.qiy         # permission（messages 之后、enum/entity 之前）
    ├── platform.qiy            # 共享 enum + auth users 实体
    ├── catalog/entities.qiy    # 领域实体
    ├── relations.qiy           # 全部 relation（所有实体之后）
    ├── pages.qiy               # pages（scope/restrict 之后）
    ├── menu.qiy                # menu（pages 之后）
    ├── charts.qiy              # chart / dashboard（menu 之后、dataflow 之前）
    ├── dataflows.qiy           # dataflow
    └── actions.qiy             # action（dataflow 之后）
```

`examples/self/app.qiy` 就是这套布局的完整实例（供应链 + ERP + WMS，17 个实体）：

| 文件 | 内容 |
| --- | --- |
| `examples/self/app.qiy` | `database sqlite`、`api`、`features`、`realtime`、`auth`、两个 `include`（messages、permissions）、领域 include、`scope`、`restrict`、UI include |
| `modules/platform.qiy` | 共享枚举（`userRole`、`purchaseStatus`…）+ `users` 实体 |
| `modules/scm/entities.qiy` | 组织/供应商/客户/产品/BOM |
| `modules/erp/entities.qiy` | 采购单/行、收货、销售单/行、发运 |
| `modules/wms/entities.qiy` | 仓库/库位/库存/流水/工单 |
| `modules/relations.qiy` | 全部 `relation`（含自关联） |
| `modules/messages.qiy` | zh-CN / en-US 全量词典 |
| `modules/permissions.qiy` | 权限字段、权限组、provider 来源、校验块 |
| `modules/pages.qiy` | 页面级角色规则 |
| `modules/menu.qiy` | 6 个菜单分组 |
| `modules/charts.qiy` | 多视图图表 + 面板 |
| `modules/dataflows.qiy` / `modules/actions.qiy` | 事务命令与按钮 |

入口文件的注释把顺序写在最前面，是这段代码的“导航图”：

```qiy
qiy v0;

application qiy-supply-chain-erp-wms @comment("供应链 + ERP + WMS 演示应用") {
  database sqlite {}
  api { client rest; }
  features { overview true; apiDocs true; apiKeys true; }
  realtime { … }
  auth { … }

  include "modules/messages.qiy";     # 配置块之后、enum/entity 之前
  include "modules/permissions.qiy";  # 可用 @label 消息，先于 enum/entity
  include "modules/platform.qiy";     # 共享 enum 必须在实体之前
  include "modules/scm/entities.qiy";
  include "modules/erp/entities.qiy";
  include "modules/wms/entities.qiy";
  include "modules/relations.qiy";    # 所有实体之后

  scope warehouses orgId claim org.id;
  restrict products { allow roles admin, operator; }

  include "modules/pages.qiy";
  include "modules/menu.qiy";
  include "modules/charts.qiy";
  include "modules/dataflows.qiy";
  include "modules/actions.qiy";
}
```

## 只引入消息字典

当模块同时包含消息、枚举和实体，而当前应用只需要它的词典时，用选择器只取 `messages`：

```qiy
include "modules/catalog.qiy" @messages;
```

- 目标文件必须**恰好**有一个顶层 `messages` 块；缺失/多个都报错。
- `@message` 是 `@messages` 的兼容别名。
- 选择在展开**之后**进行：嵌套 include、路径逃逸、符号链接逃逸与循环引用仍会先被检查。
- 被丢弃的内容（枚举、实体、其他 include）不会进入模型。

## 校验与示例测试

- `tests/qiy-include.test.ts` 覆盖嵌套展开、选择器、缺失/重复/非法选择器、循环、`..`、绝对路径、非 `.qiy`、嵌套在 `entity` 内、符号链接逃出根目录。
- `tests/example-modules.test.ts` 安全展开 `examples/self`，断言拆分前后的实体、字段、关系、页面、图表、dataflow、action 数量一致，并校验 `modules/messages.qiy` 覆盖全部模型 label 的中英翻译。

## 常见错误

| 错误 | 原因 | 修复 |
| --- | --- | --- |
| `include statements must be direct children of the application or fragment` | 写进了 `entity`/`menu`/`dataflow` 内部 | 移到 `application` 直接子项 |
| `Expected database near token N` | 片段在 `database` 之前插入了声明 | 保证展开后 `database` 仍是第一条 |
| `Expected enum near token N` / `Expected entity near token N` | 片段顺序违反全局顺序 | 按推荐布局重排 include |
| `Missing default locale message for entity comment: key` | `messages` 在实体之后 include | 把 messages 的 include 提前 |
| `duplicate entity or table name` | 同一片段被 include 两次 | 只 include 一次 |
| `include path cannot contain ..` | 用了 `../shared/x.qiy` | 把共享片段放在项目根内，用相对根内的路径 |
| `include selector @menu.operations` | 选择器尚未实现 | 直接 include 整段，或用 `@messages` |

## 相关

- [DSL 总览](/dsl/overview)：词法、顺序与校验流水线
- [application](/dsl/application)：每个配置块的语法
- [模块化模型（指南）](/guide/modules)：CLI 使用与迁移建议
- [示例：examples/self](https://github.com/AI-NoDev/qiy/blob/main/examples/self/app.qiy)
