# 最佳实践：仓储管理系统

本例是一个可直接生成的仓储管理后台。它不把所有模型堆进 `app.qiy`，而是通过相对 `include` 按职责拆分：应用配置、共享枚举、主数据、库存流水与导航各自独立。

::: tip 阅读约定
本页每一个代码块左上角都是仓库内的相对文件路径。可直接按相同路径创建文件，随后运行最后的生成命令。
:::

## 目录

<div class="qiy-code-path"><code>examples/warehouse-admin/</code></div>

```text
examples/warehouse-admin/
├── app.qiy
├── README.md
└── modules/
    ├── application-config.qiy
    ├── catalog.qiy
    ├── inventory.qiy
    ├── navigation.qiy
    └── shared/
        └── enums.qiy
```

## 根入口

根文件只保存项目边界和模块装配顺序。`database` 必须最先声明；后续内容通过相对路径插入。

<div class="qiy-code-path"><code>examples/warehouse-admin/app.qiy</code></div>

```qiy
qiy v0;

application qiy-warehouse-admin {
  database sqlite {}

  include "modules/application-config.qiy";
  include "modules/catalog.qiy";
  include "modules/inventory.qiy";
  include "modules/navigation.qiy";
}
```

## 应用配置

将前端传输、存储和后续认证等跨资源配置放到独立片段，避免和业务实体耦合。

<div class="qiy-code-path"><code>examples/warehouse-admin/modules/application-config.qiy</code></div>

```qiy
api { client rest; }

storage { provider local; }
```

## 共享枚举与主数据

`catalog.qiy` 自身继续 include 枚举片段；这让枚举能被库存模块和未来的采购模块复用。

<div class="qiy-code-path"><code>examples/warehouse-admin/modules/shared/enums.qiy</code></div>

```qiy
enum movementType {
  value inbound label "Inbound" color "green" icon LoginOutlined;
  value outbound label "Outbound" color "orange" icon LogoutOutlined;
  value adjustment label "Adjustment" color "blue" icon SwapOutlined;
}
```

<div class="qiy-code-path"><code>examples/warehouse-admin/modules/catalog.qiy</code></div>

```qiy
include "shared/enums.qiy";

entity warehouses @label("Warehouses") @icon(HomeOutlined) {
  field id UUID @id;
  field code Text @unique;
  field name Text;
}

entity products @label("Products") @icon(ShoppingOutlined) {
  field id UUID @id;
  field sku Text @unique;
  field name Text;
}
```

## 库存业务模块

关系声明紧跟所有相关实体之后。`stockMovements` 是审计友好的不可变业务流水；库存余额、预占或审批工作流可在后续模块继续扩展。

<div class="qiy-code-path"><code>examples/warehouse-admin/modules/inventory.qiy</code></div>

```qiy
entity stockMovements @label("Stock movements") @icon(SwapOutlined) {
  field id UUID @id;
  field warehouseId UUID;
  field productId UUID;
  field type movementType;
  field quantity Integer;
  field occurredAt DateTime;
}

relation stockMovementWarehouse stockMovements warehouseId warehouses id one @onDelete(restrict);
relation stockMovementProduct stockMovements productId products id one @onDelete(restrict);
```

## 菜单与 Dashboard

界面组织也是独立模块。模型更大时，可以继续按领域拆成 `sales/navigation.qiy`、`purchasing/navigation.qiy` 等片段。

<div class="qiy-code-path"><code>examples/warehouse-admin/modules/navigation.qiy</code></div>

```qiy
menu {
  group operations @label("Operations") @icon(AppstoreOutlined) {
    resource stockMovements;
  }
  group masterData @label("Master data") @icon(DatabaseOutlined) {
    resource warehouses;
    resource products;
  }
}

dashboard {
  metric movementCount stockMovements @label("Movements") @icon(SwapOutlined) @span(8);
}
```

## 生成与运行

<div class="qiy-code-path"><code>examples/warehouse-admin/README.md</code></div>

```powershell
qiy generate examples/warehouse-admin/app.qiy out/warehouse-admin

cd out/warehouse-admin
bun install
bun run build
bun run preview
```

这套组织适合从 V0 CRUD 后台逐步扩展到 ERP：优先让每个领域拥有一个入口模块；跨领域类型进入 `shared/`；根 `app.qiy` 只负责应用级配置和模块组合。
