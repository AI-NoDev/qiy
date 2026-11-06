type QiyActionCondition = { field: string; operator: "==" | "!="; value: string } | { field: string; operator: "in"; values: string[] };
type QiyActionBase = { name: string; resource: string; placements: Array<"list" | "show">; batch?: boolean; label: string; labelKey?: string; roles?: string[]; condition?: QiyActionCondition };
type QiyVerificationRule = { name: string; expression: unknown };
export type QiyActionDefinition = QiyActionBase & ({ target: { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string; permissions?: string[]; verification?: QiyVerificationRule } } | { target: { kind: "dataflow"; dataflow: string; roles: string[]; permissions?: string[]; verification?: QiyVerificationRule; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; labelKey: string; options?: Array<{ value: string; label: string; labelKey: string }> }> } });
export const qiyActions: QiyActionDefinition[] = [
  {
    "name": "orderLifecycleSubmit",
    "resource": "orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "提交订单",
    "condition": {
      "field": "status",
      "operator": "==",
      "value": "draft"
    },
    "target": {
      "kind": "dataflow",
      "dataflow": "orderLifecycleSubmit",
      "url": "/api/v1/commands/orderLifecycleSubmit",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "recordId",
      "inputs": [
        {
          "name": "recordId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.orderLifecycleSubmit.inputs.recordId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.orderLifecycleSubmit.label"
  },
  {
    "name": "orderLifecycleApprove",
    "resource": "orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "审批",
    "condition": {
      "field": "status",
      "operator": "==",
      "value": "submitted"
    },
    "target": {
      "kind": "dataflow",
      "dataflow": "orderLifecycleApprove",
      "url": "/api/v1/commands/orderLifecycleApprove",
      "idempotency": true,
      "roles": [
        "admin"
      ],
      "idInput": "recordId",
      "inputs": [
        {
          "name": "recordId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.orderLifecycleApprove.inputs.recordId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.orderLifecycleApprove.label"
  },
  {
    "name": "orderLifecycleShip",
    "resource": "orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "出库",
    "condition": {
      "field": "status",
      "operator": "==",
      "value": "approved"
    },
    "target": {
      "kind": "dataflow",
      "dataflow": "orderLifecycleShip",
      "confirm": "确认出库？",
      "confirmKey": "qiy.actions.orderLifecycleShip.confirm",
      "url": "/api/v1/commands/orderLifecycleShip",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "recordId",
      "inputs": [
        {
          "name": "recordId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.orderLifecycleShip.inputs.recordId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.orderLifecycleShip.label"
  },
  {
    "name": "orderLifecycleCancel",
    "resource": "orders",
    "placements": [
      "list",
      "show"
    ],
    "label": "取消订单",
    "condition": {
      "field": "status",
      "operator": "in",
      "values": [
        "draft",
        "submitted"
      ]
    },
    "target": {
      "kind": "dataflow",
      "dataflow": "orderLifecycleCancel",
      "confirm": "确认取消该订单？",
      "confirmKey": "qiy.actions.orderLifecycleCancel.confirm",
      "url": "/api/v1/commands/orderLifecycleCancel",
      "idempotency": true,
      "roles": [
        "admin",
        "operator"
      ],
      "idInput": "recordId",
      "inputs": [
        {
          "name": "recordId",
          "type": "UUID",
          "required": true,
          "labelKey": "qiy.actions.orderLifecycleCancel.inputs.recordId.label"
        }
      ]
    },
    "labelKey": "qiy.actions.orderLifecycleCancel.label"
  }
];
export function actionMatchesRecord(action: QiyActionDefinition, record: Record<string, unknown>) { if (!action.condition) return true; if (!Object.prototype.hasOwnProperty.call(record, action.condition.field) || record[action.condition.field] == null) return false; const value = record[action.condition.field]; if (action.condition.operator === "in") return action.condition.values.includes(String(value)); const matches = value === action.condition.value; return action.condition.operator === "==" ? matches : !matches; }
export function actionsFor(resource: string, placement: "list" | "show", record: Record<string, unknown>) { return qiyActions.filter((action) => !action.batch && action.resource === resource && action.placements.includes(placement) && actionMatchesRecord(action, record)); }
export function batchActionsFor(resource: string) { return qiyActions.filter((action) => action.batch && action.resource === resource && action.placements.includes("list") && action.target.kind === "dataflow"); }
export function hasBatchActions(resource: string) { return batchActionsFor(resource).length > 0; }
