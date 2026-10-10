import type { DatabaseIR } from "./database-ir";
import { renderAdminTemplate, renderWorkspaceTemplate } from "./admin-template";
import { generateServer } from "./generate-server";
import { generateWeb } from "./generate-web";
import type { QiyProject } from "./qiy-project";

export function generateProject(database: DatabaseIR, name: string, options: Pick<QiyProject, "apiClient" | "corsOrigins" | "elysiaPlugins" | "menuGroups" | "dashboardMetrics" | "storageProvider" | "auth" | "scopes" | "workflows"> = {}): Record<string, string> {
  const template = { ...renderWorkspaceTemplate(name, database.entities[0]?.tableName ?? ""), ...renderAdminTemplate(name, database.entities[0]?.tableName ?? "") };
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
  delete apps["apps/server/src/repositories.ts"];
  delete apps["apps/server/src/routes/index.ts"];
  return apps;
}
