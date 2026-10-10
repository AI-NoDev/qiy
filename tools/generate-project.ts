import type { DatabaseIR } from "./database-ir";
import { renderAdminTemplate, renderWorkspaceTemplate } from "./admin-template";
import { generateEnvironmentFiles } from "./environment-files";
import { generateServer } from "./generate-server";
import { generateWeb } from "./generate-web";
import type { QiyProject } from "./qiy-project";

export function generateProject(database: DatabaseIR, name: string, options: Pick<QiyProject, "apiClient" | "corsOrigins" | "elysiaPlugins" | "menuGroups" | "dashboardMetrics" | "storageProvider" | "auth" | "environment" | "scopes" | "workflows"> = {}): Record<string, string> {
  const template = { ...renderWorkspaceTemplate(name, database.entities[0]?.tableName ?? ""), ...renderAdminTemplate(name, database.entities[0]?.tableName ?? "") };
  template["apps/server/.env.example"] = renderEnvironmentExample(database, options);
  const testDatabaseUrl = database.dialect === "sqlite"
    ? ":memory:"
    : database.dialect === "mysql"
      ? "mysql://qiy:qiy@127.0.0.1:3306/qiy_test"
      : "postgres://qiy:qiy@127.0.0.1:5432/qiy_test";
  template["apps/server/tests/setup.ts"] = template["apps/server/tests/setup.ts"]!.replace(
    /Bun\.env\.DATABASE_URL \?\?= .*;/,
    `Bun.env.DATABASE_URL ??= ${JSON.stringify(testDatabaseUrl)};`,
  );
  if (options.elysiaPlugins?.jwt) {
    template["apps/server/tests/setup.ts"] += `Bun.env[${JSON.stringify(options.elysiaPlugins.jwt.secretEnv)}] ??= "qiy-test-only-jwt-secret";\n`;
  }
  if (options.auth?.provider === "local") template["apps/server/tests/setup.ts"] += 'Bun.env.QIY_AUTH_SECRET ??= "qiy-local-auth-test-secret-value-32";\n';
  const files = { ...generateServer(database, options), ...generateWeb(database, options) };
  const apps = Object.fromEntries(Object.entries(files).map(([path, content]) => [
    path.replace(/^api\//, "apps/server/").replace(/^web\//, "apps/web/"), content,
  ]));
  Object.assign(apps, generateEnvironmentFiles(database, options));
  for (const [path, content] of Object.entries(template)) {
    if (path in apps) continue;
    apps[path] = content;
  }
  apps["apps/server/tests/setup.ts"] = template["apps/server/tests/setup.ts"]!;
  if (options.elysiaPlugins?.static) apps[`apps/server/${options.elysiaPlugins.static.assets}/.gitkeep`] = "";
  if (options.elysiaPlugins && Object.keys(options.elysiaPlugins).length > 0) {
    const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { dependencies: Record<string, string> };
    const generatedServerPackage = JSON.parse(files["api/package.json"]!) as { dependencies?: Record<string, string> };
    serverPackage.dependencies = { ...serverPackage.dependencies, ...generatedServerPackage.dependencies };
    apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  }
  if (options.auth?.provider === "local") {
    const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { scripts: Record<string, string> };
    serverPackage.scripts["auth:bootstrap-admin"] = "bun src/auth/bootstrap-admin.ts";
    serverPackage.scripts["auth:set-password"] = "bun src/auth/set-password.ts";
    apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  }
  if (database.dialect === "sqlite") {
    const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { scripts: Record<string, string> };
    serverPackage.scripts["db:migrate"] = "bun src/migrate.ts";
    apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  }
  const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { scripts: Record<string, string> };
  serverPackage.scripts.dev = "bun --env-file=.env.development --watch src/server.ts";
  serverPackage.scripts.start = "bun --env-file=.env.production src/server.ts";
  serverPackage.scripts.preview = "bun --env-file=.env.development src/preview.ts";
  serverPackage.scripts["db:generate"] = "bun --env-file=.env.development run drizzle-kit generate";
  serverPackage.scripts["db:migrate"] = database.dialect === "sqlite"
    ? "bun --env-file=.env.development src/migrate.ts"
    : "bun --env-file=.env.development run drizzle-kit migrate";
  serverPackage.scripts["db:migrate:production"] = database.dialect === "sqlite"
    ? "bun --env-file=.env.production src/migrate.ts"
    : "bun --env-file=.env.production run drizzle-kit migrate";
  if (options.auth?.provider === "local") {
    serverPackage.scripts["auth:bootstrap-admin"] = "bun --env-file=.env.production src/auth/bootstrap-admin.ts";
    serverPackage.scripts["auth:set-password"] = "bun --env-file=.env.production src/auth/set-password.ts";
  }
  apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  delete apps["apps/server/src/repositories.ts"];
  delete apps["apps/server/src/routes/index.ts"];
  return apps;
}

function renderEnvironmentExample(
  database: DatabaseIR,
  options: Pick<QiyProject, "corsOrigins" | "elysiaPlugins" | "storageProvider" | "auth">,
): string {
  const databaseUrl = database.dialect === "sqlite"
    ? "./qiy.sqlite"
    : database.dialect === "mysql"
      ? "mysql://qiy:qiy@127.0.0.1:3306/qiy"
      : "postgres://qiy:qiy@127.0.0.1:5432/qiy";
  const values = new Map<string, string>([
    ["DATABASE_URL", databaseUrl],
    ["HOST", "127.0.0.1"],
    ["PORT", "3000"],
    ["QIY_DEV_MODE", "0"],
    ["QIY_STORAGE_METADATA", "database"],
    ["QIY_STORAGE_PROVIDER", options.storageProvider ?? "local"],
    ["QIY_STORAGE_ROOT", "./storage"],
  ]);
  if (options.auth?.provider === "local") values.set("QIY_AUTH_SECRET", "");
  if (options.auth && options.auth.provider !== "local") {
    values.set("QIY_OIDC_ISSUER", "");
    values.set("QIY_OIDC_AUDIENCE", "");
    values.set("QIY_OIDC_JWKS_URL", "");
  }
  if (options.corsOrigins?.length) values.set("QIY_CORS_ORIGINS", options.corsOrigins.join(","));
  if (options.elysiaPlugins?.jwt) values.set(options.elysiaPlugins.jwt.secretEnv, "");
  if (options.elysiaPlugins?.cron?.length) values.set("QIY_CRON_ENABLED", "0");

  const lines = [
    "# Copy this file to .env for local development.",
    "# Docker Compose also loads this file; use a database hostname reachable from the container.",
    ...[...values].map(([key, value]) => `${key}=${value}`),
  ];
  if (options.auth?.provider === "local") {
    lines.push("", "# Required for local password auth. Generate a unique value with: openssl rand -hex 32");
  }
  if (options.auth && options.auth.provider !== "local") {
    lines.push("", "# Required for OIDC/OAuth2/SSO access-token verification. These are issuer/JWKS settings, not OAuth client credentials.");
  }
  if (options.elysiaPlugins?.jwt) lines.push("", "# Required by the configured Elysia JWT plugin.");
  lines.push(
    "",
    "# Optional S3-compatible storage credentials. Keep secrets out of source control.",
    "# QIY_S3_BUCKET=",
    "# QIY_S3_REGION=",
    "# QIY_S3_ENDPOINT=",
    "# QIY_S3_ACCESS_KEY_ID=",
    "# QIY_S3_SECRET_ACCESS_KEY=",
    "# QIY_S3_SESSION_TOKEN=",
    "",
  );
  return lines.join("\n");
}
