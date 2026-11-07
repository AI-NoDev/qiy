/**
 * Server renderers for API keys and the generated API documentation module.
 */
import type { DatabaseIR } from "../database-ir";
import { authHasLocal, type QiyProject } from "../qiy-project";
import { requiredPermissionValues } from "../permissions";
import { roleContext } from "../roles";
import { principalNameExpression, type ServerOptions } from "./shared";

/** DDL-neutral column helpers for the `qiy_api_keys` table. */
export function renderApiKeySchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const string = (name: string, length?: number) => dialect === "mysql" ? `varchar(${JSON.stringify(name)}, { length: ${length ?? 255} })` : `text(${JSON.stringify(name)})`;
  const timestamp = (name: string) => dialect === "postgresql" ? `timestamp(${JSON.stringify(name)}, { withTimezone: true })` : dialect === "sqlite" ? `integer(${JSON.stringify(name)}, { mode: "timestamp_ms" })` : `datetime(${JSON.stringify(name)}, { mode: "date", fsp: 3 })`;
  return `\n\nexport const qiyApiKeys = ${table}("qiy_api_keys", {\n  id: ${string("id", 36)}.primaryKey(),\n  userId: ${string("userId", 36)}.notNull(),\n  name: ${string("name", 80)}.notNull(),\n  prefix: ${string("prefix", 16)}.notNull().unique(),\n  hash: ${string("hash", 64)}.notNull().unique(),\n  scopes: text("scopes"),\n  rotatedFromId: ${string("rotatedFromId", 36)},\n  createdAt: ${timestamp("createdAt")}.notNull(),\n  lastUsedAt: ${timestamp("lastUsedAt")},\n  expiresAt: ${timestamp("expiresAt")},\n  revokedAt: ${timestamp("revokedAt")},\n}, (table) => [index("qiy_api_keys_user_idx").on(table.userId)]);\n\nexport const qiyApiKeyEvents = ${table}("qiy_api_key_events", {\n  id: ${string("id", 36)}.primaryKey(),\n  keyId: ${string("keyId", 36)}.notNull(),\n  userId: ${string("userId", 36)}.notNull(),\n  action: ${string("action", 16)}.notNull(),\n  at: ${timestamp("at")}.notNull(),\n}, (table) => [index("qiy_api_key_events_user_idx").on(table.userId), index("qiy_api_key_events_key_idx").on(table.keyId)]);\n`;
}

/** Pure API-key helpers (format, hashing, validation). No database/HTTP imports. */
export function renderApiKeyHashModule(): string {
  return `import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** API keys look like qiy_<8 char prefix>_<43 char base64url secret>. */
export const API_KEY_PREFIX = "qiy";
export const API_KEY_PREFIX_LENGTH = 8;
export const API_KEY_MAX_ACTIVE = 10;
export const API_KEY_MAX_NAME = 80;
export const API_KEY_MAX_SCOPES = 50;
export const API_KEY_SCOPE_MAX_LENGTH = 120;
export const API_KEY_SECRET_LENGTH = 32;
export const API_KEY_LAST_USED_THROTTLE_MS = 60_000;

export interface ParsedApiKey { prefix: string; secret: string }
export interface GeneratedApiKey { key: string; prefix: string; hash: string }

/** The pepper is QIY_AUTH_SECRET; a missing/short secret fails closed. */
export function apiKeyPepper(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters to hash API keys");
  return value;
}

/** HMAC-SHA256 (peppered SHA-256) of the secret half only; the prefix is not secret. */
export function hashApiKey(secret: string, pepper: string = apiKeyPepper()): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Builds a fresh key: qiy_<8 hex prefix>_<base64url secret>. Only the hash is stored. */
export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(API_KEY_PREFIX_LENGTH / 2).toString("hex");
  const secret = randomBytes(API_KEY_SECRET_LENGTH).toString("base64url");
  return { key: API_KEY_PREFIX + "_" + prefix + "_" + secret, prefix, hash: hashApiKey(secret) };
}

/** Parses a presented key without touching the database. */
export function parseApiKey(value: string): ParsedApiKey | null {
  const match = new RegExp("^" + API_KEY_PREFIX + "_([a-f0-9]{" + API_KEY_PREFIX_LENGTH + "})_([A-Za-z0-9_-]{" + API_KEY_SECRET_LENGTH + ",})$").exec(value);
  return match ? { prefix: match[1]!, secret: match[2]! } : null;
}

/** Constant-time verification of a presented key against a stored hash. */
export function verifyApiKeyHash(presented: string, storedHash: string, pepper: string = apiKeyPepper()): boolean {
  const parsed = parseApiKey(presented);
  if (!parsed) return false;
  return hashesEqual(hashApiKey(parsed.secret, pepper), storedHash);
}

/** Masked display value: qiy_<prefix>_********. The full key is shown once on create. */
export function maskApiKeyPrefix(prefix: string): string {
  return API_KEY_PREFIX + "_" + prefix + "_********";
}

/** First API key source: Authorization: Bearer qiy_... or X-API-Key: qiy_.... */
export function apiKeyFromRequest(request: Request): string | null {
  const header = request.headers.get("x-api-key");
  if (header && header.startsWith(API_KEY_PREFIX + "_")) return header.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\\s+(.+)$/i.exec(authorization);
  if (match && match[1]!.startsWith(API_KEY_PREFIX + "_")) return match[1]!.trim();
  return null;
}

/** Session bearer tokens must never be treated as API keys. */
export function isApiKeyLike(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX + "_");
}

export function validateApiKeyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("API key name is required");
  if (trimmed.length > API_KEY_MAX_NAME) throw new Error("API key name must be at most " + API_KEY_MAX_NAME + " characters");
  return trimmed;
}

export function validateApiKeyExpiry(value: string | Date | null | undefined, now: Date = new Date()): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("API key expiresAt must be an ISO date-time");
  if (parsed.getTime() <= now.getTime()) throw new Error("API key expiresAt must be in the future");
  return parsed;
}

export function isApiKeyExpired(expiresAt: Date | number | string | null | undefined, now: Date = new Date()): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const value = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(value) && value <= now.getTime();
}

export function canCreateApiKey(activeCount: number): boolean {
  return activeCount < API_KEY_MAX_ACTIVE;
}

/** Normalizes an optional permission-scope list; null/empty means "all user permissions". */
export function normalizeApiKeyScopes(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error("API key scopes must be an array of permission strings");
  if (value.length > API_KEY_MAX_SCOPES) throw new Error("At most " + API_KEY_MAX_SCOPES + " API key scopes are allowed");
  const scopes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error("API key scopes must be strings");
    const scope = entry.trim();
    if (!scope) continue;
    if (scope.length > API_KEY_SCOPE_MAX_LENGTH) throw new Error("API key scope must be at most " + API_KEY_SCOPE_MAX_LENGTH + " characters");
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes.length ? scopes : null;
}

export function parseApiKeyScopes(value: unknown): string[] | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return normalizeApiKeyScopes(value);
  if (typeof value !== "string") return null;
  try { return normalizeApiKeyScopes(JSON.parse(value)); } catch { return null; }
}

/** True when a key scope set permits a permission (null/empty scopes = inherit all). */
export function apiKeyScopesAllow(scopes: readonly string[] | null | undefined, permission: string): boolean {
  return !scopes || scopes.length === 0 || scopes.includes(permission);
}

/** Records returned by the list/create/revoke routes never include hash or secret. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromId: string | null;
  scopes: string[] | null;
}

export function toApiKeyRecord(row: { id: string; name: string; prefix: string; scopes?: string | string[] | null; rotatedFromId?: string | null; createdAt: Date | number | string; lastUsedAt: Date | number | string | null; expiresAt: Date | number | string | null; revokedAt: Date | number | string | null }): ApiKeyRecord {
  const iso = (value: Date | number | string | null) => value === null || value === undefined ? null : new Date(value instanceof Date ? value.getTime() : typeof value === "number" ? value : String(value)).toISOString();
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    maskedKey: maskApiKeyPrefix(row.prefix),
    createdAt: iso(row.createdAt)!,
    lastUsedAt: iso(row.lastUsedAt),
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
    rotatedFromId: row.rotatedFromId ?? null,
    scopes: parseApiKeyScopes(row.scopes),
  };
}
`;
}

/** API-key routes + bearer authenticator composition for the generated app. */
export function renderApiKeyRoutesModule(auth: NonNullable<QiyProject["auth"]>, database: DatabaseIR, scopeClaims: string): string {
  const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
  return `import { Elysia, t } from "elysia";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity}, qiyApiKeyEvents, qiyApiKeys } from "../schema";
import type { Authenticator, Principal } from "./guard";
import {
  API_KEY_MAX_ACTIVE,
  canCreateApiKey,
  apiKeyFromRequest,
  generateApiKey,
  hashApiKey,
  isApiKeyExpired,
  normalizeApiKeyScopes,
  parseApiKey,
  parseApiKeyScopes,
  toApiKeyRecord,
  validateApiKeyExpiry,
  validateApiKeyName,
} from "./api-key-hash";
import { isQiyRole, type QiyRole } from "./roles";

type Role = QiyRole;
function asRole(value: unknown): Role | null { return isQiyRole(value) ? value : null; }

type ApiKeyEventAction = "created" | "rotated" | "revoked";
async function recordApiKeyEvent(keyId: string, userId: string, action: ApiKeyEventAction): Promise<void> {
  try {
    await db.insert(qiyApiKeyEvents).values({ id: crypto.randomUUID(), keyId, userId, action, at: new Date() });
  } catch {
    // Audit history must never turn a successful key operation into a 500.
  }
}

/** Resolves the user row behind a presented API key; updates lastUsedAt at most once a minute. */
async function resolveApiKeyPrincipal(presented: string): Promise<Principal | null> {
  const parsed = parseApiKey(presented);
  if (!parsed) return null;
  const rows = await db.select().from(qiyApiKeys).where(eq(qiyApiKeys.hash, hashApiKey(parsed.secret))).limit(1);
  const key = rows[0];
  if (!key || key.revokedAt || isApiKeyExpired(key.expiresAt)) return null;
  const userRows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, key.userId)).limit(1);
  const user = userRows[0];
  const role = user ? asRole(user.${auth.roleField}) : null;
  if (!user || !role) return null;
  const lastUsed = key.lastUsedAt ? new Date(key.lastUsedAt as Date | number).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    try { await db.update(qiyApiKeys).set({ lastUsedAt: new Date() }).where(eq(qiyApiKeys.id, key.id)); } catch { /* best effort */ }
  }
  const claims: Record<string, string | number | boolean | null> = {};
${scopeClaims}
  const row = user;
  const scopes = parseApiKeyScopes(key.scopes);
  return { id: user.id, name: ${principalNameExpression(userEntity, "displayName", auth.usernameField)}, role, ...(Object.keys(claims).length ? { claims } : {}), ...(scopes ? { scopes } : {}) };
}

/**
 * Accepts session bearers exactly as before; when no session authenticates, an
 * API key (Authorization: Bearer qiy_... or X-API-Key) is resolved to its user.
 */
export function withApiKeyAuthentication(authenticate: Authenticator): Authenticator {
  return async (request) => {
    const session = await authenticate(request);
    if (session) return session;
    const presented = apiKeyFromRequest(request);
    if (!presented) return null;
    try { return await resolveApiKeyPrincipal(presented); } catch { return null; }
  };
}

export function createApiKeyRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth/api-keys" })
    .get("/", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const rows = await db.select().from(qiyApiKeys).where(eq(qiyApiKeys.userId, principal.id)).orderBy(desc(qiyApiKeys.createdAt));
      return { items: rows.map((row) => toApiKeyRecord(row as never)) };
    })
    .post("/", async ({ body, request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      let name: string;
      let expiresAt: Date | null;
      let scopes: string[] | null;
      try {
        name = validateApiKeyName(body.name);
        expiresAt = validateApiKeyExpiry(body.expiresAt);
        scopes = normalizeApiKeyScopes(body.scopes);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : "Invalid API key" };
      }
      const active = await db.select({ id: qiyApiKeys.id, expiresAt: qiyApiKeys.expiresAt }).from(qiyApiKeys).where(and(eq(qiyApiKeys.userId, principal.id), isNull(qiyApiKeys.revokedAt)));
      const activeCount = active.filter((row) => !isApiKeyExpired(row.expiresAt)).length;
      if (!canCreateApiKey(activeCount)) { set.status = 409; return { error: "At most " + API_KEY_MAX_ACTIVE + " active API keys are allowed" }; }
      const generated = generateApiKey();
      const id = crypto.randomUUID();
      const createdAt = new Date();
      await db.insert(qiyApiKeys).values({ id, userId: principal.id, name, prefix: generated.prefix, hash: generated.hash, scopes: scopes ? JSON.stringify(scopes) : null, createdAt, lastUsedAt: null, expiresAt, revokedAt: null });
      await recordApiKeyEvent(id, principal.id, "created");
      const row = { id, name, prefix: generated.prefix, scopes: scopes ? JSON.stringify(scopes) : null, createdAt, lastUsedAt: null, expiresAt, revokedAt: null };
      set.status = 201;
      return { key: generated.key, record: toApiKeyRecord(row) };
    }, { body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }), expiresAt: t.Optional(t.String({ maxLength: 64 })), scopes: t.Optional(t.Array(t.String({ maxLength: 120 }))) }) })
    .delete("/:id", async ({ params, request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const rows = await db.select().from(qiyApiKeys).where(and(eq(qiyApiKeys.id, params.id), eq(qiyApiKeys.userId, principal.id))).limit(1);
      const row = rows[0];
      if (!row) { set.status = 404; return { error: "API key not found" }; }
      if (!row.revokedAt) {
        await db.update(qiyApiKeys).set({ revokedAt: new Date() }).where(eq(qiyApiKeys.id, row.id));
        await recordApiKeyEvent(row.id, principal.id, "revoked");
      }
      const revokedAt = row.revokedAt ?? new Date();
      return { record: toApiKeyRecord({ ...row, revokedAt } as never) };
    })
    .post("/:id/rotate", async ({ params, request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const rows = await db.select().from(qiyApiKeys).where(and(eq(qiyApiKeys.id, params.id), eq(qiyApiKeys.userId, principal.id))).limit(1);
      const row = rows[0];
      if (!row || row.revokedAt) { set.status = 404; return { error: "API key not found" }; }
      if (isApiKeyExpired(row.expiresAt)) { set.status = 409; return { error: "Expired API keys cannot be rotated; create a new key instead" }; }
      const generated = generateApiKey();
      const id = crypto.randomUUID();
      const createdAt = new Date();
      await db.insert(qiyApiKeys).values({ id, userId: principal.id, name: row.name, prefix: generated.prefix, hash: generated.hash, scopes: row.scopes, rotatedFromId: row.id, createdAt, lastUsedAt: null, expiresAt: row.expiresAt, revokedAt: null });
      await db.update(qiyApiKeys).set({ revokedAt: createdAt }).where(eq(qiyApiKeys.id, row.id));
      await recordApiKeyEvent(id, principal.id, "rotated");
      set.status = 201;
      return { key: generated.key, record: toApiKeyRecord({ id, name: row.name, prefix: generated.prefix, scopes: row.scopes, rotatedFromId: row.id, createdAt, lastUsedAt: null, expiresAt: row.expiresAt, revokedAt: null } as never) };
    })
    .get("/events", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const rows = await db.select().from(qiyApiKeyEvents).where(eq(qiyApiKeyEvents.userId, principal.id)).orderBy(desc(qiyApiKeyEvents.at)).limit(100);
      return { items: rows.map((row) => ({ id: row.id, keyId: row.keyId, action: row.action, at: new Date(row.at as Date | number | string).toISOString() })) };
    });
}
`;
}

/**
 * Building blocks for the generated `api/src/docs.ts`: static, import-free
 * metadata plus the permission-filtered OpenAPI 3.1 + model documentation
 * builders. Keeping this file import-free lets repository tests import the
 * generated module directly.
 */
export function renderDocsModule(database: DatabaseIR, options: ServerOptions, appName?: string): string {
  const enums = database.enums ?? [];
  const enumByName = new Map(enums.map((enumeration) => [enumeration.name, enumeration]));
  const relations = database.relations ?? [];
  const entityByName = new Map(database.entities.map((entity) => [entity.name, entity]));
  const masked = new Set<string>();
  for (const restriction of options.restrictions ?? []) {
    const entity = database.entities.find((candidate) => candidate.name === restriction.resource || candidate.tableName === restriction.resource);
    if (!entity) continue;
    for (const mask of restriction.masks ?? []) masked.add(entity.tableName + "." + mask.field);
  }
  const docsEntities = database.entities.map((entity) => {
    const tableName = entity.tableName;
    const fields = entity.fields.map((field) => {
      const relation = relations.find((candidate) => candidate.fromEntity === entity.name && candidate.fromField === field.name);
      const target = relation ? entityByName.get(relation.toEntity) : undefined;
      const enumeration = field.enumName ? enumByName.get(field.enumName) : undefined;
      const annotations: string[] = [];
      if (field.primaryKey) annotations.push("primaryKey");
      if (field.unique) annotations.push("unique");
      if (field.nullable) annotations.push("nullable");
      if (field.generatedValue) annotations.push("generated:" + field.generatedValue);
      if (field.codeTemplate) annotations.push("generated:code");
      if (relation && target) annotations.push("relation:" + target.tableName);
      if (masked.has(tableName + "." + field.name)) annotations.push("masked");
      return {
        name: field.name,
        label: field.label ?? field.name,
        labelKey: "qiy.resources." + tableName + ".fields." + field.name + ".label",
        type: field.type,
        ...(field.type === "Array" && field.itemType ? { itemType: field.itemType } : {}),
        nullable: Boolean(field.nullable),
        ...(field.primaryKey ? { primaryKey: true } : {}),
        ...(field.unique ? { unique: true } : {}),
        ...(field.enumName ? { enumName: field.enumName } : {}),
        ...(enumeration ? {
          enumValues: enumeration.values.map((value) => ({ name: value.name, label: value.label ?? value.name, labelKey: "qiy.enums." + enumeration.name + ".values." + value.name })),
        } : {}),
        annotations,
        ...(relation && target ? { relation: { table: target.tableName, field: relation.toField, ...(relation.onDelete ? { onDelete: relation.onDelete === "setNull" ? "set null" : relation.onDelete } : {}) } } : {}),
      };
    });
    return {
      name: entity.name,
      tableName,
      label: entity.label ?? entity.name,
      labelKey: "qiy.resources." + tableName + ".label",
      singular: entity.singular ?? entity.label ?? entity.name,
      plural: entity.plural ?? entity.label ?? entity.name,
      ...(entity.display ? { display: entity.display } : {}),
      ...(entity.tableDisplay ? { tableDisplay: entity.tableDisplay } : {}),
      fields,
      relations: relations.filter((relation) => relation.fromEntity === entity.name).map((relation) => {
        const target = entityByName.get(relation.toEntity);
        return { field: relation.fromField, toTable: target?.tableName ?? relation.toEntity, toField: relation.toField, ...(relation.onDelete ? { onDelete: relation.onDelete === "setNull" ? "set null" : relation.onDelete } : {}) };
      }),
    };
  });
  const docsDataflows = (options.dataflows ?? []).map((flow) => {
    // `allow permission` names may be permission fields or groups; the runtime
    // principal holds expanded permission VALUES, so the docs metadata (and the
    // x-qiy-permissions extensions) must carry the expanded values too.
    const allowPermissions = flow.permission
      ? (options.permissions ? requiredPermissionValues(options.permissions, flow.permission) : flow.permission)
      : [];
    return {
      name: flow.name,
      label: flow.label ?? flow.name,
      labelKey: flow.labelKey ?? "qiy.dataflows." + flow.name + ".label",
      allowRoles: flow.roles ?? [],
      allowPermissions,
      verification: flow.verification ?? null,
    inputs: flow.input.map((input) => ({ name: input.name, type: input.type, required: input.required, label: input.name, labelKey: "" })),
    contexts: flow.context.map((context) => {
      const entity = entityByName.get(context.entity);
      return { name: context.name, entity: entity?.tableName ?? context.entity };
    }),
    steps: flow.steps.map((step) => ({
      name: step.name,
      actions: step.actions.map((action) => {
        if (action.kind === "require") return { kind: "require", summary: "require " + action.left + " " + action.operator + " " + action.right };
        if (action.kind === "update") return { kind: "update", summary: "update " + action.context + " (" + action.values.map((value) => value.field).join(", ") + ")" };
        if (action.kind === "create") {
          const entity = entityByName.get(action.entity);
          return { kind: "create", summary: "create " + (entity?.tableName ?? action.entity) };
        }
        if (action.kind === "delete") return { kind: "delete", summary: "delete " + action.context };
        if (action.kind === "emit") return { kind: "emit", summary: "emit " + action.event };
        return { kind: "call", summary: "call " + action.adapter };
      }),
      })),
      result: flow.result,
    };
  });
  const permissionModel = options.permissions;
  const docsPermissions = {
    fields: (permissionModel?.fields ?? []).map((field) => ({ name: field.name, value: field.value, label: field.label ?? field.name, labelKey: field.labelKey ?? "" })),
    groups: (permissionModel?.groups ?? []).map((group) => ({ name: group.name, members: group.members, label: group.label ?? group.name, labelKey: group.labelKey ?? "" })),
    verifications: (permissionModel?.verifications ?? []).map((verification) => ({ name: verification.name, label: verification.label ?? verification.name, labelKey: verification.labelKey ?? "", inputs: verification.inputs })),
  };
  const userEntity = options.auth ? database.entities.find((entity) => entity.name === options.auth!.userEntity) : undefined;
  const pageRules = Object.fromEntries((options.pages ?? []).map((page) => [page.resource, Object.fromEntries(page.actions.map((entry) => [entry.action, entry.roles]))]));
  const restrictions = (options.restrictions ?? []).map((restriction) => ({ resource: restriction.resource, roles: restriction.roles ?? [] }));
  const meta = {
    app: { name: appName ?? "Qiy Admin", ...(options.comment ? { description: options.comment } : {}), ...(options.commentKey ? { descriptionKey: options.commentKey } : {}) },
    userTable: userEntity?.tableName ?? null,
    features: { overview: Boolean(options.features?.overview), apiDocs: Boolean(options.features?.apiDocs), apiKeys: Boolean(options.features?.apiKeys) },
    loginEnabled: Boolean(options.auth && (authHasLocal(options.auth) || options.auth.provider === "otp")),
    pageRules,
    restrictions,
    entities: docsEntities,
    relations: relations.map((relation) => {
      const from = entityByName.get(relation.fromEntity);
      const to = entityByName.get(relation.toEntity);
      return { fromTable: from?.tableName ?? relation.fromEntity, field: relation.fromField, toTable: to?.tableName ?? relation.toEntity, toField: relation.toField, ...(relation.onDelete ? { onDelete: relation.onDelete === "setNull" ? "set null" : relation.onDelete } : {}) };
    }),
    enums: enums.map((enumeration) => ({ name: enumeration.name, values: enumeration.values.map((value) => ({ name: value.name, label: value.label ?? value.name, labelKey: "qiy.enums." + enumeration.name + ".values." + value.name })) })),
    dataflows: docsDataflows,
    permissions: docsPermissions,
  };
  return `/** Generated OpenAPI 3.1 + documentation metadata. Do not edit by hand. */
import { QIY_ROLES, QIY_ROLE_NAMES, hasFullAccess, type QiyRole } from "./auth/roles";

export type DocsRole = QiyRole;
export type DocsAction = "list" | "show" | "create" | "edit" | "delete";
export interface DocsPrincipal { role: DocsRole; permissions?: string[] }
export interface DocsEnumValue { name: string; label: string; labelKey: string }
export interface DocsFieldRelation { table: string; field: string; onDelete?: string }
export interface DocsField {
  name: string;
  label: string;
  labelKey: string;
  type: string;
  itemType?: string;
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
  "x-qiy-hidden": Array<{ method: string; path: string; reason: "verification"; verification: string; label?: string }>;
}

export const docsMeta: DocsMeta = ${JSON.stringify(meta, null, 2)};

export const docsViewKindLabels: Record<string, string> = { "apiKeys": "qiy.apiKey.title", "entities": "qiy.docs.tabEntities", "dataflows": "qiy.docs.tabDataflows", "api": "qiy.docs.tabApi", "permissions": "qiy.docs.tabPermissions" };

function restrictedRoles(tableName: string): string[] | undefined {
  const restriction = docsMeta.restrictions.find((entry) => entry.resource === tableName);
  return restriction ? restriction.roles : undefined;
}

export function mayUseResource(tableName: string, principal: DocsPrincipal): boolean {
  if (hasFullAccess(principal.role)) return true;
  if (docsMeta.userTable === tableName) return false;
  const roles = restrictedRoles(tableName);
  if (roles && roles.length > 0 && !roles.includes(principal.role)) return false;
  return true;
}

export function mayUseAction(tableName: string, action: DocsAction, principal: DocsPrincipal): boolean {
  if (!mayUseResource(tableName, principal)) return false;
  const pageRule = docsMeta.pageRules[tableName]?.[action];
  if (pageRule && !pageRule.includes(principal.role)) return false;
  if (QIY_ROLES[principal.role] === "read") return action === "list" || action === "show";
  return true;
}

/** Commands are full-access only unless an allow rule names the role/permission; verification-gated commands are full-access only in the docs. */
export function flowAllowed(flow: DocsDataflow, principal: DocsPrincipal): boolean {
  if (hasFullAccess(principal.role)) return true;
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
        : field.type === "JSON" ? { type: "object", additionalProperties: true }
        : field.type === "Array" ? { type: "array", items: { type: field.itemType === "Integer" ? "integer" : "string" } }
          : field.type === "Email" ? { type: "string", format: "email" }
            : field.type === "URL" ? { type: "string", format: "uri" }
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
  const hiddenOperations: Array<{ method: string; path: string; reason: "verification"; verification: string; label?: string }> = [];
  const security: Array<Record<string, string[]>> = [{ bearerSession: [] }, { apiKey: [] }];
  const paths: Record<string, Record<string, unknown>> = {};
  const tags: Array<{ name: string; description: string }> = [];
  const rolesFor = (tableName: string, action: string): string[] => {
    const pageRule = docsMeta.pageRules[tableName]?.[action];
    const restricted = restrictedRoles(tableName);
    if (pageRule && pageRule.length) return pageRule;
    if (restricted && restricted.length) return restricted;
    return [...QIY_ROLE_NAMES];
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
    if (!flowAllowed(flow, principal)) {
      // Verification-gated commands need runtime inputs the docs cannot provide;
      // non-admins see them listed as hidden instead of silently missing.
      if (!hasFullAccess(principal.role) && flow.verification) {
        hiddenOperations.push({ method: "post", path: "/api/v1/commands/" + flow.name, reason: "verification", verification: flow.verification, label: flow.label });
      }
      continue;
    }
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
    "x-qiy-hidden": hiddenOperations,
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
`;
}

/** HTTP wiring for the docs endpoints (feature-gated in app.ts). */
export function renderDocsRoutesModule(hasPermissions: boolean, includeOpenApi: boolean, includeModel: boolean): string {
  return `import { Elysia } from "elysia";
import type { Authenticator, Principal } from "./auth/guard";
import { buildDocsModel, buildOpenApiDocument, type DocsPrincipal, type DocsRole } from "./docs";
import { QIY_DEFAULT_ROLE, isQiyRole } from "./auth/roles";
${hasPermissions ? 'import { loadPermissions } from "./auth/permissions";' : ""}

function asRole(value: unknown): DocsRole { return isQiyRole(value) ? value : QIY_DEFAULT_ROLE; }

async function docsPrincipal(principal: Principal): Promise<DocsPrincipal> {
${hasPermissions ? `  const snapshot = await loadPermissions(principal);
  return { role: asRole(principal.role), permissions: snapshot.permissions };` : `  return { role: asRole(principal.role), permissions: [] };`}
}

export function createDocsRoutes(authenticate: Authenticator): Elysia {
  const routes = new Elysia({ prefix: "/api/v1" });
  // Each GET route refines the Elysia route generics; cast back to the base type
  // so the composed app can be mounted with other plugins without type conflicts.
  let mounted = routes as unknown as Elysia;
${includeOpenApi ? `  mounted = mounted.get("/openapi.json", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      set.headers["cache-control"] = "no-store";
      return buildOpenApiDocument(await docsPrincipal(principal));
    }) as unknown as Elysia;` : ""}
${includeModel ? `  mounted = mounted.get("/docs/model", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      set.headers["cache-control"] = "no-store";
      return buildDocsModel(await docsPrincipal(principal));
    }) as unknown as Elysia;` : ""}
  return mounted;
}
`;
}

/** Generated server tests for the permission-filtered OpenAPI document. */
export function renderDocsTestModule(database: DatabaseIR, apiDocsEnabled: boolean, modelEnabled: boolean): string {
  const first = database.entities[0]!;
  return `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  buildDocsModel,
  buildOpenApiDocument,
  docsMeta,
  mayUseAction,
  mayUseResource,
  flowAllowed,
  type DocsPrincipal,
  type GeneratedOpenApiDocument,
} from "../src/docs";
import { createDocsRoutes } from "../src/docs-routes";
import { QIY_ADMIN_ROLE, QIY_ROLES, QIY_ROLE_NAMES, type QiyRoleAccess } from "../src/auth/roles";

const roleWith = (access: QiyRoleAccess) => QIY_ROLE_NAMES.find((role) => QIY_ROLES[role] === access);
const admin: DocsPrincipal = { role: QIY_ADMIN_ROLE };
const operator: DocsPrincipal = { role: roleWith("write") ?? QIY_ADMIN_ROLE };
const viewer: DocsPrincipal = { role: roleWith("read") ?? operator.role };
const paths = (document: GeneratedOpenApiDocument) => Object.keys(document.paths).sort();

test("generates a valid OpenAPI 3.1 document with session and API-key security", () => {
  const document = buildOpenApiDocument(admin);
  expect(document.openapi).toBe("3.1.0");
  expect(document.info.title.length).toBeGreaterThan(0);
  expect(document.info.version).toBe("1.0.0");
  expect(document.servers.length).toBeGreaterThan(0);
  expect(Object.keys(document.components.securitySchemes)).toEqual(["bearerSession", "apiKey"]);
  expect(document.security).toEqual([{ bearerSession: [] }, { apiKey: [] }]);
  expect(document["x-qiy-generated"]).toBe(true);
  expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  expect(document.paths["/api/v1/${first.tableName}"]).toBeDefined();
  expect(document.paths["/api/v1/${first.tableName}"]?.get).toBeDefined();
  expect(document.paths["/api/v1/auth/me"]?.get).toBeDefined();
  if (docsMeta.features.apiDocs) expect(document.paths["/api/v1/openapi.json"]?.get).toBeDefined();
  if (docsMeta.features.overview || docsMeta.features.apiDocs) expect(document.paths["/api/v1/docs/model"]?.get).toBeDefined();
  if (docsMeta.features.apiKeys) expect(document.paths["/api/v1/auth/api-keys"]?.get).toBeDefined();
  const list = document.paths["/api/v1/${first.tableName}"]?.get as Record<string, unknown>;
  expect(list["x-qiy-roles"]).toBeDefined();
  expect(list.security).toEqual([{ bearerSession: [] }, { apiKey: [] }]);
});

test("filters operations by the principal permissions and page rules", () => {
  const adminDocument = buildOpenApiDocument(admin);
  const operatorDocument = buildOpenApiDocument(operator);
  const viewerDocument = buildOpenApiDocument(viewer);
  expect(paths(operatorDocument).length).toBeLessThanOrEqual(paths(adminDocument).length);
  expect(paths(viewerDocument).length).toBeLessThanOrEqual(paths(operatorDocument).length);
  for (const entity of docsMeta.entities) {
    const listPath = "/api/v1/" + entity.tableName;
    const adminHas = mayUseResource(entity.tableName, admin);
    const viewerHas = mayUseResource(entity.tableName, viewer);
    if (!adminHas) continue;
    expect(adminDocument.paths[listPath]).toBeDefined();
    if (!viewerHas) expect(viewerDocument.paths[listPath]).toBeUndefined();
    const entityActions = ["list", "show", "create", "edit", "delete"] as const;
    for (const action of entityActions) {
      const method = action === "list" ? "get" : action === "show" ? "get" : action === "create" ? "post" : action === "edit" ? "patch" : "delete";
      const key = action === "list" || action === "create" ? listPath : listPath + "/{id}";
      const document = operatorDocument;
      if (mayUseAction(entity.tableName, action, operator)) continue;
      expect(document.paths[key]?.[method]).toBeUndefined();
    }
    if (QIY_ROLES[viewer.role] === "read") for (const method of Object.keys(viewerDocument.paths[listPath] ?? {})) expect(method).toBe("get");
  }
  for (const flow of docsMeta.dataflows) {
    const commandPath = "/api/v1/commands/" + flow.name;
    if (flowAllowed(flow, operator)) expect(operatorDocument.paths[commandPath]?.post).toBeDefined();
    else expect(operatorDocument.paths[commandPath]).toBeUndefined();
  }
});

test("lists verification-gated commands as hidden for non-admins", () => {
  const verificationFlows = docsMeta.dataflows.filter((flow) => flow.verification);
  if (verificationFlows.length === 0) return;
  const operatorDocument = buildOpenApiDocument(operator);
  for (const flow of verificationFlows) {
    expect(operatorDocument["x-qiy-hidden"]).toContainEqual({ method: "post", path: "/api/v1/commands/" + flow.name, reason: "verification", verification: flow.verification!, label: flow.label });
  }
  expect(buildOpenApiDocument(admin)["x-qiy-hidden"]).toEqual([]);
});

test("serves the docs endpoints only to authenticated principals", async () => {
  const app = new Elysia().use(createDocsRoutes(async (request) => request.headers.get("authorization") === "Bearer session-admin" ? { id: "admin", name: "Admin", role: QIY_ADMIN_ROLE } : null));
${apiDocsEnabled ? `  const anonymous = await app.handle(new Request("http://localhost/api/v1/openapi.json"));
  expect(anonymous.status).toBe(401);
  const authorized = await app.handle(new Request("http://localhost/api/v1/openapi.json", { headers: { authorization: "Bearer session-admin" } }));
  expect(authorized.status).toBe(200);
  expect(authorized.headers.get("cache-control")).toBe("no-store");
  const spec = await authorized.json() as GeneratedOpenApiDocument;
  expect(spec.openapi).toBe("3.1.0");` : ""}
${modelEnabled ? `  const modelAnonymous = await app.handle(new Request("http://localhost/api/v1/docs/model"));
  expect(modelAnonymous.status).toBe(401);
  const modelResponse = await app.handle(new Request("http://localhost/api/v1/docs/model", { headers: { authorization: "Bearer session-admin" } }));
  expect(modelResponse.status).toBe(200);
  const model = await modelResponse.json() as { entities: unknown[]; dataflows: unknown[]; app: { name: string } };
  expect(model.entities.length).toBeGreaterThan(0);
  expect(model.app.name.length).toBeGreaterThan(0);` : ""}
});
`;
}

/** Generated server tests for API keys: lifecycle, authentication and limits. */
export function renderApiKeyTestModule(auth: NonNullable<QiyProject["auth"]>, database: DatabaseIR): string {
  const roles = roleContext(auth);
  const admin = JSON.stringify(roles.admin);
  const member = JSON.stringify(roles.member ?? roles.admin);
  const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
  const dialect = database.dialect;
  const userTable = userEntity.tableName;
  const roleField = userEntity.fields.find((field) => field.name === auth.roleField)?.columnName ?? auth.roleField;
  const columnOf = (name: string) => { const field = userEntity.fields.find((candidate) => candidate.name === name); return field && (field.columnName ?? field.name); };
  const displayField = columnOf("displayName");
  const emailField = columnOf(auth.usernameField ?? "email");
  const seedColumns = [roleField, displayField, emailField].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
  const userFields = userEntity.fields.map((field) => ({ name: field.columnName ?? field.name, type: field.type, primaryKey: Boolean(field.primaryKey) }));
  const repositoryNames = database.entities.map((entity) => JSON.stringify(entity.name)).join(", ");
  const firstTable = database.entities[0]!.tableName;
  const execSource = dialect === "sqlite"
    ? `async function exec(sql: string): Promise<void> { client.exec(sql); }
async function rows(sql: string): Promise<Array<Record<string, unknown>>> { return client.query(sql).all() as Array<Record<string, unknown>>; }`
    : dialect === "postgresql"
      ? `async function exec(sql: string): Promise<void> { await client.unsafe(sql); }
async function rows(sql: string): Promise<Array<Record<string, unknown>>> { return await client.unsafe(sql) as Array<Record<string, unknown>>; }`
      : `async function exec(sql: string): Promise<void> { await client.query(sql); }
async function rows(sql: string): Promise<Array<Record<string, unknown>>> { const [result] = await client.query(sql) as unknown as [Array<Record<string, unknown>>, unknown]; return result; }`;
  return `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createApp, type Repositories } from "../src/app";
import { createApiKeyRoutes, withApiKeyAuthentication } from "../src/auth/api-keys";
import {
  API_KEY_MAX_ACTIVE,
  canCreateApiKey,
  generateApiKey,
  hashApiKey,
  isApiKeyExpired,
  maskApiKeyPrefix,
  normalizeApiKeyScopes,
  parseApiKey,
  validateApiKeyExpiry,
  validateApiKeyName,
  verifyApiKeyHash,
} from "../src/auth/api-key-hash";

const DIALECT: string = ${JSON.stringify(dialect)};
const USER_TABLE = ${JSON.stringify(userTable)};
const USER_FIELDS: Array<{ name: string; type: string; primaryKey: boolean }> = ${JSON.stringify(userFields)};
const SEED_COLUMNS: string[] = ${JSON.stringify(seedColumns)};
const ROLE_COLUMN = ${JSON.stringify(roleField)};
const DISPLAY_COLUMN = ${JSON.stringify(displayField ?? roleField)};
const EMAIL_COLUMN = ${JSON.stringify(emailField ?? roleField)};
const FIRST_TABLE = ${JSON.stringify(firstTable)};
Bun.env.QIY_AUTH_SECRET = "qiy-api-key-test-secret-value-32-chars";

function identifier(name: string): string { return DIALECT === "mysql" ? "\`" + name + "\`" : '"' + name + '"'; }

function columnType(type: string): string {
  if (DIALECT === "sqlite") {
    if (type === "Integer" || type === "Boolean" || type === "DateTime") return "INTEGER";
    if (type === "Decimal" || type === "Money") return "REAL";
    if (type === "Vector" || type === "File" || type === "Files") return "BLOB";
    return "TEXT";
  }
  if (DIALECT === "postgresql") {
    if (type === "Integer") return "INTEGER";
    if (type === "Boolean") return "BOOLEAN";
    if (type === "Decimal" || type === "Money") return "DOUBLE PRECISION";
    if (type === "DateTime") return "TIMESTAMPTZ";
    if (type === "Date") return "DATE";
    if (type === "Time") return "TIME";
    return "TEXT";
  }
  if (type === "Integer" || type === "Boolean") return "INT";
  if (type === "Decimal" || type === "Money") return "DOUBLE";
  if (type === "DateTime" || type === "Date" || type === "Time") return "DATETIME(3)";
  return "VARCHAR(191)";
}

function usersDdl(): string {
  return "CREATE TABLE " + identifier(USER_TABLE) + " (" + USER_FIELDS.map((field) => identifier(field.name) + " " + columnType(field.type) + (field.primaryKey ? " PRIMARY KEY" : "")).join(", ") + ")";
}

// MySQL cannot index TEXT without a key length, so key and id columns use VARCHAR there.
const TEXT_TYPE = DIALECT === "mysql" ? "VARCHAR(191)" : "TEXT";

function keysDdl(): string {
  const timestamp = DIALECT === "sqlite" ? "INTEGER" : DIALECT === "postgresql" ? "TIMESTAMPTZ" : "DATETIME(3)";
  return "CREATE TABLE " + identifier("qiy_api_keys") + " (" + ["id", "userId", "name", "prefix", "hash", "createdAt"].map((column) => identifier(column) + (column === "createdAt" ? " " + timestamp : " " + TEXT_TYPE) + (column === "id" ? " PRIMARY KEY" : " NOT NULL")).join(", ") + ", " + ["scopes", "rotatedFromId"].map((column) => identifier(column) + " TEXT").join(", ") + ", " + ["lastUsedAt", "expiresAt", "revokedAt"].map((column) => identifier(column) + " " + timestamp).join(", ") + ")";
}

function eventsDdl(): string {
  const timestamp = DIALECT === "sqlite" ? "INTEGER" : DIALECT === "postgresql" ? "TIMESTAMPTZ" : "DATETIME(3)";
  return "CREATE TABLE " + identifier("qiy_api_key_events") + " (" + ["id", "keyId", "userId", "action"].map((column) => identifier(column) + " " + TEXT_TYPE + (column === "id" ? " PRIMARY KEY" : " NOT NULL")).join(", ") + ", " + identifier("at") + " " + timestamp + " NOT NULL)";
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function timestampLiteral(value: Date | null): string {
  if (!value) return "NULL";
  if (DIALECT === "sqlite") return String(value.getTime());
  return literal(DIALECT === "mysql" ? value.toISOString().replace("T", " ").replace("Z", "") : value.toISOString());
}

function nowMinus(minutes: number): Date { return new Date(Date.now() - minutes * 60_000); }
function nowPlus(minutes: number): Date { return new Date(Date.now() + minutes * 60_000); }

${execSource}

async function reset(): Promise<void> {
  await exec("DROP TABLE IF EXISTS " + identifier("qiy_api_keys"));
  await exec("DROP TABLE IF EXISTS " + identifier("qiy_api_key_events"));
  await exec("DROP TABLE IF EXISTS " + identifier(USER_TABLE));
  await exec(usersDdl());
  await exec(keysDdl());
  await exec(eventsDdl());
}

async function seedUser(id: string, role: string, displayName: string): Promise<void> {
  const values = SEED_COLUMNS.map((column) => column === ROLE_COLUMN ? literal(role) : column === DISPLAY_COLUMN ? literal(displayName) : literal(displayName.toLowerCase().replace(/\\s+/g, ".") + "@example.com"));
  await exec("INSERT INTO " + identifier(USER_TABLE) + " (" + [identifier("id"), ...SEED_COLUMNS.map((column) => identifier(column))].join(", ") + ") VALUES (" + [literal(id), ...values].join(", ") + ")");
}

async function insertKey(input: { id: string; userId: string; name: string; prefix: string; hash: string; scopes?: string | null; rotatedFromId?: string | null; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null }): Promise<void> {
  await exec("INSERT INTO " + identifier("qiy_api_keys") + " (" + ["id", "userId", "name", "prefix", "hash", "scopes", "rotatedFromId", "createdAt", "lastUsedAt", "expiresAt", "revokedAt"].map((column) => identifier(column)).join(", ") + ") VALUES (" + [literal(input.id), literal(input.userId), literal(input.name), literal(input.prefix), literal(input.hash), literal(input.scopes ?? null), literal(input.rotatedFromId ?? null), timestampLiteral(input.createdAt), "NULL", timestampLiteral(input.expiresAt), timestampLiteral(input.revokedAt)].join(", ") + ")");
}

async function keyRows(): Promise<Array<Record<string, unknown>>> { return rows("SELECT " + ["id", "userId", "name", "prefix", "hash", "scopes", "rotatedFromId", "lastUsedAt", "expiresAt", "revokedAt"].map((column) => identifier(column)).join(", ") + " FROM " + identifier("qiy_api_keys")); }

const session = async (request: Request) => {
  const header = request.headers.get("authorization");
  if (header === "Bearer session-admin") return { id: "admin-user", name: "Admin", role: ${admin} as const };
  if (header === "Bearer session-operator") return { id: "operator-user", name: "Operator", role: ${member} as const };
  return null;
};

function routes() { return new Elysia().use(createApiKeyRoutes(session)); }
function call(path: string, init?: RequestInit) { return routes().handle(new Request("http://localhost" + path, init)); }
const adminHeaders = { authorization: "Bearer session-admin", "content-type": "application/json" };
const operatorHeaders = { authorization: "Bearer session-operator", "content-type": "application/json" };

test("API key helpers hash secrets, validate names/expiry and never expose the secret", () => {
  const generated = generateApiKey();
  expect(generated.key.startsWith("qiy_")).toBe(true);
  const parsed = parseApiKey(generated.key);
  expect(parsed).not.toBeNull();
  expect(generated.prefix).toHaveLength(8);
  expect(parsed!.prefix).toBe(generated.prefix);
  expect(parseApiKey("qiy_short")).toBeNull();
  expect(parseApiKey("session-token")).toBeNull();
  expect(generated.hash).toHaveLength(64);
  expect(generated.hash).not.toContain(generated.key);
  expect(verifyApiKeyHash(generated.key, generated.hash)).toBe(true);
  expect(verifyApiKeyHash(generated.key, hashApiKey("another-secret"))).toBe(false);
  expect(hashApiKey(parsed!.secret)).toBe(generated.hash);
  expect(maskApiKeyPrefix(generated.prefix)).not.toContain(parsed!.secret);
  expect(validateApiKeyName("  CI deploy  ")).toBe("CI deploy");
  expect(() => validateApiKeyName("   ")).toThrow("name is required");
  expect(validateApiKeyExpiry(nowPlus(5).toISOString())).toBeInstanceOf(Date);
  expect(() => validateApiKeyExpiry(nowMinus(5).toISOString())).toThrow("must be in the future");
  expect(isApiKeyExpired(nowMinus(1), new Date())).toBe(true);
  expect(isApiKeyExpired(null, new Date())).toBe(false);
  expect(canCreateApiKey(API_KEY_MAX_ACTIVE - 1)).toBe(true);
  expect(canCreateApiKey(API_KEY_MAX_ACTIVE)).toBe(false);
  expect(normalizeApiKeyScopes(["orders:read", " orders:read ", "inventory:receive"])).toEqual(["orders:read", "inventory:receive"]);
  expect(normalizeApiKeyScopes([])).toBeNull();
  expect(() => normalizeApiKeyScopes([1])).toThrow("must be strings");
});

test("creates, lists, authenticates and revokes an API key", async () => {
  await reset();
  await seedUser("admin-user", ${admin}, "Admin User");
  const created = await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "CI deploy", expiresAt: nowPlus(60).toISOString() }) });
  expect(created.status).toBe(201);
  const payload = await created.json() as { key: string; record: { id: string; maskedKey: string; prefix: string; name: string } };
  expect(payload.key.startsWith("qiy_")).toBe(true);
  expect(payload.record.name).toBe("CI deploy");
  const parsed = parseApiKey(payload.key)!;
  expect(payload.record.maskedKey).not.toContain(parsed.secret);
  expect(JSON.stringify(payload)).not.toContain("hash");
  const stored = await keyRows();
  expect(stored).toHaveLength(1);
  expect(stored[0]!.hash).toBe(hashApiKey(parsed.secret));
  expect(stored[0]!.hash).not.toBe(payload.key);
  expect(String(stored[0]!.hash)).toHaveLength(64);
  expect(stored[0]!.prefix).toBe(payload.record.prefix);

  const listed = await call("/api/v1/auth/api-keys", { headers: adminHeaders });
  expect(listed.status).toBe(200);
  const listedBody = await listed.json() as { items: Array<Record<string, unknown>> };
  expect(listedBody.items).toHaveLength(1);
  expect(JSON.stringify(listedBody)).not.toContain(parsed.secret);

  const wrapped = withApiKeyAuthentication(session);
  const bearerPrincipal = await wrapped(new Request("http://localhost/probe", { headers: { authorization: "Bearer " + payload.key } }));
  expect(bearerPrincipal).toMatchObject({ id: "admin-user", role: ${admin} });
  const headerPrincipal = await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": payload.key } }));
  expect(headerPrincipal).toMatchObject({ id: "admin-user", role: ${admin} });
  expect(await wrapped(new Request("http://localhost/probe", { headers: { authorization: "Bearer session-token" } }))).toBeNull();
  const used = await keyRows();
  expect(used[0]!.lastUsedAt).not.toBeNull();

  const revoked = await call("/api/v1/auth/api-keys/" + payload.record.id, { method: "DELETE", headers: adminHeaders });
  expect(revoked.status).toBe(200);
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": payload.key } }))).toBeNull();
  expect((await call("/api/v1/auth/api-keys/" + payload.record.id, { method: "DELETE", headers: adminHeaders })).status).toBe(200);
  expect((await call("/api/v1/auth/api-keys/missing", { method: "DELETE", headers: adminHeaders })).status).toBe(404);
});

test("rotates a key, revokes the old one and records audit events", async () => {
  await reset();
  await seedUser("admin-user", ${admin}, "Admin User");
  const created = await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Rotate me", scopes: ["orders:read", "orders:read"] }) });
  const original = await created.json() as { key: string; record: { id: string; name: string; scopes: string[] | null } };
  expect(original.record.scopes).toEqual(["orders:read"]);
  const rotatedResponse = await call("/api/v1/auth/api-keys/" + original.record.id + "/rotate", { method: "POST", headers: adminHeaders });
  expect(rotatedResponse.status).toBe(201);
  const rotated = await rotatedResponse.json() as { key: string; record: { id: string; rotatedFromId: string; name: string; scopes: string[] | null } };
  expect(rotated.key).not.toBe(original.key);
  expect(rotated.record.name).toBe("Rotate me");
  expect(rotated.record.scopes).toEqual(["orders:read"]);
  expect(rotated.record.rotatedFromId).toBe(original.record.id);

  const wrapped = withApiKeyAuthentication(session);
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": original.key } }))).toBeNull();
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": rotated.key } }))).toMatchObject({ id: "admin-user", role: ${admin}, scopes: ["orders:read"] });
  expect((await call("/api/v1/auth/api-keys/" + original.record.id + "/rotate", { method: "POST", headers: adminHeaders })).status).toBe(404);

  const events = await call("/api/v1/auth/api-keys/events", { headers: adminHeaders });
  expect(events.status).toBe(200);
  const body = await events.json() as { items: Array<{ action: string; keyId: string }> };
  expect(body.items.map((event) => event.action)).toEqual(["rotated", "created"]);
  expect(body.items[0]!.keyId).toBe(rotated.record.id);
});

test("API keys authenticate through the app guard and inherit the user's limits", async () => {
  await reset();
  await seedUser("admin-user", ${admin}, "Admin User");
  await seedUser("operator-user", ${member}, "Operator User");
  const adminResponse = await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Admin key" }) });
  const adminPayload = await adminResponse.json() as { key: string; record: { id: string } };
  const adminKey = adminPayload.key;
  const operatorResponse = await call("/api/v1/auth/api-keys", { method: "POST", headers: operatorHeaders, body: JSON.stringify({ name: "Operator key" }) });
  expect(operatorResponse.status).toBe(201);
  const operatorKey = (await operatorResponse.json() as { key: string }).key;

  const refused = await call("/api/v1/auth/api-keys/" + adminPayload.record.id, { method: "DELETE", headers: operatorHeaders });
  expect(refused.status).toBe(404);

  const repository = { distribution: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries([${repositoryNames}].map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, session);
  const adminRead = await app.handle(new Request("http://localhost/api/v1/" + FIRST_TABLE + "/", { headers: { "x-api-key": adminKey } }));
  expect(adminRead.status).toBe(200);
  const anonymous = await app.handle(new Request("http://localhost/api/v1/" + FIRST_TABLE + "/"));
  expect(anonymous.status).toBe(401);
  // Non-admin principals never get role access to the auth user resource: an
  // operator API key must be rejected by the same guard as an operator session.
  const operatorDenied = await app.handle(new Request("http://localhost/api/v1/" + USER_TABLE + "/", { headers: { "x-api-key": operatorKey } }));
  expect(operatorDenied.status).toBe(${roles.member ? 403 : 200});
  const self = await app.handle(new Request("http://localhost/api/v1/auth/api-keys", { headers: { "x-api-key": adminKey } }));
  expect(self.status).toBe(200);
  const revoke = await app.handle(new Request("http://localhost/api/v1/auth/api-keys/" + adminPayload.record.id, { method: "DELETE", headers: { "x-api-key": adminKey } }));
  expect(revoke.status).toBe(200);
  const afterRevoke = await app.handle(new Request("http://localhost/api/v1/" + FIRST_TABLE + "/", { headers: { "x-api-key": adminKey } }));
  expect(afterRevoke.status).toBe(401);
});

test("rejects expired/revoked keys, invalid payloads and the per-user key limit", async () => {
  await reset();
  await seedUser("admin-user", ${admin}, "Admin User");
  const generated = generateApiKey();
  const expired = generateApiKey();
  const revoked = generateApiKey();
  await insertKey({ id: "expired-key", userId: "admin-user", name: "Expired", prefix: expired.prefix, hash: expired.hash, createdAt: nowMinus(120), expiresAt: nowMinus(60), revokedAt: null });
  await insertKey({ id: "revoked-key", userId: "admin-user", name: "Revoked", prefix: revoked.prefix, hash: revoked.hash, createdAt: nowMinus(120), expiresAt: null, revokedAt: nowMinus(60) });
  await insertKey({ id: "live-key", userId: "admin-user", name: "Live", prefix: generated.prefix, hash: generated.hash, createdAt: nowMinus(120), expiresAt: null, revokedAt: null });
  const wrapped = withApiKeyAuthentication(session);
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": expired.key } }))).toBeNull();
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": revoked.key } }))).toBeNull();
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": "qiy_00000000_" + "x".repeat(43) } }))).toBeNull();
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "" }) })).status).toBe(422);
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Missing expiry" }) })).status).toBe(201);
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Past", expiresAt: nowMinus(5).toISOString() }) })).status).toBe(400);
  await exec("DELETE FROM " + identifier("qiy_api_keys"));
  for (let index = 0; index < API_KEY_MAX_ACTIVE; index += 1) {
    const key = generateApiKey();
    await insertKey({ id: "limit-" + index, userId: "admin-user", name: "Key " + index, prefix: key.prefix, hash: key.hash, createdAt: new Date(), expiresAt: null, revokedAt: null });
  }
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Over limit" }) })).status).toBe(409);
});
`;
}
