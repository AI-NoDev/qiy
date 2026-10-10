export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "DateTime" | "File" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; color?: string; icon?: string; }
export interface ResourceField { name: string; label: string; type: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; icon?: string; dimension?: number; }
export interface ResourceDefinition { name: string; apiName: string; label: string; icon: string; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string }>; }
export const menuGroups = [
  {
    "name": "menu-masterData",
    "label": "主数据",
    "icon": "AppstoreOutlined"
  },
  {
    "name": "menu-operations",
    "label": "业务运营",
    "icon": "AppstoreOutlined"
  },
  {
    "name": "menu-inventory",
    "label": "库存",
    "icon": "DatabaseOutlined",
    "parent": "menu-operations"
  },
  {
    "name": "menu-sales",
    "label": "销售",
    "icon": "ShoppingOutlined",
    "parent": "menu-operations"
  }
] as Array<{ name: string; label: string; icon: string; parent?: string }>;
export const resources: ResourceDefinition[] = [
  {
    "name": "users",
    "apiName": "users",
    "label": "用户",
    "icon": "SafetyOutlined",
    "menuParent": "menu-masterData",
    "relatedResources": [
      {
        "resource": "orders",
        "field": "approvedBy",
        "label": "订单"
      }
    ],
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "email",
        "label": "email",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "displayName",
        "label": "displayName",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "passwordHash",
        "label": "passwordHash",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "externalSubject",
        "label": "externalSubject",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": false,
        "formVisible": true,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "role",
        "label": "角色",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "enumName": "userRole",
        "enumValues": [
          {
            "name": "admin",
            "label": "管理员",
            "color": "red",
            "icon": "SafetyOutlined"
          },
          {
            "name": "operator",
            "label": "运营",
            "color": "blue",
            "icon": "UserOutlined"
          },
          {
            "name": "viewer",
            "label": "只读",
            "color": "default",
            "icon": "EyeOutlined"
          }
        ]
      }
    ]
  },
  {
    "name": "customers",
    "apiName": "customers",
    "label": "客户",
    "icon": "TableOutlined",
    "menuParent": "menu-masterData",
    "relatedResources": [
      {
        "resource": "orders",
        "field": "customerId",
        "label": "订单"
      }
    ],
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "name",
        "label": "name",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "email",
        "label": "email",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "creditLimit",
        "label": "creditLimit",
        "type": "Money",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  },
  {
    "name": "warehouses",
    "apiName": "warehouses",
    "label": "仓库",
    "icon": "DatabaseOutlined",
    "menuParent": "menu-inventory",
    "relatedResources": [
      {
        "resource": "inventory_items",
        "field": "warehouseId",
        "label": "库存明细"
      }
    ],
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "code",
        "label": "code",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "name",
        "label": "name",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "capacity",
        "label": "capacity",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  },
  {
    "name": "products",
    "apiName": "products",
    "label": "产品",
    "icon": "TableOutlined",
    "menuParent": "menu-masterData",
    "relatedResources": [
      {
        "resource": "inventory_items",
        "field": "productId",
        "label": "库存明细"
      },
      {
        "resource": "order_items",
        "field": "productId",
        "label": "订单明细"
      }
    ],
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "sku",
        "label": "sku",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "name",
        "label": "name",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "unitPrice",
        "label": "unitPrice",
        "type": "Money",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "reorderPoint",
        "label": "reorderPoint",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "datasheet",
        "label": "产品资料",
        "type": "File",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  },
  {
    "name": "inventory_items",
    "apiName": "inventoryItems",
    "label": "库存明细",
    "icon": "TableOutlined",
    "menuParent": "menu-inventory",
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "warehouseId",
        "label": "warehouseId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "relation": {
          "resource": "warehouses",
          "labelField": "code"
        }
      },
      {
        "name": "productId",
        "label": "productId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "relation": {
          "resource": "products",
          "labelField": "name"
        }
      },
      {
        "name": "quantity",
        "label": "quantity",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "reservedQuantity",
        "label": "reservedQuantity",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  },
  {
    "name": "orders",
    "apiName": "orders",
    "label": "订单",
    "icon": "ShoppingOutlined",
    "menuParent": "menu-sales",
    "relatedResources": [
      {
        "resource": "order_items",
        "field": "orderId",
        "label": "订单明细"
      }
    ],
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "orderNumber",
        "label": "orderNumber",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "customerId",
        "label": "customerId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "relation": {
          "resource": "customers",
          "labelField": "name"
        }
      },
      {
        "name": "status",
        "label": "状态",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": false,
        "filterable": true,
        "enumName": "orderStatus",
        "enumValues": [
          {
            "name": "draft",
            "label": "草稿",
            "color": "default",
            "icon": "EditOutlined"
          },
          {
            "name": "submitted",
            "label": "已提交",
            "color": "blue",
            "icon": "SendOutlined"
          },
          {
            "name": "approved",
            "label": "已审批",
            "color": "green",
            "icon": "CheckOutlined"
          },
          {
            "name": "shipped",
            "label": "已出库",
            "color": "cyan",
            "icon": "SendOutlined"
          },
          {
            "name": "cancelled",
            "label": "已取消",
            "color": "red",
            "icon": "CloseOutlined"
          }
        ],
        "icon": "TagsOutlined"
      },
      {
        "name": "totalAmount",
        "label": "totalAmount",
        "type": "Money",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "approvedBy",
        "label": "approvedBy",
        "type": "UUID",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": false,
        "relation": {
          "resource": "users",
          "labelField": "displayName"
        }
      },
      {
        "name": "createdAt",
        "label": "createdAt",
        "type": "DateTime",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  },
  {
    "name": "order_items",
    "apiName": "orderItems",
    "label": "订单明细",
    "icon": "ShoppingOutlined",
    "menuParent": "menu-sales",
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "orderId",
        "label": "orderId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "relation": {
          "resource": "orders",
          "labelField": "id"
        }
      },
      {
        "name": "productId",
        "label": "productId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "relation": {
          "resource": "products",
          "labelField": "name"
        }
      },
      {
        "name": "quantity",
        "label": "quantity",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "unitPrice",
        "label": "unitPrice",
        "type": "Money",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  }
];
export const resourceNames = ["users","customers","warehouses","products","inventory_items","orders","order_items"] as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
