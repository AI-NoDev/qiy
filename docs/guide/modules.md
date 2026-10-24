# 模块化模型

大型后台项目不必把所有实体、菜单和 Dashboard 配置写进一个文件。Qiy 支持在 `.qiy` 项目的 `application` 块中通过 `include` 插入模块片段：

```qiy
qiy v0;

application catalog-admin {
  database postgresql {}

  include "modules/catalog.qiy";
  include "modules/users.qiy";
}
```

被引入的文件是 **application 内容片段**，不要再次写 `qiy v0;` 或 `application ... {}`：

```qiy
// modules/catalog.qiy
enum productStatus {
  value draft label "草稿" color "default";
  value active label "上架" color "green";
}

entity products @label("商品") @icon(ShopOutlined) {
  field id UUID @id;
  field title Text;
  field status productStatus;
}
```

模块也可以继续引用相对路径模块：

```qiy
// modules/catalog.qiy
include "shared/audit-fields.qiy";
entity products { field id UUID @id; }
```

## 只引入消息字典

当一个模块同时包含消息、枚举和实体，而当前应用只需要它的多语言消息时，可以选择唯一的顶层 `messages` 块：

```qiy [app.qiy]
qiy v0;

application catalog-admin {
  database sqlite {}
  include "modules/catalog.qiy" @messages;
  entity products { field id UUID @id; }
}
```

`@message` 是 `@messages` 的兼容别名。选择器仍会先完整解析嵌套 include，因此路径逃逸、符号链接逃逸和循环引用继续 fail-closed。目标文件必须恰好包含一个顶层 `messages` 块；缺失或重复都会报错。当前其他选择器（例如 `@menu.operations`）尚未实现，会明确拒绝而不是静默引入错误内容。

## 示例：examples/self 的领域拆分

仓库里的供应链 + ERP + WMS 示例（`examples/self/app.qiy`）就是按领域拆分的：主文件只保留配置、`include` 与 `scope` / `restrict`，实体和 UI 配置分散到 `modules/`：

```text
examples/self/app.qiy                    # database/api/realtime/auth + include + scope/restrict
examples/self/modules/platform.qiy       # 共享 enum + auth users 实体
examples/self/modules/scm/entities.qiy   # 组织/供应商/客户/产品/BOM
examples/self/modules/erp/entities.qiy   # 采购单/行、收货、销售单/行、发运
examples/self/modules/wms/entities.qiy   # 仓库/库位/库存/流水/工单
examples/self/modules/relations.qiy      # 全部 relation
examples/self/modules/messages.qiy       # zh-CN / en-US 消息词典
examples/self/modules/pages.qiy          # 页面级角色规则
examples/self/modules/dashboard.qiy      # Dashboard 指标
examples/self/modules/dataflows.qiy      # 事务型业务命令
examples/self/modules/actions.qiy        # 绑定 dataflow 的界面按钮
```

include 的位置由展开后模型的声明顺序决定，不能随意调整：

```qiy
application demo {
  database sqlite {}
  api { client rest; }
  auth { ... }

  include "modules/messages.qiy";   # 配置块之后、enum/entity 之前

  include "modules/platform.qiy";   # enum 先于 entity
  include "modules/scm/entities.qiy";
  include "modules/erp/entities.qiy";
  include "modules/wms/entities.qiy";

  include "modules/relations.qiy";  # 所有 relation 在所有 entity 之后

  scope warehouses orgId claim org.id;
  restrict products { ... }

  include "modules/pages.qiy";      # pages 在 scope/restrict 之后
  include "modules/dashboard.qiy";
  include "modules/dataflows.qiy";
  include "modules/actions.qiy";    # dataflow 之后
}
```

`tests/example-modules.test.ts` 会安全展开该示例并断言拆分前后的实体、字段、关系、页面、Dashboard、dataflow 与 action 数量一致，同时校验 `modules/messages.qiy` 为全部模型 label 提供中英翻译，避免"模块化"变成丢字段的借口。

## 规则与安全边界

- `include` 只能作为 `application` 或模块片段的直接子项；不能嵌入 `entity`、`menu` 等块；
- 引用路径必须使用相对 `.qiy` 路径，推荐正斜杠；
- 不允许绝对路径、`..` 目录穿越或解析到项目根目录之外的符号链接；
- 支持递归引用，但循环引用会报出完整的引用链；
- `@message` / `@messages` 只提取唯一的顶层 `messages` 块；其他选择器当前不受支持；
- 展开后的内容仍遵守 V0 的声明顺序：`database` 在根文件中最先声明，随后依次放置配置、`messages`、`enum`、`entity`、`relation`、`scope`、`restrict`、`pages`、`menu`、`dashboard`、`dataflow` 和 `action`。

生成时，Qiy 会先安全展开全部模块，再执行同一套语法校验和项目生成：

```powershell
qiy generate app.qiy out/catalog-admin
```
