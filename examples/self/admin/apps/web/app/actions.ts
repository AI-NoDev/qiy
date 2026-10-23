type QiyActionCondition = { field: string; operator: "==" | "!="; value: string };
type QiyActionBase = { name: string; resource: string; placements: Array<"list" | "show">; batch?: boolean; label: string; labelKey?: string; roles?: string[]; condition?: QiyActionCondition };
export type QiyActionDefinition = QiyActionBase & ({ target: { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string } } | { target: { kind: "dataflow"; dataflow: string; roles: string[]; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; options?: Array<{ value: string; label: string }> }> } });
export const qiyActions: QiyActionDefinition[] = [
  {
    "name": "receiveInventory",
    "resource": "inventory",
    "placements": [
      "list",
      "show"
    ],
    "label": "Receive goods",
    "target": {
      "kind": "dataflow",
      "dataflow": "receiveInventory",
      "confirm": "Post this receipt into stock?",
      "url": "/api/v1/commands/receiveInventory",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "purchaseOrderId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "binId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "comment": "Quantity received in this posting"
        },
        {
          "name": "newOnHand",
          "type": "Integer",
          "required": true,
          "comment": "Absolute on-hand quantity after the receipt"
        },
        {
          "name": "reference",
          "type": "Text",
          "required": true
        }
      ]
    }
  },
  {
    "name": "putawayStock",
    "resource": "inventory",
    "placements": [
      "list"
    ],
    "label": "Put away",
    "target": {
      "kind": "dataflow",
      "dataflow": "putawayStock",
      "url": "/api/v1/commands/putawayStock",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "targetBinId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true
        }
      ]
    }
  },
  {
    "name": "reserveStock",
    "resource": "inventory",
    "placements": [
      "list"
    ],
    "label": "Reserve stock",
    "target": {
      "kind": "dataflow",
      "dataflow": "reserveStock",
      "url": "/api/v1/commands/reserveStock",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "reservedQuantity",
          "type": "Integer",
          "required": true,
          "comment": "Absolute reserved quantity after this operation"
        },
        {
          "name": "salesOrderId",
          "type": "UUID",
          "required": true
        }
      ]
    }
  },
  {
    "name": "adjustStock",
    "resource": "inventory",
    "placements": [
      "list"
    ],
    "label": "Adjust stock",
    "target": {
      "kind": "dataflow",
      "dataflow": "adjustStock",
      "confirm": "Apply this stock count?",
      "url": "/api/v1/commands/adjustStock",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "countedQuantity",
          "type": "Integer",
          "required": true
        },
        {
          "name": "reason",
          "type": "Text",
          "required": true
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "binId",
          "type": "UUID",
          "required": true
        }
      ]
    }
  },
  {
    "name": "transferInventory",
    "resource": "inventory",
    "placements": [
      "list"
    ],
    "label": "Transfer inventory",
    "target": {
      "kind": "dataflow",
      "dataflow": "transferInventory",
      "url": "/api/v1/commands/transferInventory",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "targetWarehouseId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "targetBinId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true
        }
      ]
    }
  },
  {
    "name": "shipSalesOrder",
    "resource": "sales_orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "Ship order",
    "target": {
      "kind": "dataflow",
      "dataflow": "shipSalesOrder",
      "url": "/api/v1/commands/shipSalesOrder",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "salesOrderId",
      "inputs": [
        {
          "name": "salesOrderId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true
        }
      ]
    }
  },
  {
    "name": "completeWorkOrder",
    "resource": "work_orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "Complete work order",
    "target": {
      "kind": "dataflow",
      "dataflow": "completeWorkOrder",
      "url": "/api/v1/commands/completeWorkOrder",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "workOrderId",
      "inputs": [
        {
          "name": "workOrderId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "componentId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "componentQuantity",
          "type": "Integer",
          "required": true
        },
        {
          "name": "outputBinId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "outputQuantity",
          "type": "Integer",
          "required": true
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true
        }
      ]
    }
  }
];
export function actionMatchesRecord(action: QiyActionDefinition, record: Record<string, unknown>) { if (!action.condition) return true; if (!Object.prototype.hasOwnProperty.call(record, action.condition.field) || record[action.condition.field] == null) return false; const matches = record[action.condition.field] === action.condition.value; return action.condition.operator === "==" ? matches : !matches; }
export function actionsFor(resource: string, placement: "list" | "show", record: Record<string, unknown>) { return qiyActions.filter((action) => !action.batch && action.resource === resource && action.placements.includes(placement) && actionMatchesRecord(action, record)); }
export function batchActionsFor(resource: string) { return qiyActions.filter((action) => action.batch && action.resource === resource && action.placements.includes("list") && action.target.kind === "dataflow"); }
export function hasBatchActions(resource: string) { return batchActionsFor(resource).length > 0; }
