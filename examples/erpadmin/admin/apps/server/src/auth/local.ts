import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../schema";
import { isRole, signAccessToken, verifyAccessToken, verifyPassword } from "./password";
import type { Authenticator, Principal } from "./guard";

const ISSUER = "qiy-admin";
function secret(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for local password login");
  return value;
}

async function findUserById(id: string): Promise<Principal | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const row = rows[0];
  if (!row || typeof row.id !== "string" || !isRole(row.role)) return null;
  return { id: row.id, name: String(row.displayName ?? row.email ?? row.id), role: row.role };
}

export function createProductionAuthenticator(): Authenticator {
  const key = secret();
  return async (request) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    const verified = await verifyAccessToken(match[1]!, key, ISSUER);
    return verified ? findUserById(verified.id) : null;
  };
}

export type LocalUser = typeof users.$inferSelect;
type UserLookup = (username: string) => Promise<LocalUser | null>;

export function createLocalAuthRoutes(findUser: UserLookup = async (username) => {
  const rows = await db.select().from(users).where(eq(users.email, username)).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .post("/login", async ({ body, status }) => {
      const key = secret();
      const identifier = body.username.trim();
      if (!identifier || !body.password) return status(400, { error: "Username and password are required" });
      const row = await findUser(identifier);
      if (!row) {
        await verifyPassword("$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8", body.password);
        return status(401, { error: "Invalid username or password" });
      }
      if (!isRole(row.role) || !await verifyPassword(row.passwordHash, body.password)) return status(401, { error: "Invalid username or password" });
      const token = await signAccessToken({ id: row.id, role: row.role }, key, ISSUER);
      return { accessToken: token, tokenType: "Bearer", expiresIn: 43200, id: row.id, name: String(row.displayName ?? row.email ?? row.id), role: row.role };
    }, { body: t.Object({ username: t.String({ minLength: 1, maxLength: 190 }), password: t.String({ minLength: 1, maxLength: 200 }) }) });
}
