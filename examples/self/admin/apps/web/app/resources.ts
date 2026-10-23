export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "DateTime" | "File" | "Files" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; color?: string; icon?: string; comment?: string; commentKey?: string; }
export interface ResourceEnumDefinition { name: string; comment?: string; commentKey?: string; values: ResourceEnumValue[]; }
export interface ResourceField { name: string; label: string; comment?: string; commentKey?: string; type: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; filterModes: string[]; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; icon?: string; dimension?: number; uploadMode?: "binary" | "base64" | "both"; maxBytes?: number; mimeTypes?: string[]; maxFiles?: number; /** Page-level layout: the field is only rendered for these roles. */ roles?: string[]; }
/** Page-level field layout check; a field without role rules is visible to everyone. */
export function canSeeField(field: ResourceField, role: string | undefined | null): boolean { return !field.roles || field.roles.includes(role ?? ""); }
 export interface ResourceDefinition { name: string; apiName: string; label: string; comment?: string; commentKey?: string; icon: string; liveMode: "auto" | "manual" | "off"; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string }>; }
export const enumerations: ResourceEnumDefinition[] = [
  {
    "name": "userRole",
    "values": [
      {
        "name": "admin",
        "label": "Administrator",
        "color": "red",
        "icon": "SafetyOutlined"
      },
      {
        "name": "operator",
        "label": "Operator",
        "color": "blue",
        "icon": "UserOutlined"
      },
      {
        "name": "viewer",
        "label": "Viewer",
        "color": "default",
        "icon": "EyeOutlined"
      }
    ]
  },
  {
    "name": "purchaseStatus",
    "values": [
      {
        "name": "draft"
      },
      {
        "name": "approved"
      },
      {
        "name": "received"
      },
      {
        "name": "closed"
      },
      {
        "name": "cancelled"
      }
    ]
  },
  {
    "name": "salesStatus",
    "values": [
      {
        "name": "draft"
      },
      {
        "name": "confirmed"
      },
      {
        "name": "allocated"
      },
      {
        "name": "shipped"
      },
      {
        "name": "closed"
      },
      {
        "name": "cancelled"
      }
    ]
  },
  {
    "name": "workStatus",
    "values": [
      {
        "name": "planned"
      },
      {
        "name": "released"
      },
      {
        "name": "in_progress"
      },
      {
        "name": "completed"
      },
      {
        "name": "cancelled"
      }
    ]
  },
  {
    "name": "activeState",
    "values": [
      {
        "name": "active"
      },
      {
        "name": "inactive"
      }
    ]
  },
  {
    "name": "movementType",
    "values": [
      {
        "name": "receipt"
      },
      {
        "name": "issue"
      },
      {
        "name": "transfer"
      },
      {
        "name": "adjust"
      },
      {
        "name": "production"
      },
      {
        "name": "consumption"
      }
    ]
  }
];
export const menuGroups = [] as Array<{ name: string; label: string; icon: string; parent?: string; comment?: string; commentKey?: string }>;
export const resources: ResourceDefinition[] = [
  {
    "name": "users",
    "apiName": "users",
    "label": "Users",
    "icon": "UserOutlined",
    "liveMode": "off",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "subject",
        "label": "subject",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "googleSubject",
        "label": "googleSubject",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "openidField",
        "label": "openidField",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "keycloakSubject",
        "label": "keycloakSubject",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "displayName",
        "label": "displayName",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "role",
        "label": "role",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "userRole",
        "enumValues": [
          {
            "name": "admin",
            "label": "Administrator",
            "color": "red",
            "icon": "SafetyOutlined"
          },
          {
            "name": "operator",
            "label": "Operator",
            "color": "blue",
            "icon": "UserOutlined"
          },
          {
            "name": "viewer",
            "label": "Viewer",
            "color": "default",
            "icon": "EyeOutlined"
          }
        ]
      },
      {
        "name": "orgId",
        "label": "orgId",
        "type": "UUID",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "orgs",
          "labelField": "code"
        }
      }
    ]
  },
  {
    "name": "orgs",
    "apiName": "orgs",
    "label": "Organizations",
    "icon": "ClusterOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "users",
        "field": "orgId",
        "label": "Users"
      },
      {
        "resource": "warehouses",
        "field": "orgId",
        "label": "Warehouses"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "parentId",
        "label": "parentId",
        "type": "UUID",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "suppliers",
    "apiName": "suppliers",
    "label": "Suppliers",
    "icon": "ShopOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "purchase_orders",
        "field": "supplierId",
        "label": "Purchase orders"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "leadTimeDays",
        "label": "leadTimeDays",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "customers",
    "apiName": "customers",
    "label": "Customers",
    "icon": "TeamOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "sales_orders",
        "field": "customerId",
        "label": "Sales orders"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "creditLimit",
        "label": "creditLimit",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "products",
    "apiName": "products",
    "label": "Products",
    "icon": "ShoppingOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "inventory",
        "field": "productId",
        "label": "Inventory"
      },
      {
        "resource": "stock_movements",
        "field": "productId",
        "label": "Stock movements"
      },
      {
        "resource": "purchase_order_lines",
        "field": "productId",
        "label": "Purchase order lines"
      },
      {
        "resource": "sales_order_lines",
        "field": "productId",
        "label": "Sales order lines"
      },
      {
        "resource": "work_orders",
        "field": "productId",
        "label": "Work orders"
      },
      {
        "resource": "boms",
        "field": "productId",
        "label": "Bill of materials"
      },
      {
        "resource": "boms",
        "field": "componentId",
        "label": "Bill of materials"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "uom",
        "label": "uom",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "unitCost",
        "label": "unitCost",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "price",
        "label": "price",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "active",
        "label": "active",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "activeState",
        "enumValues": [
          {
            "name": "active"
          },
          {
            "name": "inactive"
          }
        ]
      }
    ]
  },
  {
    "name": "boms",
    "apiName": "boms",
    "label": "Bill of materials",
    "icon": "ApartmentOutlined",
    "liveMode": "off",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "products",
          "labelField": "name"
        }
      },
      {
        "name": "componentId",
        "label": "componentId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "warehouses",
    "apiName": "warehouses",
    "label": "Warehouses",
    "icon": "HomeOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "bins",
        "field": "warehouseId",
        "label": "Storage bins"
      },
      {
        "resource": "inventory",
        "field": "warehouseId",
        "label": "Inventory"
      },
      {
        "resource": "stock_movements",
        "field": "warehouseId",
        "label": "Stock movements"
      },
      {
        "resource": "receipts",
        "field": "warehouseId",
        "label": "Goods receipts"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "orgId",
        "label": "orgId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "orgs",
          "labelField": "code"
        }
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "active",
        "label": "active",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "activeState",
        "enumValues": [
          {
            "name": "active"
          },
          {
            "name": "inactive"
          }
        ]
      }
    ]
  },
  {
    "name": "bins",
    "apiName": "bins",
    "label": "Storage bins",
    "icon": "AppstoreOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "inventory",
        "field": "binId",
        "label": "Inventory"
      },
      {
        "resource": "stock_movements",
        "field": "binId",
        "label": "Stock movements"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "warehouses",
          "labelField": "code"
        }
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
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "inventory",
    "apiName": "inventory",
    "label": "Inventory",
    "icon": "DatabaseOutlined",
    "liveMode": "auto",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "inventoryKey",
        "label": "inventoryKey",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "warehouses",
          "labelField": "code"
        }
      },
      {
        "name": "binId",
        "label": "binId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "bins",
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "reserved",
        "label": "reserved",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "lotCode",
        "label": "lotCode",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "updatedAt",
        "label": "updatedAt",
        "type": "DateTime",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "stock_movements",
    "apiName": "stock_movements",
    "label": "Stock movements",
    "icon": "SwapOutlined",
    "liveMode": "auto",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "products",
          "labelField": "name"
        }
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "warehouses",
          "labelField": "code"
        }
      },
      {
        "name": "binId",
        "label": "binId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "bins",
          "labelField": "code"
        }
      },
      {
        "name": "type",
        "label": "type",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "movementType",
        "enumValues": [
          {
            "name": "receipt"
          },
          {
            "name": "issue"
          },
          {
            "name": "transfer"
          },
          {
            "name": "adjust"
          },
          {
            "name": "production"
          },
          {
            "name": "consumption"
          }
        ]
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "reference",
        "label": "reference",
        "type": "Text",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "occurredAt",
        "label": "occurredAt",
        "type": "DateTime",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "purchase_orders",
    "apiName": "purchase_orders",
    "label": "Purchase orders",
    "icon": "FileTextOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "purchase_order_lines",
        "field": "purchaseOrderId",
        "label": "Purchase order lines"
      },
      {
        "resource": "receipts",
        "field": "purchaseOrderId",
        "label": "Goods receipts"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "number",
        "label": "number",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "supplierId",
        "label": "supplierId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "suppliers",
          "labelField": "code"
        }
      },
      {
        "name": "status",
        "label": "status",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "purchaseStatus",
        "enumValues": [
          {
            "name": "draft"
          },
          {
            "name": "approved"
          },
          {
            "name": "received"
          },
          {
            "name": "closed"
          },
          {
            "name": "cancelled"
          }
        ]
      },
      {
        "name": "orderedAt",
        "label": "orderedAt",
        "type": "DateTime",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "total",
        "label": "total",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "purchase_order_lines",
    "apiName": "purchase_order_lines",
    "label": "Purchase order lines",
    "icon": "UnorderedListOutlined",
    "liveMode": "off",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "purchaseOrderId",
        "label": "purchaseOrderId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "purchase_orders",
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "unitCost",
        "label": "unitCost",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "receipts",
    "apiName": "receipts",
    "label": "Goods receipts",
    "icon": "InboxOutlined",
    "liveMode": "off",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "purchaseOrderId",
        "label": "purchaseOrderId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "purchase_orders",
          "labelField": "id"
        }
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "warehouses",
          "labelField": "code"
        }
      },
      {
        "name": "status",
        "label": "status",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "receivedAt",
        "label": "receivedAt",
        "type": "DateTime",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "sales_orders",
    "apiName": "sales_orders",
    "label": "Sales orders",
    "icon": "ShoppingCartOutlined",
    "liveMode": "off",
    "relatedResources": [
      {
        "resource": "sales_order_lines",
        "field": "salesOrderId",
        "label": "Sales order lines"
      },
      {
        "resource": "shipments",
        "field": "salesOrderId",
        "label": "Shipments"
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "number",
        "label": "number",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "customers",
          "labelField": "code"
        }
      },
      {
        "name": "status",
        "label": "status",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "salesStatus",
        "enumValues": [
          {
            "name": "draft"
          },
          {
            "name": "confirmed"
          },
          {
            "name": "allocated"
          },
          {
            "name": "shipped"
          },
          {
            "name": "closed"
          },
          {
            "name": "cancelled"
          }
        ]
      },
      {
        "name": "orderedAt",
        "label": "orderedAt",
        "type": "DateTime",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "total",
        "label": "total",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "sales_order_lines",
    "apiName": "sales_order_lines",
    "label": "Sales order lines",
    "icon": "OrderedListOutlined",
    "liveMode": "off",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "salesOrderId",
        "label": "salesOrderId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "sales_orders",
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "unitPrice",
        "label": "unitPrice",
        "type": "Decimal",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "allocated",
        "label": "allocated",
        "type": "Integer",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "shipments",
    "apiName": "shipments",
    "label": "Shipments",
    "icon": "CarOutlined",
    "liveMode": "auto",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "salesOrderId",
        "label": "salesOrderId",
        "type": "UUID",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
        "relation": {
          "resource": "sales_orders",
          "labelField": "id"
        }
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "status",
        "label": "status",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
      },
      {
        "name": "shippedAt",
        "label": "shippedAt",
        "type": "DateTime",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  },
  {
    "name": "work_orders",
    "apiName": "work_orders",
    "label": "Work orders",
    "icon": "ToolOutlined",
    "liveMode": "off",
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "number",
        "label": "number",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "contains",
          "startsWith",
          "endsWith",
          "eq"
        ]
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
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ],
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
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      },
      {
        "name": "status",
        "label": "status",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq"
        ],
        "enumName": "workStatus",
        "enumValues": [
          {
            "name": "planned"
          },
          {
            "name": "released"
          },
          {
            "name": "in_progress"
          },
          {
            "name": "completed"
          },
          {
            "name": "cancelled"
          }
        ]
      },
      {
        "name": "plannedAt",
        "label": "plannedAt",
        "type": "DateTime",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true,
        "filterModes": [
          "eq",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
          "in"
        ]
      }
    ]
  }
];
export const resourceNames = ["users","orgs","suppliers","customers","products","boms","warehouses","bins","inventory","stock_movements","purchase_orders","purchase_order_lines","receipts","sales_orders","sales_order_lines","shipments","work_orders"] as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
