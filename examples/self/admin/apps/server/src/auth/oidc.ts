import { createRemoteJWKSet } from "jose";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { users } from "../schema";
import { createOidcAuthenticator } from "./verify";
import type { Authenticator } from "./guard";

export interface QiyOidcProviderConfig {
  id: string; label: string; issuer: string; audience: string; jwksUrl: string;
  authorizationUrl?: string; tokenUrl?: string; clientId?: string; scope: string; redirectUri?: string; logoutUrl?: string;
  subjectField?: string; claim?: string;
}

const providerIds = ["oidc","oauth2","sso","okta","auth0","azure-ad-b2c","keycloak","google","kinde"] as const;
const providerLabels: Record<string, string> = {"oidc":"OpenID Connect","oauth2":"OAuth2","sso":"SSO","okta":"Okta","auth0":"Auth0","azure-ad-b2c":"Azure AD B2C","keycloak":"Keycloak","google":"Google","kinde":"Kinde"};
const providerMappings: Record<string, { subjectField: string; claim?: string }> = {"google":{"subjectField":"googleSubject"},"oidc":{"subjectField":"openidField","claim":"openid"},"keycloak":{"subjectField":"keycloakSubject"}};
const defaultSubjectField: string = "subject";
function envSuffix(id: string): string { return id.toUpperCase().replace(/[^A-Z0-9]/g, "_"); }
function readEnv(name: string): string | undefined { const value = Bun.env[name]; return value && value.trim() !== "" ? value.trim() : undefined; }
function providerEnv(id: string, suffix: string): string | undefined { return readEnv("QIY_OIDC_" + envSuffix(id) + "_" + suffix); }

export function providerConfigs(): QiyOidcProviderConfig[] {
  return providerIds.flatMap((id) => {
    const issuer = providerEnv(id, "ISSUER");
    const audience = providerEnv(id, "AUDIENCE");
    const jwksUrl = providerEnv(id, "JWKS_URL");
    if (!issuer || !audience || !jwksUrl) return [];
    const mapping = providerMappings[id];
    return [{ id, label: providerLabels[id] ?? id, issuer, audience, jwksUrl,
      authorizationUrl: providerEnv(id, "AUTHORIZATION_URL"), tokenUrl: providerEnv(id, "TOKEN_URL"),
      clientId: providerEnv(id, "CLIENT_ID"), scope: providerEnv(id, "SCOPE") ?? "openid profile email",
      redirectUri: providerEnv(id, "REDIRECT_URI") ?? readEnv("QIY_OIDC_REDIRECT_URI"), logoutUrl: providerEnv(id, "LOGOUT_URL"),
      ...(mapping ? { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) } : {}) }];
  });
}

export function publicAuthProviders() {
  return providerConfigs().filter((config) => config.authorizationUrl && config.clientId).map((config) => ({
    id: config.id, label: config.label, authorizationUrl: config.authorizationUrl!, clientId: config.clientId!,
    tokenUrl: config.tokenUrl, scope: config.scope, redirectUri: config.redirectUri, ...(config.logoutUrl ? { logoutUrl: config.logoutUrl } : {}),
  }));
}

export function createAuthProviderRoutes() { return new Elysia({ prefix: "/api/v1/auth" }).get("/providers", () => ({ providers: publicAuthProviders() })); }

function positiveInteger(name: string, fallback: number, minimum: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(name + " must be an integer of at least " + minimum);
  return value;
}

export function createProductionAuthenticator(): Authenticator {
  const configs = providerConfigs();
  if (configs.length === 0) throw new Error("No OIDC provider is configured: set QIY_OIDC_<PROVIDER>_ISSUER, _AUDIENCE and _JWKS_URL (for example QIY_OIDC_GOOGLE_ISSUER)");
  const timeoutDuration = positiveInteger("QIY_OIDC_JWKS_TIMEOUT_MS", 5000, 1);
  const cooldownDuration = positiveInteger("QIY_OIDC_JWKS_COOLDOWN_MS", 30000, 0);
  const cacheMaxAge = positiveInteger("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", 600000, 1);
  const subjectColumns = users as unknown as Record<string, Parameters<typeof eq>[0]>;
  const authenticators = configs.map((config) => ({
    issuer: config.issuer.replace(/\/+$/, ""),
    authenticate: createOidcAuthenticator({ issuer: config.issuer, audience: config.audience,
      keySet: createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration, cooldownDuration, cacheMaxAge }), roleField: "role",
      ...(config.claim ? { subject: (payload: Record<string, unknown>) => typeof payload[config.claim!] === "string" && payload[config.claim!] !== "" ? String(payload[config.claim!]) : null } : config.subjectField ? { subject: (payload: Record<string, unknown>) => typeof payload.sub === "string" && payload.sub !== "" ? String(payload.sub) : null } : {}),
      async findUser(externalSubject) {
        const column = subjectColumns[config.subjectField ?? defaultSubjectField];
        const rows = await db.select().from(users).where(eq(column!, externalSubject)).limit(2);
        return rows.length === 1 ? rows[0]! : null;
      },
    }),
  }));
  // Route by the unverified issuer first, then verify only against that provider's JWKS.
  return async (request) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    let issuer: string | undefined;
    try { const payload = JSON.parse(Buffer.from(match[1]!.split(".")[1] ?? "", "base64url").toString()) as { iss?: string }; issuer = payload.iss; } catch { return null; }
    if (!issuer) return null;
    const normalized = issuer.replace(/\/+$/, "");
    const selected = authenticators.find((candidate) => candidate.issuer === normalized);
    if (!selected) return null;
    return selected.authenticate(request);
  };
}
