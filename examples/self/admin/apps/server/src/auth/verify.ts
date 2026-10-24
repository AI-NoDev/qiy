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
    // sources). Scalar claims keep their JSON type and string arrays are
    // preserved; object claims are never trusted through this surface.
    const claims = Object.fromEntries(Object.entries(payload).filter(([key, value]) => key !== "iss" && key !== "aud" && key !== "exp" && key !== "iat" && key !== "nbf" && key !== "jti" && key !== "sub" && (["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((entry) => typeof entry === "string")))).map(([key, value]) => [key, value as string | number | boolean | string[]]));
    return { id: user.id, name: String(user.displayName ?? user.email ?? user.id), role, ...(Object.keys(claims).length ? { claims } : {}) } satisfies Principal;
  };
}
