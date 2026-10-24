import { randomBytes } from "node:crypto";
import type { DatabaseIR } from "./database-ir";
import type { QiyEnvironmentVariable, QiyProject } from "./qiy-project";
import { authHasLocal, authIsHybrid, authOAuthProviders, authUsesProviderChooser, type QiyAuthProvider } from "./qiy-project";

type Mode = "development" | "production" | "example";
type EnvOptions = Pick<QiyProject, "apiClient" | "corsOrigins" | "elysiaPlugins" | "realtime" | "storageProvider" | "auth" | "environment">;

const generatedSecret = "__QIY_GENERATE_SECRET__";
const isOidcAuth = (provider: NonNullable<QiyProject["auth"]>["provider"]): boolean => provider !== "local" && provider !== "otp";

/** Env suffix used by the generated per-provider OIDC configuration (okta -> OKTA). */
export function providerEnvSuffix(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function providerOidcExample(provider: QiyAuthProvider): { issuer: string; jwksUrl: string; authorizationUrl: string; tokenUrl: string } {
  const sample = oidcExample(provider);
  return {
    issuer: `https://${provider}.example.com/`,
    jwksUrl: `https://${provider}.example.com/.well-known/jwks.json`,
    authorizationUrl: sample.authorizationUrl,
    tokenUrl: sample.tokenUrl,
  };
}

function oidcExample(provider: NonNullable<QiyProject["auth"]>["provider"]): { authorizationUrl: string; tokenUrl: string; logoutUrl: string } {
  if (provider === "google") return { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", logoutUrl: "" };
  if (provider === "auth0") return { authorizationUrl: "https://YOUR_TENANT.auth0.com/authorize", tokenUrl: "https://YOUR_TENANT.auth0.com/oauth/token", logoutUrl: "https://YOUR_TENANT.auth0.com/v2/logout" };
  if (provider === "okta") return { authorizationUrl: "https://YOUR_OKTA_DOMAIN/oauth2/default/v1/authorize", tokenUrl: "https://YOUR_OKTA_DOMAIN/oauth2/default/v1/token", logoutUrl: "https://YOUR_OKTA_DOMAIN/oauth2/default/v1/logout" };
  if (provider === "azure-ad-b2c") return { authorizationUrl: "https://YOUR_TENANT.b2clogin.com/YOUR_TENANT.onmicrosoft.com/YOUR_POLICY/oauth2/v2.0/authorize", tokenUrl: "https://YOUR_TENANT.b2clogin.com/YOUR_TENANT.onmicrosoft.com/YOUR_POLICY/oauth2/v2.0/token", logoutUrl: "https://YOUR_TENANT.b2clogin.com/YOUR_TENANT.onmicrosoft.com/YOUR_POLICY/oauth2/v2.0/logout" };
  if (provider === "keycloak") return { authorizationUrl: "https://identity.example.com/realms/YOUR_REALM/protocol/openid-connect/auth", tokenUrl: "https://identity.example.com/realms/YOUR_REALM/protocol/openid-connect/token", logoutUrl: "https://identity.example.com/realms/YOUR_REALM/protocol/openid-connect/logout" };
  if (provider === "kinde") return { authorizationUrl: "https://YOUR_SUBDOMAIN.kinde.com/oauth2/auth", tokenUrl: "https://YOUR_SUBDOMAIN.kinde.com/oauth2/token", logoutUrl: "https://YOUR_SUBDOMAIN.kinde.com/logout" };
  return { authorizationUrl: "https://identity.example.com/oauth2/authorize", tokenUrl: "https://identity.example.com/oauth2/token", logoutUrl: "https://identity.example.com/logout" };
}

function databaseUrl(database: DatabaseIR): string {
  if (database.dialect === "sqlite") return "./qiy.sqlite";
  if (database.dialect === "mysql") return "mysql://qiy:qiy@127.0.0.1:3306/qiy";
  return "postgres://qiy:qiy@127.0.0.1:5432/qiy";
}

function defaults(database: DatabaseIR, options: EnvOptions, mode: Mode): Map<string, string> {
  const development = mode === "development";
  const example = mode === "example";
  const sampleDatabaseUrl = databaseUrl(database)
    .replace("qiy:qiy", "USER:PASSWORD")
    .replace("127.0.0.1", "db.example.com");
  const values = new Map<string, string>([
    ["DATABASE_URL", development ? databaseUrl(database) : example ? sampleDatabaseUrl : ""],
    ["HOST", development ? "127.0.0.1" : "0.0.0.0"],
    ["PORT", "3000"],
    ["QIY_DEV_MODE", development && !options.auth ? "1" : "0"],
    ["QIY_STORAGE_METADATA", "database"],
    ["QIY_STORAGE_PROVIDER", options.storageProvider ?? "local"],
    ["QIY_STORAGE_ROOT", "./storage"],
  ]);
  const auth = options.auth;
  const oauthProviders = auth ? authOAuthProviders(auth) : [];
  const providerChooser = Boolean(auth && authUsesProviderChooser(auth));
  if (auth && authHasLocal(auth)) values.set("QIY_AUTH_SECRET", development ? generatedSecret : "");
  if (auth?.provider === "otp") {
    values.set("QIY_OTP_DELIVERY_URL", "");
    values.set("QIY_OTP_DELIVERY_TOKEN", "");
    values.set("QIY_OTP_DELIVERY_TIMEOUT_MS", "10000");
    values.set("QIY_OTP_DEV_CODE", development ? "246810" : "");
  }
  if (auth && oauthProviders.length > 0) {
    values.set("QIY_OIDC_JWKS_TIMEOUT_MS", "5000");
    values.set("QIY_OIDC_JWKS_COOLDOWN_MS", "30000");
    values.set("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", "600000");
  }
  if (auth && providerChooser) {
    // Multi-provider and hybrid projects read one QIY_OIDC_<PROVIDER>_* block per
    // configured provider; the public login page lists only blocks that are set.
    for (const provider of oauthProviders) {
      const suffix = providerEnvSuffix(provider);
      const sample = providerOidcExample(provider);
      values.set(`QIY_OIDC_${suffix}_ISSUER`, example ? sample.issuer : "");
      values.set(`QIY_OIDC_${suffix}_AUDIENCE`, example ? "qiy-admin" : "");
      values.set(`QIY_OIDC_${suffix}_JWKS_URL`, example ? sample.jwksUrl : "");
      values.set(`QIY_OIDC_${suffix}_AUTHORIZATION_URL`, example ? sample.authorizationUrl : "");
      values.set(`QIY_OIDC_${suffix}_TOKEN_URL`, example ? sample.tokenUrl : "");
      values.set(`QIY_OIDC_${suffix}_CLIENT_ID`, example ? "qiy-admin-spa" : "");
      values.set(`QIY_OIDC_${suffix}_SCOPE`, "openid profile email");
      values.set(`QIY_OIDC_${suffix}_REDIRECT_URI`, example ? "https://admin.example.com/auth/callback" : "");
    }
  } else if (auth && oauthProviders.length === 1) {
    values.set("QIY_OIDC_ISSUER", example ? "https://identity.example.com/" : "");
    values.set("QIY_OIDC_AUDIENCE", example ? "qiy-admin" : "");
    values.set("QIY_OIDC_JWKS_URL", example ? "https://identity.example.com/.well-known/jwks.json" : "");
  }
  if (auth && authIsHybrid(auth)) values.set("QIY_OIDC_DEFAULT_ROLE", "viewer");
  if (options.corsOrigins?.length) values.set("QIY_CORS_ORIGINS", options.corsOrigins.join(","));
  if (options.elysiaPlugins?.jwt) values.set(options.elysiaPlugins.jwt.secretEnv, development ? generatedSecret : "");
  if (options.elysiaPlugins?.cron?.length) values.set("QIY_CRON_ENABLED", "0");
  if (options.realtime) {
    values.set("QIY_ABLY_API_KEY", "");
    values.set("QIY_REALTIME_DISABLED", "0");
    values.set("QIY_REALTIME_POLL_MS", "5000");
    values.set("QIY_REALTIME_LEASE_MS", "30000");
    values.set("QIY_REALTIME_MAX_ATTEMPTS", "10");
    values.set("QIY_REALTIME_RETENTION_DAYS", "7");
    values.set("QIY_REALTIME_CLEANUP_MS", "86400000");
    values.set("QIY_REALTIME_ADMIN_URL", development ? "http://127.0.0.1:3000/api/v1/realtime/outbox" : example ? "https://admin.example.com/api/v1/realtime/outbox" : "");
    values.set("QIY_REALTIME_ADMIN_TOKEN", "");
    values.set("QIY_REALTIME_METRICS_TOKEN", "");
    values.set("QIY_REALTIME_ALERT_MAX_PENDING", "1000");
    values.set("QIY_REALTIME_ALERT_MAX_DEAD_LETTERED", "0");
    values.set("QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS", "300000");
  }
  if (options.storageProvider === "s3") {
    values.set("QIY_S3_BUCKET", "");
    values.set("QIY_S3_REGION", "");
    values.set("QIY_S3_ENDPOINT", "");
    values.set("QIY_S3_ACCESS_KEY_ID", "");
    values.set("QIY_S3_SECRET_ACCESS_KEY", "");
    values.set("QIY_S3_SESSION_TOKEN", "");
  }
  return values;
}

function configuredValue(variable: QiyEnvironmentVariable, mode: Mode): string | undefined {
  const value = variable[mode];
  if (!value) return undefined;
  if (value.kind === "value") return value.value;
  if (value.kind === "generate") return generatedSecret;
  return "";
}

function serverEnvironment(database: DatabaseIR, options: EnvOptions, mode: Mode): string {
  const values = defaults(database, options, mode);
  for (const variable of options.environment ?? []) {
    if (variable.name.startsWith("VITE_")) continue;
    const value = configuredValue(variable, mode);
    if (value !== undefined) values.set(variable.name, value);
    else if (!values.has(variable.name)) values.set(variable.name, "");
  }
  const lines = [
    `# Qiy ${mode} environment for the generated admin server.`,
    "# This file is generated from the application's .qiy model.",
    ...[...values].map(([key, value]) => `${key}=${value}`),
  ];
  if (options.auth && isOidcAuth(options.auth.provider) && !authUsesProviderChooser(options.auth)) {
    lines.push("", "# Configure the issuer, audience and JWKS URL for the selected OIDC/OAuth2/SSO provider.");
    if (mode === "example") lines.push("# These settings validate access tokens; they are not OAuth client credentials.");
  }
  if (options.auth && authUsesProviderChooser(options.auth)) {
    lines.push("", "# One QIY_OIDC_<PROVIDER>_* block per configured provider; only complete blocks appear on the public login page.");
    if (mode === "example") lines.push("# These settings validate provider tokens; they are not OAuth client credentials.", "# Set QIY_OIDC_<PROVIDER>_CLIENT_SECRET server-side only for confidential clients; never expose it in VITE_* variables.");
    if (authIsHybrid(options.auth)) lines.push("# QIY_OIDC_DEFAULT_ROLE is the role for accounts created by first-time OAuth onboarding (default viewer).");
  }
  if (options.auth && authHasLocal(options.auth)) lines.push("", "# QIY_AUTH_SECRET is generated for development. Set a unique 32-byte value in production; it signs password sessions and OAuth onboarding tokens.");
  if (options.auth?.provider === "otp") lines.push("", "# OTP uses QIY_AUTH_SECRET to sign challenges and access tokens. Configure an HTTPS delivery adapter in production; QIY_OTP_DEV_CODE is development-only.");
  if (options.elysiaPlugins?.jwt) lines.push("", `# ${options.elysiaPlugins.jwt.secretEnv} is required by the configured Elysia JWT plugin.`);
  if (options.storageProvider === "s3") lines.push("", "# Set the QIY_S3_* values above for Bun's S3-compatible storage adapter.");
  if (options.realtime) lines.push("", "# QIY_ABLY_API_KEY remains server-only. The browser obtains a role-scoped, subscribe-only token request from /api/v1/realtime/token.", "# QIY_REALTIME_ADMIN_TOKEN is an administrator access token used only by the realtime:admin HTTP client; never commit it.", "# QIY_REALTIME_METRICS_TOKEN is a separate read-only bearer token for Prometheus scraping; rotate it through the deployment secret.");
  for (const variable of options.environment ?? []) {
    if (variable.secret) lines.push(`# ${variable.name} is secret; supply it through a secret manager in production.`);
    if (variable.production?.kind === "required") lines.push(`# ${variable.name} must be configured before production startup.`);
  }
  lines.push("");
  return lines.join("\n");
}

function webEnvironment(options: EnvOptions, mode: Mode): string {
  const values = new Map<string, string>([["VITE_QIY_API_TRANSPORT", options.apiClient ?? "rest"]]);
  // Multi-provider and hybrid login pages read the provider list from the server,
  // so only the legacy single-provider client needs VITE_QIY_* settings.
  const singleOidc = options.auth && isOidcAuth(options.auth.provider) && !authUsesProviderChooser(options.auth);
  if (singleOidc && options.auth) {
    const sample = oidcExample(options.auth.provider);
    const useSample = mode === "example";
    values.set("VITE_QIY_AUTHORIZATION_URL", useSample ? sample.authorizationUrl : "");
    values.set("VITE_QIY_TOKEN_URL", useSample ? sample.tokenUrl : "");
    values.set("VITE_QIY_CLIENT_ID", useSample ? "qiy-admin-spa" : "");
    values.set("VITE_QIY_AUTH_SCOPE", "openid profile email");
    values.set("VITE_QIY_REDIRECT_URI", "");
    values.set("VITE_QIY_LOGOUT_URL", useSample ? sample.logoutUrl : "");
  }
  for (const variable of options.environment ?? []) {
    if (!variable.name.startsWith("VITE_")) continue;
    const value = configuredValue(variable, mode);
    values.set(variable.name, value ?? "");
  }
  return [
    `# Qiy ${mode} frontend environment.`,
    ...(singleOidc ? ["# Configure a public SPA client with Authorization Code + PKCE. Never put a client secret in VITE_* variables."] : []),
    ...[...values].map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
}

export function generateEnvironmentFiles(database: DatabaseIR, options: EnvOptions): Record<string, string> {
  const files: Record<string, string> = {};
  for (const mode of ["development", "production", "example"] as const) {
    files[`apps/server/.env.${mode}`] = serverEnvironment(database, options, mode);
    files[`apps/web/.env.${mode}`] = webEnvironment(options, mode);
  }
  return files;
}

export function prepareEnvironmentFile(content: string, existing?: string): string {
  let prepared = existing === undefined ? content : mergeEnvironmentValues(existing, content);
  prepared = prepared.replaceAll(generatedSecret, randomBytes(32).toString("hex"));
  return prepared;
}

function mergeEnvironmentValues(existing: string, generated: string): string {
  const existingLines = existing.replace(/\r\n/g, "\n").split("\n");
  const existingValues = new Map<string, string>();
  for (const line of existingLines) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match && !existingValues.has(match[1]!)) existingValues.set(match[1]!, line);
  }
  const generatedNames = new Set<string>();
  const merged = generated.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) return line;
    const name = match[1]!;
    generatedNames.add(name);
    return existingValues.get(name) ?? line;
  });
  const userLines = existingLines.filter((line) => {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    return match ? !generatedNames.has(match[1]!) : line.trim() !== "" && !line.trimStart().startsWith("#");
  });
  if (userLines.length) merged.push("", ...userLines);
  return merged.join("\n").replace(/\n*$/, "\n");
}
