/** Generated OpenAPI 3.1 + documentation metadata. Do not edit by hand. */
export type DocsRole = "admin" | "operator" | "viewer";
export type DocsAction = "list" | "show" | "create" | "edit" | "delete";
export interface DocsPrincipal { role: DocsRole; permissions?: string[] }
export interface DocsEnumValue { name: string; label: string; labelKey: string }
export interface DocsFieldRelation { table: string; field: string; onDelete?: string }
export interface DocsField {
  name: string;
  label: string;
  labelKey: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  enumName?: string;
  enumValues?: DocsEnumValue[];
  annotations: string[];
  relation?: DocsFieldRelation;
}
export interface DocsEntity {
  name: string;
  tableName: string;
  label: string;
  labelKey: string;
  singular: string;
  plural: string;
  display?: string;
  tableDisplay?: string;
  fields: DocsField[];
  relations: Array<{ field: string; toTable: string; toField: string; onDelete?: string }>;
}
export interface DocsRelation { fromTable: string; field: string; toTable: string; toField: string; onDelete?: string }
export interface DocsDataflowAction { kind: string; summary: string }
export interface DocsDataflowInput { name: string; type: string; required: boolean; label: string; labelKey: string }
export interface DocsDataflow {
  name: string;
  label: string;
  labelKey: string;
  allowRoles: string[];
  allowPermissions: string[];
  verification: string | null;
  inputs: DocsDataflowInput[];
  contexts: Array<{ name: string; entity: string }>;
  steps: Array<{ name: string; actions: DocsDataflowAction[] }>;
  result: string;
}
export interface DocsPermissionField { name: string; value: string; label: string; labelKey: string }
export interface DocsPermissionGroup { name: string; members: string[]; label: string; labelKey: string }
export interface DocsPermissionVerification { name: string; label: string; labelKey: string; inputs: Array<{ name: string; type: string }> }
export interface DocsMeta {
  app: { name: string; description?: string; descriptionKey?: string };
  userTable: string | null;
  features: { overview: boolean; apiDocs: boolean; apiKeys: boolean };
  loginEnabled: boolean;
  pageRules: Record<string, Record<string, string[]>>;
  restrictions: Array<{ resource: string; roles: string[] }>;
  entities: DocsEntity[];
  relations: DocsRelation[];
  enums: Array<{ name: string; values: DocsEnumValue[] }>;
  dataflows: DocsDataflow[];
  permissions: { fields: DocsPermissionField[]; groups: DocsPermissionGroup[]; verifications: DocsPermissionVerification[] };
}
export interface GeneratedOpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, Record<string, unknown>> };
  "x-qiy-generated": true;
  "x-qiy-principal": { role: DocsRole; permissions: string[] };
}

export const docsMeta: DocsMeta = {
  "app": {
    "name": "qiy-supply-chain-erp-wms",
    "description": "供应链 + ERP + WMS 演示应用：17 个实体、事务型业务命令与系统管理功能"
  },
  "userTable": "users",
  "features": {
    "overview": true,
    "apiDocs": true,
    "apiKeys": true
  },
  "loginEnabled": true,
  "pageRules": {
    "inventory": {
      "list": [
        "admin",
        "operator"
      ],
      "show": [
        "admin",
        "operator"
      ],
      "create": [
        "admin",
        "operator"
      ],
      "edit": [
        "admin",
        "operator"
      ],
      "delete": [
        "admin"
      ]
    },
    "stock_movements": {
      "list": [
        "admin",
        "operator"
      ],
      "show": [
        "admin",
        "operator"
      ],
      "create": [
        "admin",
        "operator"
      ],
      "edit": [
        "admin"
      ],
      "delete": [
        "admin"
      ]
    },
    "purchase_orders": {
      "list": [
        "admin",
        "operator"
      ],
      "show": [
        "admin",
        "operator"
      ],
      "create": [
        "admin",
        "operator"
      ],
      "edit": [
        "admin",
        "operator"
      ],
      "delete": [
        "admin"
      ]
    },
    "sales_orders": {
      "list": [
        "admin",
        "operator"
      ],
      "show": [
        "admin",
        "operator"
      ],
      "create": [
        "admin",
        "operator"
      ],
      "edit": [
        "admin",
        "operator"
      ],
      "delete": [
        "admin"
      ]
    }
  },
  "restrictions": [
    {
      "resource": "products",
      "roles": [
        "admin",
        "operator"
      ]
    }
  ],
  "entities": [
    {
      "name": "users",
      "tableName": "users",
      "label": "Users",
      "labelKey": "qiy.resources.users.label",
      "singular": "User",
      "plural": "Users",
      "display": "{$.displayName}",
      "tableDisplay": "{$.displayName}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.users.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "subject",
          "label": "subject",
          "labelKey": "qiy.resources.users.fields.subject.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "oktaSubject",
          "label": "oktaSubject",
          "labelKey": "qiy.resources.users.fields.oktaSubject.label",
          "type": "Text",
          "nullable": true,
          "unique": true,
          "annotations": [
            "unique",
            "nullable"
          ]
        },
        {
          "name": "keycloakSubject",
          "label": "keycloakSubject",
          "labelKey": "qiy.resources.users.fields.keycloakSubject.label",
          "type": "Text",
          "nullable": true,
          "unique": true,
          "annotations": [
            "unique",
            "nullable"
          ]
        },
        {
          "name": "googleSubject",
          "label": "googleSubject",
          "labelKey": "qiy.resources.users.fields.googleSubject.label",
          "type": "Text",
          "nullable": true,
          "unique": true,
          "annotations": [
            "unique",
            "nullable"
          ]
        },
        {
          "name": "kindeSubject",
          "label": "kindeSubject",
          "labelKey": "qiy.resources.users.fields.kindeSubject.label",
          "type": "Text",
          "nullable": true,
          "unique": true,
          "annotations": [
            "unique",
            "nullable"
          ]
        },
        {
          "name": "azureSubject",
          "label": "azureSubject",
          "labelKey": "qiy.resources.users.fields.azureSubject.label",
          "type": "Text",
          "nullable": true,
          "unique": true,
          "annotations": [
            "unique",
            "nullable"
          ]
        },
        {
          "name": "email",
          "label": "email",
          "labelKey": "qiy.resources.users.fields.email.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "displayName",
          "label": "displayName",
          "labelKey": "qiy.resources.users.fields.displayName.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "role",
          "label": "role",
          "labelKey": "qiy.resources.users.fields.role.label",
          "type": "Text",
          "nullable": false,
          "enumName": "userRole",
          "enumValues": [
            {
              "name": "admin",
              "label": "Administrator",
              "labelKey": "qiy.enums.userRole.values.admin"
            },
            {
              "name": "operator",
              "label": "Operator",
              "labelKey": "qiy.enums.userRole.values.operator"
            },
            {
              "name": "viewer",
              "label": "Viewer",
              "labelKey": "qiy.enums.userRole.values.viewer"
            }
          ],
          "annotations": []
        },
        {
          "name": "passwordHash",
          "label": "passwordHash",
          "labelKey": "qiy.resources.users.fields.passwordHash.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "oauthProfiles",
          "label": "oauthProfiles",
          "labelKey": "qiy.resources.users.fields.oauthProfiles.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "permissions",
          "label": "permissions",
          "labelKey": "qiy.resources.users.fields.permissions.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "orgId",
          "label": "orgId",
          "labelKey": "qiy.resources.users.fields.orgId.label",
          "type": "UUID",
          "nullable": true,
          "annotations": [
            "nullable",
            "relation:orgs"
          ],
          "relation": {
            "table": "orgs",
            "field": "id",
            "onDelete": "restrict"
          }
        }
      ],
      "relations": [
        {
          "field": "orgId",
          "toTable": "orgs",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "orgs",
      "tableName": "orgs",
      "label": "Organizations",
      "labelKey": "qiy.resources.orgs.label",
      "singular": "Organization",
      "plural": "Organizations",
      "display": "{$.code} · {$.name}",
      "tableDisplay": "{$.code} · {$.name}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.orgs.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "code",
          "label": "code",
          "labelKey": "qiy.resources.orgs.fields.code.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique",
            "generated:code"
          ]
        },
        {
          "name": "name",
          "label": "name",
          "labelKey": "qiy.resources.orgs.fields.name.label",
          "type": "Text",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "parentId",
          "label": "parentId",
          "labelKey": "qiy.resources.orgs.fields.parentId.label",
          "type": "UUID",
          "nullable": true,
          "annotations": [
            "nullable",
            "relation:orgs"
          ],
          "relation": {
            "table": "orgs",
            "field": "id",
            "onDelete": "set null"
          }
        },
        {
          "name": "externalId",
          "label": "externalId",
          "labelKey": "qiy.resources.orgs.fields.externalId.label",
          "type": "UUID",
          "nullable": true,
          "annotations": [
            "nullable",
            "generated:uuid"
          ]
        }
      ],
      "relations": [
        {
          "field": "parentId",
          "toTable": "orgs",
          "toField": "id",
          "onDelete": "set null"
        }
      ]
    },
    {
      "name": "suppliers",
      "tableName": "suppliers",
      "label": "Suppliers",
      "labelKey": "qiy.resources.suppliers.label",
      "singular": "Supplier",
      "plural": "Suppliers",
      "display": "{$.code} · {$.name}",
      "tableDisplay": "{$.code} · {$.name}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.suppliers.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "code",
          "label": "code",
          "labelKey": "qiy.resources.suppliers.fields.code.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique",
            "generated:code"
          ]
        },
        {
          "name": "name",
          "label": "name",
          "labelKey": "qiy.resources.suppliers.fields.name.label",
          "type": "Text",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "email",
          "label": "email",
          "labelKey": "qiy.resources.suppliers.fields.email.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "leadTimeDays",
          "label": "leadTimeDays",
          "labelKey": "qiy.resources.suppliers.fields.leadTimeDays.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": []
    },
    {
      "name": "customers",
      "tableName": "customers",
      "label": "Customers",
      "labelKey": "qiy.resources.customers.label",
      "singular": "Customer",
      "plural": "Customers",
      "display": "{$.code} · {$.name}",
      "tableDisplay": "{$.code} · {$.name}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.customers.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "code",
          "label": "code",
          "labelKey": "qiy.resources.customers.fields.code.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique",
            "generated:code"
          ]
        },
        {
          "name": "name",
          "label": "name",
          "labelKey": "qiy.resources.customers.fields.name.label",
          "type": "Text",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "email",
          "label": "email",
          "labelKey": "qiy.resources.customers.fields.email.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "creditLimit",
          "label": "creditLimit",
          "labelKey": "qiy.resources.customers.fields.creditLimit.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": []
    },
    {
      "name": "products",
      "tableName": "products",
      "label": "Products",
      "labelKey": "qiy.resources.products.label",
      "singular": "Product",
      "plural": "Products",
      "display": "{$.sku} · {$.name}",
      "tableDisplay": "{$.sku} · {$.name}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.products.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "sku",
          "label": "sku",
          "labelKey": "qiy.resources.products.fields.sku.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "name",
          "label": "name",
          "labelKey": "qiy.resources.products.fields.name.label",
          "type": "Text",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "uom",
          "label": "uom",
          "labelKey": "qiy.resources.products.fields.uom.label",
          "type": "Text",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "unitCost",
          "label": "unitCost",
          "labelKey": "qiy.resources.products.fields.unitCost.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": [
            "masked"
          ]
        },
        {
          "name": "price",
          "label": "price",
          "labelKey": "qiy.resources.products.fields.price.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "reorderPoint",
          "label": "reorderPoint",
          "labelKey": "qiy.resources.products.fields.reorderPoint.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "active",
          "label": "active",
          "labelKey": "qiy.resources.products.fields.active.label",
          "type": "Text",
          "nullable": false,
          "enumName": "activeState",
          "enumValues": [
            {
              "name": "active",
              "label": "active",
              "labelKey": "qiy.enums.activeState.values.active"
            },
            {
              "name": "inactive",
              "label": "inactive",
              "labelKey": "qiy.enums.activeState.values.inactive"
            }
          ],
          "annotations": []
        }
      ],
      "relations": []
    },
    {
      "name": "boms",
      "tableName": "boms",
      "label": "Bill of materials",
      "labelKey": "qiy.resources.boms.label",
      "singular": "BOM line",
      "plural": "Bill of materials",
      "display": "{$.quantity}",
      "tableDisplay": "{$.quantity}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.boms.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "productId",
          "label": "productId",
          "labelKey": "qiy.resources.boms.fields.productId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "componentId",
          "label": "componentId",
          "labelKey": "qiy.resources.boms.fields.componentId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "quantity",
          "label": "quantity",
          "labelKey": "qiy.resources.boms.fields.quantity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "productId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "componentId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "purchase_orders",
      "tableName": "purchase_orders",
      "label": "Purchase orders",
      "labelKey": "qiy.resources.purchase_orders.label",
      "singular": "Purchase order",
      "plural": "Purchase orders",
      "display": "{$.number}",
      "tableDisplay": "{$.number}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.purchase_orders.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "number",
          "label": "number",
          "labelKey": "qiy.resources.purchase_orders.fields.number.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique",
            "generated:code"
          ]
        },
        {
          "name": "supplierId",
          "label": "supplierId",
          "labelKey": "qiy.resources.purchase_orders.fields.supplierId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:suppliers"
          ],
          "relation": {
            "table": "suppliers",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "status",
          "label": "status",
          "labelKey": "qiy.resources.purchase_orders.fields.status.label",
          "type": "Text",
          "nullable": false,
          "enumName": "purchaseStatus",
          "enumValues": [
            {
              "name": "draft",
              "label": "draft",
              "labelKey": "qiy.enums.purchaseStatus.values.draft"
            },
            {
              "name": "approved",
              "label": "approved",
              "labelKey": "qiy.enums.purchaseStatus.values.approved"
            },
            {
              "name": "received",
              "label": "received",
              "labelKey": "qiy.enums.purchaseStatus.values.received"
            },
            {
              "name": "closed",
              "label": "closed",
              "labelKey": "qiy.enums.purchaseStatus.values.closed"
            },
            {
              "name": "cancelled",
              "label": "cancelled",
              "labelKey": "qiy.enums.purchaseStatus.values.cancelled"
            }
          ],
          "annotations": []
        },
        {
          "name": "orderedAt",
          "label": "orderedAt",
          "labelKey": "qiy.resources.purchase_orders.fields.orderedAt.label",
          "type": "DateTime",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "expectedDate",
          "label": "expectedDate",
          "labelKey": "qiy.resources.purchase_orders.fields.expectedDate.label",
          "type": "Date",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "total",
          "label": "total",
          "labelKey": "qiy.resources.purchase_orders.fields.total.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "supplierId",
          "toTable": "suppliers",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "purchase_order_lines",
      "tableName": "purchase_order_lines",
      "label": "Purchase order lines",
      "labelKey": "qiy.resources.purchase_order_lines.label",
      "singular": "Purchase order line",
      "plural": "Purchase order lines",
      "display": "{$.quantity}",
      "tableDisplay": "{$.quantity}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.purchase_order_lines.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "purchaseOrderId",
          "label": "purchaseOrderId",
          "labelKey": "qiy.resources.purchase_order_lines.fields.purchaseOrderId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:purchase_orders"
          ],
          "relation": {
            "table": "purchase_orders",
            "field": "id",
            "onDelete": "cascade"
          }
        },
        {
          "name": "productId",
          "label": "productId",
          "labelKey": "qiy.resources.purchase_order_lines.fields.productId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "quantity",
          "label": "quantity",
          "labelKey": "qiy.resources.purchase_order_lines.fields.quantity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "unitCost",
          "label": "unitCost",
          "labelKey": "qiy.resources.purchase_order_lines.fields.unitCost.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "purchaseOrderId",
          "toTable": "purchase_orders",
          "toField": "id",
          "onDelete": "cascade"
        },
        {
          "field": "productId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "receipts",
      "tableName": "receipts",
      "label": "Goods receipts",
      "labelKey": "qiy.resources.receipts.label",
      "singular": "Goods receipt",
      "plural": "Goods receipts",
      "display": "{$.status}",
      "tableDisplay": "{$.status}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.receipts.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "purchaseOrderId",
          "label": "purchaseOrderId",
          "labelKey": "qiy.resources.receipts.fields.purchaseOrderId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:purchase_orders"
          ],
          "relation": {
            "table": "purchase_orders",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "warehouseId",
          "label": "warehouseId",
          "labelKey": "qiy.resources.receipts.fields.warehouseId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:warehouses"
          ],
          "relation": {
            "table": "warehouses",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "status",
          "label": "status",
          "labelKey": "qiy.resources.receipts.fields.status.label",
          "type": "Text",
          "nullable": false,
          "enumName": "receiptStatus",
          "enumValues": [
            {
              "name": "draft",
              "label": "draft",
              "labelKey": "qiy.enums.receiptStatus.values.draft"
            },
            {
              "name": "received",
              "label": "received",
              "labelKey": "qiy.enums.receiptStatus.values.received"
            },
            {
              "name": "inspected",
              "label": "inspected",
              "labelKey": "qiy.enums.receiptStatus.values.inspected"
            },
            {
              "name": "closed",
              "label": "closed",
              "labelKey": "qiy.enums.receiptStatus.values.closed"
            },
            {
              "name": "cancelled",
              "label": "cancelled",
              "labelKey": "qiy.enums.receiptStatus.values.cancelled"
            }
          ],
          "annotations": []
        },
        {
          "name": "receivedAt",
          "label": "receivedAt",
          "labelKey": "qiy.resources.receipts.fields.receivedAt.label",
          "type": "DateTime",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        }
      ],
      "relations": [
        {
          "field": "purchaseOrderId",
          "toTable": "purchase_orders",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "warehouseId",
          "toTable": "warehouses",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "sales_orders",
      "tableName": "sales_orders",
      "label": "Sales orders",
      "labelKey": "qiy.resources.sales_orders.label",
      "singular": "Sales order",
      "plural": "Sales orders",
      "display": "{$.number}",
      "tableDisplay": "{$.number}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.sales_orders.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "number",
          "label": "number",
          "labelKey": "qiy.resources.sales_orders.fields.number.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "customerId",
          "label": "customerId",
          "labelKey": "qiy.resources.sales_orders.fields.customerId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:customers"
          ],
          "relation": {
            "table": "customers",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "status",
          "label": "status",
          "labelKey": "qiy.resources.sales_orders.fields.status.label",
          "type": "Text",
          "nullable": false,
          "enumName": "salesStatus",
          "enumValues": [
            {
              "name": "draft",
              "label": "draft",
              "labelKey": "qiy.enums.salesStatus.values.draft"
            },
            {
              "name": "confirmed",
              "label": "confirmed",
              "labelKey": "qiy.enums.salesStatus.values.confirmed"
            },
            {
              "name": "allocated",
              "label": "allocated",
              "labelKey": "qiy.enums.salesStatus.values.allocated"
            },
            {
              "name": "shipped",
              "label": "shipped",
              "labelKey": "qiy.enums.salesStatus.values.shipped"
            },
            {
              "name": "closed",
              "label": "closed",
              "labelKey": "qiy.enums.salesStatus.values.closed"
            },
            {
              "name": "cancelled",
              "label": "cancelled",
              "labelKey": "qiy.enums.salesStatus.values.cancelled"
            }
          ],
          "annotations": []
        },
        {
          "name": "orderedAt",
          "label": "orderedAt",
          "labelKey": "qiy.resources.sales_orders.fields.orderedAt.label",
          "type": "DateTime",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "total",
          "label": "total",
          "labelKey": "qiy.resources.sales_orders.fields.total.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "customerId",
          "toTable": "customers",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "sales_order_lines",
      "tableName": "sales_order_lines",
      "label": "Sales order lines",
      "labelKey": "qiy.resources.sales_order_lines.label",
      "singular": "Sales order line",
      "plural": "Sales order lines",
      "display": "{$.quantity}",
      "tableDisplay": "{$.quantity}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.sales_order_lines.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "salesOrderId",
          "label": "salesOrderId",
          "labelKey": "qiy.resources.sales_order_lines.fields.salesOrderId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:sales_orders"
          ],
          "relation": {
            "table": "sales_orders",
            "field": "id",
            "onDelete": "cascade"
          }
        },
        {
          "name": "productId",
          "label": "productId",
          "labelKey": "qiy.resources.sales_order_lines.fields.productId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "quantity",
          "label": "quantity",
          "labelKey": "qiy.resources.sales_order_lines.fields.quantity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "unitPrice",
          "label": "unitPrice",
          "labelKey": "qiy.resources.sales_order_lines.fields.unitPrice.label",
          "type": "Decimal",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "allocated",
          "label": "allocated",
          "labelKey": "qiy.resources.sales_order_lines.fields.allocated.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "salesOrderId",
          "toTable": "sales_orders",
          "toField": "id",
          "onDelete": "cascade"
        },
        {
          "field": "productId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "shipments",
      "tableName": "shipments",
      "label": "Shipments",
      "labelKey": "qiy.resources.shipments.label",
      "singular": "Shipment",
      "plural": "Shipments",
      "display": "{$.status}",
      "tableDisplay": "{$.status}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.shipments.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "salesOrderId",
          "label": "salesOrderId",
          "labelKey": "qiy.resources.shipments.fields.salesOrderId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:sales_orders"
          ],
          "relation": {
            "table": "sales_orders",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "warehouseId",
          "label": "warehouseId",
          "labelKey": "qiy.resources.shipments.fields.warehouseId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:warehouses"
          ],
          "relation": {
            "table": "warehouses",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "status",
          "label": "status",
          "labelKey": "qiy.resources.shipments.fields.status.label",
          "type": "Text",
          "nullable": false,
          "enumName": "shipmentStatus",
          "enumValues": [
            {
              "name": "pending",
              "label": "pending",
              "labelKey": "qiy.enums.shipmentStatus.values.pending"
            },
            {
              "name": "shipped",
              "label": "shipped",
              "labelKey": "qiy.enums.shipmentStatus.values.shipped"
            },
            {
              "name": "delivered",
              "label": "delivered",
              "labelKey": "qiy.enums.shipmentStatus.values.delivered"
            },
            {
              "name": "cancelled",
              "label": "cancelled",
              "labelKey": "qiy.enums.shipmentStatus.values.cancelled"
            }
          ],
          "annotations": []
        },
        {
          "name": "shippedAt",
          "label": "shippedAt",
          "labelKey": "qiy.resources.shipments.fields.shippedAt.label",
          "type": "DateTime",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "departureTime",
          "label": "departureTime",
          "labelKey": "qiy.resources.shipments.fields.departureTime.label",
          "type": "Time",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        }
      ],
      "relations": [
        {
          "field": "salesOrderId",
          "toTable": "sales_orders",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "warehouseId",
          "toTable": "warehouses",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "warehouses",
      "tableName": "warehouses",
      "label": "Warehouses",
      "labelKey": "qiy.resources.warehouses.label",
      "singular": "Warehouse",
      "plural": "Warehouses",
      "display": "{$.code} · {$.name}",
      "tableDisplay": "{$.code} · {$.name}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.warehouses.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "orgId",
          "label": "orgId",
          "labelKey": "qiy.resources.warehouses.fields.orgId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:orgs"
          ],
          "relation": {
            "table": "orgs",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "code",
          "label": "code",
          "labelKey": "qiy.resources.warehouses.fields.code.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "name",
          "label": "name",
          "labelKey": "qiy.resources.warehouses.fields.name.label",
          "type": "Text",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "active",
          "label": "active",
          "labelKey": "qiy.resources.warehouses.fields.active.label",
          "type": "Text",
          "nullable": false,
          "enumName": "activeState",
          "enumValues": [
            {
              "name": "active",
              "label": "active",
              "labelKey": "qiy.enums.activeState.values.active"
            },
            {
              "name": "inactive",
              "label": "inactive",
              "labelKey": "qiy.enums.activeState.values.inactive"
            }
          ],
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "orgId",
          "toTable": "orgs",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "bins",
      "tableName": "bins",
      "label": "Storage bins",
      "labelKey": "qiy.resources.bins.label",
      "singular": "Storage bin",
      "plural": "Storage bins",
      "display": "{$.code}",
      "tableDisplay": "{$.code}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.bins.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "warehouseId",
          "label": "warehouseId",
          "labelKey": "qiy.resources.bins.fields.warehouseId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:warehouses"
          ],
          "relation": {
            "table": "warehouses",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "code",
          "label": "code",
          "labelKey": "qiy.resources.bins.fields.code.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "capacity",
          "label": "capacity",
          "labelKey": "qiy.resources.bins.fields.capacity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "warehouseId",
          "toTable": "warehouses",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "inventory",
      "tableName": "inventory",
      "label": "Inventory",
      "labelKey": "qiy.resources.inventory.label",
      "singular": "Inventory record",
      "plural": "Inventory",
      "display": "{$.inventoryKey}",
      "tableDisplay": "{$.inventoryKey}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.inventory.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "inventoryKey",
          "label": "inventoryKey",
          "labelKey": "qiy.resources.inventory.fields.inventoryKey.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "warehouseId",
          "label": "warehouseId",
          "labelKey": "qiy.resources.inventory.fields.warehouseId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:warehouses"
          ],
          "relation": {
            "table": "warehouses",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "binId",
          "label": "binId",
          "labelKey": "qiy.resources.inventory.fields.binId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:bins"
          ],
          "relation": {
            "table": "bins",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "productId",
          "label": "productId",
          "labelKey": "qiy.resources.inventory.fields.productId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "quantity",
          "label": "quantity",
          "labelKey": "qiy.resources.inventory.fields.quantity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "reserved",
          "label": "reserved",
          "labelKey": "qiy.resources.inventory.fields.reserved.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "lotCode",
          "label": "lotCode",
          "labelKey": "qiy.resources.inventory.fields.lotCode.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "updatedAt",
          "label": "updatedAt",
          "labelKey": "qiy.resources.inventory.fields.updatedAt.label",
          "type": "DateTime",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        }
      ],
      "relations": [
        {
          "field": "warehouseId",
          "toTable": "warehouses",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "binId",
          "toTable": "bins",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "productId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "stock_movements",
      "tableName": "stock_movements",
      "label": "Stock movements",
      "labelKey": "qiy.resources.stock_movements.label",
      "singular": "Stock movement",
      "plural": "Stock movements",
      "display": "{$.type}",
      "tableDisplay": "{$.type}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.stock_movements.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "productId",
          "label": "productId",
          "labelKey": "qiy.resources.stock_movements.fields.productId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "warehouseId",
          "label": "warehouseId",
          "labelKey": "qiy.resources.stock_movements.fields.warehouseId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:warehouses"
          ],
          "relation": {
            "table": "warehouses",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "binId",
          "label": "binId",
          "labelKey": "qiy.resources.stock_movements.fields.binId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:bins"
          ],
          "relation": {
            "table": "bins",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "type",
          "label": "type",
          "labelKey": "qiy.resources.stock_movements.fields.type.label",
          "type": "Text",
          "nullable": false,
          "enumName": "movementType",
          "enumValues": [
            {
              "name": "receipt",
              "label": "receipt",
              "labelKey": "qiy.enums.movementType.values.receipt"
            },
            {
              "name": "issue",
              "label": "issue",
              "labelKey": "qiy.enums.movementType.values.issue"
            },
            {
              "name": "transfer",
              "label": "transfer",
              "labelKey": "qiy.enums.movementType.values.transfer"
            },
            {
              "name": "adjust",
              "label": "adjust",
              "labelKey": "qiy.enums.movementType.values.adjust"
            },
            {
              "name": "production",
              "label": "production",
              "labelKey": "qiy.enums.movementType.values.production"
            },
            {
              "name": "consumption",
              "label": "consumption",
              "labelKey": "qiy.enums.movementType.values.consumption"
            }
          ],
          "annotations": []
        },
        {
          "name": "quantity",
          "label": "quantity",
          "labelKey": "qiy.resources.stock_movements.fields.quantity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "reference",
          "label": "reference",
          "labelKey": "qiy.resources.stock_movements.fields.reference.label",
          "type": "Text",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        },
        {
          "name": "occurredAt",
          "label": "occurredAt",
          "labelKey": "qiy.resources.stock_movements.fields.occurredAt.label",
          "type": "DateTime",
          "nullable": true,
          "annotations": [
            "nullable"
          ]
        }
      ],
      "relations": [
        {
          "field": "productId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "warehouseId",
          "toTable": "warehouses",
          "toField": "id",
          "onDelete": "restrict"
        },
        {
          "field": "binId",
          "toTable": "bins",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    },
    {
      "name": "work_orders",
      "tableName": "work_orders",
      "label": "Work orders",
      "labelKey": "qiy.resources.work_orders.label",
      "singular": "Work order",
      "plural": "Work orders",
      "display": "{$.number}",
      "tableDisplay": "{$.number}",
      "fields": [
        {
          "name": "id",
          "label": "id",
          "labelKey": "qiy.resources.work_orders.fields.id.label",
          "type": "UUID",
          "nullable": false,
          "primaryKey": true,
          "annotations": [
            "primaryKey"
          ]
        },
        {
          "name": "number",
          "label": "number",
          "labelKey": "qiy.resources.work_orders.fields.number.label",
          "type": "Text",
          "nullable": false,
          "unique": true,
          "annotations": [
            "unique"
          ]
        },
        {
          "name": "productId",
          "label": "productId",
          "labelKey": "qiy.resources.work_orders.fields.productId.label",
          "type": "UUID",
          "nullable": false,
          "annotations": [
            "relation:products"
          ],
          "relation": {
            "table": "products",
            "field": "id",
            "onDelete": "restrict"
          }
        },
        {
          "name": "quantity",
          "label": "quantity",
          "labelKey": "qiy.resources.work_orders.fields.quantity.label",
          "type": "Integer",
          "nullable": false,
          "annotations": []
        },
        {
          "name": "status",
          "label": "status",
          "labelKey": "qiy.resources.work_orders.fields.status.label",
          "type": "Text",
          "nullable": false,
          "enumName": "workStatus",
          "enumValues": [
            {
              "name": "planned",
              "label": "planned",
              "labelKey": "qiy.enums.workStatus.values.planned"
            },
            {
              "name": "released",
              "label": "released",
              "labelKey": "qiy.enums.workStatus.values.released"
            },
            {
              "name": "in_progress",
              "label": "in_progress",
              "labelKey": "qiy.enums.workStatus.values.in_progress"
            },
            {
              "name": "completed",
              "label": "completed",
              "labelKey": "qiy.enums.workStatus.values.completed"
            },
            {
              "name": "cancelled",
              "label": "cancelled",
              "labelKey": "qiy.enums.workStatus.values.cancelled"
            }
          ],
          "annotations": []
        },
        {
          "name": "plannedAt",
          "label": "plannedAt",
          "labelKey": "qiy.resources.work_orders.fields.plannedAt.label",
          "type": "DateTime",
          "nullable": false,
          "annotations": []
        }
      ],
      "relations": [
        {
          "field": "productId",
          "toTable": "products",
          "toField": "id",
          "onDelete": "restrict"
        }
      ]
    }
  ],
  "relations": [
    {
      "fromTable": "orgs",
      "field": "parentId",
      "toTable": "orgs",
      "toField": "id",
      "onDelete": "set null"
    },
    {
      "fromTable": "users",
      "field": "orgId",
      "toTable": "orgs",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "warehouses",
      "field": "orgId",
      "toTable": "orgs",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "bins",
      "field": "warehouseId",
      "toTable": "warehouses",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "inventory",
      "field": "warehouseId",
      "toTable": "warehouses",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "inventory",
      "field": "binId",
      "toTable": "bins",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "inventory",
      "field": "productId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "stock_movements",
      "field": "productId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "stock_movements",
      "field": "warehouseId",
      "toTable": "warehouses",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "stock_movements",
      "field": "binId",
      "toTable": "bins",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "purchase_orders",
      "field": "supplierId",
      "toTable": "suppliers",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "purchase_order_lines",
      "field": "purchaseOrderId",
      "toTable": "purchase_orders",
      "toField": "id",
      "onDelete": "cascade"
    },
    {
      "fromTable": "purchase_order_lines",
      "field": "productId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "receipts",
      "field": "purchaseOrderId",
      "toTable": "purchase_orders",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "receipts",
      "field": "warehouseId",
      "toTable": "warehouses",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "sales_orders",
      "field": "customerId",
      "toTable": "customers",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "sales_order_lines",
      "field": "salesOrderId",
      "toTable": "sales_orders",
      "toField": "id",
      "onDelete": "cascade"
    },
    {
      "fromTable": "sales_order_lines",
      "field": "productId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "shipments",
      "field": "salesOrderId",
      "toTable": "sales_orders",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "shipments",
      "field": "warehouseId",
      "toTable": "warehouses",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "work_orders",
      "field": "productId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "boms",
      "field": "productId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    },
    {
      "fromTable": "boms",
      "field": "componentId",
      "toTable": "products",
      "toField": "id",
      "onDelete": "restrict"
    }
  ],
  "enums": [
    {
      "name": "userRole",
      "values": [
        {
          "name": "admin",
          "label": "Administrator",
          "labelKey": "qiy.enums.userRole.values.admin"
        },
        {
          "name": "operator",
          "label": "Operator",
          "labelKey": "qiy.enums.userRole.values.operator"
        },
        {
          "name": "viewer",
          "label": "Viewer",
          "labelKey": "qiy.enums.userRole.values.viewer"
        }
      ]
    },
    {
      "name": "purchaseStatus",
      "values": [
        {
          "name": "draft",
          "label": "draft",
          "labelKey": "qiy.enums.purchaseStatus.values.draft"
        },
        {
          "name": "approved",
          "label": "approved",
          "labelKey": "qiy.enums.purchaseStatus.values.approved"
        },
        {
          "name": "received",
          "label": "received",
          "labelKey": "qiy.enums.purchaseStatus.values.received"
        },
        {
          "name": "closed",
          "label": "closed",
          "labelKey": "qiy.enums.purchaseStatus.values.closed"
        },
        {
          "name": "cancelled",
          "label": "cancelled",
          "labelKey": "qiy.enums.purchaseStatus.values.cancelled"
        }
      ]
    },
    {
      "name": "salesStatus",
      "values": [
        {
          "name": "draft",
          "label": "draft",
          "labelKey": "qiy.enums.salesStatus.values.draft"
        },
        {
          "name": "confirmed",
          "label": "confirmed",
          "labelKey": "qiy.enums.salesStatus.values.confirmed"
        },
        {
          "name": "allocated",
          "label": "allocated",
          "labelKey": "qiy.enums.salesStatus.values.allocated"
        },
        {
          "name": "shipped",
          "label": "shipped",
          "labelKey": "qiy.enums.salesStatus.values.shipped"
        },
        {
          "name": "closed",
          "label": "closed",
          "labelKey": "qiy.enums.salesStatus.values.closed"
        },
        {
          "name": "cancelled",
          "label": "cancelled",
          "labelKey": "qiy.enums.salesStatus.values.cancelled"
        }
      ]
    },
    {
      "name": "workStatus",
      "values": [
        {
          "name": "planned",
          "label": "planned",
          "labelKey": "qiy.enums.workStatus.values.planned"
        },
        {
          "name": "released",
          "label": "released",
          "labelKey": "qiy.enums.workStatus.values.released"
        },
        {
          "name": "in_progress",
          "label": "in_progress",
          "labelKey": "qiy.enums.workStatus.values.in_progress"
        },
        {
          "name": "completed",
          "label": "completed",
          "labelKey": "qiy.enums.workStatus.values.completed"
        },
        {
          "name": "cancelled",
          "label": "cancelled",
          "labelKey": "qiy.enums.workStatus.values.cancelled"
        }
      ]
    },
    {
      "name": "activeState",
      "values": [
        {
          "name": "active",
          "label": "active",
          "labelKey": "qiy.enums.activeState.values.active"
        },
        {
          "name": "inactive",
          "label": "inactive",
          "labelKey": "qiy.enums.activeState.values.inactive"
        }
      ]
    },
    {
      "name": "movementType",
      "values": [
        {
          "name": "receipt",
          "label": "receipt",
          "labelKey": "qiy.enums.movementType.values.receipt"
        },
        {
          "name": "issue",
          "label": "issue",
          "labelKey": "qiy.enums.movementType.values.issue"
        },
        {
          "name": "transfer",
          "label": "transfer",
          "labelKey": "qiy.enums.movementType.values.transfer"
        },
        {
          "name": "adjust",
          "label": "adjust",
          "labelKey": "qiy.enums.movementType.values.adjust"
        },
        {
          "name": "production",
          "label": "production",
          "labelKey": "qiy.enums.movementType.values.production"
        },
        {
          "name": "consumption",
          "label": "consumption",
          "labelKey": "qiy.enums.movementType.values.consumption"
        }
      ]
    },
    {
      "name": "receiptStatus",
      "values": [
        {
          "name": "draft",
          "label": "draft",
          "labelKey": "qiy.enums.receiptStatus.values.draft"
        },
        {
          "name": "received",
          "label": "received",
          "labelKey": "qiy.enums.receiptStatus.values.received"
        },
        {
          "name": "inspected",
          "label": "inspected",
          "labelKey": "qiy.enums.receiptStatus.values.inspected"
        },
        {
          "name": "closed",
          "label": "closed",
          "labelKey": "qiy.enums.receiptStatus.values.closed"
        },
        {
          "name": "cancelled",
          "label": "cancelled",
          "labelKey": "qiy.enums.receiptStatus.values.cancelled"
        }
      ]
    },
    {
      "name": "shipmentStatus",
      "values": [
        {
          "name": "pending",
          "label": "pending",
          "labelKey": "qiy.enums.shipmentStatus.values.pending"
        },
        {
          "name": "shipped",
          "label": "shipped",
          "labelKey": "qiy.enums.shipmentStatus.values.shipped"
        },
        {
          "name": "delivered",
          "label": "delivered",
          "labelKey": "qiy.enums.shipmentStatus.values.delivered"
        },
        {
          "name": "cancelled",
          "label": "cancelled",
          "labelKey": "qiy.enums.shipmentStatus.values.cancelled"
        }
      ]
    }
  ],
  "dataflows": [
    {
      "name": "receiveInventory",
      "label": "Receive goods",
      "labelKey": "qiy.dataflows.receiveInventory.label",
      "allowRoles": [],
      "allowPermissions": [
        "InventoryReceivePermission"
      ],
      "verification": null,
      "inputs": [
        {
          "name": "purchaseOrderId",
          "type": "UUID",
          "required": true,
          "label": "purchaseOrderId",
          "labelKey": ""
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "label": "productId",
          "labelKey": ""
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "label": "warehouseId",
          "labelKey": ""
        },
        {
          "name": "binId",
          "type": "UUID",
          "required": true,
          "label": "binId",
          "labelKey": ""
        },
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "label": "inventoryId",
          "labelKey": ""
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "label": "quantity",
          "labelKey": ""
        },
        {
          "name": "newOnHand",
          "type": "Integer",
          "required": true,
          "label": "newOnHand",
          "labelKey": ""
        },
        {
          "name": "reference",
          "type": "Text",
          "required": true,
          "label": "reference",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "purchaseOrder",
          "entity": "purchase_orders"
        },
        {
          "name": "inventoryItem",
          "entity": "inventory"
        }
      ],
      "steps": [
        {
          "name": "validate",
          "actions": [
            {
              "kind": "require",
              "summary": "require purchaseOrder.status == approved"
            },
            {
              "kind": "require",
              "summary": "require input.quantity > 0"
            }
          ]
        },
        {
          "name": "postMovement",
          "actions": [
            {
              "kind": "create",
              "summary": "create stock_movements"
            }
          ]
        },
        {
          "name": "updateOnHand",
          "actions": [
            {
              "kind": "update",
              "summary": "update inventoryItem (quantity, binId)"
            },
            {
              "kind": "update",
              "summary": "update purchaseOrder (status)"
            },
            {
              "kind": "emit",
              "summary": "emit inventory.received"
            }
          ]
        }
      ],
      "result": "inventoryItem"
    },
    {
      "name": "putawayStock",
      "label": "Put away",
      "labelKey": "qiy.dataflows.putawayStock.label",
      "allowRoles": [],
      "allowPermissions": [
        "InventoryPutawayPermission"
      ],
      "verification": null,
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "label": "inventoryId",
          "labelKey": ""
        },
        {
          "name": "targetBinId",
          "type": "UUID",
          "required": true,
          "label": "targetBinId",
          "labelKey": ""
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "label": "quantity",
          "labelKey": ""
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "label": "productId",
          "labelKey": ""
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "label": "warehouseId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "inventoryItem",
          "entity": "inventory"
        }
      ],
      "steps": [
        {
          "name": "validate",
          "actions": [
            {
              "kind": "require",
              "summary": "require input.quantity > 0"
            }
          ]
        },
        {
          "name": "move",
          "actions": [
            {
              "kind": "create",
              "summary": "create stock_movements"
            },
            {
              "kind": "update",
              "summary": "update inventoryItem (binId)"
            },
            {
              "kind": "emit",
              "summary": "emit inventory.moved"
            }
          ]
        }
      ],
      "result": "inventoryItem"
    },
    {
      "name": "reserveStock",
      "label": "Reserve stock",
      "labelKey": "qiy.dataflows.reserveStock.label",
      "allowRoles": [
        "admin",
        "operator"
      ],
      "allowPermissions": [],
      "verification": null,
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "label": "inventoryId",
          "labelKey": ""
        },
        {
          "name": "reservedQuantity",
          "type": "Integer",
          "required": true,
          "label": "reservedQuantity",
          "labelKey": ""
        },
        {
          "name": "salesOrderId",
          "type": "UUID",
          "required": true,
          "label": "salesOrderId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "inventoryItem",
          "entity": "inventory"
        },
        {
          "name": "salesOrder",
          "entity": "sales_orders"
        }
      ],
      "steps": [
        {
          "name": "reserve",
          "actions": [
            {
              "kind": "update",
              "summary": "update inventoryItem (reserved)"
            },
            {
              "kind": "update",
              "summary": "update salesOrder (status)"
            },
            {
              "kind": "emit",
              "summary": "emit sales.allocated"
            }
          ]
        }
      ],
      "result": "inventoryItem"
    },
    {
      "name": "adjustStock",
      "label": "Adjust stock",
      "labelKey": "qiy.dataflows.adjustStock.label",
      "allowRoles": [],
      "allowPermissions": [
        "InventoryAdjustPermission"
      ],
      "verification": null,
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "label": "inventoryId",
          "labelKey": ""
        },
        {
          "name": "countedQuantity",
          "type": "Integer",
          "required": true,
          "label": "countedQuantity",
          "labelKey": ""
        },
        {
          "name": "reason",
          "type": "Text",
          "required": true,
          "label": "reason",
          "labelKey": ""
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "label": "productId",
          "labelKey": ""
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "label": "warehouseId",
          "labelKey": ""
        },
        {
          "name": "binId",
          "type": "UUID",
          "required": true,
          "label": "binId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "inventoryItem",
          "entity": "inventory"
        }
      ],
      "steps": [
        {
          "name": "apply",
          "actions": [
            {
              "kind": "create",
              "summary": "create stock_movements"
            },
            {
              "kind": "update",
              "summary": "update inventoryItem (quantity)"
            },
            {
              "kind": "emit",
              "summary": "emit inventory.adjusted"
            }
          ]
        }
      ],
      "result": "inventoryItem"
    },
    {
      "name": "shipSalesOrder",
      "label": "Ship order",
      "labelKey": "qiy.dataflows.shipSalesOrder.label",
      "allowRoles": [],
      "allowPermissions": [],
      "verification": "CanShipOrders",
      "inputs": [
        {
          "name": "salesOrderId",
          "type": "UUID",
          "required": true,
          "label": "salesOrderId",
          "labelKey": ""
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "label": "warehouseId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "salesOrder",
          "entity": "sales_orders"
        }
      ],
      "steps": [
        {
          "name": "validate",
          "actions": [
            {
              "kind": "require",
              "summary": "require salesOrder.status == allocated"
            }
          ]
        },
        {
          "name": "ship",
          "actions": [
            {
              "kind": "create",
              "summary": "create shipments"
            },
            {
              "kind": "update",
              "summary": "update salesOrder (status)"
            },
            {
              "kind": "emit",
              "summary": "emit sales.shipped"
            }
          ]
        }
      ],
      "result": "shipment"
    },
    {
      "name": "transferInventory",
      "label": "Transfer inventory",
      "labelKey": "qiy.dataflows.transferInventory.label",
      "allowRoles": [],
      "allowPermissions": [
        "InventoryTransferPermission"
      ],
      "verification": null,
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "label": "inventoryId",
          "labelKey": ""
        },
        {
          "name": "targetWarehouseId",
          "type": "UUID",
          "required": true,
          "label": "targetWarehouseId",
          "labelKey": ""
        },
        {
          "name": "targetBinId",
          "type": "UUID",
          "required": true,
          "label": "targetBinId",
          "labelKey": ""
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "label": "quantity",
          "labelKey": ""
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "label": "productId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "inventoryItem",
          "entity": "inventory"
        }
      ],
      "steps": [
        {
          "name": "transfer",
          "actions": [
            {
              "kind": "create",
              "summary": "create stock_movements"
            },
            {
              "kind": "update",
              "summary": "update inventoryItem (warehouseId, binId)"
            },
            {
              "kind": "emit",
              "summary": "emit inventory.transferred"
            }
          ]
        }
      ],
      "result": "inventoryItem"
    },
    {
      "name": "completeWorkOrder",
      "label": "Complete work order",
      "labelKey": "qiy.dataflows.completeWorkOrder.label",
      "allowRoles": [],
      "allowPermissions": [
        "WorkOrderCompletePermission"
      ],
      "verification": null,
      "inputs": [
        {
          "name": "workOrderId",
          "type": "UUID",
          "required": true,
          "label": "workOrderId",
          "labelKey": ""
        },
        {
          "name": "componentId",
          "type": "UUID",
          "required": true,
          "label": "componentId",
          "labelKey": ""
        },
        {
          "name": "componentQuantity",
          "type": "Integer",
          "required": true,
          "label": "componentQuantity",
          "labelKey": ""
        },
        {
          "name": "outputBinId",
          "type": "UUID",
          "required": true,
          "label": "outputBinId",
          "labelKey": ""
        },
        {
          "name": "outputQuantity",
          "type": "Integer",
          "required": true,
          "label": "outputQuantity",
          "labelKey": ""
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "label": "warehouseId",
          "labelKey": ""
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "label": "productId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "workOrder",
          "entity": "work_orders"
        }
      ],
      "steps": [
        {
          "name": "validate",
          "actions": [
            {
              "kind": "require",
              "summary": "require workOrder.status == in_progress"
            }
          ]
        },
        {
          "name": "consume",
          "actions": [
            {
              "kind": "create",
              "summary": "create stock_movements"
            },
            {
              "kind": "create",
              "summary": "create stock_movements"
            },
            {
              "kind": "update",
              "summary": "update workOrder (status)"
            },
            {
              "kind": "emit",
              "summary": "emit production.completed"
            }
          ]
        }
      ],
      "result": "workOrder"
    },
    {
      "name": "approvePurchaseOrder",
      "label": "Approve purchase order",
      "labelKey": "qiy.dataflows.approvePurchaseOrder.label",
      "allowRoles": [],
      "allowPermissions": [
        "PurchaseApprovePermission"
      ],
      "verification": null,
      "inputs": [
        {
          "name": "purchaseOrderId",
          "type": "UUID",
          "required": true,
          "label": "purchaseOrderId",
          "labelKey": ""
        }
      ],
      "contexts": [
        {
          "name": "purchaseOrder",
          "entity": "purchase_orders"
        }
      ],
      "steps": [
        {
          "name": "approve",
          "actions": [
            {
              "kind": "require",
              "summary": "require purchaseOrder.status == draft"
            },
            {
              "kind": "update",
              "summary": "update purchaseOrder (status)"
            },
            {
              "kind": "emit",
              "summary": "emit purchasing.approved"
            }
          ]
        }
      ],
      "result": "purchaseOrder"
    }
  ],
  "permissions": {
    "fields": [
      {
        "name": "ApiGetUserPermission",
        "value": "api:getUser",
        "label": "Read user API",
        "labelKey": ""
      },
      {
        "name": "ApiPutUserPermission",
        "value": "api:putUser",
        "label": "Update users",
        "labelKey": ""
      },
      {
        "name": "ApiDeleteUserPermission",
        "value": "api:deleteUser",
        "label": "Delete users",
        "labelKey": ""
      },
      {
        "name": "InventoryReceivePermission",
        "value": "inventory:receive",
        "label": "Receive inventory",
        "labelKey": ""
      },
      {
        "name": "InventoryPutawayPermission",
        "value": "inventory:putaway",
        "label": "Put away inventory",
        "labelKey": ""
      },
      {
        "name": "InventoryReservePermission",
        "value": "inventory:reserve",
        "label": "Reserve inventory",
        "labelKey": ""
      },
      {
        "name": "InventoryAdjustPermission",
        "value": "inventory:adjust",
        "label": "Adjust inventory",
        "labelKey": ""
      },
      {
        "name": "InventoryTransferPermission",
        "value": "inventory:transfer",
        "label": "Transfer inventory",
        "labelKey": ""
      },
      {
        "name": "PurchaseApprovePermission",
        "value": "purchasing:approve",
        "label": "Approve purchase orders",
        "labelKey": ""
      },
      {
        "name": "SalesShipPermission",
        "value": "sales:ship",
        "label": "Ship sales orders",
        "labelKey": ""
      },
      {
        "name": "WorkOrderCompletePermission",
        "value": "workorder:complete",
        "label": "Complete work orders",
        "labelKey": ""
      },
      {
        "name": "ReportReadPermission",
        "value": "report:read",
        "label": "Read reports",
        "labelKey": ""
      }
    ],
    "groups": [
      {
        "name": "UserApiPermissionGroup",
        "members": [
          "ApiGetUserPermission",
          "ApiPutUserPermission"
        ],
        "label": "UserApiPermissionGroup",
        "labelKey": ""
      },
      {
        "name": "ManagerRole",
        "members": [
          "ApiPutUserPermission",
          "ApiDeleteUserPermission"
        ],
        "label": "ManagerRole",
        "labelKey": ""
      },
      {
        "name": "SuperAdminManager",
        "members": [
          "UserApiPermissionGroup",
          "ManagerRole"
        ],
        "label": "SuperAdminManager",
        "labelKey": ""
      },
      {
        "name": "admin",
        "members": [
          "SuperAdminManager",
          "InventoryReceivePermission",
          "InventoryPutawayPermission",
          "InventoryReservePermission",
          "InventoryAdjustPermission",
          "InventoryTransferPermission",
          "PurchaseApprovePermission",
          "SalesShipPermission",
          "WorkOrderCompletePermission",
          "ReportReadPermission"
        ],
        "label": "admin",
        "labelKey": ""
      },
      {
        "name": "operator",
        "members": [
          "InventoryReceivePermission",
          "InventoryPutawayPermission",
          "InventoryReservePermission",
          "InventoryAdjustPermission",
          "InventoryTransferPermission",
          "SalesShipPermission",
          "WorkOrderCompletePermission",
          "ReportReadPermission"
        ],
        "label": "operator",
        "labelKey": ""
      },
      {
        "name": "viewer",
        "members": [
          "ReportReadPermission"
        ],
        "label": "viewer",
        "labelKey": ""
      }
    ],
    "verifications": [
      {
        "name": "CanAccessUserApi",
        "label": "CanAccessUserApi",
        "labelKey": "",
        "inputs": [
          {
            "name": "permission",
            "type": "Array<String>"
          }
        ]
      },
      {
        "name": "CanManageUsers",
        "label": "CanManageUsers",
        "labelKey": "",
        "inputs": [
          {
            "name": "permission",
            "type": "Array<String>"
          }
        ]
      },
      {
        "name": "CanShipOrders",
        "label": "CanShipOrders",
        "labelKey": "",
        "inputs": []
      },
      {
        "name": "CanAdjustStock",
        "label": "CanAdjustStock",
        "labelKey": "",
        "inputs": [
          {
            "name": "permission",
            "type": "Text"
          }
        ]
      }
    ]
  }
};

export const docsViewKindLabels: Record<string, string> = { "apiKeys": "qiy.apiKey.title", "entities": "qiy.docs.tabEntities", "dataflows": "qiy.docs.tabDataflows", "api": "qiy.docs.tabApi", "permissions": "qiy.docs.tabPermissions" };

function restrictedRoles(tableName: string): string[] | undefined {
  const restriction = docsMeta.restrictions.find((entry) => entry.resource === tableName);
  return restriction ? restriction.roles : undefined;
}

export function mayUseResource(tableName: string, principal: DocsPrincipal): boolean {
  if (principal.role === "admin") return true;
  if (docsMeta.userTable === tableName) return false;
  const roles = restrictedRoles(tableName);
  if (roles && roles.length > 0 && !roles.includes(principal.role)) return false;
  return true;
}

export function mayUseAction(tableName: string, action: DocsAction, principal: DocsPrincipal): boolean {
  if (!mayUseResource(tableName, principal)) return false;
  const pageRule = docsMeta.pageRules[tableName]?.[action];
  if (pageRule && !pageRule.includes(principal.role)) return false;
  if (principal.role === "viewer") return action === "list" || action === "show";
  return true;
}

/** Commands are admin-only unless an allow rule names the role/permission; verification-gated commands are admin-only in the docs. */
export function flowAllowed(flow: DocsDataflow, principal: DocsPrincipal): boolean {
  if (principal.role === "admin") return true;
  if (flow.verification) return false;
  if (flow.allowRoles.length > 0) return flow.allowRoles.includes(principal.role);
  if (flow.allowPermissions.length > 0) {
    const held = new Set(principal.permissions ?? []);
    return flow.allowPermissions.every((permission) => held.has(permission));
  }
  return false;
}

export function allowedActions(entity: DocsEntity, principal: DocsPrincipal): DocsAction[] {
  return (["list", "show", "create", "edit", "delete"] as DocsAction[]).filter((action) => mayUseAction(entity.tableName, action, principal));
}

export function accessibleEntities(principal: DocsPrincipal): DocsEntity[] {
  return docsMeta.entities.filter((entity) => mayUseResource(entity.tableName, principal));
}

export function buildDocsModel(principal: DocsPrincipal): Record<string, unknown> {
  const permissions = principal.permissions ?? [];
  return {
    app: docsMeta.app,
    features: docsMeta.features,
    principal: { role: principal.role, permissions },
    entities: accessibleEntities(principal).map((entity) => ({
      ...entity,
      restricted: !mayUseAction(entity.tableName, "list", principal),
      actions: allowedActions(entity, principal),
    })),
    relations: docsMeta.relations,
    enums: docsMeta.enums,
    dataflows: docsMeta.dataflows.filter((flow) => flowAllowed(flow, principal)),
    permissions: docsMeta.permissions,
  };
}

function jsonSchemaForField(field: DocsField): Record<string, unknown> {
  const base: Record<string, unknown> = field.type === "Integer" ? { type: "integer" }
    : field.type === "Decimal" || field.type === "Money" ? { type: "number" }
      : field.type === "Boolean" ? { type: "boolean" }
        : field.type === "Vector" ? { type: "array", items: { type: "number" } }
          : field.type === "File" || field.type === "Files" ? { type: "string", format: "binary" }
            : { type: "string" };
  if (field.enumValues?.length) base.enum = field.enumValues.map((value) => value.name);
  if (field.nullable) base.nullable = true;
  return base;
}

function requestSchema(entity: DocsEntity): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of entity.fields) {
    if (field.primaryKey || field.annotations.includes("generated:code") || field.annotations.includes("generated:uuid")) continue;
    properties[field.name] = jsonSchemaForField(field);
    if (!field.nullable) required.push(field.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

export function buildOpenApiDocument(principal: DocsPrincipal): GeneratedOpenApiDocument {
  const permissions = principal.permissions ?? [];
  const security: Array<Record<string, string[]>> = [{ bearerSession: [] }, { apiKey: [] }];
  const paths: Record<string, Record<string, unknown>> = {};
  const tags: Array<{ name: string; description: string }> = [];
  const rolesFor = (tableName: string, action: string): string[] => {
    const pageRule = docsMeta.pageRules[tableName]?.[action];
    const restricted = restrictedRoles(tableName);
    if (pageRule && pageRule.length) return pageRule;
    if (restricted && restricted.length) return restricted;
    return ["admin", "operator", "viewer"];
  };
  const add = (path: string, method: string, operation: Record<string, unknown>) => {
    if (!paths[path]) paths[path] = {};
    paths[path]![method] = operation;
  };
  for (const entity of docsMeta.entities) {
    if (!mayUseResource(entity.tableName, principal)) continue;
    const tag = entity.tableName;
    tags.push({ name: tag, description: entity.label });
    const entityPath = "/api/v1/" + entity.tableName;
    const idPath = entityPath + "/{id}";
    if (mayUseAction(entity.tableName, "list", principal)) {
      add(entityPath, "get", {
        tags: [tag], summary: "List " + entity.plural, operationId: "list_" + tag,
        security, "x-qiy-roles": rolesFor(tag, "list"), "x-qiy-permissions": [],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 }, description: "Page number" },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 }, description: "Items per page" },
          { name: "search", in: "query", schema: { type: "string" }, description: "Search the list" },
        ],
        responses: { "200": { description: "Paginated records", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object" } }, total: { type: "integer" } } } } } }, "401": { description: "Authentication required" }, "403": { description: "Permission denied" } },
      });
      add(entityPath + "/distribution", "get", { tags: [tag], summary: "Distribution of " + entity.plural, operationId: "distribution_" + tag, security, "x-qiy-roles": rolesFor(tag, "list"), "x-qiy-permissions": [], parameters: [{ name: "field", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Distribution buckets" } } });
      add(entityPath + "/trend", "get", { tags: [tag], summary: "Daily trend of " + entity.plural, operationId: "trend_" + tag, security, "x-qiy-roles": rolesFor(tag, "list"), "x-qiy-permissions": [], parameters: [{ name: "field", in: "query", schema: { type: "string" } }, { name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365 } }], responses: { "200": { description: "Daily counts" } } });
      add(entityPath + "/aggregate", "get", { tags: [tag], summary: "Aggregate a numeric field of " + entity.plural, operationId: "aggregate_" + tag, security, "x-qiy-roles": rolesFor(tag, "list"), "x-qiy-permissions": [], parameters: [{ name: "field", in: "query", schema: { type: "string" } }, { name: "op", in: "query", schema: { type: "string", enum: ["sum", "avg", "min", "max"] } }], responses: { "200": { description: "Aggregate value" } } });
    }
    if (mayUseAction(entity.tableName, "show", principal)) {
      add(idPath, "get", { tags: [tag], summary: "Read one record of " + entity.plural, operationId: "show_" + tag, security, "x-qiy-roles": rolesFor(tag, "show"), "x-qiy-permissions": [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "One record" }, "404": { description: "Not found" } } });
    }
    if (mayUseAction(entity.tableName, "create", principal)) {
      add(entityPath, "post", { tags: [tag], summary: "Create " + entity.singular, operationId: "create_" + tag, security, "x-qiy-roles": rolesFor(tag, "create"), "x-qiy-permissions": [], requestBody: { required: true, content: { "application/json": { schema: requestSchema(entity) } } }, responses: { "201": { description: "Created" }, "400": { description: "Invalid input" } } });
    }
    if (mayUseAction(entity.tableName, "edit", principal)) {
      add(idPath, "patch", { tags: [tag], summary: "Update " + entity.singular, operationId: "update_" + tag, security, "x-qiy-roles": rolesFor(tag, "edit"), "x-qiy-permissions": [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: requestSchema(entity) } } }, responses: { "200": { description: "Updated" } } });
    }
    if (mayUseAction(entity.tableName, "delete", principal)) {
      add(idPath, "delete", { tags: [tag], summary: "Delete " + entity.singular, operationId: "delete_" + tag, security, "x-qiy-roles": rolesFor(tag, "delete"), "x-qiy-permissions": [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" } } });
    }
  }
  for (const flow of docsMeta.dataflows) {
    if (!flowAllowed(flow, principal)) continue;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const input of flow.inputs) {
      properties[input.name] = input.type === "Integer" ? { type: "integer" } : input.type === "Decimal" ? { type: "number" } : input.type === "Boolean" ? { type: "boolean" } : { type: "string" };
      if (input.required) required.push(input.name);
    }
    add("/api/v1/commands/" + flow.name, "post", {
      tags: ["commands"], summary: flow.label, operationId: "run_" + flow.name, security,
      "x-qiy-roles": flow.allowRoles, "x-qiy-permissions": flow.allowPermissions, "x-qiy-verification": flow.verification,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties, ...(required.length ? { required } : {}) } } } },
      responses: { "200": { description: "Command result" }, "403": { description: "Command is not allowed for this principal" } },
    });
  }
  add("/api/v1/auth/me", "get", { tags: ["auth"], summary: "Current principal and effective permissions", operationId: "auth_me", security, responses: { "200": { description: "Principal" } } });
  if (docsMeta.loginEnabled) {
    add("/api/v1/auth/login", "post", { tags: ["auth"], summary: "Password login", operationId: "auth_login", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { username: { type: "string" }, password: { type: "string" } }, required: ["username", "password"] } } } }, responses: { "200": { description: "Access token" }, "401": { description: "Invalid credentials" } } });
  }
  if (docsMeta.features.apiKeys) {
    add("/api/v1/auth/api-keys", "get", { tags: ["auth"], summary: "List API keys", operationId: "list_api_keys", security, responses: { "200": { description: "Masked API keys" } } });
    add("/api/v1/auth/api-keys", "post", { tags: ["auth"], summary: "Create an API key (secret shown once)", operationId: "create_api_key", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, expiresAt: { type: "string", format: "date-time" } }, required: ["name"] } } } }, responses: { "201": { description: "Key and record" } } });
    add("/api/v1/auth/api-keys/{id}", "delete", { tags: ["auth"], summary: "Revoke an API key", operationId: "revoke_api_key", security, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Revoked" }, "404": { description: "Not found" } } });
  }
  if (docsMeta.features.apiDocs) {
    add("/api/v1/openapi.json", "get", { tags: ["docs"], summary: "Permission-filtered OpenAPI 3.1 document", operationId: "openapi_json", security, responses: { "200": { description: "OpenAPI document" } } });
  }
  if (docsMeta.features.overview || docsMeta.features.apiDocs) {
    add("/api/v1/docs/model", "get", { tags: ["docs"], summary: "Model metadata for the documentation page", operationId: "docs_model", security, responses: { "200": { description: "Model metadata" } } });
  }
  return {
    openapi: "3.1.0",
    info: { title: docsMeta.app.name + " API", version: "1.0.0", ...(docsMeta.app.description ? { description: docsMeta.app.description } : {}) },
    servers: [{ url: "/", description: "Same origin" }],
    tags,
    security,
    paths,
    components: {
      securitySchemes: {
        bearerSession: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Session access token from /api/v1/auth/login or an OAuth provider" },
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "Personal API key (qiy_...); sent as X-API-Key or Authorization: Bearer" },
      },
    },
    "x-qiy-generated": true,
    "x-qiy-principal": { role: principal.role, permissions },
  };
}
