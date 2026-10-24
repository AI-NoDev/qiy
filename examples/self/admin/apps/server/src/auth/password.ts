import { jwtVerify, SignJWT } from "jose";

const ROLES = ["admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Qiy stores password hashes produced by `Bun.password.hash(password, { algorithm: "argon2id" })`.
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

export async function verifyAccessToken(token: string, secret: string, issuer: string): Promise<{ id: string; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer, audience: issuer, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !isRole(payload.role)) return null;
    return { id: payload.sub, role: payload.role };
  } catch { return null; }
}
