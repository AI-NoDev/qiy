/**
 * Server files for authentication: the permission model, OIDC (single, multi-
 * provider and hybrid), local passwords with session revocation, OTP, account
 * management and their tests.
 */
import { renderPermissionModule, renderPermissionRoutes, renderPermissionTest } from "./permissions";
import { renderHybridAuthModule, renderHybridAuthenticatorModule, renderMultiProviderOidcModule, renderAccountModule, renderHybridAuthTest } from "./auth";
import { userClaimFields, renderUserClaimLines, principalNameExpression, type ServerOptions } from "./shared";
import type { QiyPermissionModel } from "../permissions";
import { fullAccessRoles, type RoleContext } from "../roles";
import type { DatabaseIR } from "../database-ir";

export function addAuthFiles(files: Record<string, string>, { database, options, auth, permissions, roles, hybridAuth, multiProviderAuth, singleOidcAuth, hasLocalAuth }: { database: DatabaseIR; options: ServerOptions; auth: NonNullable<ServerOptions['auth']>; permissions: QiyPermissionModel | undefined; roles: RoleContext; hybridAuth: boolean; multiProviderAuth: boolean; singleOidcAuth: boolean; hasLocalAuth: boolean }): void {
  if (permissions) {
    files["api/src/auth/permissions.ts"] = renderPermissionModule(auth, permissions);
    files["api/src/auth/permission-routes.ts"] = renderPermissionRoutes();
    files["api/tests/permissions.test.ts"] = renderPermissionTest(database, permissions, roles);
  }
  if (hybridAuth) {
    files["api/src/auth/oidc.ts"] = renderHybridAuthModule(auth, database);
    files["api/src/auth/hybrid.ts"] = renderHybridAuthenticatorModule();
  } else if (multiProviderAuth) {
    files["api/src/auth/oidc.ts"] = renderMultiProviderOidcModule(auth);
  } else if (singleOidcAuth) files["api/src/auth/oidc.ts"] = `import { createRemoteJWKSet } from "jose";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { createOidcAuthenticator } from "./verify";

export function createProductionAuthenticator() {
  const issuer = Bun.env.QIY_OIDC_ISSUER;
  const audience = Bun.env.QIY_OIDC_AUDIENCE;
  const jwksUrl = Bun.env.QIY_OIDC_JWKS_URL;
  if (!issuer || !audience || !jwksUrl) throw new Error("OIDC issuer, audience and JWKS URL are required");
  if (new URL(issuer).protocol !== "https:" || new URL(jwksUrl).protocol !== "https:") throw new Error("OIDC endpoints must use HTTPS");
  // Rotation and revocation windows are operator decisions: without these knobs the
  // generated defaults would silently pin a 5s fetch timeout, a 30s missing-key
  // cooldown and a 10min key cache, which is untunable per identity provider.
  const positiveInteger = (name: string, fallback: number, minimum: number): number => {
    const raw = Bun.env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum) throw new Error(name + " must be an integer of at least " + minimum);
    return value;
  };
  const timeoutDuration = positiveInteger("QIY_OIDC_JWKS_TIMEOUT_MS", 5000, 1);
  const cooldownDuration = positiveInteger("QIY_OIDC_JWKS_COOLDOWN_MS", 30000, 0);
  const cacheMaxAge = positiveInteger("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", 600000, 1);
  return createOidcAuthenticator({ issuer, audience, keySet: createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration, cooldownDuration, cacheMaxAge }), roleField: ${JSON.stringify(auth.roleField)},
    async findUser(externalSubject) {
      const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${auth.subjectField}, externalSubject)).limit(2);
      return rows.length === 1 ? rows[0]! : null;
    },
  });
}
`;
  if (hasLocalAuth) {
    const usernameField = auth.usernameField!;
    const passwordField = auth.passwordField!;
    const sessionTimestamp = database.dialect === "sqlite" ? "INTEGER" : database.dialect === "postgresql" ? "TIMESTAMPTZ" : "DATETIME(3)";
    const sessionUserColumn = database.dialect === "mysql" ? "VARCHAR(36)" : "TEXT";
    const sessionRevocationDdl = `CREATE TABLE qiy_session_revocations (userId ${sessionUserColumn} PRIMARY KEY, revokedBefore ${sessionTimestamp} NOT NULL)`;
    const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
    const bootstrapFields = userEntity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable && ![usernameField, passwordField, auth.roleField].includes(field.name) && !(hybridAuth && field.name === auth.subjectField));
    const bootstrapHasDisplayName = bootstrapFields.some((field) => field.name === "displayName");
    // A hybrid account needs the required canonical subject column too; it is
    // derived instead of prompted because no OAuth identity exists yet.
    const bootstrapCanonicalSubject = hybridAuth ? `${JSON.stringify(auth.subjectField)}: "local:" + username, ` : "";
    const bootstrapValues = bootstrapFields.map((field) => {
      const value = field.name === "displayName" ? "displayName"
        : field.type === "Integer" ? `Number(await terminal.question(${JSON.stringify(field.name + ": ")}))`
          : field.type === "DateTime" ? `new Date(await terminal.question(${JSON.stringify(field.name + " (ISO date-time): ")}))`
            : field.type === "Date" ? `await terminal.question(${JSON.stringify(field.name + " (YYYY-MM-DD): ")})`
              : field.type === "Time" ? `await terminal.question(${JSON.stringify(field.name + " (HH:mm:ss): ")})`
                : `await terminal.question(${JSON.stringify(field.name + ": ")})`;
      return `${JSON.stringify(field.name)}: ${value}`;
    }).join(",\n    ");
    files["api/src/auth/password.ts"] = `import { jwtVerify, SignJWT } from "jose";
import { isQiyRole, type QiyRole } from "./roles";

export type Role = QiyRole;
export const isRole = isQiyRole;

/**
 * Qiy stores password hashes produced by \`Bun.password.hash(password, { algorithm: "argon2id" })\`.
 * The plaintext password is never persisted and never leaves the login request.
 */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) return false;
  try { return await Bun.password.verify(password, hash); }
  catch { return false; }
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  return await Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function signAccessToken(user: { id: string; role: Role }, secret: string, issuer: string): Promise<string> {
  return await new SignJWT({ role: user.role, typ: "qiy-local" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(token: string, secret: string, issuer: string): Promise<{ id: string; role: Role; issuedAt: number } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer, audience: issuer, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !isRole(payload.role)) return null;
    return { id: payload.sub, role: payload.role, issuedAt: typeof payload.iat === "number" ? payload.iat : 0 };
  } catch { return null; }
}
`;
    // Local password sessions have no identity-provider token, so claims used by
    // data scopes are resolved from the authenticated user row instead. A scope
    // claim such as "org.id" maps to the user field "orgId" (dotted segments are
    // camel-cased); the mapping is validated at generation time so a broken claim
    // cannot silently produce 403 responses at runtime.
    const localScopeClaims = userClaimFields(options.auth, userEntity, options.scopes);
    for (const mapping of localScopeClaims) {
      if (!mapping.field) throw new Error(`Data scope claim ${mapping.claim} needs a matching field on ${userEntity.name} (expected ${mapping.expected}) to resolve local password sessions; add that field or map it with \`claim ${mapping.claim} <field>;\` in auth`);
    }
    const localScopeClaimLines = renderUserClaimLines(localScopeClaims, "row");
    files["api/src/auth/session-revocations.ts"] = `import { eq } from "drizzle-orm";
import { db } from "../db";
import { qiySessionRevocations } from "../schema";

/** Invalidates every local-access token issued before the returned instant. */
export async function revokeUserSessions(userId: string): Promise<Date> {
  const revokedBefore = new Date();
  const rows = await db.select().from(qiySessionRevocations).where(eq(qiySessionRevocations.userId, userId)).limit(1);
  if (rows[0]) await db.update(qiySessionRevocations).set({ revokedBefore }).where(eq(qiySessionRevocations.userId, userId));
  else await db.insert(qiySessionRevocations).values({ userId, revokedBefore });
  return revokedBefore;
}

/** Checks a JWT iat (seconds) against the user's revocation watermark. */
export async function isSessionRevoked(userId: string, issuedAtSeconds: number): Promise<boolean> {
  const rows = await db.select().from(qiySessionRevocations).where(eq(qiySessionRevocations.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) return false;
  const before = row.revokedBefore instanceof Date ? row.revokedBefore : new Date(row.revokedBefore as number | string);
  return Number.isFinite(before.getTime()) && issuedAtSeconds * 1000 < before.getTime();
}
`;
    files["api/src/auth/local.ts"] = `import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { isRole, signAccessToken, verifyAccessToken, verifyPassword } from "./password";
import { isSessionRevoked } from "./session-revocations";
import type { Authenticator, Principal } from "./guard";

const ISSUER = "qiy-admin";
function positiveInt(name: string, fallback: number): number {
  const value = Number(Bun.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
const LOGIN_MAX_ATTEMPTS = positiveInt("QIY_AUTH_LOGIN_MAX_ATTEMPTS", 5);
const LOGIN_WINDOW_MS = positiveInt("QIY_AUTH_LOGIN_WINDOW_MS", 15 * 60_000);
const LOGIN_LOCK_MS = positiveInt("QIY_AUTH_LOGIN_LOCK_MS", 15 * 60_000);
interface LoginAttempt { failures: number; firstAt: number; lockedUntil: number }
const loginAttempts = new Map<string, LoginAttempt>();
function attemptKey(identifier: string): string { return identifier.trim().toLowerCase(); }
function lockedFor(key: string, now: number): number {
  const attempt = loginAttempts.get(key);
  if (!attempt) return 0;
  if (now - attempt.firstAt > LOGIN_WINDOW_MS) { loginAttempts.delete(key); return 0; }
  return Math.max(0, attempt.lockedUntil - now);
}
function recordFailure(key: string, now: number): number {
  const attempt = loginAttempts.get(key);
  const next = attempt && now - attempt.firstAt <= LOGIN_WINDOW_MS ? { ...attempt, failures: attempt.failures + 1 } : { failures: 1, firstAt: now, lockedUntil: 0 };
  if (next.failures >= LOGIN_MAX_ATTEMPTS) next.lockedUntil = now + LOGIN_LOCK_MS;
  loginAttempts.set(key, next);
  if (loginAttempts.size > 10_000) {
    const oldest = [...loginAttempts.entries()].sort((left, right) => left[1].firstAt - right[1].firstAt)[0];
    if (oldest) loginAttempts.delete(oldest[0]);
  }
  return Math.max(0, next.lockedUntil - now);
}
function secret(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for local password login");
  return value;
}

async function findUserById(id: string): Promise<Principal | null> {
  const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1);
  const row = rows[0];
  if (!row || typeof row.id !== "string" || !isRole(row.${auth.roleField})) return null;
  const claims: Record<string, string | number | boolean | null> = {};
${localScopeClaimLines}
  return { id: row.id, name: ${principalNameExpression(userEntity, "displayName", auth.usernameField)}, role: row.${auth.roleField}, ...(Object.keys(claims).length ? { claims } : {}) };
}

export function createProductionAuthenticator(): Authenticator {
  const key = secret();
  return async (request) => {
    const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    const verified = await verifyAccessToken(match[1]!, key, ISSUER);
    if (!verified) return null;
    if (await isSessionRevoked(verified.id, verified.issuedAt)) return null;
    return findUserById(verified.id);
  };
}

export type LocalUser = typeof ${auth.userEntity}.$inferSelect;
type UserLookup = (username: string) => Promise<LocalUser | null>;

export function createLocalAuthRoutes(findUser: UserLookup = async (username) => {
  const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${usernameField}, username)).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .post("/login", async ({ body, status, set }) => {
      const key = secret();
      const identifier = body.username.trim();
      if (!identifier || !body.password) return status(400, { error: "Username and password are required" });
      const attempt = attemptKey(identifier);
      const now = Date.now();
      const retryAfterMs = lockedFor(attempt, now);
      if (retryAfterMs > 0) {
        set.headers["retry-after"] = String(Math.ceil(retryAfterMs / 1000));
        return status(429, { error: "Too many login attempts; try again later", retryAfterSeconds: Math.ceil(retryAfterMs / 1000) });
      }
      const row = await findUser(identifier);
      if (!row) {
        await verifyPassword("\$argon2id\$v=19\$m=65536,t=3,p=4\$c29tZXNhbHRzb21lc2FsdA\$0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8", body.password);
        const lockMs = recordFailure(attempt, now);
        if (lockMs > 0) { set.headers["retry-after"] = String(Math.ceil(lockMs / 1000)); return status(429, { error: "Too many login attempts; try again later", retryAfterSeconds: Math.ceil(lockMs / 1000) }); }
        return status(401, { error: "Invalid username or password" });
      }
      if (!isRole(row.${auth.roleField}) || !await verifyPassword(row.${passwordField}, body.password)) {
        const lockMs = recordFailure(attempt, now);
        if (lockMs > 0) { set.headers["retry-after"] = String(Math.ceil(lockMs / 1000)); return status(429, { error: "Too many login attempts; try again later", retryAfterSeconds: Math.ceil(lockMs / 1000) }); }
        return status(401, { error: "Invalid username or password" });
      }
      loginAttempts.delete(attempt);
      const token = await signAccessToken({ id: row.id, role: row.${auth.roleField} }, key, ISSUER);
      return { accessToken: token, tokenType: "Bearer", expiresIn: 43200, id: row.id, name: ${principalNameExpression(userEntity, "displayName", auth.usernameField)}, role: row.${auth.roleField} };    }, { body: t.Object({ username: t.String({ minLength: 1, maxLength: 190 }), password: t.String({ minLength: 1, maxLength: 200 }) }) });
}
`;
    files["api/src/auth/set-password.ts"] = `import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { hashPassword } from "./password";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const username = (await terminal.question("Username or email: ")).trim();
  const password = await terminal.question("New password (minimum 8 characters): ");
  const passwordHash = await hashPassword(password);
  const rows = await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(${auth.userEntity}.${usernameField}, username)).limit(2);
  if (rows.length !== 1) throw new Error("Expected exactly one matching user");
  await db.update(${auth.userEntity}).set({ ${passwordField}: passwordHash }).where(eq(${auth.userEntity}.id, rows[0]!.id));
  console.log("Password updated for " + username);
} finally { terminal.close(); }
`;
    files["api/src/auth/bootstrap-admin.ts"] = `import { createInterface } from "node:readline/promises";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { hashPassword } from "./password";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  if ((await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(inArray(${auth.userEntity}.${auth.roleField}, ${JSON.stringify(fullAccessRoles(options.auth))})).limit(1)).length) throw new Error("An admin account already exists");
  const username = (await terminal.question("${usernameField}: ")).trim();
  if (!username) throw new Error("Username is required");
  ${bootstrapHasDisplayName ? 'const displayName = (await terminal.question("Display name: ")).trim() || username;' : ""}
  const password = await terminal.question("Password (minimum 8 characters): ");
  const values = { ${JSON.stringify(usernameField)}: username, ${JSON.stringify(auth.roleField)}: ${JSON.stringify(roles.admin)}, ${JSON.stringify(passwordField)}: await hashPassword(password), ${bootstrapCanonicalSubject}${bootstrapValues} };
  await db.insert(${auth.userEntity}).values({ ...values, id: crypto.randomUUID() } as typeof ${auth.userEntity}.$inferInsert);
  console.log("Initial admin account created for " + username);
} finally { terminal.close(); }
`;
    files["api/tests/local-auth.test.ts"] = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createLocalAuthRoutes } from "../src/auth/local";
import { hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from "../src/auth/password";

const secret = "qiy-local-auth-test-secret-value-32";

test("hashes and verifies local passwords without storing plaintext", async () => {
  const hash = await hashPassword("correct-horse-battery");
  expect(hash).toStartWith("\$argon2id\$");
  expect(hash).not.toContain("correct-horse-battery");
  expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
  expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  expect(await verifyPassword(null, "correct-horse-battery")).toBe(false);
});

test("round-trips a signed local access token and rejects tampering", async () => {
  const token = await signAccessToken({ id: "user-1", role: ${JSON.stringify(roles.admin)} }, secret, "qiy-admin");
  expect(await verifyAccessToken(token, secret, "qiy-admin")).toMatchObject({ id: "user-1", role: ${JSON.stringify(roles.admin)} });
  expect((await verifyAccessToken(token, secret, "qiy-admin"))!.issuedAt).toBeNumber();
  expect(await verifyAccessToken(token, secret + "x", "qiy-admin")).toBeNull();
  expect(await verifyAccessToken(token + "x", secret, "qiy-admin")).toBeNull();
  expect(await verifyAccessToken(token, secret, "other-app")).toBeNull();
});

test("locks a username after repeated failed logins", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const passwordHash = await hashPassword("correct-password");
  const user = { id: "user-lock", ${JSON.stringify(auth.usernameField)}: "lock-user", ${JSON.stringify(auth.passwordField)}: passwordHash, ${JSON.stringify(auth.roleField)}: ${JSON.stringify(roles.admin)} } as unknown as import("../src/auth/local").LocalUser;
  const app = new Elysia().use(createLocalAuthRoutes(async (username) => username === "lock-user" ? user : null));
  const login = (password: string) => app.handle(new Request("http://localhost/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "lock-user", password }) }));
  for (let attempt = 0; attempt < 4; attempt += 1) expect((await login("wrong-password")).status).toBe(401);
  const locked = await login("wrong-password");
  expect(locked.status).toBe(429);
  expect(locked.headers.get("retry-after")).toBeTruthy();
  expect((await login("correct-password")).status).toBe(429);
});

test("local login route issues a bearer token and rejects invalid credentials", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const passwordHash = await hashPassword("correct-password");
  const user = { id: "user-1", ${JSON.stringify(auth.usernameField)}: "admin", ${JSON.stringify(auth.passwordField)}: passwordHash, ${JSON.stringify(auth.roleField)}: ${JSON.stringify(roles.admin)} } as unknown as import("../src/auth/local").LocalUser;
  const app = new Elysia().use(createLocalAuthRoutes(async (username) => username === "admin" ? user : null));
  const login = (username: string, password: string) => app.handle(new Request("http://localhost/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const success = await login("admin", "correct-password");
  expect(success.status).toBe(200);
  const payload = await success.json() as { accessToken: string; role: string };
  expect(payload.role).toBe(${JSON.stringify(roles.admin)});
  expect(await verifyAccessToken(payload.accessToken, secret, "qiy-admin")).toMatchObject({ id: "user-1", role: ${JSON.stringify(roles.admin)} });
  expect((await login("admin", "wrong-password")).status).toBe(401);
  expect((await login("missing", "wrong-password")).status).toBe(401);
  expect((await app.handle(new Request("http://localhost/api/v1/auth/password", { method: "POST" }))).status).toBe(404);
});
`;
    if (database.dialect === "sqlite") files["api/tests/session-revocation.test.ts"] = `import { expect, test } from "bun:test";
import { client } from "../src/db";
import { isSessionRevoked, revokeUserSessions } from "../src/auth/session-revocations";

const DDL = ${JSON.stringify(sessionRevocationDdl)};

test("revokes tokens issued before the revocation watermark", async () => {
  client.exec("DROP TABLE IF EXISTS qiy_session_revocations");
  client.exec(DDL);
  try {
    const userId = "00000000-0000-4000-8000-0000000000aa";
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    expect(await isSessionRevoked(userId, issuedAt)).toBe(false);
    const revokedBefore = await revokeUserSessions(userId);
    expect(await isSessionRevoked(userId, issuedAt)).toBe(true);
    expect(await isSessionRevoked(userId, Math.floor(revokedBefore.getTime() / 1000) + 60)).toBe(false);
  } finally {
    client.exec("DROP TABLE IF EXISTS qiy_session_revocations");
  }
});
`;
  }
  if (auth.provider === "otp") {
    const usernameField = auth.usernameField!;
    const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
    const otpClaimFields = userClaimFields(auth, userEntity, options.scopes);
    for (const mapping of otpClaimFields) {
      if (!mapping.field) throw new Error(`Data scope claim ${mapping.claim} needs a matching field on ${userEntity.name} (expected ${mapping.expected}) to resolve OTP sessions; add that field or map it with \`claim ${mapping.claim} <field>;\` in auth`);
    }
    const otpClaimLines = renderUserClaimLines(otpClaimFields, "row");
    files["api/src/auth/otp.ts"] = `import { createHmac, timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import type { Authenticator, Principal } from "./guard";
import { QIY_DEFAULT_ROLE, QIY_ROLE_NAMES } from "./roles";

const ISSUER = "qiy-admin";
const roles = new Set<string>(QIY_ROLE_NAMES);
function secret(): string { const value = Bun.env.QIY_AUTH_SECRET; if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for OTP login"); return value; }
function otpHash(identifier: string, code: string, key: string): string { return createHmac("sha256", key).update(identifier + "\\n" + code).digest("hex"); }
function matchesHash(left: string, right: string): boolean { const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex"); return a.length === b.length && timingSafeEqual(a, b); }
function randomCode(): string { return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0"); }
async function findUser(identifier: string) { const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${usernameField}, identifier)).limit(2); return rows.length === 1 ? rows[0]! : null; }
async function findPrincipal(id: string): Promise<Principal | null> { const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1); const row = rows[0]; if (!row || typeof row.id !== "string" || !roles.has(String(row.${auth.roleField}))) return null;${otpClaimLines ? ` const claims: Record<string, string | number | boolean | null> = {};\n${otpClaimLines}\n` : ""} return { id: row.id, name: ${principalNameExpression(userEntity, "displayName", usernameField)}, role: row.${auth.roleField} as Principal["role"]${otpClaimLines ? ", ...(Object.keys(claims).length ? { claims } : {})" : ""} }; }
class OtpDeliveryError extends Error {}
async function deliver(identifier: string, code: string): Promise<void> {
  const endpoint = Bun.env.QIY_OTP_DELIVERY_URL;
  if (!endpoint) {
    if (Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE) return;
    throw new OtpDeliveryError("QIY_OTP_DELIVERY_URL is required outside explicit development OTP mode");
  }
  if (new URL(endpoint).protocol !== "https:") throw new OtpDeliveryError("QIY_OTP_DELIVERY_URL must use HTTPS");
  const timeout = Number(Bun.env.QIY_OTP_DELIVERY_TIMEOUT_MS ?? "10000");
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new OtpDeliveryError("QIY_OTP_DELIVERY_TIMEOUT_MS must be an integer between 100 and 60000");
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(Bun.env.QIY_OTP_DELIVERY_TOKEN ? { Authorization: "Bearer " + Bun.env.QIY_OTP_DELIVERY_TOKEN } : {}) }, body: JSON.stringify({ recipient: identifier, code, expiresIn: 300 }), signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new OtpDeliveryError(error instanceof Error && error.name === "TimeoutError" ? "OTP delivery adapter timed out" : "OTP delivery adapter is unreachable");
  }
  if (!response.ok) throw new OtpDeliveryError("OTP delivery adapter rejected the request");
}
async function signAccessToken(user: { id: string; role: string }, key: string): Promise<string> { return new SignJWT({ role: user.role, typ: "qiy-otp" }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime("12h").sign(new TextEncoder().encode(key)); }

export function createProductionAuthenticator(): Authenticator { const key = secret(); return async (request) => { const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? ""); if (!match) return null; try { const { payload } = await jwtVerify(match[1]!, new TextEncoder().encode(key), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] }); if (payload.typ !== "qiy-otp" || typeof payload.sub !== "string" || !roles.has(String(payload.role))) return null; return await findPrincipal(payload.sub); } catch { return null; } }; }

export function createOtpAuthRoutes(lookup = findUser, send = deliver, resolvePrincipal = findPrincipal) { return new Elysia({ prefix: "/api/v1/auth/otp" })
  .post("/request", async ({ body, status }) => { const identifier = body.identifier.trim(); if (!identifier) return status(400, { error: "Login identifier is required" }); const key = secret(); const row = await lookup(identifier); const role = row && roles.has(String(row.${auth.roleField})) ? String(row.${auth.roleField}) : QIY_DEFAULT_ROLE; const code = Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE ? Bun.env.QIY_OTP_DEV_CODE : randomCode(); const valid = Boolean(row && typeof row.id === "string" && roles.has(role));
    if (valid) {
      try { await send(identifier, code); }
      catch (error) {
        // Never log or return the one-time code, and never mint a challenge whose
        // code the provider did not accept.
        console.error("OTP delivery failed", { provider: Bun.env.QIY_OTP_DELIVERY_URL, error });
        return status(502, { error: Bun.env.QIY_DEV_MODE === "1" && error instanceof Error ? error.message : "Could not send the one-time password", errorKey: "auth.otpDeliveryFailed" });
      }
    }
    const challengeToken = await new SignJWT({ typ: "qiy-otp-challenge", identifier, otpHash: otpHash(identifier, code, key), role, valid }).setProtectedHeader({ alg: "HS256" }).setSubject(valid ? row!.id : "unknown").setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(key)); return { challengeToken, expiresIn: 300, ...(Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE ? { devCode: code } : {}) }; }, { body: t.Object({ identifier: t.String({ minLength: 1, maxLength: 190 }) }) })
  .post("/verify", async ({ body, status }) => { const key = secret(); try { const { payload } = await jwtVerify(body.challengeToken, new TextEncoder().encode(key), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] }); if (payload.typ !== "qiy-otp-challenge" || payload.valid !== true || payload.identifier !== body.identifier || typeof payload.otpHash !== "string" || typeof payload.sub !== "string" || !roles.has(String(payload.role)) || !matchesHash(payload.otpHash, otpHash(body.identifier, body.code, key))) return status(401, { error: "Invalid or expired one-time password" }); const principal = await resolvePrincipal(payload.sub); if (!principal) return status(401, { error: "Invalid or expired one-time password" }); return { accessToken: await signAccessToken({ id: principal.id, role: principal.role }, key), tokenType: "Bearer", expiresIn: 43200, ...principal }; } catch { return status(401, { error: "Invalid or expired one-time password" }); } }, { body: t.Object({ identifier: t.String({ minLength: 1, maxLength: 190 }), challengeToken: t.String({ minLength: 1, maxLength: 4096 }), code: t.String({ minLength: 4, maxLength: 12 }) }) }); }
`;
    files["api/tests/otp-auth.test.ts"] = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createOtpAuthRoutes } from "../src/auth/otp";

test("issues and verifies a short-lived OTP challenge without exposing a production code", async () => { Bun.env.QIY_AUTH_SECRET = "qiy-otp-test-secret-value-at-least-32"; Bun.env.QIY_DEV_MODE = "1"; Bun.env.QIY_OTP_DEV_CODE = "246810"; const sent: Array<{ identifier: string; code: string }> = []; const user = { id: "user-1", ${JSON.stringify(usernameField)}: "admin@example.com", ${JSON.stringify(auth.roleField)}: ${JSON.stringify(roles.admin)} } as any; const principal = { id: "user-1", name: "Admin", role: ${JSON.stringify(roles.admin)} } as const; const app = new Elysia().use(createOtpAuthRoutes(async (identifier) => identifier === "admin@example.com" ? user : null, async (identifier, code) => { sent.push({ identifier, code }); }, async (id) => id === "user-1" ? principal : null)); const request = await app.handle(new Request("http://localhost/api/v1/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@example.com" }) })); expect(request.status).toBe(200); const challenge = await request.json() as { challengeToken: string; devCode?: string }; expect(challenge.devCode).toBe("246810"); expect(sent).toEqual([{ identifier: "admin@example.com", code: "246810" }]); const verify = (code: string) => app.handle(new Request("http://localhost/api/v1/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@example.com", challengeToken: challenge.challengeToken, code }) })); expect((await verify("wrong")).status).toBe(401); const success = await verify("246810"); expect(success.status).toBe(200); expect((await success.json() as { accessToken: string }).accessToken.length).toBeGreaterThan(40); });
`;
  }
  if (hasLocalAuth) files["api/src/auth/account.ts"] = renderAccountModule(auth, database);
  if (hybridAuth) files["api/tests/hybrid-auth.test.ts"] = renderHybridAuthTest(auth);
  files["api/tests/auth.test.ts"] = `import { expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createOidcAuthenticator } from "../src/auth/verify";

test("verifies issuer, audience and rotating JWKS keys before resolving subject", async () => {
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  const firstJwk = { ...await exportJWK(first.publicKey), kid: "first", alg: "RS256" };
  const secondJwk = { ...await exportJWK(second.publicKey), kid: "second", alg: "RS256" };
  const seen: string[] = [];
  const authenticate = createOidcAuthenticator({ issuer: "https://id.example.test", audience: "qiy-admin", keySet: createLocalJWKSet({ keys: [firstJwk, secondJwk] }), roleField: "role", findUser: async (subject) => { seen.push(subject); return subject === "https://id.example.test|user-1" ? { id: "user-1", role: ${JSON.stringify(roles.member ?? roles.admin)}, displayName: "Operator" } : null; } });
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "second" }).setIssuer("https://id.example.test").setAudience("qiy-admin").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(second.privateKey);
  const request = (value: string) => new Request("http://localhost/api/v1/orders", { headers: { Authorization: "Bearer " + value } });
  expect(await authenticate(request(token))).toEqual({ id: "user-1", name: "Operator", role: ${JSON.stringify(roles.member ?? roles.admin)} });
  expect(seen).toEqual(["https://id.example.test|user-1"]);
  expect(await authenticate(new Request("http://localhost/api/v1/orders"))).toBeNull();
  const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "first" }).setIssuer("https://id.example.test").setAudience("other-app").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(first.privateKey);
  await expect(authenticate(request(wrongAudience))).rejects.toThrow();
  const wrongIssuer = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "first" }).setIssuer("https://other.example.test").setAudience("qiy-admin").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(first.privateKey);
  await expect(authenticate(request(wrongIssuer))).rejects.toThrow();
  expect(seen).toEqual(["https://id.example.test|user-1"]);
});
`;
}
