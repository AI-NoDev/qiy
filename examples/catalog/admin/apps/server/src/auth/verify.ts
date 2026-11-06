import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Authenticator, Principal } from "./guard";

export interface OidcOptions {
  issuer: string;
  audience: string;
  keySet: JWTVerifyGetKey;
  findUser(externalSubject: string): Promise<Record<string, unknown> | null>;
  roleField: string;
  /** Optional resolver for providers whose identity claim is not sub (for example openid). */
  subject?(payload: Record<string, unknown>): string | null;
}

const IGNORED_CLAIM_KEYS = new Set(["iss", "aud", "exp", "iat", "nbf", "jti", "sub"]);

/**
 * Flattens id_token claims into dotted keys so policies can address nested claims
 * (`org.id`) without knowing the token shape. Scalar claims keep their JSON type,
 * string arrays are preserved, and anything else (objects, mixed arrays) is
 * either recursed into or dropped rather than trusted.
 */
function flattenClaims(source: Record<string, unknown>, prefix = "", depth = 0): Array<[string, string | number | boolean | string[]]> {
  const entries: Array<[string, string | number | boolean | string[]]> = [];
  for (const [key, value] of Object.entries(source)) {
    if (depth === 0 && IGNORED_CLAIM_KEYS.has(key)) continue;
    const name = prefix ? prefix + "." + key : key;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      entries.push([name, value]);
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      entries.push([name, value as string[]]);
      continue;
    }
    if (value !== null && typeof value === "object" && depth < 2) entries.push(...flattenClaims(value as Record<string, unknown>, name, depth + 1));
  }
  return entries;
}

export function createOidcAuthenticator(options: OidcOptions): Authenticator {
  return async (request) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    const { payload } = await jwtVerify(match[1]!, options.keySet, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ["RS256", "ES256"],
    });
    const externalSubject = options.subject
      ? options.subject(payload as Record<string, unknown>)
      : payload.sub && payload.iss
        ? payload.iss + "|" + payload.sub
        : null;
    if (!externalSubject) return null;
    const user = await options.findUser(externalSubject);
    if (!user) return null;
    const role = user[options.roleField];
    if (role !== "admin" && role !== "operator" && role !== "viewer") return null;
    if (typeof user.id !== "string") return null;
    // Claims are exposed to generated policy code (data scopes, permission claim
    // sources). Nested claims are flattened to dotted keys; object claims are
    // never trusted through this surface.
    const claims = Object.fromEntries(flattenClaims(payload as Record<string, unknown>));
    return { id: user.id, name: String(user.displayName ?? user.email ?? user.id), role, ...(Object.keys(claims).length ? { claims } : {}) } satisfies Principal;
  };
}
