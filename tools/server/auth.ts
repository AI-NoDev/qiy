/**
 * Server renderers for multi-provider OIDC, hybrid local + OAuth sign-in,
 * account management and session revocation.
 */
import type { DatabaseIR } from "../database-ir";
import { authProviderLabel, authProviderSubjectField, type QiyProject } from "../qiy-project";
import { roleContext } from "../roles";
import { principalNameExpression } from "./shared";

export function renderMultiProviderOidcModule(auth: NonNullable<QiyProject["auth"]>): string {
  const providerIds = JSON.stringify(auth.providers ?? [auth.provider]);
  const labels = JSON.stringify(Object.fromEntries((auth.providers ?? [auth.provider]).map((provider) => [provider, authProviderLabel(auth, provider)])));
  const mappings = JSON.stringify(Object.fromEntries((auth.providerMappings ?? []).filter((mapping) => mapping.subjectField).map((mapping) => [mapping.provider, { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) }])));
  const roleField = JSON.stringify(auth.roleField);
  const defaultSubjectField = JSON.stringify(auth.subjectField);
  const userEntity = auth.userEntity;
  const lines: string[] = [];
  lines.push("import { createRemoteJWKSet } from \"jose\";");
  lines.push("import { eq } from \"drizzle-orm\";");
  lines.push("import { Elysia } from \"elysia\";");
  lines.push("import { db } from \"../db\";");
  lines.push("import { " + userEntity + " } from \"../schema\";");
  lines.push("import { createOidcAuthenticator } from \"./verify\";");
  lines.push("import type { Authenticator } from \"./guard\";");
  lines.push("");
  lines.push("export interface QiyOidcProviderConfig {");
  lines.push("  id: string; label: string; issuer: string; audience: string; jwksUrl: string;");
  lines.push("  authorizationUrl?: string; tokenUrl?: string; clientId?: string; scope: string; redirectUri?: string; logoutUrl?: string; clientSecret?: string;");
  lines.push("  subjectField?: string; claim?: string;");
  lines.push("}");
  lines.push("");
  lines.push("const providerIds = " + providerIds + " as const;");
  lines.push("const providerLabels: Record<string, string> = " + labels + ";");
  lines.push("const providerMappings: Record<string, { subjectField: string; claim?: string }> = " + mappings + ";");
  lines.push("const defaultSubjectField: string = " + defaultSubjectField + ";");
  lines.push("function envSuffix(id: string): string { return id.toUpperCase().replace(/[^A-Z0-9]/g, \"_\"); }");
  lines.push("function readEnv(name: string): string | undefined { const value = Bun.env[name]; return value && value.trim() !== \"\" ? value.trim() : undefined; }");
  lines.push("function providerEnv(id: string, suffix: string): string | undefined { return readEnv(\"QIY_OIDC_\" + envSuffix(id) + \"_\" + suffix); }");
  lines.push("");
  lines.push("export function providerConfigs(): QiyOidcProviderConfig[] {");
  lines.push("  return providerIds.flatMap((id) => {");
  lines.push("    const issuer = providerEnv(id, \"ISSUER\");");
  lines.push("    const audience = providerEnv(id, \"AUDIENCE\");");
  lines.push("    const jwksUrl = providerEnv(id, \"JWKS_URL\");");
  lines.push("    if (!issuer || !audience || !jwksUrl) return [];");
  lines.push("    const mapping = providerMappings[id];");
  lines.push("    return [{ id, label: providerLabels[id] ?? id, issuer, audience, jwksUrl,");
  lines.push("      authorizationUrl: providerEnv(id, \"AUTHORIZATION_URL\"), tokenUrl: providerEnv(id, \"TOKEN_URL\"),");
  lines.push("      clientId: providerEnv(id, \"CLIENT_ID\"), scope: providerEnv(id, \"SCOPE\") ?? \"openid profile email\",");
  lines.push("      redirectUri: providerEnv(id, \"REDIRECT_URI\") ?? readEnv(\"QIY_OIDC_REDIRECT_URI\"), logoutUrl: providerEnv(id, \"LOGOUT_URL\"),");
  lines.push("      clientSecret: providerEnv(id, \"CLIENT_SECRET\"),");
  lines.push("      ...(mapping ? { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) } : {}) }];");
  lines.push("  });");
  lines.push("}");
  lines.push("");
  lines.push("export function publicAuthProviders() {");
  lines.push("  return providerConfigs().filter((config) => config.authorizationUrl && config.clientId).map((config) => ({");
  lines.push("    id: config.id, label: config.label, authorizationUrl: config.authorizationUrl!, clientId: config.clientId!,");
  lines.push("    tokenUrl: config.tokenUrl, scope: config.scope, redirectUri: config.redirectUri, ...(config.logoutUrl ? { logoutUrl: config.logoutUrl } : {}),");
  lines.push("  }));");
  lines.push("}");
  lines.push("");
  lines.push("export function createAuthProviderRoutes() {");
  lines.push("  return new Elysia({ prefix: \"/api/v1/auth\" })");
  lines.push("    .get(\"/providers\", () => ({ providers: publicAuthProviders() }))");
  lines.push("    .post(\"/exchange\", async (context: any) => {");
  lines.push("      const { body, set } = context;");
  lines.push("      const input = (body ?? {}) as { provider?: string; code?: string; codeVerifier?: string; redirectUri?: string };");
  lines.push("      const config = input.provider ? providerConfigs().find((candidate) => candidate.id === input.provider) : undefined;");
  lines.push("      if (!config || !config.tokenUrl || !config.clientId || !input.code) { set.status = 400; return { error: \"invalid token exchange request\" }; }");
  lines.push("      const form = new URLSearchParams({ grant_type: \"authorization_code\", code: input.code, client_id: config.clientId, redirect_uri: input.redirectUri ?? config.redirectUri ?? \"\" });");
  lines.push("      if (input.codeVerifier) form.set(\"code_verifier\", input.codeVerifier);");
  lines.push("      if (config.clientSecret) form.set(\"client_secret\", config.clientSecret);");
  lines.push("      let response: Response;");
  lines.push("      try {");
  lines.push("        response = await fetch(config.tokenUrl, { method: \"POST\", headers: { \"Content-Type\": \"application/x-www-form-urlencoded\", Accept: \"application/json\" }, body: form.toString() });");
  lines.push("      } catch (error) { const reason = error instanceof Error ? error.message : String(error); set.status = 401; return { error: config.id + \": the token endpoint \" + config.tokenUrl + \" is unreachable (\" + reason + \"). If this host needs an HTTP proxy for outbound HTTPS, set HTTPS_PROXY.\" }; }");
  lines.push("      const raw = await response.text();");
  lines.push("      let tokens: { access_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string } | null = null;");
  lines.push("      try { tokens = raw ? JSON.parse(raw) as typeof tokens : null; } catch { tokens = null; }");
  lines.push("      const payload = tokens && typeof tokens === \"object\" ? tokens : {};");
  lines.push("      if (!response.ok || !payload.access_token) { const detail = [payload.error, payload.error_description].filter((value): value is string => typeof value === \"string\" && value !== \"\").join(\": \") || raw.slice(0, 300) || \"no access token\"; console.error(\"OIDC exchange failed for \" + config.id + \" (HTTP \" + response.status + \"): \" + detail); set.status = 401; return { error: config.id + \": HTTP \" + response.status + \" \" + detail }; }");
  lines.push("      return { access_token: payload.access_token, ...(payload.id_token ? { id_token: payload.id_token } : {}), ...(typeof payload.expires_in === \"number\" ? { expires_in: payload.expires_in } : {}) };");
  lines.push("    });");
  lines.push("}");
  lines.push("");
  lines.push("function positiveInteger(name: string, fallback: number, minimum: number): number {");
  lines.push("  const raw = Bun.env[name];");
  lines.push("  if (raw === undefined || raw === \"\") return fallback;");
  lines.push("  const value = Number(raw);");
  lines.push("  if (!Number.isInteger(value) || value < minimum) throw new Error(name + \" must be an integer of at least \" + minimum);");
  lines.push("  return value;");
  lines.push("}");
  lines.push("");
  lines.push("export function createProductionAuthenticator(): Authenticator {");
  lines.push("  const configs = providerConfigs();");
  lines.push("  if (configs.length === 0) throw new Error(\"No OIDC provider is configured: set QIY_OIDC_<PROVIDER>_ISSUER, _AUDIENCE and _JWKS_URL (for example QIY_OIDC_GOOGLE_ISSUER)\");");
  lines.push("  const timeoutDuration = positiveInteger(\"QIY_OIDC_JWKS_TIMEOUT_MS\", 5000, 1);");
  lines.push("  const cooldownDuration = positiveInteger(\"QIY_OIDC_JWKS_COOLDOWN_MS\", 30000, 0);");
  lines.push("  const cacheMaxAge = positiveInteger(\"QIY_OIDC_JWKS_CACHE_MAX_AGE_MS\", 600000, 1);");
  lines.push("  const subjectColumns = " + userEntity + " as unknown as Record<string, Parameters<typeof eq>[0]>;");
  lines.push("  const authenticators = configs.map((config) => ({");
  lines.push("    issuer: config.issuer.replace(/\\/+$/, \"\"),");
  lines.push("    authenticate: createOidcAuthenticator({ issuer: config.issuer, audience: config.audience,");
  lines.push("      keySet: createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration, cooldownDuration, cacheMaxAge }), roleField: " + roleField + ",");
  lines.push("      ...(config.claim ? { subject: (payload: Record<string, unknown>) => typeof payload[config.claim!] === \"string\" && payload[config.claim!] !== \"\" ? String(payload[config.claim!]) : null } : config.subjectField ? { subject: (payload: Record<string, unknown>) => typeof payload.sub === \"string\" && payload.sub !== \"\" ? String(payload.sub) : null } : {}),");
  lines.push("      async findUser(externalSubject) {");
  lines.push("        const column = subjectColumns[config.subjectField ?? defaultSubjectField];");
  lines.push("        const rows = await db.select().from(" + userEntity + ").where(eq(column!, externalSubject)).limit(2);");
  lines.push("        return rows.length === 1 ? rows[0]! : null;");
  lines.push("      },");
  lines.push("    }),");
  lines.push("  }));");
  lines.push("  // Route by the unverified issuer first, then verify only against that provider's JWKS.");
  lines.push("  return async (request) => {");
  lines.push("    const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get(\"authorization\") ?? \"\");");
  lines.push("    if (!match) return null;");
  lines.push("    let issuer: string | undefined;");
  lines.push("    try { const payload = JSON.parse(Buffer.from(match[1]!.split(\".\")[1] ?? \"\", \"base64url\").toString()) as { iss?: string }; issuer = payload.iss; } catch { return null; }");
  lines.push("    if (!issuer) return null;");
  lines.push("    const normalized = issuer.replace(/\\/+$/, \"\");");
  lines.push("    const selected = authenticators.find((candidate) => candidate.issuer === normalized);");
  lines.push("    if (!selected) return null;");
  lines.push("    return selected.authenticate(request);");
  lines.push("  };");
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * Composes the password authenticator and the OAuth provider authenticator into
 * one bearer authenticator for hybrid apps. Password (`qiy-admin` HS256) sessions
 * are checked first; provider tokens are routed by their `iss` claim.
 */
export function renderHybridAuthenticatorModule(): string {
  return `import { createProductionAuthenticator as createLocalAuthenticator } from "./local";
import { createProductionAuthenticator as createProviderAuthenticator } from "./oidc";
import type { Authenticator } from "./guard";

/**
 * Hybrid authentication: signed password sessions (issuer "qiy-admin") and
 * OAuth/OIDC provider tokens share one bearer authenticator. The provider side
 * only verifies tokens whose issuer matches a configured provider, so an
 * unknown or forged token is never accepted.
 */
export function createProductionAuthenticator(): Authenticator {
  const local = createLocalAuthenticator();
  const providers = createProviderAuthenticator();
  return async (request) => (await local(request)) ?? (await providers(request));
}
`;
}

/**
 * GET /api/v1/auth/identities: the signed-in account plus every configured
 * login method. Bind/unbind uses the per-provider subject columns as the binding
 * store, so this module only reads them (plus the optional profile metadata
 * column that remembers the email/name returned by the provider).
 */
export function renderAccountModule(auth: NonNullable<QiyProject["auth"]>, database: DatabaseIR): string {
  const user = database.entities.find((entity) => entity.name === auth.userEntity)!;
  const providerIdentities = (auth.providers ?? []).map((provider) => ({ id: provider, label: authProviderLabel(auth, provider), subjectField: authProviderSubjectField(auth, provider) }));
  const emailField = user.fields.some((field) => field.name === "email") && auth.usernameField !== "email" ? "email" : null;
  const displayNameField = ["displayName", "name"].find((name) => user.fields.some((field) => field.name === name)) ?? null;
  return `import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { revokeUserSessions } from "./session-revocations";
import type { Authenticator } from "./guard";

interface QiyProviderIdentitySummary { id: string; label: string; bound: boolean; subject?: string; email?: string; name?: string }
interface QiyProfileMetadata { email?: string; name?: string; sub?: string }

const providerIdentities: Array<{ id: string; label: string; subjectField: string }> = ${JSON.stringify(providerIdentities)};
const USERNAME_FIELD = ${JSON.stringify(auth.usernameField)};
const PASSWORD_FIELD = ${JSON.stringify(auth.passwordField)};
const ROLE_FIELD = ${JSON.stringify(auth.roleField)};
const PROFILE_FIELD: string | null = ${JSON.stringify(auth.profileField ?? null)};
const EMAIL_FIELD: string | null = ${JSON.stringify(emailField)};
const DISPLAY_NAME_FIELD: string | null = ${JSON.stringify(displayNameField)};

function readProfiles(record: Record<string, unknown>): Record<string, QiyProfileMetadata> {
  if (!PROFILE_FIELD) return {};
  const raw = record[PROFILE_FIELD];
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try { const parsed = JSON.parse(raw) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, QiyProfileMetadata> : {}; } catch { return {}; }
}

export function createAccountRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" }).get("/identities", async (context: any) => {
    const { request, set } = context;
    const principal = await authenticate(request);
    if (!principal) { set.status = 401; return { error: "Authentication required" }; }
    const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, principal.id)).limit(1);
    const row = rows[0];
    if (!row) { set.status = 401; return { error: "Unknown account" }; }
    const record = row as unknown as Record<string, unknown>;
    const profiles = readProfiles(record);
    const username = String(record[USERNAME_FIELD] ?? "");
    const email = EMAIL_FIELD ? String(record[EMAIL_FIELD] ?? username) : username;
    const name = DISPLAY_NAME_FIELD ? String(record[DISPLAY_NAME_FIELD] ?? username) : username;
    const passwordSet = Boolean(record[PASSWORD_FIELD]);
    const providers: QiyProviderIdentitySummary[] = providerIdentities.map((provider) => {
      const subject = record[provider.subjectField];
      const metadata = profiles[provider.id];
      return { id: provider.id, label: provider.label, bound: typeof subject === "string" && subject !== "", ...(typeof subject === "string" && subject !== "" ? { subject } : {}), ...(metadata?.email ? { email: metadata.email } : {}), ...(metadata?.name ? { name: metadata.name } : {}) };
    });
    const loginMethodCount = providers.filter((provider) => provider.bound).length + (passwordSet ? 1 : 0);
    return { user: { id: String(record.id), username, email, name, role: String(record[ROLE_FIELD] ?? "") }, password: { set: passwordSet }, providers, loginMethodCount };
  })
    .post("/logout-all", async (context: any) => {
      const { request, set } = context;
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const revokedBefore = await revokeUserSessions(principal.id);
      return { ok: true, revokedBefore: revokedBefore.toISOString() };
    });
}
`;
}

/**
 * Generated unit test for the onboarding-token contract. It does not need a
 * database or an identity provider, so it runs with the other generated tests.
 */
export function renderHybridAuthTest(auth: NonNullable<QiyProject["auth"]>): string {
  const provider = (auth.providers ?? ["oidc"])[0]!;
  return `import { expect, test } from "bun:test";
import { SignJWT } from "jose";
import { createOnboardingToken, readOnboardingToken } from "../src/auth/oidc";

const secret = "qiy-hybrid-auth-test-secret-value-at-least-32";

test("signs and verifies a short-lived provider onboarding token", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const token = await createOnboardingToken({ provider: ${JSON.stringify(provider)}, subject: "subject-1", username: "new@example.test", email: "new@example.test", name: "New User" });
  const claims = await readOnboardingToken(token);
  expect(claims.provider).toBe(${JSON.stringify(provider)});
  expect(claims.subject).toBe("subject-1");
  expect(claims.email).toBe("new@example.test");
});

test("rejects a tampered, expired or foreign onboarding token", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const token = await createOnboardingToken({ provider: ${JSON.stringify(provider)}, subject: "subject-1" });
  await expect(readOnboardingToken(token + "x")).rejects.toThrow();
  const foreign = await new SignJWT({ typ: "qiy-onboarding", provider: ${JSON.stringify(provider)}, identitySubject: "subject-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("qiy-admin").setAudience("qiy-admin").setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode("a-different-secret-that-is-long-enough-32"));
  await expect(readOnboardingToken(foreign)).rejects.toThrow();
  const expired = await new SignJWT({ typ: "qiy-onboarding", provider: ${JSON.stringify(provider)}, identitySubject: "subject-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("qiy-admin").setAudience("qiy-admin").setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 1800).sign(new TextEncoder().encode(secret));
  await expect(readOnboardingToken(expired)).rejects.toThrow();
});
`;
}

/**
 * Hybrid auth server module (`auth/oidc.ts` for a project that combines password
 * login with OAuth providers). It keeps the multi-provider configuration and
 * issuer routing, and adds:
 *  - POST /api/v1/auth/exchange  -> session token, or needsOnboarding + signed onboarding token
 *  - POST /api/v1/auth/oauth/register -> create the users row and sign in
 *  - POST /api/v1/auth/bind       -> link an additional provider to the current account
 *  - POST /api/v1/auth/unbind     -> remove a provider, refusing the last login method
 *  - GET  /api/v1/auth/providers  -> public provider list for the login page
 * Account reads live in ./account (GET /api/v1/auth/identities).
 */
export function renderHybridAuthModule(auth: NonNullable<QiyProject["auth"]>, database: DatabaseIR): string {
  const user = database.entities.find((entity) => entity.name === auth.userEntity)!;
  const providerIds = auth.providers ?? [];
  const mappings = Object.fromEntries((auth.providerMappings ?? [])
    .filter((mapping) => providerIds.includes(mapping.provider) && mapping.subjectField)
    .map((mapping) => [mapping.provider, { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) }]));
  const roleValues = database.enums?.find((item) => item.name === user.fields.find((field) => field.name === auth.roleField)?.enumName)?.values.map((item) => item.name);
  const emailField = user.fields.some((field) => field.name === "email") && auth.usernameField !== "email" ? "email" : null;
  const displayNameField = ["displayName", "name"].find((name) => user.fields.some((field) => field.name === name)) ?? null;
  const nameExpression = principalNameExpression(user, displayNameField ?? undefined, auth.usernameField);
  const labels = Object.fromEntries(providerIds.map((provider) => [provider, authProviderLabel(auth, provider)]));
  return `import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { createOidcAuthenticator } from "./verify";
import { hashPassword, isRole, signAccessToken, type Role } from "./password";
import type { Authenticator } from "./guard";

const ISSUER = "qiy-admin";
const TOKEN_TTL_SECONDS = 43200;
const ONBOARDING_TTL = "10m";
const DEFAULT_SUBJECT_FIELD = ${JSON.stringify(auth.subjectField)};
const USERNAME_FIELD = ${JSON.stringify(auth.usernameField)};
const PASSWORD_FIELD = ${JSON.stringify(auth.passwordField)};
const ROLE_FIELD = ${JSON.stringify(auth.roleField)};
const PROFILE_FIELD: string | null = ${JSON.stringify(auth.profileField ?? null)};
const EMAIL_FIELD: string | null = ${JSON.stringify(emailField)};
const DISPLAY_NAME_FIELD: string | null = ${JSON.stringify(displayNameField)};
const ALLOWED_ROLES: readonly string[] = ${JSON.stringify(roleValues ?? roleContext(auth).names)};
const DEFAULT_ROLE_ENV = "QIY_OIDC_DEFAULT_ROLE";

export interface QiyOidcProviderConfig {
  id: string; label: string; issuer: string; audience: string; jwksUrl: string;
  authorizationUrl?: string; tokenUrl?: string; clientId?: string; scope: string; redirectUri?: string; logoutUrl?: string; clientSecret?: string;
  subjectField?: string; claim?: string;
}

export interface QiyProviderIdentity { provider: string; subject: string; username?: string; email?: string; name?: string }
export interface QiyOnboardingClaims { provider: string; subject: string; username?: string; email?: string; name?: string }
interface QiyProviderTokens { accessToken?: string; idToken?: string }
interface QiyProfileMetadata { email?: string; name?: string; sub?: string }
type UserRow = typeof ${auth.userEntity}.$inferSelect;

const providerIds = ${JSON.stringify(providerIds)} as const;
const providerLabels: Record<string, string> = ${JSON.stringify(labels)};
const providerMappings: Record<string, { subjectField: string; claim?: string }> = ${JSON.stringify(mappings)};

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
      clientSecret: providerEnv(id, "CLIENT_SECRET"),
      ...(mapping ? { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) } : {}) }];
  });
}

export function publicAuthProviders() {
  return providerConfigs().filter((config) => config.authorizationUrl && config.clientId).map((config) => ({
    id: config.id, label: config.label, authorizationUrl: config.authorizationUrl!, clientId: config.clientId!,
    tokenUrl: config.tokenUrl, scope: config.scope, redirectUri: config.redirectUri, ...(config.logoutUrl ? { logoutUrl: config.logoutUrl } : {}),
  }));
}

function authSecret(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for hybrid password and OAuth authentication");
  return value;
}

/** Default role for accounts created through first-time OAuth onboarding. */
export function defaultRole(): Role {
  const configured = Bun.env[DEFAULT_ROLE_ENV]?.trim();
  const role = configured && configured !== "" ? configured : ${JSON.stringify(roleContext(auth).least)};
  if (!ALLOWED_ROLES.includes(role) || !isRole(role)) throw new Error(DEFAULT_ROLE_ENV + " must be one of " + ALLOWED_ROLES.join(", "));
  return role;
}

function positiveInteger(name: string, fallback: number, minimum: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(name + " must be an integer of at least " + minimum);
  return value;
}

const providerKeySets = new Map<string, JWTVerifyGetKey>();
function providerKeySet(config: QiyOidcProviderConfig): JWTVerifyGetKey {
  const existing = providerKeySets.get(config.id);
  if (existing) return existing;
  const keySet = createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: positiveInteger("QIY_OIDC_JWKS_TIMEOUT_MS", 5000, 1),
    cooldownDuration: positiveInteger("QIY_OIDC_JWKS_COOLDOWN_MS", 30000, 0),
    cacheMaxAge: positiveInteger("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", 600000, 1),
  });
  providerKeySets.set(config.id, keySet);
  return keySet;
}

function providerAudiences(config: QiyOidcProviderConfig): string[] {
  return [...new Set([config.audience, config.clientId].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function claimString(payload: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) { const value = payload[name]; if (typeof value === "string" && value.trim() !== "") return value.trim(); }
  return undefined;
}

/** Matches ./verify: a mapped provider uses sub (or its claim); an unmapped provider uses issuer|sub. */
function mappedSubject(config: QiyOidcProviderConfig, payload: Record<string, unknown>): string | null {
  if (config.claim) { const value = payload[config.claim]; return typeof value === "string" && value !== "" ? value : null; }
  if (config.subjectField) return typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : null;
  return typeof payload.sub === "string" && payload.sub !== "" && typeof payload.iss === "string" ? payload.iss + "|" + payload.sub : null;
}

function identityFromPayload(config: QiyOidcProviderConfig, payload: Record<string, unknown>): QiyProviderIdentity | null {
  const subject = mappedSubject(config, payload);
  if (!subject) return null;
  const username = claimString(payload, ["preferred_username", "username", "email"]);
  const email = claimString(payload, ["email"]);
  const name = claimString(payload, ["name", "display_name", "preferred_username", "given_name"]);
  return { provider: config.id, subject, ...(username ? { username } : {}), ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

async function exchangeAuthorizationCode(config: QiyOidcProviderConfig, input: { code: string; codeVerifier?: string; redirectUri?: string }): Promise<QiyProviderTokens> {
  if (!config.tokenUrl || !config.clientId) throw new Error("The provider token endpoint and client id are required");
  const form = new URLSearchParams({ grant_type: "authorization_code", code: input.code, client_id: config.clientId, redirect_uri: input.redirectUri ?? config.redirectUri ?? "" });
  if (input.codeVerifier) form.set("code_verifier", input.codeVerifier);
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  let response: Response;
  try {
    response = await fetch(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
  } catch (error) {
    // Outbound HTTPS to an identity provider often needs an explicit proxy on
    // developer machines and locked-down hosts; say so instead of hiding it.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(config.id + ": the token endpoint " + config.tokenUrl + " is unreachable (" + reason + "). If this host needs an HTTP proxy for outbound HTTPS, set HTTPS_PROXY.");
  }
  const raw = await response.text();
  let tokens: { access_token?: string; id_token?: string; error?: string; error_description?: string } | null = null;
  try { tokens = raw ? JSON.parse(raw) as typeof tokens : null; } catch { tokens = null; }
  const payload: { access_token?: string; id_token?: string; error?: string; error_description?: string } = tokens && typeof tokens === "object" ? tokens : {};
  if (!response.ok || !payload.access_token) {
    const detail = [payload.error, payload.error_description].filter((value): value is string => typeof value === "string" && value !== "").join(": ") || raw.slice(0, 300) || "no access token";
    console.error("OIDC exchange failed for " + config.id + " (HTTP " + response.status + "): " + detail);
    throw new Error(config.id + ": HTTP " + response.status + " " + detail);
  }
  return { accessToken: payload.access_token, ...(payload.id_token ? { idToken: payload.id_token } : {}) };
}

async function resolveProviderIdentity(config: QiyOidcProviderConfig, tokens: QiyProviderTokens): Promise<QiyProviderIdentity> {
  const candidates = [tokens.idToken, tokens.accessToken].filter((value): value is string => typeof value === "string" && value.length > 0);
  let failure = "the identity provider did not return a verifiable token";
  for (const token of candidates) {
    try {
      const { payload } = await jwtVerify(token, providerKeySet(config), { issuer: config.issuer, audience: providerAudiences(config), algorithms: ["RS256", "ES256"] });
      const identity = identityFromPayload(config, payload as Record<string, unknown>);
      if (identity) return identity;
      failure = "the identity provider token did not contain an identity subject";
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  }
  throw new Error("The identity provider token could not be verified: " + failure);
}

function userColumn(name: string): Parameters<typeof eq>[0] | undefined {
  return (${auth.userEntity} as unknown as Record<string, Parameters<typeof eq>[0]>)[name];
}

async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1);
  return rows[0] ?? null;
}

async function findUserBySubject(config: QiyOidcProviderConfig, subject: string): Promise<UserRow | null> {
  const columnName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
  const column = userColumn(columnName);
  if (!column) throw new Error("Auth mapping references an unknown user field: " + columnName);
  const rows = await db.select().from(${auth.userEntity}).where(eq(column, subject)).limit(2);
  return rows.length === 1 ? rows[0] ?? null : null;
}

function roleOf(row: UserRow): Role {
  const role = (row as unknown as Record<string, unknown>)[ROLE_FIELD];
  if (!isRole(role)) throw new Error("The user account has an invalid role");
  return role;
}

function readProfiles(row: UserRow): Record<string, QiyProfileMetadata> {
  if (!PROFILE_FIELD) return {};
  const raw = (row as unknown as Record<string, unknown>)[PROFILE_FIELD];
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try { const parsed = JSON.parse(raw) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, QiyProfileMetadata> : {}; } catch { return {}; }
}

function profileMetadata(identity: QiyProviderIdentity): QiyProfileMetadata {
  return { ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}), sub: identity.subject };
}

async function issueSession(row: UserRow) {
  const role = roleOf(row);
  return {
    accessToken: await signAccessToken({ id: row.id, role }, authSecret(), ISSUER),
    tokenType: "Bearer" as const,
    expiresIn: TOKEN_TTL_SECONDS,
    user: { id: row.id, name: ${nameExpression}, role },
  };
}

/** Short-lived signed token that lets a verified provider identity finish registration. */
export async function createOnboardingToken(identity: QiyProviderIdentity): Promise<string> {
  return await new SignJWT({ typ: "qiy-onboarding", provider: identity.provider, identitySubject: identity.subject, ...(identity.username ? { username: identity.username } : {}), ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.provider + ":" + identity.subject)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ONBOARDING_TTL)
    .sign(new TextEncoder().encode(authSecret()));
}

export async function readOnboardingToken(token: string): Promise<QiyOnboardingClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(authSecret()), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] });
  if (payload.typ !== "qiy-onboarding" || typeof payload.provider !== "string" || typeof payload.identitySubject !== "string") throw new Error("Invalid or expired onboarding token");
  return {
    provider: payload.provider,
    subject: payload.identitySubject,
    ...(typeof payload.username === "string" && payload.username !== "" ? { username: payload.username } : {}),
    ...(typeof payload.email === "string" && payload.email !== "" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" && payload.name !== "" ? { name: payload.name } : {}),
  };
}

function validEmail(value: string): boolean { return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value); }

export function createProductionAuthenticator(): Authenticator {
  const configs = providerConfigs();
  if (configs.length === 0) return async () => null;
  const authenticators = configs.map((config) => ({
    issuer: config.issuer.replace(/\\/+$/, ""),
    authenticate: createOidcAuthenticator({ issuer: config.issuer, audience: config.audience,
      keySet: providerKeySet(config), roleField: ROLE_FIELD,
      ...(config.claim ? { subject: (payload: Record<string, unknown>) => typeof payload[config.claim!] === "string" && payload[config.claim!] !== "" ? String(payload[config.claim!]) : null } : config.subjectField ? { subject: (payload: Record<string, unknown>) => typeof payload.sub === "string" && payload.sub !== "" ? String(payload.sub) : null } : {}),
      async findUser(externalSubject) {
        const column = userColumn(config.subjectField ?? DEFAULT_SUBJECT_FIELD);
        if (!column) throw new Error("Auth mapping references an unknown user field: " + (config.subjectField ?? DEFAULT_SUBJECT_FIELD));
        const rows = await db.select().from(${auth.userEntity}).where(eq(column, externalSubject)).limit(2);
        return rows.length === 1 ? rows[0]! : null;
      },
    }),
  }));
  // Password sessions use the "qiy-admin" issuer and are handled by ./local;
  // provider tokens are routed by their unverified issuer first and then verified
  // against that provider's JWKS only.
  return async (request) => {
    const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    let issuer: string | undefined;
    try { const payload = JSON.parse(Buffer.from(match[1]!.split(".")[1] ?? "", "base64url").toString()) as { iss?: string }; issuer = payload.iss; } catch { return null; }
    if (!issuer) return null;
    const normalized = issuer.replace(/\\/+$/, "");
    if (normalized === ISSUER) return null;
    const selected = authenticators.find((candidate) => candidate.issuer === normalized);
    if (!selected) return null;
    try { return await selected.authenticate(request); } catch { return null; }
  };
}

function providerForRequest(provider: string | undefined): QiyOidcProviderConfig | undefined {
  return provider ? providerConfigs().find((candidate) => candidate.id === provider) : undefined;
}

export function createHybridAuthRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .get("/providers", () => ({ providers: publicAuthProviders(), local: true }))
    .post("/exchange", async (context: any) => {
      const { body, set } = context;
      const input = (body ?? {}) as { provider?: string; code?: string; codeVerifier?: string; redirectUri?: string };
      const config = providerForRequest(input.provider);
      if (!config || !config.tokenUrl || !config.clientId || typeof input.code !== "string" || input.code === "") { set.status = 400; return { error: "invalid token exchange request" }; }
      let identity: QiyProviderIdentity;
      try {
        identity = await resolveProviderIdentity(config, await exchangeAuthorizationCode(config, { code: input.code, ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}), ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) }));
      } catch (error) { set.status = 401; return { error: error instanceof Error ? error.message : "The provider token exchange failed" }; }
      const existing = await findUserBySubject(config, identity.subject);
      if (existing) return await issueSession(existing);
      return {
        needsOnboarding: true,
        onboardingToken: await createOnboardingToken(identity),
        provider: { id: config.id, label: config.label },
        profile: { sub: identity.subject, ...(identity.username ? { username: identity.username } : {}), ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}) },
      };
    })
    .post("/oauth/register", async (context: any) => {
      const { body, set } = context;
      const input = (body ?? {}) as { onboardingToken?: string; username?: string; email?: string; password?: string };
      const token = typeof input.onboardingToken === "string" ? input.onboardingToken : "";
      const username = typeof input.username === "string" ? input.username.trim() : "";
      const email = typeof input.email === "string" ? input.email.trim() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (!token || !username || !password) { set.status = 400; return { error: "An onboarding token, username and password are required" }; }
      let claims: QiyOnboardingClaims;
      try { claims = await readOnboardingToken(token); } catch { set.status = 401; return { error: "The onboarding session is invalid or has expired. Start the provider sign-in again." }; }
      const config = providerForRequest(claims.provider);
      if (!config) { set.status = 400; return { error: "The identity provider is no longer configured" }; }
      if (USERNAME_FIELD === "email" && !validEmail(username)) { set.status = 400; return { error: "Enter a valid email address" }; }
      const subjectFieldName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
      if (await findUserBySubject(config, claims.subject)) { set.status = 409; return { error: "This identity is already registered. Sign in with that provider instead." }; }
      const usernameColumn = userColumn(USERNAME_FIELD);
      if (!usernameColumn) { set.status = 500; return { error: "The generated auth configuration is missing its username field" }; }
      if ((await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(usernameColumn, username)).limit(1)).length > 0) { set.status = 409; return { error: "That " + USERNAME_FIELD + " is already registered" }; }
      const emailValue = email || username;
      if (EMAIL_FIELD === "email" && !validEmail(emailValue)) { set.status = 400; return { error: "Enter a valid email address" }; }
      if (EMAIL_FIELD) {
        const emailColumn = userColumn(EMAIL_FIELD);
        if (emailColumn && (await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(emailColumn, emailValue)).limit(1)).length > 0) { set.status = 409; return { error: "That email is already registered" }; }
      }
      let passwordHash: string;
      try { passwordHash = await hashPassword(password); } catch (error) { set.status = 400; return { error: error instanceof Error ? error.message : "Password must be at least 8 characters" }; }
      const role = defaultRole();
      const id = crypto.randomUUID();
      const displayName = claims.name && claims.name.trim() !== "" ? claims.name.trim() : username;
      const values: Record<string, unknown> = {
        id,
        [USERNAME_FIELD]: username,
        [PASSWORD_FIELD]: passwordHash,
        [ROLE_FIELD]: role,
        [DEFAULT_SUBJECT_FIELD]: claims.provider + ":" + claims.subject,
        [subjectFieldName]: claims.subject,
      };
      if (EMAIL_FIELD) values[EMAIL_FIELD] = emailValue;
      if (DISPLAY_NAME_FIELD) values[DISPLAY_NAME_FIELD] = displayName;
      if (PROFILE_FIELD) values[PROFILE_FIELD] = JSON.stringify({ [claims.provider]: profileMetadata({ provider: claims.provider, subject: claims.subject, ...(claims.username ? { username: claims.username } : {}), ...(claims.email ? { email: claims.email } : {}), ...(claims.name ? { name: claims.name } : {}) }) });
      try {
        await db.insert(${auth.userEntity}).values(values as typeof ${auth.userEntity}.$inferInsert);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unique|duplicate/i.test(message)) { set.status = 409; return { error: "That account already exists. Sign in or bind the provider from your profile." }; }
        console.error("OAuth onboarding failed", error);
        set.status = 500;
        return { error: "Could not create the account" };
      }
      return {
        accessToken: await signAccessToken({ id, role }, authSecret(), ISSUER),
        tokenType: "Bearer" as const,
        expiresIn: TOKEN_TTL_SECONDS,
        user: { id, name: displayName, role },
      };
    })
    .post("/bind", async (context: any) => {
      const { body, request, set } = context;
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const input = (body ?? {}) as { provider?: string; code?: string; codeVerifier?: string; redirectUri?: string; onboardingToken?: string };
      let config: QiyOidcProviderConfig | undefined;
      let identity: QiyProviderIdentity | undefined;
      try {
        if (typeof input.onboardingToken === "string" && input.onboardingToken !== "") {
          const claims = await readOnboardingToken(input.onboardingToken);
          config = providerForRequest(claims.provider);
          identity = { provider: claims.provider, subject: claims.subject, ...(claims.username ? { username: claims.username } : {}), ...(claims.email ? { email: claims.email } : {}), ...(claims.name ? { name: claims.name } : {}) };
        } else {
          config = providerForRequest(input.provider);
          if (!config || typeof input.code !== "string" || input.code === "") { set.status = 400; return { error: "invalid provider link request" }; }
          identity = await resolveProviderIdentity(config, await exchangeAuthorizationCode(config, { code: input.code, ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}), ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) }));
        }
      } catch (error) { set.status = 401; return { error: error instanceof Error ? error.message : "Could not verify the provider identity" }; }
      if (!config || !identity) { set.status = 400; return { error: "invalid provider link request" }; }
      const subjectFieldName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
      const existing = await findUserBySubject(config, identity.subject);
      if (existing && existing.id !== principal.id) { set.status = 409; return { error: "This " + config.label + " identity is already linked to another account" }; }
      const row = await findUserById(principal.id);
      if (!row) { set.status = 401; return { error: "Unknown account" }; }
      const values: Record<string, unknown> = { [subjectFieldName]: identity.subject };
      if (PROFILE_FIELD) { const profiles = readProfiles(row); profiles[config.id] = profileMetadata(identity); values[PROFILE_FIELD] = JSON.stringify(profiles); }
      await db.update(${auth.userEntity}).set(values as Partial<typeof ${auth.userEntity}.$inferInsert>).where(eq(${auth.userEntity}.id, principal.id));
      return { ok: true, provider: config.id, label: config.label, bound: true };
    })
    .post("/unbind", async (context: any) => {
      const { body, request, set } = context;
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const input = (body ?? {}) as { provider?: string };
      const config = providerForRequest(input.provider);
      if (!config) { set.status = 400; return { error: "Unknown identity provider" }; }
      const row = await findUserById(principal.id);
      if (!row) { set.status = 401; return { error: "Unknown account" }; }
      const record = row as unknown as Record<string, unknown>;
      const subjectFieldName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
      if (typeof record[subjectFieldName] !== "string" || record[subjectFieldName] === "") { set.status = 400; return { error: config.label + " is not linked to your account" }; }
      const hasPassword = Boolean(record[PASSWORD_FIELD]);
      const otherBindings = providerConfigs().filter((candidate) => candidate.id !== config.id && Boolean(record[candidate.subjectField ?? DEFAULT_SUBJECT_FIELD]));
      if (!hasPassword && otherBindings.length === 0) { set.status = 409; return { error: "Cannot remove the last login method. Set a password or link another provider first." }; }
      const values: Record<string, unknown> = { [subjectFieldName]: null };
      if (PROFILE_FIELD) { const profiles = readProfiles(row); delete profiles[config.id]; values[PROFILE_FIELD] = JSON.stringify(profiles); }
      await db.update(${auth.userEntity}).set(values as Partial<typeof ${auth.userEntity}.$inferInsert>).where(eq(${auth.userEntity}.id, principal.id));
      return { ok: true, provider: config.id, label: config.label, bound: false };
    });
}
`;
}

/** DDL-neutral `qiy_session_revocations` table for local-auth token revocation. */
export function renderSessionRevocationSchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const string = (name: string, length?: number) => dialect === "mysql" ? `varchar(${JSON.stringify(name)}, { length: ${length ?? 255} })` : `text(${JSON.stringify(name)})`;
  const timestamp = (name: string) => dialect === "postgresql" ? `timestamp(${JSON.stringify(name)}, { withTimezone: true })` : dialect === "sqlite" ? `integer(${JSON.stringify(name)}, { mode: "timestamp_ms" })` : `datetime(${JSON.stringify(name)}, { mode: "date", fsp: 3 })`;
  return `\n\nexport const qiySessionRevocations = ${table}("qiy_session_revocations", {\n  userId: ${string("userId", 36)}.primaryKey(),\n  revokedBefore: ${timestamp("revokedBefore")}.notNull(),\n});\n`;
}
