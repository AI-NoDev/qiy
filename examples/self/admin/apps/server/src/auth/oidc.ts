import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { users } from "../schema";
import { createOidcAuthenticator } from "./verify";
import { hashPassword, isRole, signAccessToken, type Role } from "./password";
import type { Authenticator } from "./guard";

const ISSUER = "qiy-admin";
const TOKEN_TTL_SECONDS = 43200;
const ONBOARDING_TTL = "10m";
const DEFAULT_SUBJECT_FIELD = "subject";
const USERNAME_FIELD = "email";
const PASSWORD_FIELD = "passwordHash";
const ROLE_FIELD = "role";
const PROFILE_FIELD: string | null = "oauthProfiles";
const EMAIL_FIELD: string | null = null;
const DISPLAY_NAME_FIELD: string | null = "displayName";
const ALLOWED_ROLES: readonly string[] = ["admin","operator","viewer"];
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
type UserRow = typeof users.$inferSelect;

const providerIds = ["okta","keycloak","google","kinde","azure-ad-b2c"] as const;
const providerLabels: Record<string, string> = {"okta":"Okta","keycloak":"Keycloak","google":"Google","kinde":"Kinde","azure-ad-b2c":"Azure AD B2C"};
const providerMappings: Record<string, { subjectField: string; claim?: string }> = {"okta":{"subjectField":"oktaSubject"},"keycloak":{"subjectField":"keycloakSubject"},"google":{"subjectField":"googleSubject"},"kinde":{"subjectField":"kindeSubject"},"azure-ad-b2c":{"subjectField":"azureSubject"}};

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
  const role = configured && configured !== "" ? configured : "viewer";
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
  const tokens = (await response.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!response.ok || !tokens.access_token) {
    const detail = [tokens.error, tokens.error_description].filter((value): value is string => typeof value === "string" && value !== "").join(": ");
    console.error("OIDC exchange failed for " + config.id + " (HTTP " + response.status + "): " + (detail || "no access token"));
    throw new Error(config.id + ": " + (detail || "the provider token exchange failed"));
  }
  return { accessToken: tokens.access_token, ...(tokens.id_token ? { idToken: tokens.id_token } : {}) };
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
  return (users as unknown as Record<string, Parameters<typeof eq>[0]>)[name];
}

async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

async function findUserBySubject(config: QiyOidcProviderConfig, subject: string): Promise<UserRow | null> {
  const columnName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
  const column = userColumn(columnName);
  if (!column) throw new Error("Auth mapping references an unknown user field: " + columnName);
  const rows = await db.select().from(users).where(eq(column, subject)).limit(2);
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
    user: { id: row.id, name: String(row.displayName ?? row.email ?? row.id), role },
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

function validEmail(value: string): boolean { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value); }

export function createProductionAuthenticator(): Authenticator {
  const configs = providerConfigs();
  if (configs.length === 0) return async () => null;
  const authenticators = configs.map((config) => ({
    issuer: config.issuer.replace(/\/+$/, ""),
    authenticate: createOidcAuthenticator({ issuer: config.issuer, audience: config.audience,
      keySet: providerKeySet(config), roleField: ROLE_FIELD,
      ...(config.claim ? { subject: (payload: Record<string, unknown>) => typeof payload[config.claim!] === "string" && payload[config.claim!] !== "" ? String(payload[config.claim!]) : null } : config.subjectField ? { subject: (payload: Record<string, unknown>) => typeof payload.sub === "string" && payload.sub !== "" ? String(payload.sub) : null } : {}),
      async findUser(externalSubject) {
        const column = userColumn(config.subjectField ?? DEFAULT_SUBJECT_FIELD);
        if (!column) throw new Error("Auth mapping references an unknown user field: " + (config.subjectField ?? DEFAULT_SUBJECT_FIELD));
        const rows = await db.select().from(users).where(eq(column, externalSubject)).limit(2);
        return rows.length === 1 ? rows[0]! : null;
      },
    }),
  }));
  // Password sessions use the "qiy-admin" issuer and are handled by ./local;
  // provider tokens are routed by their unverified issuer first and then verified
  // against that provider's JWKS only.
  return async (request) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    let issuer: string | undefined;
    try { const payload = JSON.parse(Buffer.from(match[1]!.split(".")[1] ?? "", "base64url").toString()) as { iss?: string }; issuer = payload.iss; } catch { return null; }
    if (!issuer) return null;
    const normalized = issuer.replace(/\/+$/, "");
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
      if ((await db.select({ id: users.id }).from(users).where(eq(usernameColumn, username)).limit(1)).length > 0) { set.status = 409; return { error: "That " + USERNAME_FIELD + " is already registered" }; }
      const emailValue = email || username;
      if (EMAIL_FIELD === "email" && !validEmail(emailValue)) { set.status = 400; return { error: "Enter a valid email address" }; }
      if (EMAIL_FIELD) {
        const emailColumn = userColumn(EMAIL_FIELD);
        if (emailColumn && (await db.select({ id: users.id }).from(users).where(eq(emailColumn, emailValue)).limit(1)).length > 0) { set.status = 409; return { error: "That email is already registered" }; }
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
        await db.insert(users).values(values as typeof users.$inferInsert);
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
      await db.update(users).set(values as Partial<typeof users.$inferInsert>).where(eq(users.id, principal.id));
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
      await db.update(users).set(values as Partial<typeof users.$inferInsert>).where(eq(users.id, principal.id));
      return { ok: true, provider: config.id, label: config.label, bound: false };
    });
}
