type QiyActionCondition = { field: string; operator: "==" | "!="; value: string };
type QiyActionBase = { name: string; resource: string; placements: Array<"list" | "show">; batch?: boolean; label: string; labelKey?: string; roles?: string[]; condition?: QiyActionCondition };
type QiyVerificationRule = { name: string; expression: unknown };
export type QiyActionDefinition = QiyActionBase & ({ target: { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string; permissions?: string[]; verification?: QiyVerificationRule } } | { target: { kind: "dataflow"; dataflow: string; roles: string[]; permissions?: string[]; verification?: QiyVerificationRule; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; labelKey: string; options?: Array<{ value: string; label: string; labelKey: string }> }> } });
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
      "confirmKey": "qiy.actions.receiveInventory.confirm",
      "url": "/api/v1/commands/receiveInventory",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "permissions": [
        "inventory:receive"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "purchaseOrderId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.receiveInventory.inputs.purchaseOrderId.label"
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.receiveInventory.inputs.productId.label"
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.receiveInventory.inputs.warehouseId.label"
        },
        {
          "name": "binId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.receiveInventory.inputs.binId.label"
        },
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.receiveInventory.inputs.inventoryId.label"
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "comment": "Quantity received in this posting",
          "labelKey": "qiy.actions.receiveInventory.inputs.quantity.label"
        },
        {
          "name": "newOnHand",
          "type": "Integer",
          "required": true,
          "comment": "Absolute on-hand quantity after the receipt",
          "labelKey": "qiy.actions.receiveInventory.inputs.newOnHand.label"
        },
        {
          "name": "reference",
          "type": "Text",
          "required": true,
          "labelKey": "qiy.actions.receiveInventory.inputs.reference.label"
        }
      ]
    },
    "labelKey": "qiy.actions.receiveInventory.label"
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
      "permissions": [
        "inventory:putaway"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.putawayStock.inputs.inventoryId.label"
        },
        {
          "name": "targetBinId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.putawayStock.inputs.targetBinId.label"
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "labelKey": "qiy.actions.putawayStock.inputs.quantity.label"
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.putawayStock.inputs.productId.label"
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.putawayStock.inputs.warehouseId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.putawayStock.label"
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
          "required": true,
          "labelKey": "qiy.actions.reserveStock.inputs.inventoryId.label"
        },
        {
          "name": "reservedQuantity",
          "type": "Integer",
          "required": true,
          "comment": "Absolute reserved quantity after this operation",
          "labelKey": "qiy.actions.reserveStock.inputs.reservedQuantity.label"
        },
        {
          "name": "salesOrderId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.reserveStock.inputs.salesOrderId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.reserveStock.label"
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
      "confirmKey": "qiy.actions.adjustStock.confirm",
      "url": "/api/v1/commands/adjustStock",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "permissions": [
        "inventory:adjust"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.adjustStock.inputs.inventoryId.label"
        },
        {
          "name": "countedQuantity",
          "type": "Integer",
          "required": true,
          "labelKey": "qiy.actions.adjustStock.inputs.countedQuantity.label"
        },
        {
          "name": "reason",
          "type": "Text",
          "required": true,
          "labelKey": "qiy.actions.adjustStock.inputs.reason.label"
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.adjustStock.inputs.productId.label"
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.adjustStock.inputs.warehouseId.label"
        },
        {
          "name": "binId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.adjustStock.inputs.binId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.adjustStock.label"
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
      "permissions": [
        "inventory:transfer"
      ],
      "idInput": "inventoryId",
      "inputs": [
        {
          "name": "inventoryId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.transferInventory.inputs.inventoryId.label"
        },
        {
          "name": "targetWarehouseId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.transferInventory.inputs.targetWarehouseId.label"
        },
        {
          "name": "targetBinId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.transferInventory.inputs.targetBinId.label"
        },
        {
          "name": "quantity",
          "type": "Integer",
          "required": true,
          "labelKey": "qiy.actions.transferInventory.inputs.quantity.label"
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.transferInventory.inputs.productId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.transferInventory.label"
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
      "verification": {
        "name": "CanShipOrders",
        "expression": {
          "kind": "or",
          "children": [
            {
              "kind": "comparison",
              "operator": "equals",
              "left": {
                "kind": "self",
                "set": "role"
              },
              "right": {
                "kind": "literal",
                "value": "admin"
              }
            },
            {
              "kind": "comparison",
              "operator": "equals",
              "left": {
                "kind": "self",
                "set": "role"
              },
              "right": {
                "kind": "literal",
                "value": "operator"
              }
            }
          ]
        }
      },
      "idInput": "salesOrderId",
      "inputs": [
        {
          "name": "salesOrderId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.shipSalesOrder.inputs.salesOrderId.label"
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.shipSalesOrder.inputs.warehouseId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.shipSalesOrder.label"
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
      "permissions": [
        "workorder:complete"
      ],
      "idInput": "workOrderId",
      "inputs": [
        {
          "name": "workOrderId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.workOrderId.label"
        },
        {
          "name": "componentId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.componentId.label"
        },
        {
          "name": "componentQuantity",
          "type": "Integer",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.componentQuantity.label"
        },
        {
          "name": "outputBinId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.outputBinId.label"
        },
        {
          "name": "outputQuantity",
          "type": "Integer",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.outputQuantity.label"
        },
        {
          "name": "warehouseId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.warehouseId.label"
        },
        {
          "name": "productId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.completeWorkOrder.inputs.productId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.completeWorkOrder.label"
  },
  {
    "name": "approvePurchaseOrder",
    "resource": "purchase_orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "Approve purchase order",
    "target": {
      "kind": "dataflow",
      "dataflow": "approvePurchaseOrder",
      "confirm": "Approve this purchase order for receiving?",
      "confirmKey": "qiy.actions.approvePurchaseOrder.confirm",
      "url": "/api/v1/commands/approvePurchaseOrder",
      "idempotency": false,
      "roles": [
        "admin",
        "operator"
      ],
      "permissions": [
        "purchasing:approve"
      ],
      "idInput": "purchaseOrderId",
      "inputs": [
        {
          "name": "purchaseOrderId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.approvePurchaseOrder.inputs.purchaseOrderId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.approvePurchaseOrder.label"
  }
];
export function actionMatchesRecord(action: QiyActionDefinition, record: Record<string, unknown>) { if (!action.condition) return true; if (!Object.prototype.hasOwnProperty.call(record, action.condition.field) || record[action.condition.field] == null) return false; const matches = record[action.condition.field] === action.condition.value; return action.condition.operator === "==" ? matches : !matches; }
export function actionsFor(resource: string, placement: "list" | "show", record: Record<string, unknown>) { return qiyActions.filter((action) => !action.batch && action.resource === resource && action.placements.includes(placement) && actionMatchesRecord(action, record)); }
export function batchActionsFor(resource: string) { return qiyActions.filter((action) => action.batch && action.resource === resource && action.placements.includes("list") && action.target.kind === "dataflow"); }
export function hasBatchActions(resource: string) { return batchActionsFor(resource).length > 0; }
