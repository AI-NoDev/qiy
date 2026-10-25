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

export interface OpenApiParameter { name: string; in: string; required: boolean; description?: string; schema?: unknown }
export interface OpenApiResponse { status: string; description?: string; schema?: unknown }
export interface OpenApiOperation {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  parameters: OpenApiParameter[];
  requestSchema?: unknown;
  responses: OpenApiResponse[];
  security: string[];
  roles: string[];
  permissions: string[];
  verification?: string | null;
}
export interface OpenApiTagGroup { name: string; description?: string; operations: OpenApiOperation[] }

function openApiRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function openApiString(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function openApiStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }

/** Short human-readable schema description used by the built-in API explorer. */
export function schemaSummary(schema: unknown, depth = 0): string {
  const record = openApiRecord(schema);
  if (!record) return "\u2014";
  if (typeof record.$ref === "string") return record.$ref.split("/").pop() ?? record.$ref;
  if (depth > 2) return "\u2026";
  const type = openApiString(record.type);
  const nullable = record.nullable === true ? "?" : "";
  const enums = Array.isArray(record.enum) ? record.enum.map(String) : [];
  const format = openApiString(record.format);
  if (type === "array") return "array<" + schemaSummary(record.items, depth + 1) + ">" + nullable;
  if (Array.isArray(record.oneOf)) return "oneOf<" + record.oneOf.map((item) => schemaSummary(item, depth + 1)).join(" | ") + ">";
  if (Array.isArray(record.anyOf)) return "anyOf<" + record.anyOf.map((item) => schemaSummary(item, depth + 1)).join(" | ") + ">";
  const properties = openApiRecord(record.properties);
  if (type === "object" || properties) {
    if (!properties) return "object" + nullable;
    const names = Object.keys(properties);
    const shown = names.slice(0, 6).map((name) => name + ": " + schemaSummary(properties[name], depth + 1));
    return "object { " + shown.join("; ") + (names.length > 6 ? "; \u2026" : "") + " }";
  }
  const base = type ?? "value";
  const enumText = enums.length ? " (" + enums.slice(0, 8).join(" | ") + (enums.length > 8 ? " | \u2026" : "") + ")" : "";
  return base + (format ? " (" + format + ")" : "") + enumText + nullable;
}

/** Deterministic example value for request bodies and curl snippets. */
export function schemaExample(schema: unknown, depth = 0): unknown {
  const record = openApiRecord(schema);
  if (!record || depth > 4) return null;
  if (typeof record.$ref === "string") return record.$ref.split("/").pop() ?? "";
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0];
  if (Array.isArray(record.oneOf) && record.oneOf.length > 0) return schemaExample(record.oneOf[0], depth + 1);
  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) return schemaExample(record.anyOf[0], depth + 1);
  const type = openApiString(record.type);
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [schemaExample(record.items, depth + 1)];
  const properties = openApiRecord(record.properties);
  if (type === "object" || properties) {
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(properties ?? {})) result[name] = schemaExample(child, depth + 1);
    return result;
  }
  return "";
}

function openApiParameter(raw: unknown): OpenApiParameter | undefined {
  const record = openApiRecord(raw);
  if (!record) return undefined;
  const name = openApiString(record.name);
  if (!name) return undefined;
  return { name, in: openApiString(record.in) ?? "query", required: record.required === true, ...(openApiString(record.description) ? { description: openApiString(record.description) } : {}), ...(record.schema !== undefined ? { schema: record.schema } : {}) };
}

function openApiResponse(raw: unknown): { description?: string; schema?: unknown } | undefined {
  const record = openApiRecord(raw);
  if (!record) return undefined;
  const content = openApiRecord(record.content);
  const jsonContent = content ? openApiRecord(content["application/json"]) : undefined;
  return { ...(openApiString(record.description) ? { description: openApiString(record.description) } : {}), ...(jsonContent?.schema !== undefined ? { schema: jsonContent.schema } : {}) };
}

function openApiSecurityNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>();
  for (const entry of raw) for (const name of Object.keys(openApiRecord(entry) ?? {})) names.add(name);
  return [...names];
}

function openApiOperation(path: string, method: string, raw: unknown): OpenApiOperation | undefined {
  const record = openApiRecord(raw);
  if (!record) return undefined;
  const requestBody = openApiRecord(record.requestBody);
  const requestContent = requestBody ? openApiRecord(requestBody.content) : undefined;
  const requestJson = requestContent ? openApiRecord(requestContent["application/json"]) : undefined;
  const responses: OpenApiResponse[] = Object.entries(openApiRecord(record.responses) ?? {}).map(([status, value]) => {
    const response = openApiResponse(value);
    return { status, ...(response ?? {}) };
  });
  return {
    method,
    path,
    ...(openApiString(record.summary) ? { summary: openApiString(record.summary) } : {}),
    ...(openApiString(record.description) ? { description: openApiString(record.description) } : {}),
    ...(openApiString(record.operationId) ? { operationId: openApiString(record.operationId) } : {}),
    tags: openApiStringArray(record.tags).length > 0 ? openApiStringArray(record.tags) : ["default"],
    parameters: Array.isArray(record.parameters) ? record.parameters.map(openApiParameter).filter((item): item is OpenApiParameter => Boolean(item)) : [],
    ...(requestJson?.schema !== undefined ? { requestSchema: requestJson.schema } : {}),
    responses,
    security: openApiSecurityNames(record.security),
    roles: openApiStringArray(record["x-qiy-roles"]),
    permissions: openApiStringArray(record["x-qiy-permissions"]),
    ...(record["x-qiy-verification"] !== undefined ? { verification: record["x-qiy-verification"] as string | null } : {}),
  };
}

/** Groups OpenAPI operations by tag in a stable order (declared tags first, then alphabetical). */
export function groupOpenApiOperations(spec: unknown): OpenApiTagGroup[] {
  const document = openApiRecord(spec) ?? {};
  const paths = openApiRecord(document.paths) ?? {};
  const methods = ["get", "post", "patch", "delete"];
  const byTag = new Map<string, OpenApiOperation[]>();
  for (const path of Object.keys(paths)) {
    const item = openApiRecord(paths[path]);
    if (!item) continue;
    for (const method of methods) {
      const operation = openApiOperation(path, method, item[method]);
      if (!operation) continue;
      for (const tag of operation.tags) {
        const list = byTag.get(tag) ?? [];
        list.push(operation);
        byTag.set(tag, list);
      }
    }
  }
  const declared = (Array.isArray(document.tags) ? document.tags : []).map((tag) => openApiRecord(tag)).filter((tag): tag is Record<string, unknown> => Boolean(tag));
  const order = declared.map((tag) => openApiString(tag.name) ?? "").filter(Boolean);
  const names = [...order.filter((name) => byTag.has(name)), ...[...byTag.keys()].filter((name) => !order.includes(name)).sort()];
  return names.map((name) => {
    const tag = declared.find((entry) => openApiString(entry.name) === name);
    const description = tag ? openApiString(tag.description) : undefined;
    return { name, ...(description ? { description } : {}), operations: byTag.get(name) ?? [] };
  });
}

export function openApiOperationCount(spec: unknown): number {
  return groupOpenApiOperations(spec).reduce((total, group) => total + group.operations.length, 0);
}

export function openApiServerBaseUrl(spec: unknown, fallback = "http://localhost:3000"): string {
  const document = openApiRecord(spec) ?? {};
  const servers = Array.isArray(document.servers) ? document.servers : [];
  const first = openApiRecord(servers[0]);
  const url = first ? openApiString(first.url) : undefined;
  if (!url) return fallback;
  if (/^https?:/.test(url)) return url.replace(/\/+$/, "");
  if (url === "/") return fallback;
  return fallback + (url.startsWith("/") ? "" : "/") + url.replace(/\/+$/, "");
}

/** Copyable, read-only curl example for one operation (no live requests are made). */
export function buildCurlExample(input: { method: string; path: string; baseUrl?: string; security?: readonly string[]; requestBody?: unknown; locale?: string }): string {
  const method = input.method.toUpperCase();
  const baseUrl = (input.baseUrl ?? "http://localhost:3000").replace(/\/+$/, "");
  const locale = input.locale ?? "en-US";
  const chinese = locale.toLowerCase().startsWith("zh");
  const token = chinese ? "<\u4f1a\u8bdd\u4ee4\u724c>" : "<session-token>";
  const apiKey = chinese ? "<\u4f60\u7684 API Key>" : "<your-api-key>";
  const lines = ["curl -X " + method + " '" + baseUrl + input.path + "'"];
  const security = input.security ?? [];
  if (security.includes("apiKey") && !security.includes("bearerSession")) lines.push("  -H 'X-API-Key: " + apiKey + "'");
  else lines.push("  -H 'Authorization: Bearer " + token + "'");
  if (method !== "GET" && method !== "DELETE" && input.requestBody !== undefined) {
    lines.push("  -H 'Content-Type: application/json'");
    lines.push("  -d '" + JSON.stringify(input.requestBody) + "'");
  }
  const separator = " " + String.fromCharCode(92) + "\n";
  return lines.join(separator);
}
