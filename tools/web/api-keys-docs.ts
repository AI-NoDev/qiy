/**
 * Web renderers for the system feature pages: in-app documentation, API
 * reference, API keys and their tests.
 */

export function renderWebFeaturesModule(overviewPage: boolean, apiDocs: boolean, apiKeys: boolean): string {
  return `/** Generated feature flags and extra sidebar page links. Do not edit by hand. */
export const qiyFeatureFlags = { overview: ${overviewPage ? "true" : "false"}, apiDocs: ${apiDocs ? "true" : "false"}, apiKeys: ${apiKeys ? "true" : "false"} } as const;
export const docsEnabled = qiyFeatureFlags.apiDocs || qiyFeatureFlags.apiKeys;
export const overviewEnabled = qiyFeatureFlags.overview;

export interface QiyMenuLink {
  name: string;
  path: string;
  label: string;
  labelKey: string;
  icon?: string;
  group?: string;
}

/** Developer pages under 系统管理; each entry is only present when its feature is enabled. */
export const qiyMenuLinks: QiyMenuLink[] = [
${overviewPage ? `  { name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" },` : ""}
${apiDocs ? `  { name: "qiy-api-docs", path: "/system/api-docs", label: "API 文档", labelKey: "qiy.apiDocs.title", icon: "FileTextOutlined", group: "system" },` : ""}
${apiKeys ? `  { name: "qiy-api-keys", path: "/system/api-keys", label: "访问密钥", labelKey: "qiy.apiKey.title", icon: "KeyOutlined", group: "system" },` : ""}
];
`;
}

export function renderWebDocsModule(usesAuth: boolean): string {
  return `/** Generated documentation helpers: Mermaid builders, tab gating and API fetchers. */
${usesAuth ? 'import { qiyAuthToken } from "./auth";' : 'const qiyAuthToken = (): string | undefined => (typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token") ?? undefined);'}
import { qiyFeatureFlags } from "./features";

export type DocsRole = string;
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
  features: { overview: boolean; apiDocs: boolean; apiKeys: boolean };
  principal: { role: DocsRole; permissions: string[] };
  entities: DocsEntity[];
  relations: DocsRelation[];
  enums: Array<{ name: string; values: DocsEnumValue[] }>;
  dataflows: DocsDataflow[];
  permissions: { fields: DocsPermissionField[]; groups: DocsPermissionGroup[]; verifications: DocsPermissionVerification[] };
}
export interface DocsEnvelope { model: DocsModel; openApi: unknown }

/** 功能总览 page tabs (API docs and access keys are separate pages now). */
export type DocsTabKey = "entities" | "dataflows" | "permissions";

export function docsTabs(flags: { overview?: boolean } = qiyFeatureFlags): DocsTabKey[] {
  return flags.overview === false ? [] : ["entities", "dataflows", "permissions"];
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
    .replace(/[\\r\\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/[{}]/g, (character) => character === "{" ? "(" : ")")
    .replace(/;/g, ",")
    .replace(/[#]/g, "")
    .replace(/\\s+/g, " ")
    .trim();
}

/** UML class diagram from entities + relations, with fields and enum values. */
export function buildEntityDiagram(model: DocsModel): string {
  const lines: string[] = ["classDiagram", "  direction LR"];
  const tableId = new Map(model.entities.map((entity) => [entity.tableName, mermaidId("e_" + entity.tableName)]));
  for (const entity of model.entities) {
    const id = tableId.get(entity.tableName)!;
    lines.push("  class " + id + '["' + escapeMermaidLabel(entity.label) + '"] {');
    for (const field of entity.fields) {
      // Mermaid class members accept +Type field; PK/unique/nullable annotations
      // are not valid in the class body, so they stay in the field table below.
      const type = field.enumName ? field.enumName : field.type;
      lines.push("    +" + mermaidId(field.name) + " " + escapeMermaidLabel(type));
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
  return lines.join("\\n");
}

/** Flowchart for one dataflow: inputs -> context loads -> steps/actions -> result. */
export function buildDataflowDiagram(flow: DocsDataflow): string {
  const lines: string[] = ["flowchart LR"];
  const inputId = mermaidId("d_" + flow.name + "_input");
  lines.push("  " + inputId + "([\\u8f93\\u5165: " + escapeMermaidLabel(flow.inputs.length ? flow.inputs.map((input) => input.name).join(", ") : "\\u65e0") + "])");
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
      lines.push("  " + id + '["' + escapeMermaidLabel(action.kind + ": " + action.summary) + '"]');
      actionIds.push(id);
    });
  });
  const resultId = mermaidId("d_" + flow.name + "_result");
  lines.push("  " + resultId + "([" + escapeMermaidLabel("\\u7ed3\\u679c: " + flow.result) + "])");
  const chain = [inputId, ...contextIds, ...stepIds, ...actionIds, resultId];
  for (let index = 1; index < chain.length; index += 1) lines.push("  " + chain[index - 1] + " --> " + chain[index]);
  return lines.join("\\n");
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

/** Model metadata is immutable for a session: fetch once, share the promise. */
let docsModelPromise: Promise<DocsModel> | undefined;

export function fetchDocsModel(force = false): Promise<DocsModel> {
  if (!force && docsModelPromise) return docsModelPromise;
  const promise = docsFetch("/api/v1/docs/model").then(async (response) => await response.json() as DocsModel);
  docsModelPromise = promise.catch((error: unknown) => {
    docsModelPromise = undefined;
    throw error;
  });
  return docsModelPromise;
}

/** The permission-filtered OpenAPI document is fetched once per session. */
let openApiDocumentPromise: Promise<unknown> | undefined;

export function fetchOpenApiDocument(force = false): Promise<unknown> {
  if (!force && openApiDocumentPromise) return openApiDocumentPromise;
  const promise = docsFetch("/api/v1/openapi.json").then(async (response) => await response.json() as unknown);
  openApiDocumentPromise = promise.catch((error: unknown) => {
    openApiDocumentPromise = undefined;
    throw error;
  });
  return openApiDocumentPromise;
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
  if (!record) return "\\u2014";
  if (typeof record.$ref === "string") return record.$ref.split("/").pop() ?? record.$ref;
  if (depth > 2) return "\\u2026";
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
    return "object { " + shown.join("; ") + (names.length > 6 ? "; \\u2026" : "") + " }";
  }
  const base = type ?? "value";
  const enumText = enums.length ? " (" + enums.slice(0, 8).join(" | ") + (enums.length > 8 ? " | \\u2026" : "") + ")" : "";
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
  if (/^https?:/.test(url)) return url.replace(/\\/+$/, "");
  if (url === "/") return fallback;
  return fallback + (url.startsWith("/") ? "" : "/") + url.replace(/\\/+$/, "");
}

/** Copyable, read-only curl example for one operation (no live requests are made). */
export function buildCurlExample(input: { method: string; path: string; baseUrl?: string; security?: readonly string[]; requestBody?: unknown; locale?: string }): string {
  const method = input.method.toUpperCase();
  const baseUrl = (input.baseUrl ?? "http://localhost:3000").replace(/\\/+$/, "");
  const locale = input.locale ?? "en-US";
  const chinese = locale.toLowerCase().startsWith("zh");
  const token = chinese ? "<\\u4f1a\\u8bdd\\u4ee4\\u724c>" : "<session-token>";
  const apiKey = chinese ? "<\\u4f60\\u7684 API Key>" : "<your-api-key>";
  const lines = ["curl -X " + method + " '" + baseUrl + input.path + "'"];
  const security = input.security ?? [];
  if (security.includes("apiKey") && !security.includes("bearerSession")) lines.push("  -H 'X-API-Key: " + apiKey + "'");
  else lines.push("  -H 'Authorization: Bearer " + token + "'");
  if (method !== "GET" && method !== "DELETE" && input.requestBody !== undefined) {
    lines.push("  -H 'Content-Type: application/json'");
    lines.push("  -d '" + JSON.stringify(input.requestBody) + "'");
  }
  const separator = " " + String.fromCharCode(92) + "\\n";
  return lines.join(separator);
}

/** Case-insensitive match of one operation against path/method/summary/description/tags. */
export function openApiOperationMatches(operation: OpenApiOperation, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [operation.path, operation.method, operation.summary ?? "", operation.description ?? "", ...operation.tags].some((value) => value.toLowerCase().includes(trimmed));
}

/** Search filter for the API-docs page: drops empty tags and returns the matching count. */
export function filterOpenApiOperations(groups: readonly OpenApiTagGroup[], query: string): { groups: OpenApiTagGroup[]; total: number } {
  const filtered = groups.map((group) => ({ ...group, operations: group.operations.filter((operation) => openApiOperationMatches(operation, query)) })).filter((group) => group.operations.length > 0);
  return { groups: filtered, total: filtered.reduce((total, group) => total + group.operations.length, 0) };
}
`;
}

/** Client for the API-key management tab (list/create/revoke + pure helpers). */
export function renderWebApiKeysModule(): string {
  return `/** Generated API-key client and pure helpers for the access-key page. */
import { qiyAuthToken } from "./auth";

export const QIY_API_KEY_MAX_ACTIVE = 10;
export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromId?: string | null;
  scopes?: string[] | null;
}
export interface CreatedApiKey { key: string; record: ApiKeyRecord }
export interface ApiKeyEvent { id: string; keyId: string; action: "created" | "rotated" | "revoked" | string; at: string }
export interface QiyIdentityLike { id?: string; role?: string; permissions?: unknown; groups?: unknown }
export type ApiKeyStatusFilter = "all" | "active" | "revoked" | "expired";
export interface ApiKeyPermissionTag { key: string; kind: "role" | "permission" | "group"; value: string }

function authHeaders(): Record<string, string> {
  const token = qiyAuthToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) };
}

async function apiKeyRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw Object.assign(new Error(body?.error ?? "API key request failed (" + response.status + ")"), { statusCode: response.status });
  return body;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const body = await apiKeyRequest("/api/v1/auth/api-keys") as { items: ApiKeyRecord[] };
  return body.items;
}

export async function createApiKey(input: { name: string; expiresAt?: string | null; scopes?: string[] }): Promise<CreatedApiKey> {
  return await apiKeyRequest("/api/v1/auth/api-keys", { method: "POST", body: JSON.stringify({ name: input.name, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), ...(input.scopes && input.scopes.length ? { scopes: input.scopes } : {}) }) }) as CreatedApiKey;
}

export async function revokeApiKey(id: string): Promise<void> {
  await apiKeyRequest("/api/v1/auth/api-keys/" + encodeURIComponent(id), { method: "DELETE" });
}

export async function rotateApiKey(id: string): Promise<CreatedApiKey> {
  return await apiKeyRequest("/api/v1/auth/api-keys/" + encodeURIComponent(id) + "/rotate", { method: "POST" }) as CreatedApiKey;
}

export async function listApiKeyEvents(): Promise<ApiKeyEvent[]> {
  const body = await apiKeyRequest("/api/v1/auth/api-keys/events") as { items: ApiKeyEvent[] };
  return body.items;
}

export function maskedApiKey(prefix: string): string {
  return "qiy_" + prefix + "_********";
}

/** Number of keys that are neither revoked nor expired (the server enforces the same rule). */
export function countActiveApiKeys(records: readonly ApiKeyRecord[], now: Date = new Date()): number {
  return records.filter((record) => !record.revokedAt && (!record.expiresAt || new Date(record.expiresAt).getTime() > now.getTime())).length;
}

export function canCreateApiKey(records: readonly ApiKeyRecord[], now: Date = new Date()): boolean {
  return countActiveApiKeys(records, now) < QIY_API_KEY_MAX_ACTIVE;
}

export function defaultApiKeyName(records: readonly ApiKeyRecord[], now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return "Key " + stamp;
}

export function formatApiKeyDate(value: string | null, locale: string): string {
  if (!value) return "\\u2014";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale);
}

export type ApiKeyStatus = "active" | "revoked" | "expired";
export function apiKeyStatus(record: Pick<ApiKeyRecord, "revokedAt" | "expiresAt">, now: Date = new Date()): ApiKeyStatus {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function apiKeyStatusOptions(): ApiKeyStatusFilter[] {
  return ["all", "active", "revoked", "expired"];
}

/** Case-insensitive search across name, prefix and localized status label. */
export function apiKeyMatches(record: ApiKeyRecord, query: string, now: Date = new Date()): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [record.name, record.prefix, record.maskedKey, apiKeyStatus(record, now)].some((value) => value.toLowerCase().includes(trimmed));
}

/** Search + status filter used by the access-key page. */
export function filterApiKeys(records: readonly ApiKeyRecord[], input: { search?: string; status?: ApiKeyStatusFilter } = {}, now: Date = new Date()): ApiKeyRecord[] {
  const status = input.status ?? "all";
  const search = input.search ?? "";
  return records.filter((record) => (status === "all" || apiKeyStatus(record, now) === status) && apiKeyMatches(record, search, now));
}

/** Flatten the current identity into role/permission/group tags with hover explanations. */
/** Effective permission values from the cached identity, used as optional API-key scopes. */
export function permissionValues(identity: QiyIdentityLike | null | undefined): string[] {
  return permissionTags(identity).filter((tag) => tag.kind === "permission").map((tag) => tag.value);
}

export function permissionTags(identity: QiyIdentityLike | null | undefined): ApiKeyPermissionTag[] {
  if (!identity) return [];
  const tags: ApiKeyPermissionTag[] = [];
  if (typeof identity.role === "string" && identity.role) tags.push({ key: "role:" + identity.role, kind: "role", value: identity.role });
  const toValues = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : typeof value === "string" ? value.split(/[\\s,]+/).filter(Boolean) : [];
  for (const permission of toValues(identity.permissions)) tags.push({ key: "permission:" + permission, kind: "permission", value: permission });
  for (const group of toValues(identity.groups)) tags.push({ key: "group:" + group, kind: "group", value: group });
  return tags;
}

/** Relative time for last-used/created cells (tooltips carry the full timestamp). */
export function relativeTime(value: string | null, now: Date = new Date(), locale = "en-US"): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const deltaSeconds = Math.round((parsed.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const unit: Intl.RelativeTimeFormatUnit = absolute < 60 ? "second" : absolute < 3_600 ? "minute" : absolute < 86_400 ? "hour" : absolute < 2_592_000 ? "day" : "month";
  const divisor = unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3_600 : unit === "day" ? 86_400 : 2_592_000;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(deltaSeconds / divisor), unit);
}

/** Curl snippets shown on the access-key page. */
export function apiKeyCurlExamples(baseUrl = "http://localhost:3000"): { bearer: string; header: string } {
  const base = baseUrl.replace(/\\/+$/, "");
  return {
    bearer: "curl -H 'Authorization: Bearer qiy_<prefix>_<secret>' " + base + "/api/v1/inventory",
    header: "curl -H 'X-API-Key: qiy_<prefix>_<secret>' " + base + "/api/v1/inventory",
  };
}
`;
}

/** Mermaid renderer: SSR-safe placeholder, dynamic import in the browser. */
export function renderWebMermaidComponent(): string {
  return `import { Alert, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { useQiyUiOptional } from "../ui";

/** Maximum time the deferred Mermaid render may take before the source fallback is shown. */
export const QIY_MERMAID_TIMEOUT_MS = 10_000;

/**
 * Renders one Mermaid diagram. The server render keeps the diagram source in a
 * stable container (so docs SSR tests and bundle checks can see it); the browser
 * defers the heavy dynamic import to a later task, renders asynchronously, and
 * falls back to the raw source after a timeout or on any error instead of
 * leaving a blank/frozen panel. The diagram theme follows the app color mode
 * (亮色/暗色/跟随系统) and re-renders when it changes.
 */
export function MermaidDiagram({ id, source, ariaLabel, errorText, timeoutText }: { id: string; source: string; ariaLabel: string; errorText: string; timeoutText?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const renderSeq = useRef(0);
  const { resolvedColorMode } = useQiyUiOptional() ?? { resolvedColorMode: "light" as const };
  const [error, setError] = useState<string | undefined>();
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let delay: ReturnType<typeof setTimeout> | undefined;
    let guard: ReturnType<typeof setTimeout> | undefined;
    setError(undefined);
    setRendering(true);
    const start = () => {
      guard = setTimeout(() => {
        if (cancelled) return;
        setError(timeoutText ?? "Mermaid rendering timed out");
        setRendering(false);
      }, QIY_MERMAID_TIMEOUT_MS);
      void (async () => {
        try {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: resolvedColorMode === "dark" ? "dark" : "default" });
          // A fresh id per render avoids duplicate-definition warnings when the
          // color mode flips and the diagram is rendered again.
          renderSeq.current += 1;
          const rendered = await mermaid.render("qiy-mermaid-" + id + "-" + renderSeq.current, source);
          if (!cancelled && container.current) container.current.innerHTML = rendered.svg;
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (guard) clearTimeout(guard);
          if (!cancelled) setRendering(false);
        }
      })();
    };
    // Defer the import/render so the tab shell paints first; unmount/remount
    // (tab switches, HMR, StrictMode) cancels the pending render.
    delay = setTimeout(start, 0);
    return () => {
      cancelled = true;
      if (delay) clearTimeout(delay);
      if (guard) clearTimeout(guard);
    };
  }, [id, source, timeoutText, resolvedColorMode]);
  return <div className="qiy-mermaid" data-diagram={source} aria-label={ariaLabel}>
    <div ref={container} />
    {rendering ? <Spin size="small" /> : null}
    {error ? <>
      <Alert type="warning" showIcon message={errorText} description={error} />
      <pre className="qiy-mermaid-fallback" data-mermaid-fallback={source}>{source}</pre>
    </> : null}
  </div>;
}
`;
}

/** Docs page component + route. JSX is generated as a template string. */
export function renderWebDocsPageComponent(): string {
  return `import { Alert, Card, Descriptions, Empty, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import { useTranslation } from "@refinedev/core";
import { Component, useState, type ReactNode } from "react";
import {
  buildDataflowDiagram,
  buildEntityDiagram,
  describeDataflow,
  docsTabLabelKey,
  docsTabs,
  type DocsDataflow,
  type DocsEntity,
  type DocsModel,
  type DocsTabKey,
} from "../docs";
import { MermaidDiagram } from "./mermaid";

/** Keeps a crashing panel from blanking the whole feature page. */
class DocsErrorBoundary extends Component<{ fallback: ReactNode; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface DocsPageProps {
  model?: DocsModel;
  loading?: boolean;
  error?: string;
  initialTab?: DocsTabKey;
}

function fieldColumns(translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string) {
  return [
    { title: translate("qiy.docs.fieldName", {}, "Field"), dataIndex: "name", key: "name" },
    { title: translate("qiy.docs.fieldType", {}, "Type"), dataIndex: "type", key: "type" },
    { title: translate("qiy.docs.fieldNullable", {}, "Nullable"), dataIndex: "nullable", key: "nullable", render: (value: boolean) => value ? translate("qiy.yes", {}, "Yes") : translate("qiy.no", {}, "No") },
    { title: translate("qiy.docs.fieldEnum", {}, "Enum"), dataIndex: "enumName", key: "enumName", render: (value?: string) => value ?? "—" },
    { title: translate("qiy.docs.fieldAnnotations", {}, "Annotations"), dataIndex: "annotations", key: "annotations", render: (value: string[]) => (value ?? []).map((entry) => <Tag key={entry}>{entry}</Tag>) },
  ];
}

function EntityPanel({ model }: { model: DocsModel }) {
  const { translate } = useTranslation();
  const [selected, setSelected] = useState<string | undefined>(model.entities[0]?.tableName);
  const entity = model.entities.find((candidate) => candidate.tableName === selected) ?? model.entities[0];
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.entitiesTitle", {}, "Entities & relations")}</Typography.Title>
    <MermaidDiagram id="entities" source={buildEntityDiagram(model)} ariaLabel={translate("qiy.docs.entitiesTitle", {}, "Entities & relations")} errorText={translate("qiy.docs.mermaidError", {}, "Diagram failed to render")} timeoutText={translate("qiy.docs.mermaidTimeout", {}, "Diagram rendering timed out; showing the source instead")} />
    <Table<DocsEntity> size="small" rowKey="tableName" pagination={false} dataSource={model.entities} columns={[
      { title: translate("qiy.docs.entity", {}, "Entity"), key: "entity", render: (_, row) => <Space><span>{translate(row.labelKey, {}, row.label)}</span>{row.restricted ? <Tag color="orange">{translate("qiy.docs.restricted", {}, "Restricted")}</Tag> : null}</Space> },
      { title: translate("qiy.docs.fieldName", {}, "Field"), key: "fields", render: (_, row) => row.fields.length },
      { title: translate("qiy.docs.actions", {}, "Actions"), key: "actions", render: (_, row) => (row.actions ?? []).map((action) => <Tag key={action}>{action}</Tag>) },
    ]} />
    {entity ? <>
      <Space wrap>
        <Typography.Text>{translate("qiy.docs.selectEntity", {}, "Entity")}</Typography.Text>
        <Select value={entity.tableName} style={{ minWidth: 220 }} onChange={(value: string) => setSelected(value)} options={model.entities.map((candidate) => ({ value: candidate.tableName, label: translate(candidate.labelKey, {}, candidate.label) }))} />
      </Space>
      <Table size="small" rowKey="name" pagination={false} dataSource={entity.fields} columns={fieldColumns(translate)} />
    </> : null}
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.relationsTitle", {}, "Relations")}</Typography.Title>
    <Table size="small" rowKey={(row) => row.fromTable + "." + row.field + "." + row.toTable} pagination={false} dataSource={model.relations} columns={[
      { title: translate("qiy.docs.from", {}, "From"), dataIndex: "fromTable", key: "fromTable" },
      { title: translate("qiy.docs.fieldName", {}, "Field"), dataIndex: "field", key: "field" },
      { title: translate("qiy.docs.to", {}, "To"), dataIndex: "toTable", key: "toTable" },
      { title: translate("qiy.docs.onDelete", {}, "On delete"), dataIndex: "onDelete", key: "onDelete", render: (value?: string) => value ?? "—" },
    ]} />
  </Space>;
}

function DataflowPanel({ model }: { model: DocsModel }) {
  const { translate } = useTranslation();
  const [selected, setSelected] = useState<string | undefined>(model.dataflows[0]?.name);
  const flow = model.dataflows.find((candidate) => candidate.name === selected) ?? model.dataflows[0];
  if (!flow) return <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} />;
  const info = describeDataflow(flow);
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.dataflowsTitle", {}, "Dataflows")}</Typography.Title>
    <Select value={flow.name} style={{ minWidth: 260 }} onChange={(value: string) => setSelected(value)} options={model.dataflows.map((candidate) => ({ value: candidate.name, label: translate(candidate.labelKey, {}, candidate.label) }))} />
    <MermaidDiagram id={"dataflow-" + flow.name} source={buildDataflowDiagram(flow)} ariaLabel={flow.label} errorText={translate("qiy.docs.mermaidError", {}, "Diagram failed to render")} timeoutText={translate("qiy.docs.mermaidTimeout", {}, "Diagram rendering timed out; showing the source instead")} />
    <Descriptions size="small" column={1} bordered items={[
      { key: "roles", label: translate("qiy.docs.allowRoles", {}, "Allowed roles"), children: info.allowRoles.length ? info.allowRoles.join(", ") : "—" },
      { key: "permissions", label: translate("qiy.docs.allowPermissions", {}, "Required permissions"), children: info.allowPermissions.length ? info.allowPermissions.join(", ") : "—" },
      { key: "verification", label: translate("qiy.docs.verification", {}, "Verification"), children: info.verification ?? "—" },
      { key: "inputs", label: translate("qiy.docs.dataflowInputs", {}, "Inputs"), children: info.inputs.length ? info.inputs.join(", ") : "—" },
      { key: "result", label: translate("qiy.docs.dataflowResult", {}, "Result"), children: flow.result },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={flow.steps} columns={[
      { title: translate("qiy.docs.dataflowSteps", {}, "Steps"), dataIndex: "name", key: "name" },
      { title: translate("qiy.docs.actions", {}, "Actions"), key: "actions", render: (_, row) => <Space direction="vertical" size={2}>{row.actions.map((action, index) => <Typography.Text key={index} code>{action.summary}</Typography.Text>)}</Space> },
    ]} />
  </Space>;
}

function PermissionsPanel({ model }: { model: DocsModel }) {
  const { translate } = useTranslation();
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.tabPermissions", {}, "Permissions")}</Typography.Title>
    <Descriptions size="small" column={1} items={[
      { key: "role", label: translate("qiy.docs.role", {}, "Role"), children: model.principal.role },
      { key: "permissions", label: translate("qiy.docs.effectivePermissions", {}, "Effective permissions"), children: model.principal.permissions.length ? model.principal.permissions.join(", ") : "—" },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={model.permissions.fields} columns={[
      { title: translate("qiy.docs.permissionField", {}, "Permission"), dataIndex: "label", key: "label" },
      { title: translate("qiy.docs.permissionValue", {}, "Value"), dataIndex: "value", key: "value" },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={model.permissions.groups} columns={[
      { title: translate("qiy.docs.permissionGroups", {}, "Groups"), dataIndex: "label", key: "label" },
      { title: translate("qiy.docs.members", {}, "Members"), dataIndex: "members", key: "members", render: (value: string[]) => value.join(", ") },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={model.permissions.verifications} columns={[
      { title: translate("qiy.docs.permissionVerifications", {}, "Verifications"), dataIndex: "label", key: "label" },
      { title: translate("qiy.docs.dataflowInputs", {}, "Inputs"), dataIndex: "inputs", key: "inputs", render: (value: Array<{ name: string; type: string }>) => value.map((entry) => entry.name + ": " + entry.type).join(", ") },
    ]} />
  </Space>;
}

function overviewTabChildren(tab: DocsTabKey, props: DocsPageProps): ReactNode {
  if (tab === "entities") return props.model ? <EntityPanel model={props.model} /> : null;
  if (tab === "dataflows") return props.model ? <DataflowPanel model={props.model} /> : null;
  return props.model ? <PermissionsPanel model={props.model} /> : null;
}

/** 功能总览 page: UML entities, dataflow diagrams and the permission model. */
export function DocsOverviewPage(props: DocsPageProps) {
  const { translate } = useTranslation();
  const tabs = docsTabs({ overview: true });
  const [active, setActive] = useState<DocsTabKey | undefined>(props.initialTab && tabs.includes(props.initialTab) ? props.initialTab : tabs[0]);
  if (tabs.length === 0) return <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} />;
  const current = active && tabs.includes(active) ? active : tabs[0];
  const content = props.loading
    ? <Spin size="large" />
    : props.error
      ? <Alert type="error" showIcon message={translate("qiy.docs.loadError", {}, "Failed to load the overview")} description={props.error} />
      : <DocsErrorBoundary fallback={<Alert type="warning" showIcon message={translate("qiy.docs.panelError", {}, "This section could not be rendered")} />}>{overviewTabChildren(current!, props)}</DocsErrorBoundary>;
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.docs.title", {}, "Feature overview")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{props.model?.app.description ?? translate("qiy.docs.subtitle", {}, "Generated entities, dataflows and permission model for this application")}</Typography.Paragraph>
    {props.model?.principal ? <Alert type="info" showIcon message={translate("qiy.docs.accessNote", {}, "This overview only shows what your role and permissions allow")} /> : null}
    <Card size="small">
      {/* Only the active tab is mounted: the Mermaid diagrams are heavy and keeping inactive panes alive froze the page. */}
      <Tabs activeKey={current} onChange={(key: string) => setActive(key as DocsTabKey)} destroyOnHidden items={tabs.map((tab) => ({ key: tab, label: translate(docsTabLabelKey(tab), {}, tab), children: tab === current ? content : null }))} />
    </Card>
  </Space>;
}
`;
}

/** Overview route: feature gate + model fetch. */
export function renderWebDocsRoute(): string {
  return `import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { overviewEnabled } from "../features";
import { fetchDocsModel, type DocsModel } from "../docs";
import { DocsOverviewPage } from "../components/docs-page";

export default function DocsRoute() {
  const [state, setState] = useState<{ model?: DocsModel; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // The route lives inside the guarded layout; using auth hooks here caused a
    // render loop, so fetch the model once and let the layout handle redirects.
    let cancelled = false;
    void (async () => {
      try {
        const model = await fetchDocsModel();
        if (!cancelled) setState({ model, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!overviewEnabled) return <Navigate to="/" replace />;
  return <DocsOverviewPage {...state} />;
}
`;
}

/** API-docs page: full-page, searchable, read-only OpenAPI explorer. */
export function renderWebApiDocsPageComponent(): string {
  return `import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Input, Menu, Row, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "@refinedev/core";
import { useMemo, useState } from "react";
import {
  buildCurlExample,
  filterOpenApiOperations,
  groupOpenApiOperations,
  openApiServerBaseUrl,
  schemaExample,
  schemaSummary,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiResponse,
  type OpenApiTagGroup,
} from "../docs";

/** Downloads the permission-filtered OpenAPI document currently shown on screen. */
function downloadOpenApiDocument(spec: unknown, title: string | undefined): void {
  if (spec === null || typeof spec !== "object") return;
  const stem = (title ?? "qiy").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "qiy";
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = stem + ".openapi.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface ApiDocsPageProps {
  spec?: unknown;
  loading?: boolean;
  error?: string;
  identity?: { role?: string; permissions?: string[]; groups?: string[] } | null;
  initialTag?: string;
  initialSearch?: string;
}

function curlFor(operation: OpenApiOperation, baseUrl: string, locale: string): string {
  return buildCurlExample({
    method: operation.method,
    path: operation.path,
    baseUrl,
    security: operation.security,
    ...(operation.requestSchema !== undefined ? { requestBody: schemaExample(operation.requestSchema) } : {}),
    locale,
  });
}

function ApiOperationCard({ operation, baseUrl, translate, locale }: { operation: OpenApiOperation; baseUrl: string; translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string; locale: string }) {
  const method = operation.method.toUpperCase();
  const color = operation.method === "get" ? "blue" : operation.method === "post" ? "green" : operation.method === "patch" ? "orange" : "red";
  const requestExample = operation.requestSchema !== undefined ? JSON.stringify(schemaExample(operation.requestSchema), null, 2) : undefined;
  const curl = curlFor(operation, baseUrl, locale);
  const pathParameters = operation.parameters.filter((parameter) => parameter.in === "path");
  const queryParameters = operation.parameters.filter((parameter) => parameter.in === "query");
  const [tryOpen, setTryOpen] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [bodyDraft, setBodyDraft] = useState(requestExample ?? "");
  const [apiKey, setApiKey] = useState("");
  const [sending, setSending] = useState(false);
  const [tryError, setTryError] = useState<string | undefined>();
  const [result, setResult] = useState<{ status: number; statusText: string; body: string } | undefined>();
  const sendTryIt = async () => {
    setSending(true);
    setTryError(undefined);
    setResult(undefined);
    try {
      let url = baseUrl.replace(/\\/+$/, "") + operation.path;
      for (const parameter of pathParameters) {
        url = url.replace("{" + parameter.name + "}", encodeURIComponent(paramValues[parameter.name] ?? ""));
      }
      const query = new URLSearchParams();
      for (const parameter of queryParameters) {
        const value = paramValues[parameter.name];
        if (value) query.set(parameter.name, value);
      }
      const token = typeof window === "undefined" ? null : window.localStorage.getItem("qiy.access_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = "Bearer " + token;
      if (apiKey.trim()) headers["X-API-Key"] = apiKey.trim();
      let body: string | undefined;
      if (operation.method !== "get" && bodyDraft.trim()) {
        headers["Content-Type"] = "application/json";
        body = bodyDraft;
      }
      const response = await fetch(url + (query.toString() ? "?" + query.toString() : ""), {
        method,
        headers,
        ...(body ? { body } : {}),
        credentials: "include",
      });
      const text = await response.text();
      setResult({ status: response.status, statusText: response.statusText, body: text.slice(0, 20000) });
    } catch (error) {
      setTryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
  const roleTooltip = translate("qiy.apiDocs.rolesTooltip", {}, "Your role must be one of these roles; this document is already filtered for your account.");
  const permissionTooltip = translate("qiy.apiDocs.permissionsTooltip", {}, "The operation additionally requires every listed permission; this document is already filtered for your account.");
  const securityTooltip = translate("qiy.apiDocs.securityTooltip", {}, "Supported authentication schemes for this operation.");
  const securityLabels = operation.security.map((scheme) => scheme === "apiKey"
    ? translate("qiy.docs.securityApiKey", {}, "X-API-Key header")
    : scheme === "bearerSession" ? translate("qiy.docs.securityBearer", {}, "Session JWT bearer") : scheme);
  return <Card size="small" style={{ marginBottom: 12 }} title={<Space wrap><Tag color={color}>{method}</Tag><Typography.Text code>{operation.path}</Typography.Text>{operation.summary ? <Typography.Text type="secondary">{operation.summary}</Typography.Text> : null}</Space>}>
    {operation.description ? <Typography.Paragraph type="secondary">{operation.description}</Typography.Paragraph> : null}
    {operation.roles.length > 0 || operation.permissions.length > 0 || operation.verification ? <Space wrap style={{ marginBottom: 8 }}>
      {operation.roles.length > 0 ? <Tooltip title={roleTooltip}><Tag color="purple" data-tooltip={roleTooltip}>{translate("qiy.docs.roles", {}, "Roles") + ": " + operation.roles.join(", ")}</Tag></Tooltip> : null}
      {operation.permissions.length > 0 ? <Tooltip title={permissionTooltip}><Tag color="geekblue" data-tooltip={permissionTooltip}>{translate("qiy.docs.permissions", {}, "Permissions") + ": " + operation.permissions.join(", ")}</Tag></Tooltip> : null}
      {operation.verification ? <Tag color="gold">{translate("qiy.docs.verification", {}, "Verification") + ": " + operation.verification}</Tag> : null}
    </Space> : null}
    {operation.parameters.length > 0 ? <>
      <Typography.Text strong style={{ display: "block", marginTop: 8 }}>{translate("qiy.docs.parameters", {}, "Parameters")}</Typography.Text>
      <Table size="small" pagination={false} rowKey={(row: OpenApiParameter) => row.in + ":" + row.name} dataSource={operation.parameters} columns={[
        { title: translate("qiy.docs.paramName", {}, "Name"), dataIndex: "name", key: "name" },
        { title: translate("qiy.docs.paramIn", {}, "In"), dataIndex: "in", key: "in" },
        { title: translate("qiy.docs.paramRequired", {}, "Required"), dataIndex: "required", key: "required", render: (value: boolean) => value ? translate("qiy.yes", {}, "Yes") : translate("qiy.no", {}, "No") },
        { title: translate("qiy.docs.fieldType", {}, "Type"), dataIndex: "schema", key: "schema", render: (schema: unknown) => schemaSummary(schema) },
      ]} />
    </> : null}
    {requestExample ? <>
      <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.requestBody", {}, "Request body")}</Typography.Text>
      <pre className="qiy-docs-code">{requestExample}</pre>
    </> : null}
    {operation.responses.length > 0 ? <>
      <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.responses", {}, "Responses")}</Typography.Text>
      <Table size="small" pagination={false} rowKey={(row: OpenApiResponse) => row.status} dataSource={operation.responses} columns={[
        { title: translate("qiy.docs.responseStatus", {}, "Status"), dataIndex: "status", key: "status" },
        { title: translate("qiy.docs.responseDescription", {}, "Description"), dataIndex: "description", key: "description", render: (value?: string) => value ?? "—" },
        { title: translate("qiy.docs.fieldType", {}, "Type"), dataIndex: "schema", key: "schema", render: (schema: unknown) => schema ? schemaSummary(schema) : "—" },
      ]} />
    </> : null}
    <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.security", {}, "Security")}</Typography.Text>
    <Tooltip title={securityTooltip}><Space wrap>{securityLabels.length > 0 ? securityLabels.map((label) => <Tag key={label} data-tooltip={securityTooltip}>{label}</Tag>) : <Typography.Text type="secondary">—</Typography.Text>}</Space></Tooltip>
    <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.curl", {}, "curl example")}</Typography.Text>
    <Typography.Paragraph copyable={{ text: curl }}><pre className="qiy-docs-code">{curl}</pre></Typography.Paragraph>
    <Space wrap>
      <Button size="small" onClick={() => setTryOpen((open) => !open)}>{tryOpen ? translate("qiy.apiDocs.tryHide", {}, "Hide try it") : translate("qiy.apiDocs.tryOpen", {}, "Try it")}</Button>
    </Space>
    {tryOpen ? <Card size="small" type="inner" style={{ marginTop: 8 }}>
      <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={translate("qiy.apiDocs.tryWarning", {}, "Requests run from this browser using your current session token (or the API key below). Responses are shown raw and truncated to 20k characters.")} />
      {operation.security.includes("apiKey") ? <Input.Password style={{ marginBottom: 8 }} placeholder={translate("qiy.apiDocs.tryApiKey", {}, "Optional X-API-Key")} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /> : null}
      {pathParameters.length > 0 || queryParameters.length > 0 ? <Space direction="vertical" style={{ width: "100%", marginBottom: 8 }}>
        {[...pathParameters, ...queryParameters].map((parameter) => <Input key={parameter.in + ":" + parameter.name} addonBefore={parameter.in + " " + parameter.name} placeholder={parameter.required ? translate("qiy.apiDocs.tryRequired", {}, "required") : translate("qiy.apiDocs.tryOptional", {}, "optional")} value={paramValues[parameter.name] ?? ""} onChange={(event) => setParamValues({ ...paramValues, [parameter.name]: event.target.value })} />)}
      </Space> : null}
      {operation.method !== "get" && requestExample ? <Input.TextArea rows={6} style={{ marginBottom: 8, fontFamily: "monospace" }} value={bodyDraft} onChange={(event) => setBodyDraft(event.target.value)} /> : null}
      <Space style={{ marginBottom: 8 }}>
        <Button type="primary" size="small" loading={sending} onClick={sendTryIt}>{translate("qiy.apiDocs.trySend", {}, "Send request")}</Button>
        <Typography.Text type="secondary">{translate("qiy.apiDocs.tryAuth", {}, "Authorization: current session token / X-API-Key")}</Typography.Text>
      </Space>
      {tryError ? <Alert type="error" showIcon message={tryError} /> : null}
      {result ? <div style={{ marginTop: 8 }}>
        <Space style={{ marginBottom: 4 }}><Tag color={result.status >= 200 && result.status < 300 ? "green" : result.status >= 400 ? "red" : "orange"}>{result.status + " " + result.statusText}</Tag></Space>
        <pre className="qiy-docs-code">{result.body || "(empty response)"}</pre>
      </div> : null}
    </Card> : null}
  </Card>;
}

/** Full-page API reference explorer with session-scoped try-it requests. */
export function ApiDocsPage(props: ApiDocsPageProps) {
  const { translate, getLocale } = useTranslation();
  const groups = useMemo(() => groupOpenApiOperations(props.spec), [props.spec]);
  const [query, setQuery] = useState(props.initialSearch ?? "");
  const [tag, setTag] = useState<string | undefined>(props.initialTag);
  const filtered = useMemo(() => filterOpenApiOperations(groups, query), [groups, query]);
  const selected: OpenApiTagGroup | undefined = filtered.groups.find((group) => group.name === tag) ?? filtered.groups[0];
  const document = props.spec !== null && typeof props.spec === "object" && !Array.isArray(props.spec) ? props.spec as Record<string, unknown> : undefined;
  const info = document && document.info !== null && typeof document.info === "object" ? document.info as { title?: string; version?: string } : undefined;
  const principal = props.identity ?? (document && document["x-qiy-principal"] !== null && typeof document["x-qiy-principal"] === "object" ? document["x-qiy-principal"] as { role?: string; permissions?: string[]; groups?: string[] } : undefined);
  const hiddenOperations = useMemo(() => {
    const hidden = document?.["x-qiy-hidden"];
    return Array.isArray(hidden) ? hidden.filter((entry): entry is { method?: string; path?: string; reason?: string; verification?: string; label?: string } => entry !== null && typeof entry === "object") : [];
  }, [props.spec]);
  const baseUrl = openApiServerBaseUrl(props.spec, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  const roleTooltip = translate("qiy.apiDocs.roleTooltip", {}, "Your account role is used to filter this document; operations you cannot call are not listed.");
  const permissionTooltip = translate("qiy.apiDocs.permissionTooltip", {}, "Permission values from your role, database column and verified claims. The document only contains operations you may call.");
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.apiDocs.pageTitle", {}, "API reference")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiDocs.pageSubtitle", {}, "OpenAPI 3.1 operations allowed for the current account. Try them with your session token or an API key, or copy the curl example.")}</Typography.Paragraph>
    {hiddenOperations.length > 0 ? <Alert type="info" showIcon message={translate("qiy.apiDocs.hiddenTitle", { count: hiddenOperations.length }, hiddenOperations.length + " verification-gated operations are hidden")} description={<Space direction="vertical" size={2}>{hiddenOperations.map((operation) => <Typography.Text key={(operation.method ?? "post") + ":" + (operation.path ?? "")} type="secondary">{(operation.label ?? operation.path ?? "") + " — " + translate("qiy.apiDocs.hiddenVerification", { verification: operation.verification ?? "" }, "requires runtime verification: " + (operation.verification ?? ""))}</Typography.Text>)}</Space>} /> : null}
    <Space wrap>
      {info?.title ? <Typography.Text strong>{info.title}</Typography.Text> : null}
      {info?.version ? <Tag>{info.version}</Tag> : null}
      {document ? <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadOpenApiDocument(document, info?.title)}>{translate("qiy.apiDocs.download", {}, "Download OpenAPI")}</Button> : null}
      {principal?.role ? <Tooltip title={roleTooltip}><Tag color="blue">{translate("qiy.apiDocs.currentRole", {}, "Role") + ": " + principal.role}</Tag></Tooltip> : null}
      {Array.isArray(principal?.permissions) && principal.permissions.length > 0 ? <Tooltip title={permissionTooltip}><Tag color="geekblue">{translate("qiy.apiDocs.currentPermissions", {}, "Permissions") + ": " + principal.permissions.map(String).join(", ")}</Tag></Tooltip> : null}
    </Space>
    <Alert type="info" showIcon message={translate("qiy.docs.apiFiltered", {}, "This document is filtered by the current account permissions")} />
    <Input.Search allowClear value={query} onChange={(event) => { setQuery(event.target.value); setTag(undefined); }} placeholder={translate("qiy.apiDocs.searchPlaceholder", {}, "Search path, method, summary or tag")} />
    {props.loading ? <Spin size="large" /> : props.error ? <Alert type="error" showIcon message={translate("qiy.apiDocs.loadError", {}, "Failed to load the API document")} description={props.error} /> : !document ? <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} /> : <>
      <Typography.Text type="secondary">{translate("qiy.apiDocs.resultCount", { count: filtered.total }, String(filtered.total) + " operation(s)")}</Typography.Text>
      {filtered.total === 0 ? <Empty description={translate("qiy.apiDocs.noResults", {}, "No operations match this search")} /> : <Row gutter={16}>
        <Col xs={24} md={6}>
          <div style={{ position: "sticky", top: 16 }}>
            <Menu mode="inline" selectedKeys={selected ? [selected.name] : []} onClick={({ key }: { key: string }) => setTag(String(key))} items={filtered.groups.map((group) => ({ key: group.name, label: <Space>{group.name}<Tag>{group.operations.length}</Tag></Space> }))} style={{ borderInlineEnd: "none" }} />
          </div>
        </Col>
        <Col xs={24} md={18}>
          {selected ? <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Title level={5} style={{ margin: 0 }}>{selected.name}{selected.description ? <Typography.Text type="secondary"> {selected.description}</Typography.Text> : null}</Typography.Title>
            {selected.operations.map((operation) => <ApiOperationCard key={operation.method + " " + operation.path} operation={operation} baseUrl={baseUrl} translate={translate} locale={getLocale()} />)}
          </Space> : null}
        </Col>
      </Row>}
    </>}
  </Space>;
}
`;
}

/** API-docs route: feature gate + OpenAPI/identity fetch (no auth hooks). */
export function renderWebApiDocsRoute(usesAuth: boolean): string {
  return `import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { fetchOpenApiDocument } from "../docs";
${usesAuth ? 'import { fetchCurrentIdentity } from "../auth";' : ""}
import { ApiDocsPage, type ApiDocsPageProps } from "../components/api-docs-page";

export default function ApiDocsRoute() {
  const [state, setState] = useState<{ spec?: unknown; identity?: ApiDocsPageProps["identity"]; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules: they caused a render loop. The guard
    // layout handles redirects; fetch the spec + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [spec, identity] = await Promise.all([fetchOpenApiDocument(), ${usesAuth ? "fetchCurrentIdentity()" : "Promise.resolve(undefined)"}]);
        if (!cancelled) setState({ spec, identity: (identity ?? undefined) as ApiDocsPageProps["identity"], loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiDocs) return <Navigate to="/" replace />;
  return <ApiDocsPage {...state} />;
}
`;
}

/** Access-keys page: developer-oriented API-key management. */
export function renderWebApiKeysPageComponent(): string {
  return `import { Alert, Button, Card, DatePicker, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
import { useTranslation } from "@refinedev/core";
import { useState } from "react";
import { Link } from "react-router";
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyCurlExamples,
  apiKeyStatus,
  apiKeyStatusOptions,
  canCreateApiKey,
  countActiveApiKeys,
  createApiKey,
  defaultApiKeyName,
  filterApiKeys,
  formatApiKeyDate,
  listApiKeyEvents,
  permissionTags,
  permissionValues,
  relativeTime,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyEvent,
  type ApiKeyRecord,
  type ApiKeyStatusFilter,
  type QiyIdentityLike,
} from "../api-keys";
import { qiyFeatureFlags } from "../features";

export interface ApiKeysPageProps {
  identity?: QiyIdentityLike | null;
  initialRecords?: ApiKeyRecord[];
  initialEvents?: ApiKeyEvent[];
  loading?: boolean;
  error?: string;
  initialSearch?: string;
  initialStatus?: ApiKeyStatusFilter;
  initialCreateOpen?: boolean;
  initialSecret?: string;
}

const statusColor: Record<string, string> = { active: "green", revoked: "red", expired: "orange" };
type Translate = (key: string, params?: Record<string, unknown>, fallback?: string) => string;

function statusLabel(state: string, translate: Translate): string {
  return translate("qiy.apiKey.status." + state, {}, state.charAt(0).toUpperCase() + state.slice(1));
}

function CreateKeyForm({ translate, form, records, permissions }: { translate: Translate; form?: ReturnType<typeof Form.useForm>[0]; records?: ApiKeyRecord[]; permissions?: string[] }) {
  const [fallback] = Form.useForm();
  const usedForm = form ?? fallback;
  return <Form form={usedForm} layout="vertical" initialValues={{ name: defaultApiKeyName(records ?? []) }}>
    <Form.Item name="name" label={translate("qiy.apiKey.name", {}, "Name")} rules={[{ required: true, message: translate("qiy.apiKey.nameRequired", {}, "Name is required") }]}>
      <Input placeholder={translate("qiy.apiKey.namePlaceholder", {}, "e.g. CI deploy")} maxLength={80} />
    </Form.Item>
    <Form.Item name="expiresAt" label={translate("qiy.apiKey.expires", {}, "Expires (optional)")}>
      <DatePicker showTime style={{ width: "100%" }} />
    </Form.Item>
    {permissions && permissions.length > 0 ? <Form.Item name="scopes" label={translate("qiy.apiKey.scopes", {}, "Permission scopes (optional)")} extra={translate("qiy.apiKey.scopesHint", {}, "Leave empty to inherit all of your permissions. Scopes only narrow permission checks.")}>
      <Select mode="multiple" allowClear placeholder={translate("qiy.apiKey.scopesPlaceholder", {}, "All permissions")} options={permissions.map((permission) => ({ value: permission, label: permission }))} />
    </Form.Item> : null}
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiKey.createExplanation", {}, "The key inherits your current role and permissions (or the selected subset). Expired or revoked keys stop working immediately.")}</Typography.Paragraph>
  </Form>;
}

function SecretKeyContent({ secret, translate, copy }: { secret?: string; translate: Translate; copy: (value: string) => Promise<void> }) {
  return <>
    <Alert type="warning" showIcon message={translate("qiy.apiKey.secretHint", {}, "The full key is shown only once and cannot be recovered.")} style={{ marginBottom: 12 }} />
    <Typography.Paragraph><Typography.Text code copyable>{secret}</Typography.Text></Typography.Paragraph>
    <Button onClick={() => secret ? void copy(secret) : undefined}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button>
  </>;
}

/** Full-page API-key management UI. The route wrapper owns fetching. */
export function ApiKeysPage(props: ApiKeysPageProps) {
  const { translate, getLocale } = useTranslation();
  const locale = getLocale();
  const [records, setRecords] = useState<ApiKeyRecord[]>(props.initialRecords ?? []);
  const [events, setEvents] = useState<ApiKeyEvent[]>(props.initialEvents ?? []);
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const [status, setStatus] = useState<ApiKeyStatusFilter>(props.initialStatus ?? "all");
  const [createOpen, setCreateOpen] = useState(Boolean(props.initialCreateOpen));
  const [secret, setSecret] = useState<string | undefined>(props.initialSecret);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const filtered = filterApiKeys(records, { search, status });
  const activeCount = countActiveApiKeys(records);
  const tags = permissionTags(props.identity);
  const curls = apiKeyCurlExamples(typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  const roleTooltip = translate("qiy.apiKey.roleTooltip", {}, "Your account role. API keys inherit the role and permissions of the user who created them.");
  const permissionTooltip = translate("qiy.apiKey.permissionTooltip", {}, "Effective permission values for your account; a key created here can call exactly the APIs that you can call.");
  const groupTooltip = translate("qiy.apiKey.groupTooltip", {}, "Permission groups (roles) granted to your account.");
  const refreshAudit = () => {
    void listApiKeyEvents().then(setEvents).catch(() => undefined);
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      void message.success(translate("qiy.apiKey.copied", {}, "Copied"));
    } catch {
      void message.warning(value);
    }
  };
  const create = async () => {
    const values = await form.validateFields() as { name: string; expiresAt?: { toISOString?: () => string } | null; scopes?: string[] };
    setSaving(true);
    try {
      const created = await createApiKey({ name: values.name, expiresAt: values.expiresAt?.toISOString?.() ?? null, scopes: values.scopes ?? [] });
      setRecords((current) => [created.record, ...current]);
      setSecret(created.key);
      setCreateOpen(false);
      form.resetFields();
      refreshAudit();
      void message.success(translate("qiy.apiKey.created", {}, "Created"));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const revoke = async (record: ApiKeyRecord) => {
    try {
      await revokeApiKey(record.id);
      setRecords((current) => current.map((entry) => entry.id === record.id ? { ...entry, revokedAt: new Date().toISOString() } : entry));
      refreshAudit();
      void message.success(translate("qiy.apiKey.revokedMessage", {}, "Revoked"));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const rotate = async (record: ApiKeyRecord) => {
    setSaving(true);
    try {
      const rotated = await rotateApiKey(record.id);
      setRecords((current) => [rotated.record, ...current.map((entry) => entry.id === record.id ? { ...entry, revokedAt: new Date().toISOString() } : entry)]);
      setSecret(rotated.key);
      refreshAudit();
      void message.success(translate("qiy.apiKey.rotatedMessage", {}, "Rotated; the old key is revoked"));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.apiKey.pageTitle", {}, "Access keys")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiKey.pageSubtitle", {}, "Personal API keys for scripts and CI. Each key inherits your role and permissions and can be used as a Bearer token or X-API-Key header.")}</Typography.Paragraph>
    {qiyFeatureFlags.apiDocs ? <Typography.Paragraph style={{ margin: 0 }}><Link to="/system/api-docs">{translate("qiy.apiKey.apiDocsLink", {}, "View the API reference allowed for your account")}</Link></Typography.Paragraph> : null}
    <Card size="small" title={translate("qiy.apiKey.curlTitle", {}, "Using a key with curl")}>
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <pre className="qiy-docs-code">{curls.bearer}</pre><Button size="small" onClick={() => void copy(curls.bearer)}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button>
        <pre className="qiy-docs-code">{curls.header}</pre><Button size="small" onClick={() => void copy(curls.header)}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button>
      </Space>
    </Card>
    <Space wrap>
      <Input.Search allowClear value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translate("qiy.apiKey.searchPlaceholder", {}, "Search name, prefix or status")} style={{ width: 320 }} />
      <Select value={status} style={{ width: 160 }} onChange={(value: ApiKeyStatusFilter) => setStatus(value)} options={apiKeyStatusOptions().map((option) => ({ value: option, label: statusLabel(option, translate) }))} />
      <Button type="primary" disabled={!canCreateApiKey(records)} onClick={() => setCreateOpen(true)}>{translate("qiy.apiKey.create", {}, "Create key")}</Button>
      <Typography.Text type="secondary">{activeCount + " / " + QIY_API_KEY_MAX_ACTIVE} {translate("qiy.apiKey.limitHint", {}, "active keys")}</Typography.Text>
    </Space>
    {tags.length > 0 ? <Space wrap>
      {tags.map((tag) => <Tooltip key={tag.key} title={tag.kind === "role" ? roleTooltip : tag.kind === "group" ? groupTooltip : permissionTooltip}><Tag color={tag.kind === "role" ? "blue" : tag.kind === "group" ? "purple" : "geekblue"} data-tooltip={tag.kind === "role" ? roleTooltip : tag.kind === "group" ? groupTooltip : permissionTooltip}>{tag.kind + ": " + tag.value}</Tag></Tooltip>)}
    </Space> : null}
    {props.error ? <Alert type="error" showIcon message={translate("qiy.apiKey.loadError", {}, "Failed to load API keys")} description={props.error} /> : null}
    <Table<ApiKeyRecord> size="small" rowKey="id" loading={props.loading} pagination={false} dataSource={filtered} locale={{ emptyText: translate("qiy.apiKey.empty", {}, "No API keys yet") }} columns={[
      { title: translate("qiy.apiKey.name", {}, "Name"), dataIndex: "name", key: "name" },
      { title: translate("qiy.apiKey.scopes", {}, "Scopes"), key: "scopes", render: (_, record) => record.scopes && record.scopes.length ? <Space wrap>{record.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>)}</Space> : <Typography.Text type="secondary">{translate("qiy.apiKey.scopesAll", {}, "All permissions")}</Typography.Text> },
      { title: translate("qiy.apiKey.prefix", {}, "Key"), key: "prefix", render: (_, record) => <Space><Typography.Text code>{record.maskedKey}</Typography.Text><Button size="small" type="link" onClick={() => void copy(record.maskedKey)}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button></Space> },
      { title: translate("qiy.apiKey.status", {}, "Status"), key: "status", render: (_, record) => { const state = apiKeyStatus(record); return <Tag color={statusColor[state]}>{statusLabel(state, translate)}</Tag>; } },
      { title: translate("qiy.apiKey.createdAt", {}, "Created"), dataIndex: "createdAt", key: "createdAt", render: (value: string) => formatApiKeyDate(value, locale) },
      { title: translate("qiy.apiKey.lastUsed", {}, "Last used"), dataIndex: "lastUsedAt", key: "lastUsedAt", render: (value: string | null) => value ? <Tooltip title={formatApiKeyDate(value, locale)}>{relativeTime(value, new Date(), locale)}</Tooltip> : translate("qiy.apiKey.never", {}, "Never") },
      { title: translate("qiy.apiKey.expires", {}, "Expires"), dataIndex: "expiresAt", key: "expiresAt", render: (value: string | null) => value ? <Tooltip title={formatApiKeyDate(value, locale)}>{formatApiKeyDate(value, locale)}</Tooltip> : translate("qiy.apiKey.never", {}, "Never") },
      { title: translate("qiy.apiKey.actions", {}, "Actions"), key: "actions", render: (_, record) => record.revokedAt ? null : <Space wrap><Popconfirm title={translate("qiy.apiKey.rotateConfirm", {}, "Rotate this key? The old key stops working immediately and the new secret is shown once.")} onConfirm={() => void rotate(record)} okText={translate("qiy.apiKey.rotate", {}, "Rotate")} cancelText={translate("qiy.cancel", {}, "Cancel")}><Button size="small" loading={saving}>{translate("qiy.apiKey.rotate", {}, "Rotate")}</Button></Popconfirm><Popconfirm title={translate("qiy.apiKey.revokeConfirm", {}, "Revoke this key? It stops working immediately.")} onConfirm={() => void revoke(record)} okText={translate("qiy.apiKey.revoke", {}, "Revoke")} cancelText={translate("qiy.cancel", {}, "Cancel")}><Button danger size="small">{translate("qiy.apiKey.revoke", {}, "Revoke")}</Button></Popconfirm></Space> },
    ]} />
    <Card size="small" title={translate("qiy.apiKey.auditTitle", {}, "Audit trail")}>
      <Table<ApiKeyEvent> size="small" rowKey="id" pagination={false} dataSource={events} locale={{ emptyText: translate("qiy.apiKey.auditEmpty", {}, "No key events yet") }} columns={[
        { title: translate("qiy.apiKey.auditTime", {}, "Time"), dataIndex: "at", key: "at", render: (value: string) => formatApiKeyDate(value, locale) },
        { title: translate("qiy.apiKey.auditAction", {}, "Action"), dataIndex: "action", key: "action", render: (value: string) => <Tag color={value === "revoked" ? "red" : value === "rotated" ? "orange" : "green"}>{value}</Tag> },
        { title: translate("qiy.apiKey.auditKey", {}, "Key"), dataIndex: "keyId", key: "keyId", render: (value: string) => <Typography.Text code>{value.slice(0, 8) + "…"}</Typography.Text> },
      ]} />
    </Card>
    <Modal open={createOpen} forceRender getContainer={false} title={translate("qiy.apiKey.create", {}, "Create key")} okText={translate("qiy.apiKey.create", {}, "Create key")} confirmLoading={saving} onOk={() => void create()} onCancel={() => setCreateOpen(false)}>
      <CreateKeyForm translate={translate} form={form} records={records} permissions={permissionValues(props.identity)} />
    </Modal>
    <Modal open={Boolean(secret)} forceRender getContainer={false} title={translate("qiy.apiKey.secretTitle", {}, "Save this secret now")} onCancel={() => setSecret(undefined)} footer={<Space><Button onClick={() => secret ? void copy(secret) : undefined}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button><Button type="primary" onClick={() => setSecret(undefined)}>{translate("qiy.close", {}, "Close")}</Button></Space>}>
      <SecretKeyContent secret={secret} translate={translate} copy={copy} />
    </Modal>
    {props.initialCreateOpen ? <div hidden data-modal-preview="create"><CreateKeyForm translate={translate} records={records} permissions={permissionValues(props.identity)} /></div> : null}
    {props.initialSecret ? <div hidden data-modal-preview="secret"><Typography.Title level={5}>{translate("qiy.apiKey.secretTitle", {}, "Save this secret now")}</Typography.Title><SecretKeyContent secret={props.initialSecret} translate={translate} copy={copy} /></div> : null}
  </Space>;
}
`;
}

/** API-keys route: feature gate + key list/identity fetch (no auth hooks). */
export function renderWebApiKeysRoute(): string {
  return `import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { listApiKeyEvents, listApiKeys, type ApiKeyEvent, type ApiKeyRecord, type QiyIdentityLike } from "../api-keys";
import { fetchCurrentIdentity } from "../auth";
import { ApiKeysPage } from "../components/api-keys-page";

export default function ApiKeysRoute() {
  const [state, setState] = useState<{ records?: ApiKeyRecord[]; events?: ApiKeyEvent[]; identity?: QiyIdentityLike; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules (render-loop hazard); the guarded layout
    // owns redirects, this effect fetches the key list, audit events + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [records, events, identity] = await Promise.all([listApiKeys(), listApiKeyEvents(), fetchCurrentIdentity()]);
        if (!cancelled) setState({ records, events, identity: identity ?? undefined, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiKeys) return <Navigate to="/" replace />;
  return <ApiKeysPage initialRecords={state.records} initialEvents={state.events} identity={state.identity} loading={state.loading} error={state.error} />;
}
`;
}

/** Generated web tests for the docs helpers, menu link and API-key pure helpers. */
export function renderWebFeaturesTest(overview: boolean, apiDocs: boolean, apiKeys: boolean): string {
  const links: Array<Record<string, string>> = [];
  if (overview) links.push({ name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" });
  if (apiDocs) links.push({ name: "qiy-api-docs", path: "/system/api-docs", label: "API 文档", labelKey: "qiy.apiDocs.title", icon: "FileTextOutlined", group: "system" });
  if (apiKeys) links.push({ name: "qiy-api-keys", path: "/system/api-keys", label: "访问密钥", labelKey: "qiy.apiKey.title", icon: "KeyOutlined", group: "system" });
  return `import { expect, test } from "bun:test";
import { buildMenuTree } from "../app/components/menu";
import { menuGroups, resources } from "../app/resources";
import { overviewEnabled, qiyFeatureFlags, qiyMenuLinks } from "../app/features";

test("exposes the feature flags and developer-page menu links in order", () => {
  expect(qiyFeatureFlags).toEqual({ overview: ${overview}, apiDocs: ${apiDocs}, apiKeys: ${apiKeys} });
  expect(overviewEnabled).toBe(${overview});
  expect(qiyMenuLinks).toEqual(${JSON.stringify(links, null, 2)});
  const tree = buildMenuTree({ resources, menuGroups, links: qiyMenuLinks });
  const systemGroup = tree.find((node) => node.key === "menu-system") ?? tree.find((node) => node.children.some((child) => qiyMenuLinks.some((link) => link.name === child.key)));
  expect(systemGroup).toBeDefined();
  const linkNodes = systemGroup!.children.filter((child) => qiyMenuLinks.some((link) => link.name === child.key));
  expect(linkNodes.map((node) => node.to)).toEqual(qiyMenuLinks.map((link) => link.path));
});
`;
}

/** Overview helper tests: Mermaid builders and the three-page tab gating. */
export function renderWebOverviewTest(): string {
  return `import { expect, test } from "bun:test";
import {
  buildDataflowDiagram,
  buildDataflowDiagrams,
  buildEntityDiagram,
  describeDataflow,
  docsTabLabelKey,
  docsTabs,
  escapeMermaidLabel,
  mermaidId,
  type DocsModel,
} from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app" },
  features: { overview: true, apiDocs: true, apiKeys: true },
  principal: { role: "operator", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "role", label: "Role", labelKey: "qiy.resources.users.fields.role.label", type: "userRole", nullable: false, enumName: "userRole", enumValues: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }], annotations: [] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "userId", label: "User", labelKey: "qiy.resources.orders.fields.userId.label", type: "UUID", nullable: false, annotations: ["relation:users"], relation: { table: "users", field: "id" } }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [{ name: "userRole", values: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }] }],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin", "operator"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [{ name: "InventoryReceivePermission", value: "inventory:receive", label: "Receive", labelKey: "" }], groups: [{ name: "operator", members: ["InventoryReceivePermission"], label: "operator", labelKey: "" }], verifications: [] },
};

test("builds an escaped UML entity diagram", () => {
  const diagram = buildEntityDiagram(model);
  expect(diagram.startsWith("classDiagram")).toBe(true);
  expect(diagram).toContain('class e_users["Users"]');
  expect(diagram).toContain('class e_orders["Orders"]');
  expect(diagram).toContain("+id UUID");
  expect(diagram).toContain("+role userRole");
  expect(diagram).toContain("e_orders --> e_users : userId");
  expect(buildEntityDiagram(model)).toBe(diagram);
  expect(escapeMermaidLabel('a "b" {c};\\nd')).toBe("a 'b' (c), d");
  expect(mermaidId("orders-line")).toBe("orders_line");
  expect(mermaidId("1bad")).toBe("qiy_1bad");
});

test("builds a flowchart per dataflow with inputs, steps and result", () => {
  const flow = model.dataflows[0]!;
  const diagram = buildDataflowDiagram(flow);
  expect(diagram.startsWith("flowchart LR")).toBe(true);
  expect(diagram).toContain("d_receiveStock_input");
  expect(diagram).toContain("d_receiveStock_step_0");
  expect(diagram).toContain("d_receiveStock_result");
  expect(diagram).toContain("update inventory");
  expect(buildDataflowDiagrams(model)).toHaveLength(1);
  expect(describeDataflow(flow).inputs).toEqual(["quantity: Integer (required)"]);
  expect(describeDataflow(flow).allowRoles).toEqual(["admin", "operator"]);
});

test("the overview only exposes entities, dataflows and permissions tabs", () => {
  expect(docsTabs({ overview: true })).toEqual(["entities", "dataflows", "permissions"]);
  expect(docsTabs({ overview: false })).toEqual([]);
  expect(docsTabLabelKey("entities")).toBe("qiy.docs.tabEntities");
  expect(docsTabLabelKey("permissions")).toBe("qiy.docs.tabPermissions");
});
`;
}

/** Pure OpenAPI explorer helper tests for the API-docs page. */
export function renderWebApiDocsTest(): string {
  return `import { expect, test } from "bun:test";
import {
  buildCurlExample,
  filterOpenApiOperations,
  groupOpenApiOperations,
  openApiOperationCount,
  openApiOperationMatches,
  openApiServerBaseUrl,
  schemaExample,
  schemaSummary,
} from "../app/docs";

const spec = {
  openapi: "3.1.0",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [{ name: "orders", description: "Orders" }, { name: "auth", description: "Auth" }],
  paths: {
    "/api/v1/orders": {
      get: {
        tags: ["orders"],
        summary: "List orders",
        security: [{ bearerSession: [] }, { apiKey: [] }],
        "x-qiy-roles": ["admin", "operator"],
        "x-qiy-permissions": [],
        parameters: [
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Paginated records", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object" } }, total: { type: "integer" } } } } } }, "401": { description: "Authentication required" } },
      },
      post: {
        tags: ["orders"],
        summary: "Create order",
        security: [{ bearerSession: [] }],
        "x-qiy-roles": ["admin"],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { number: { type: "string" }, total: { type: "integer" } }, required: ["number"] } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/auth/me": { get: { tags: ["auth"], summary: "Current principal", security: [{ bearerSession: [] }], responses: { "200": { description: "Principal" } } } },
  },
  "x-qiy-principal": { role: "operator", permissions: ["inventory:receive"] },
};

test("groups OpenAPI operations into stable tag panels", () => {
  const groups = groupOpenApiOperations(spec);
  expect(groups.map((group) => group.name)).toEqual(["orders", "auth"]);
  expect(groups[0]!.operations.map((operation) => operation.method)).toEqual(["get", "post"]);
  expect(groups[0]!.operations[0]!.summary).toBe("List orders");
  expect(groups[0]!.operations[0]!.parameters.map((parameter) => parameter.name)).toEqual(["page", "search"]);
  expect(groups[0]!.operations[0]!.security).toEqual(["bearerSession", "apiKey"]);
  expect(groups[0]!.operations[1]!.requestSchema).toBeDefined();
  expect(groups[0]!.operations[0]!.roles).toEqual(["admin", "operator"]);
  expect(openApiOperationCount(spec)).toBe(3);
  expect(groupOpenApiOperations(undefined)).toEqual([]);
  expect(openApiOperationCount({ paths: {} })).toBe(0);
});

test("searches operations by path, method, summary and tag", () => {
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "orders")).toBe(true);
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "list")).toBe(true);
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "post")).toBe(false);
  const byPath = filterOpenApiOperations(groupOpenApiOperations(spec), "auth/me");
  expect(byPath.total).toBe(1);
  expect(byPath.groups.map((group) => group.name)).toEqual(["auth"]);
  const byMethod = filterOpenApiOperations(groupOpenApiOperations(spec), "get");
  expect(byMethod.total).toBe(2);
  const byTag = filterOpenApiOperations(groupOpenApiOperations(spec), "orders");
  expect(byTag.total).toBe(2);
  const none = filterOpenApiOperations(groupOpenApiOperations(spec), "missing");
  expect(none.total).toBe(0);
  expect(none.groups).toEqual([]);
  expect(filterOpenApiOperations(groupOpenApiOperations(spec), "  ").total).toBe(3);
});

test("summarizes schemas and builds read-only curl examples", () => {
  expect(schemaSummary({ type: "string" })).toBe("string");
  expect(schemaSummary({ type: "string", format: "date-time" })).toBe("string (date-time)");
  expect(schemaSummary({ type: "string", enum: ["a", "b"] })).toBe("string (a | b)");
  expect(schemaSummary({ type: "integer", nullable: true })).toBe("integer?");
  expect(schemaSummary({ type: "array", items: { type: "string" } })).toBe("array<string>");
  expect(schemaSummary({ type: "object", properties: { id: { type: "string" }, total: { type: "integer" } } })).toContain("id: string");
  expect(schemaExample({ type: "object", properties: { number: { type: "string" }, total: { type: "integer" }, active: { type: "boolean" } } })).toEqual({ number: "", total: 0, active: false });
  expect(schemaExample({ type: "array", items: { type: "integer" } })).toEqual([0]);
  const getCurl = buildCurlExample({ method: "get", path: "/api/v1/orders", baseUrl: "http://localhost:3000", security: ["bearerSession"], locale: "en-US" });
  expect(getCurl).toContain("curl -X GET 'http://localhost:3000/api/v1/orders'");
  expect(getCurl).toContain("Authorization: Bearer <session-token>");
  expect(getCurl).not.toContain("Content-Type");
  const postCurl = buildCurlExample({ method: "post", path: "/api/v1/orders", baseUrl: "http://localhost:3000", security: ["apiKey"], requestBody: { number: "A-1" }, locale: "en-US" });
  expect(postCurl).toContain("X-API-Key: <your-api-key>");
  expect(postCurl).toContain("Content-Type: application/json");
  expect(postCurl).toContain('"number":"A-1"');
  expect(postCurl).toContain("\\n");
  expect(openApiServerBaseUrl(spec, "http://localhost:3000")).toBe("http://localhost:3000");
  expect(openApiServerBaseUrl({ servers: [{ url: "https://api.example.com" }] }, "http://localhost:3000")).toBe("https://api.example.com");
});
`;
}

/** Pure API-key helper tests for the access-keys page. */
export function renderWebApiKeysTest(): string {
  return `import { expect, test } from "bun:test";
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyCurlExamples,
  apiKeyMatches,
  apiKeyStatus,
  apiKeyStatusOptions,
  canCreateApiKey,
  countActiveApiKeys,
  defaultApiKeyName,
  filterApiKeys,
  formatApiKeyDate,
  maskedApiKey,
  permissionTags,
  relativeTime,
  type ApiKeyRecord,
} from "../app/api-keys";

const now = new Date("2026-01-01T00:00:00Z");
const active: ApiKeyRecord = { id: "a", name: "Deploy", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: "2025-12-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: null };
const expired: ApiKeyRecord = { ...active, id: "b", name: "Old key", prefix: "bbbbbbbb", expiresAt: "2025-12-31T00:00:00Z" };
const revoked: ApiKeyRecord = { ...active, id: "c", name: "Revoked key", prefix: "cccccccc", revokedAt: "2025-12-31T00:00:00Z" };

test("status, counts and limits mirror the server rules", () => {
  expect(maskedApiKey("abcdef12")).toBe("qiy_abcdef12_********");
  expect(apiKeyStatus(active, now)).toBe("active");
  expect(apiKeyStatus(expired, now)).toBe("expired");
  expect(apiKeyStatus(revoked, now)).toBe("revoked");
  expect(countActiveApiKeys([active, expired, revoked], now)).toBe(1);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE - 1 }, () => active), now)).toBe(true);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE }, () => active), now)).toBe(false);
  expect(defaultApiKeyName([], now)).toBe("Key 2026-01-01");
  expect(formatApiKeyDate(null, "en-US")).toBe("\\u2014");
  expect(formatApiKeyDate("2026-01-01T00:00:00Z", "en-US")).toContain("2026");
  expect(apiKeyStatusOptions()).toEqual(["all", "active", "revoked", "expired"]);
});

test("searches and filters keys by name, prefix and status", () => {
  expect(apiKeyMatches(active, "dep")).toBe(true);
  expect(apiKeyMatches(active, "abcdef12")).toBe(true);
  expect(apiKeyMatches(active, "revoked")).toBe(false);
  expect(filterApiKeys([active, expired, revoked], { search: "" }, now).map((record) => record.id)).toEqual(["a", "b", "c"]);
  expect(filterApiKeys([active, expired, revoked], { search: "deploy" }, now).map((record) => record.id)).toEqual(["a"]);
  expect(filterApiKeys([active, expired, revoked], { search: "", status: "revoked" }, now).map((record) => record.id)).toEqual(["c"]);
  expect(filterApiKeys([active, expired, revoked], { search: "", status: "expired" }, now).map((record) => record.id)).toEqual(["b"]);
  expect(filterApiKeys([active, expired, revoked], { search: "missing" }, now)).toEqual([]);
});

test("maps identity permissions and formats relative times and curl examples", () => {
  expect(permissionTags({ role: "operator", permissions: ["inventory:receive", "report:read"], groups: ["ManagerRole"] })).toEqual([
    { key: "role:operator", kind: "role", value: "operator" },
    { key: "permission:inventory:receive", kind: "permission", value: "inventory:receive" },
    { key: "permission:report:read", kind: "permission", value: "report:read" },
    { key: "group:ManagerRole", kind: "group", value: "ManagerRole" },
  ]);
  expect(permissionTags(null)).toEqual([]);
  expect(relativeTime("2025-12-31T23:59:00Z", now, "en-US")).toContain("ago");
  expect(relativeTime("2025-12-31T23:59:00Z", now, "zh-CN")).toContain("\\u524d");
  expect(relativeTime(null, now, "en-US")).toBe("");
  const curls = apiKeyCurlExamples("http://localhost:3000/");
  expect(curls.bearer).toContain("Authorization: Bearer qiy_");
  expect(curls.header).toContain("X-API-Key: qiy_");
  expect(curls.bearer).toContain("http://localhost:3000/api/v1/inventory");
});
`;
}

/** SSR render test for the overview page (entities/dataflows/permissions only). */
export function renderWebOverviewRenderTest(): string {
  return `import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocsModel } from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app", description: "Supply chain demo" },
  features: { overview: true, apiDocs: true, apiKeys: true },
  principal: { role: "admin", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [], groups: [], verifications: [] },
};

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { DocsOverviewPage } = await import("../app/components/docs-page");

test("renders the entity tab with the generated UML source", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "entities" }));
  expect(html).toContain("Feature overview");
  expect(html).toContain('data-diagram="classDiagram');
  expect(html).toContain("e_users");
  expect(html).toContain("Relations");
  expect(html).toContain("entities");
  expect(html).toContain("dataflows");
  expect(html).toContain("permissions");
  expect(html).not.toContain("API reference");
  expect(html).not.toContain("Access keys");
  expect(html).not.toContain("data-diagram=\\"flowchart");
  expect((html.match(/data-diagram=/g) ?? []).length).toBe(1);
});

test("renders the dataflow tab with exactly one flowchart", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "dataflows" }));
  expect(html).toContain('data-diagram="flowchart LR');
  expect(html).toContain("d_receiveStock_step_0");
  expect(html).toContain("Receive stock");
  expect((html.match(/data-diagram=/g) ?? []).length).toBe(1);
});

test("renders the permission model tab without mounting other tabs", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "permissions" }));
  expect(html).toContain("Permissions");
  expect(html).toContain("admin");
  expect(html).not.toContain('data-diagram="classDiagram');
  expect(html).not.toContain('data-diagram="flowchart');
});
`;
}

/** SSR render test for the full-page API-docs explorer. */
export function renderWebApiDocsRenderTest(): string {
  return `import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const spec = {
  openapi: "3.1.0",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [{ name: "orders", description: "Orders" }, { name: "auth", description: "Auth" }],
  paths: {
    "/api/v1/orders": {
      get: {
        tags: ["orders"],
        summary: "List orders",
        security: [{ bearerSession: [] }, { apiKey: [] }],
        "x-qiy-roles": ["admin", "operator"],
        "x-qiy-permissions": [],
        parameters: [{ name: "page", in: "query", required: false, schema: { type: "integer" } }],
        responses: { "200": { description: "Paginated records" } },
      },
      post: {
        tags: ["orders"],
        summary: "Create order",
        security: [{ bearerSession: [] }],
        "x-qiy-roles": ["admin"],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { number: { type: "string" } } } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/auth/me": { get: { tags: ["auth"], summary: "Current principal", security: [{ bearerSession: [] }], responses: { "200": { description: "Principal" } } } },
  },
  "x-qiy-principal": { role: "operator", permissions: ["inventory:receive"] },
};

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { ApiDocsPage } = await import("../app/components/api-docs-page");

test("renders the API reference page with tags, operations, parameters and curl", () => {
  const html = renderToStaticMarkup(createElement(ApiDocsPage, { spec }));
  expect(html).toContain("API reference");
  expect(html).toContain("Download OpenAPI");
  expect(html).toContain("Demo API");
  expect(html).toContain("orders");
  expect(html).toContain("auth");
  expect(html).toContain("GET");
  expect(html).toContain("/api/v1/orders");
  expect(html).toContain("List orders");
  expect(html).toContain("Parameters");
  expect(html).toContain("Request body");
  expect(html).toContain("Responses");
  expect(html).toContain("Security");
  expect(html).toContain("curl -X GET");
  expect(html).toContain("Authorization: Bearer");
  expect(html).toContain("Role: operator");
  expect(html).toContain("Permissions: inventory:receive");
  expect(html).toContain("data-tooltip");
  expect(html).toContain("filtered by the current account permissions");
  expect(html).toContain("operation(s)");
});

test("filters operations with the search box", () => {
  const filtered = renderToStaticMarkup(createElement(ApiDocsPage, { spec, initialSearch: "auth/me" }));
  expect(filtered).toContain("Current principal");
  expect(filtered).not.toContain("List orders");
  const noResults = renderToStaticMarkup(createElement(ApiDocsPage, { spec, initialSearch: "does-not-exist" }));
  expect(noResults).toContain("No operations match this search");
  expect(noResults).not.toContain("/api/v1/orders");
});

test("renders loading, error and empty states without network effects", () => {
  const empty = renderToStaticMarkup(createElement(ApiDocsPage, { spec: undefined }));
  expect(empty).toContain("Nothing to show");
  const loading = renderToStaticMarkup(createElement(ApiDocsPage, { spec, loading: true }));
  expect(loading).toContain("ant-spin");
  const error = renderToStaticMarkup(createElement(ApiDocsPage, { spec, error: "boom" }));
  expect(error).toContain("boom");
});
`;
}

/** SSR render test for the access-keys page. */
export function renderWebApiKeysRenderTest(apiDocs: boolean): string {
  return `import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiKeyRecord } from "../app/api-keys";

const records: ApiKeyRecord[] = [
  { id: "a", name: "Deploy", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: "2025-12-01T00:00:00Z", lastUsedAt: "2025-12-31T23:59:00Z", expiresAt: null, revokedAt: null },
  { id: "b", name: "Old key", prefix: "bbbbbbbb", maskedKey: "qiy_bbbbbbbb_********", createdAt: "2025-11-01T00:00:00Z", lastUsedAt: null, expiresAt: "2025-12-31T00:00:00Z", revokedAt: null },
  { id: "c", name: "Revoked key", prefix: "cccccccc", maskedKey: "qiy_cccccccc_********", createdAt: "2025-10-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: "2025-12-31T00:00:00Z" },
];
const identity = { id: "admin", role: "operator", permissions: ["inventory:receive", "report:read"], groups: ["ManagerRole"] };

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: identity, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { ApiKeysPage } = await import("../app/components/api-keys-page");

test("renders the access-keys page with curl examples, permission tags and rows", () => {
  const html = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records }));
  expect(html).toContain("Access keys");
  expect(html).toContain("Authorization: Bearer qiy_");
  expect(html).toContain("X-API-Key: qiy_");
  expect(html).toContain("role: operator");
  expect(html).toContain("permission: inventory:receive");
  expect(html).toContain("group: ManagerRole");
  expect(html).toContain("data-tooltip");
  expect(html).toContain("Deploy");
  expect(html).toContain("qiy_abcdef12_********");
  expect(html).toContain("Active");
  expect(html).toContain("Expired");
  expect(html).toContain("Revoked");
  expect(html).toContain("Create key");
${apiDocs ? `  expect(html).toContain("/system/api-docs");` : ""}
});

test("filters keys by search and status", () => {
  const search = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialSearch: "Old key" }));
  expect(search).toContain("Old key");
  expect(search).not.toContain("Deploy");
  const revoked = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialStatus: "revoked" }));
  expect(revoked).toContain("Revoked key");
  expect(revoked).not.toContain("Deploy");
});

test("renders the create modal and the one-time secret flow", () => {
  const create = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialCreateOpen: true }));
  expect(create).toContain("Create key");
  expect(create).toContain("Expires (optional)");
  expect(create).toContain("inherits your current role and permissions");
  const secret = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialSecret: "qiy_abcdef12_one-time-secret" }));
  expect(secret).toContain("Save this secret now");
  expect(secret).toContain("shown only once");
  expect(secret).toContain("qiy_abcdef12_one-time-secret");
});
`;
}
