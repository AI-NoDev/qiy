import { randomBytes } from "node:crypto";
import type { DatabaseIR } from "./database-ir";
import type { QiyEnvironmentVariable, QiyProject } from "./qiy-project";

type Mode = "development" | "production" | "example";
type EnvOptions = Pick<QiyProject, "apiClient" | "corsOrigins" | "elysiaPlugins" | "storageProvider" | "auth" | "environment">;

const generatedSecret = "__QIY_GENERATE_SECRET__";

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
  if (options.auth?.provider === "local") values.set("QIY_AUTH_SECRET", development ? generatedSecret : "");
  if (options.auth && options.auth.provider !== "local") {
    values.set("QIY_OIDC_ISSUER", example ? "https://identity.example.com/" : "");
    values.set("QIY_OIDC_AUDIENCE", example ? "qiy-admin" : "");
    values.set("QIY_OIDC_JWKS_URL", example ? "https://identity.example.com/.well-known/jwks.json" : "");
  }
  if (options.corsOrigins?.length) values.set("QIY_CORS_ORIGINS", options.corsOrigins.join(","));
  if (options.elysiaPlugins?.jwt) values.set(options.elysiaPlugins.jwt.secretEnv, development ? generatedSecret : "");
  if (options.elysiaPlugins?.cron?.length) values.set("QIY_CRON_ENABLED", "0");
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
  if (options.auth && options.auth.provider !== "local") {
    lines.push("", "# Configure the issuer, audience and JWKS URL for the selected OIDC/OAuth2/SSO provider.");
    if (mode === "example") lines.push("# These settings validate access tokens; they are not OAuth client credentials.");
  }
  if (options.auth?.provider === "local") lines.push("", "# QIY_AUTH_SECRET is generated for development. Set a unique 32-byte value in production.");
  if (options.elysiaPlugins?.jwt) lines.push("", `# ${options.elysiaPlugins.jwt.secretEnv} is required by the configured Elysia JWT plugin.`);
  if (options.storageProvider === "s3") lines.push("", "# Set the QIY_S3_* values above for Bun's S3-compatible storage adapter.");
  for (const variable of options.environment ?? []) {
    if (variable.secret) lines.push(`# ${variable.name} is secret; supply it through a secret manager in production.`);
    if (variable.production?.kind === "required") lines.push(`# ${variable.name} must be configured before production startup.`);
  }
  lines.push("");
  return lines.join("\n");
}

function webEnvironment(options: EnvOptions, mode: Mode): string {
  const values = new Map<string, string>([["VITE_QIY_API_TRANSPORT", options.apiClient ?? "rest"]]);
  for (const variable of options.environment ?? []) {
    if (!variable.name.startsWith("VITE_")) continue;
    const value = configuredValue(variable, mode);
    values.set(variable.name, value ?? "");
  }
  return [
    `# Qiy ${mode} frontend environment.`,
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
