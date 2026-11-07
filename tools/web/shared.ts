/**
 * Types shared by the web renderers.
 */
import type { QiyAction, QiyProject } from "../qiy-project";
import type { QiyPermissionExpressionIR } from "../permissions";

export type WebOptions = Pick<QiyProject, "mode" | "integration" | "ui" | "messages" | "apiClient" | "menuGroups" | "charts" | "chartPanels" | "realtime" | "auth" | "permissions" | "dataflows" | "actions" | "restrictions" | "pages" | "scopes" | "features" | "comment"> & { readOnly?: boolean };

export type GeneratedAction = {
  name: string;
  roles?: string[];
  permission?: string[];
  verification?: string;
  resource: string;
  placements: Array<"list" | "show">;
  batch?: boolean;
  label: string;
  labelKey?: string;
  condition?: QiyAction["condition"];
  target:
    | { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpressionIR } }
    | { kind: "dataflow"; dataflow: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpressionIR }; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; labelKey: string; options?: Array<{ value: string; label: string; labelKey: string }> }> };
};
