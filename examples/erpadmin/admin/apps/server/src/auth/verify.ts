import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Authenticator, Principal } from "./guard";

export interface OidcOptions {
  issuer: string;
  audience: string;
  keySet: JWTVerifyGetKey;
  findUser(externalSubject: string): Promise<Record<string, unknown> | null>;
  roleField: string;
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
    if (!payload.sub || !payload.iss) return null;
    const user = await options.findUser(payload.iss + "|" + payload.sub);
    if (!user) return null;
    const role = user[options.roleField];
    if (role !== "admin" && role !== "operator" && role !== "viewer") return null;
    if (typeof user.id !== "string") return null;
    const claims = Object.fromEntries(Object.entries(payload).filter(([key, value]) => key !== "iss" && key !== "aud" && key !== "exp" && key !== "iat" && key !== "nbf" && key !== "jti" && key !== "sub" && ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => [key, value as string | number | boolean]));
    return { id: user.id, name: String(user.displayName ?? user.email ?? user.id), role, ...(Object.keys(claims).length ? { claims } : {}) } satisfies Principal;
  };
}
