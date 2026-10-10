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

## 规则与安全边界

- `include` 只能作为 `application` 或模块片段的直接子项；不能嵌入 `entity`、`menu` 等块；
- 引用路径必须使用相对 `.qiy` 路径，推荐正斜杠；
- 不允许绝对路径、`..` 目录穿越或解析到项目根目录之外的符号链接；
- 支持递归引用，但循环引用会报出完整的引用链；
- 展开后的内容仍遵守 V0 的声明顺序：`database` 在根文件中最先声明，随后依次放置配置、`enum`、`entity`、`relation`、`scope`、`menu` 和 `dashboard`。

生成时，Qiy 会先安全展开全部模块，再执行同一套语法校验和项目生成：

```powershell
qiy generate app.qiy out/catalog-admin
```
