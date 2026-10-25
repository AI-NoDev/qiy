/** Generated documentation helpers: Mermaid builders, tab gating and API fetchers. */
import { qiyAuthToken } from "./auth";
import { qiyFeatureFlags } from "./features";

export type DocsRole = "admin" | "operator" | "viewer";
export interface DocsEnumValue { name: string; label: string; labelKey: string }
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
  relation?: { table: string; field: string; onDelete?: string };
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
  restricted?: boolean;
  actions?: string[];
}
export interface DocsRelation { fromTable: string; field: string; toTable: string; toField: string; onDelete?: string }
export interface DocsDataflow {
  name: string;
  label: string;
  labelKey: string;
  allowRoles: string[];
  allowPermissions: string[];
  verification: string | null;
  inputs: Array<{ name: string; type: string; required: boolean; label: string; labelKey: string }>;
  contexts: Array<{ name: string; entity: string }>;
  steps: Array<{ name: string; actions: Array<{ kind: string; summary: string }> }>;
  result: string;
}
export interface DocsPermissionField { name: string; value: string; label: string; labelKey: string }
export interface DocsPermissionGroup { name: string; members: string[]; label: string; labelKey: string }
export interface DocsPermissionVerification { name: string; label: string; labelKey: string; inputs: Array<{ name: string; type: string }> }
export interface DocsModel {
  app: { name: string; description?: string; descriptionKey?: string };
  features: { apiDocs: boolean; apiKeys: boolean };
  principal: { role: DocsRole; permissions: string[] };
  entities: DocsEntity[];
  relations: DocsRelation[];
  enums: Array<{ name: string; values: DocsEnumValue[] }>;
  dataflows: DocsDataflow[];
  permissions: { fields: DocsPermissionField[]; groups: DocsPermissionGroup[]; verifications: DocsPermissionVerification[] };
}
export interface DocsEnvelope { model: DocsModel; openApi: unknown }

export type DocsTabKey = "entities" | "dataflows" | "api" | "permissions" | "apiKeys";

/** Tabs available for the generated feature flags (访问密钥 only when API keys are enabled). */
export function docsTabs(flags: { apiDocs: boolean; apiKeys: boolean } = qiyFeatureFlags): DocsTabKey[] {
  const tabs: DocsTabKey[] = flags.apiDocs ? ["entities", "dataflows", "api", "permissions"] : [];
  if (flags.apiKeys) tabs.push("apiKeys");
  return tabs;
}

export function docsTabLabelKey(tab: DocsTabKey): string {
  return "qiy.docs.tab" + tab.charAt(0).toUpperCase() + tab.slice(1);
}

/** Mermaid identifiers must be stable ASCII: everything else is replaced. */
export function mermaidId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return normalized.length > 0 && /^[A-Za-z_]/.test(normalized) ? normalized : "qiy_" + normalized;
}

/** Escapes text placed inside a Mermaid label: no quotes, braces, semicolons or newlines. */
export function escapeMermaidLabel(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/[{}]/g, (character) => character === "{" ? "(" : ")")
    .replace(/;/g, ",")
    .replace(/[#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** UML class diagram from entities + relations, with fields and enum values. */
export function buildEntityDiagram(model: DocsModel): string {
  const lines: string[] = ["classDiagram", "  direction LR"];
  const tableId = new Map(model.entities.map((entity) => [entity.tableName, mermaidId("e_" + entity.tableName)]));
  for (const entity of model.entities) {
    const id = tableId.get(entity.tableName)!;
    lines.push("  class " + id + "[" + escapeMermaidLabel(entity.label) + "] {");
    for (const field of entity.fields) {
      const marks = [field.primaryKey ? "PK" : "", field.unique ? "UK" : "", field.nullable ? "" : "NN"].filter(Boolean).join(",");
      const type = field.enumName ? field.enumName : field.type;
      lines.push("    +" + mermaidId(field.name) + " " + escapeMermaidLabel(type) + (marks ? " [" + marks + "]" : ""));
    }
    lines.push("  }");
  }
  const seen = new Set<string>();
  for (const relation of model.relations) {
    const from = tableId.get(relation.fromTable);
    const to = tableId.get(relation.toTable);
    if (!from || !to) continue;
    const key = from + "->" + to + ":" + relation.field;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push("  " + from + " --> " + to + " : " + escapeMermaidLabel(relation.field));
  }
  return lines.join("\n");
}

/** Flowchart for one dataflow: inputs -> context loads -> steps/actions -> result. */
export function buildDataflowDiagram(flow: DocsDataflow): string {
  const lines: string[] = ["flowchart LR"];
  const inputId = mermaidId("d_" + flow.name + "_input");
  lines.push("  " + inputId + "([\u8f93\u5165: " + escapeMermaidLabel(flow.inputs.length ? flow.inputs.map((input) => input.name).join(", ") : "\u65e0") + "])");
  const contextIds = flow.contexts.map((context, index) => {
    const id = mermaidId("d_" + flow.name + "_ctx_" + index);
    lines.push("  " + id + "[(" + escapeMermaidLabel(context.name + ": " + context.entity) + ")]");
    return id;
  });
  const stepIds = flow.steps.map((step, index) => {
    const id = mermaidId("d_" + flow.name + "_step_" + index);
    lines.push("  " + id + '["' + escapeMermaidLabel(step.name) + '"]');
    return id;
  });
  const actionIds: string[] = [];
  flow.steps.forEach((step, stepIndex) => {
    step.actions.forEach((action, actionIndex) => {
      const id = mermaidId("d_" + flow.name + "_act_" + stepIndex + "_" + actionIndex);
      lines.push("  " + id + ">[" + escapeMermaidLabel(action.kind + ": " + action.summary) + "]]");
      actionIds.push(id);
    });
  });
  const resultId = mermaidId("d_" + flow.name + "_result");
  lines.push("  " + resultId + "([" + escapeMermaidLabel("\u7ed3\u679c: " + flow.result) + "])");
  const chain = [inputId, ...contextIds, ...stepIds, ...actionIds, resultId];
  for (let index = 1; index < chain.length; index += 1) lines.push("  " + chain[index - 1] + " --> " + chain[index]);
  return lines.join("\n");
}

export function buildDataflowDiagrams(model: DocsModel): Array<{ name: string; label: string; source: string }> {
  return model.dataflows.map((flow) => ({ name: flow.name, label: flow.label, source: buildDataflowDiagram(flow) }));
}

export function describeDataflow(flow: DocsDataflow): { allowRoles: string[]; allowPermissions: string[]; verification: string | null; inputs: string[] } {
  return { allowRoles: flow.allowRoles, allowPermissions: flow.allowPermissions, verification: flow.verification, inputs: flow.inputs.map((input) => input.name + ": " + input.type + (input.required ? " (required)" : "")) };
}

async function docsFetch(path: string): Promise<Response> {
  const token = qiyAuthToken();
  const response = await fetch(path, { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error("Request failed (" + response.status + ")"), { statusCode: response.status });
  return response;
}

export async function fetchDocsEnvelopeUncached(): Promise<DocsEnvelope> {
  const [modelResponse, specResponse] = await Promise.all([
    qiyFeatureFlags.apiDocs ? docsFetch("/api/v1/docs/model") : Promise.resolve(undefined),
    qiyFeatureFlags.apiDocs ? docsFetch("/api/v1/openapi.json") : Promise.resolve(undefined),
  ]);
  const model = modelResponse ? await modelResponse.json() as DocsModel : undefined;
  const openApi = specResponse ? await specResponse.json() as unknown : undefined;
  if (!model) throw new Error("API docs are disabled");
  return { model, openApi };
}

/**
 * Docs metadata is immutable for a session, so the envelope is fetched once and
 * shared. Without this, a route remount (StrictMode/HMR) or a re-rendering page
 * issued /docs/model + /openapi.json in a tight loop.
 */
let docsEnvelopePromise: Promise<DocsEnvelope> | undefined;

export function fetchDocsEnvelope(force = false): Promise<DocsEnvelope> {
  if (!force && docsEnvelopePromise) return docsEnvelopePromise;
  const promise = fetchDocsEnvelopeUncached();
  docsEnvelopePromise = promise.catch((error: unknown) => {
    docsEnvelopePromise = undefined;
    throw error;
  });
  return docsEnvelopePromise;
}
