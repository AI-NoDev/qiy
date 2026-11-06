import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../schema";
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
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const row = rows[0];
  if (!row || typeof row.id !== "string" || !isRole(row.role)) return null;
  const claims: Record<string, string | number | boolean | null> = {};
  if (row.customerId !== null && row.customerId !== undefined && row.customerId !== "") claims["tenant.customerId"] = typeof row.customerId === "boolean" || typeof row.customerId === "number" ? row.customerId : String(row.customerId);
  return { id: row.id, name: String(row.displayName ?? row.email ?? row.id), role: row.role, ...(Object.keys(claims).length ? { claims } : {}) };
}

export function createProductionAuthenticator(): Authenticator {
  const key = secret();
  return async (request) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    const verified = await verifyAccessToken(match[1]!, key, ISSUER);
    if (!verified) return null;
    if (await isSessionRevoked(verified.id, verified.issuedAt)) return null;
    return findUserById(verified.id);
  };
}

export type LocalUser = typeof users.$inferSelect;
type UserLookup = (username: string) => Promise<LocalUser | null>;

export function createLocalAuthRoutes(findUser: UserLookup = async (username) => {
  const rows = await db.select().from(users).where(eq(users.email, username)).limit(2);
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
        await verifyPassword("$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8", body.password);
        const lockMs = recordFailure(attempt, now);
        if (lockMs > 0) { set.headers["retry-after"] = String(Math.ceil(lockMs / 1000)); return status(429, { error: "Too many login attempts; try again later", retryAfterSeconds: Math.ceil(lockMs / 1000) }); }
        return status(401, { error: "Invalid username or password" });
      }
      if (!isRole(row.role) || !await verifyPassword(row.passwordHash, body.password)) {
        const lockMs = recordFailure(attempt, now);
        if (lockMs > 0) { set.headers["retry-after"] = String(Math.ceil(lockMs / 1000)); return status(429, { error: "Too many login attempts; try again later", retryAfterSeconds: Math.ceil(lockMs / 1000) }); }
        return status(401, { error: "Invalid username or password" });
      }
      loginAttempts.delete(attempt);
      const token = await signAccessToken({ id: row.id, role: row.role }, key, ISSUER);
      return { accessToken: token, tokenType: "Bearer", expiresIn: 43200, id: row.id, name: String(row.displayName ?? row.email ?? row.id), role: row.role };    }, { body: t.Object({ username: t.String({ minLength: 1, maxLength: 190 }), password: t.String({ minLength: 1, maxLength: 200 }) }) });
}
