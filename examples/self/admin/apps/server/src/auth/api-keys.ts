import { Elysia, t } from "elysia";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { users, qiyApiKeys } from "../schema";
import type { Authenticator, Principal } from "./guard";
import {
  API_KEY_MAX_ACTIVE,
  canCreateApiKey,
  apiKeyFromRequest,
  generateApiKey,
  hashApiKey,
  isApiKeyExpired,
  parseApiKey,
  toApiKeyRecord,
  validateApiKeyExpiry,
  validateApiKeyName,
} from "./api-key-hash";

const ROLES = ["admin", "operator", "viewer"] as const;
type Role = (typeof ROLES)[number];
function asRole(value: unknown): Role | null { return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? value as Role : null; }

/** Resolves the user row behind a presented API key; updates lastUsedAt at most once a minute. */
async function resolveApiKeyPrincipal(presented: string): Promise<Principal | null> {
  const parsed = parseApiKey(presented);
  if (!parsed) return null;
  const rows = await db.select().from(qiyApiKeys).where(eq(qiyApiKeys.hash, hashApiKey(parsed.secret))).limit(1);
  const key = rows[0];
  if (!key || key.revokedAt || isApiKeyExpired(key.expiresAt)) return null;
  const userRows = await db.select().from(users).where(eq(users.id, key.userId)).limit(1);
  const user = userRows[0];
  const role = user ? asRole(user.role) : null;
  if (!user || !role) return null;
  const lastUsed = key.lastUsedAt ? new Date(key.lastUsedAt as Date | number).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    try { await db.update(qiyApiKeys).set({ lastUsedAt: new Date() }).where(eq(qiyApiKeys.id, key.id)); } catch { /* best effort */ }
  }
  const claims: Record<string, string | number | boolean | null> = {};
  if (user.orgId !== null && user.orgId !== undefined && user.orgId !== "") claims["org.id"] = typeof user.orgId === "boolean" || typeof user.orgId === "number" ? user.orgId : String(user.orgId);
  const row = user;
  return { id: user.id, name: String(row.displayName ?? row.email ?? row.id), role, ...(Object.keys(claims).length ? { claims } : {}) };
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
      try {
        name = validateApiKeyName(body.name);
        expiresAt = validateApiKeyExpiry(body.expiresAt);
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
      await db.insert(qiyApiKeys).values({ id, userId: principal.id, name, prefix: generated.prefix, hash: generated.hash, createdAt, lastUsedAt: null, expiresAt, revokedAt: null });
      const row = { id, name, prefix: generated.prefix, createdAt, lastUsedAt: null, expiresAt, revokedAt: null };
      set.status = 201;
      return { key: generated.key, record: toApiKeyRecord(row) };
    }, { body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }), expiresAt: t.Optional(t.String({ maxLength: 64 })) }) })
    .delete("/:id", async ({ params, request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const rows = await db.select().from(qiyApiKeys).where(and(eq(qiyApiKeys.id, params.id), eq(qiyApiKeys.userId, principal.id))).limit(1);
      const row = rows[0];
      if (!row) { set.status = 404; return { error: "API key not found" }; }
      if (!row.revokedAt) await db.update(qiyApiKeys).set({ revokedAt: new Date() }).where(eq(qiyApiKeys.id, row.id));
      const revokedAt = row.revokedAt ?? new Date();
      return { record: toApiKeyRecord({ ...row, revokedAt } as never) };
    });
}
