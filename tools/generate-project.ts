import type { DatabaseIR } from "./database-ir";
import { renderAdminTemplate, renderWorkspaceTemplate } from "./admin-template";
import { generateEnvironmentFiles } from "./environment-files";
import { generateServer } from "./generate-server";
import { generateWeb } from "./generate-web";
import type { QiyProject } from "./qiy-project";

type ProjectOptions = Pick<QiyProject, "mode" | "integration" | "ui" | "messages" | "dataflows" | "actions" | "apiClient" | "corsOrigins" | "elysiaPlugins" | "menuGroups" | "dashboardMetrics" | "storageProvider" | "auth" | "environment" | "scopes" | "workflows">;

export function generateProject(database: DatabaseIR, name: string, options: ProjectOptions = {}): Record<string, string> {
  if (options.mode === "integration" && options.dataflows?.length) {
    throw new Error("Dataflow server generation is unavailable in integration mode; implement host commands in the existing API.");
  }
  if (options.mode === "integration") return generateIntegrationProject(database, options);
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
  if (options.auth?.provider === "local" || options.auth?.provider === "otp") template["apps/server/tests/setup.ts"] += 'Bun.env.QIY_AUTH_SECRET ??= "qiy-local-auth-test-secret-value-32";\n';
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

function generateIntegrationProject(database: DatabaseIR, options: ProjectOptions): Record<string, string> {
  if (!options.integration) throw new Error("Integration generation requires integration settings.");
  const apps = Object.fromEntries(Object.entries(generateWeb(database, { ...options, readOnly: true })).map(([path, content]) => [
    path.replace(/^web\//, "apps/web/"), content,
  ]));
  for (const path of Object.keys(apps)) if (path.startsWith("apps/web/tests/")) delete apps[path];
  const apiBase = JSON.stringify(options.integration.apiBase);
  const authTransport = JSON.stringify(options.integration.authTransport);
  apps["apps/web/app/data-provider.ts"] = 'export { dataProvider } from "./host/data-provider";\n';
  apps["apps/web/app/host/data-provider.ts"] = `import type { DataProvider } from "@refinedev/core";
import { qiyIntegrationFetch, qiyIntegrationUrl } from "./auth";

export const apiBase = import.meta.env.VITE_QIY_API_BASE ?? ${apiBase};
export const authTransport = ${authTransport} as "none" | "cookie" | "bearer" | "portal";

export async function hostRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await qiyIntegrationFetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload ? String(payload.error) : \`Host API error \${response.status}\`);
  return payload;
}

const unsupported = async (): Promise<never> => {
  throw new Error("Qiy integration data provider is not configured. Implement the host API resource mapping in this unowned adapter.");
};

export const dataProvider: DataProvider = {
  getApiUrl: () => apiBase,
  getList: unsupported,
  getOne: unsupported,
  create: unsupported,
  update: unsupported,
  deleteOne: unsupported,
};
`;
  apps["apps/web/app/host/auth.ts"] = `import type { AuthProvider } from "@refinedev/core";

export const authTransport = ${authTransport} as "none" | "cookie" | "bearer" | "portal";
const apiBase = import.meta.env.VITE_QIY_API_BASE ?? ${apiBase};
const csrfCookieName = ${JSON.stringify(options.integration.csrfCookie ?? "csrf_token")};
const csrfHeaderName = ${JSON.stringify(options.integration.csrfHeader ?? "x-csrf-token")};

export interface QiyHostAuthBridge {
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  check?: () => boolean | Promise<boolean>;
  login?: () => void | Promise<void>;
  getIdentity?: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  getPermissions?: () => unknown | Promise<unknown>;
  can?: (request: { resource?: string; action: string; params?: unknown }) => { can: boolean; reason?: string } | Promise<{ can: boolean; reason?: string }>;
  logout?: () => void | Promise<void>;
}
declare global { interface Window { qiyHostAuth?: QiyHostAuthBridge } }

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = encodeURIComponent(name) + "=";
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return undefined;
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return undefined; }
}

export function qiyIntegrationUrl(path: string): string {
  if (/^https?:\\/\\//i.test(path)) return path;
  return apiBase.replace(/\\/+$/, "") + "/" + path.replace(/^\\/+/, "");
}

export async function qiyIntegrationFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const browserOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const base = new URL(apiBase, browserOrigin);
  const url = new URL(input instanceof URL ? input.href : qiyIntegrationUrl(String(input)), browserOrigin);
  const prefix = base.pathname.replace(/\\/+$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== base.origin || (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/"))) {
    throw new Error("Host API request is outside the configured API base");
  }
  if (authTransport === "cookie" && base.origin !== browserOrigin) throw new Error("Cookie transport requires a same-origin host API");
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (authTransport === "bearer" || authTransport === "portal") {
    const token = typeof window === "undefined" ? undefined : await window.qiyHostAuth?.getAccessToken?.();
    if (token) headers.set("Authorization", "Bearer " + token);
  }
  if (authTransport === "cookie" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie(csrfCookieName);
    if (!csrf) throw new Error("Host CSRF cookie is missing or invalid");
    headers.set(csrfHeaderName, csrf);
  }
  return fetch(url, { ...init, method, headers, redirect: "error", credentials: authTransport === "cookie" ? "include" : init.credentials ?? "same-origin" });
}

function bridge(): QiyHostAuthBridge | undefined { return typeof window === "undefined" ? undefined : window.qiyHostAuth; }
export const qiyIntegrationAuthProvider: AuthProvider = {
  login: async () => { const login = bridge()?.login; if (!login) return { success: false, error: { name: "HostLogin", message: "Implement window.qiyHostAuth.login in the host adapter" } }; await login(); return { success: true, redirectTo: "/" }; },
  logout: async () => { await bridge()?.logout?.(); return { success: true }; },
  check: async () => (await bridge()?.check?.()) === true ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => await bridge()?.getIdentity?.() ?? null,
  getPermissions: async () => await bridge()?.getPermissions?.() ?? null,
  onError: async ({ error }) => error?.statusCode === 401 ? { logout: false } : {},
};

export const integrationAuthGuide = "Provide window.qiyHostAuth.getAccessToken for bearer/portal mode. Cookie mode includes credentials and copies the configured readable CSRF cookie into its request header. Implement host login, refresh, identity, logout, and authorization in this unowned adapter; keep secrets out of the Qiy model.";
`;
  apps["apps/web/app/host/access-control.ts"] = `import type { AccessControlProvider } from "@refinedev/core";
import type { QiyHostAuthBridge } from "./auth";

export const qiyIntegrationAccessControlProvider: AccessControlProvider = {
  can: async (request) => {
    const host: QiyHostAuthBridge | undefined = typeof window === "undefined" ? undefined : window.qiyHostAuth;
    if (!host?.can) return { can: false, reason: "Host access-control adapter is not configured" };
    try {
      const decision = await host.can(request);
      return decision?.can === true ? { can: true } : { can: false, reason: decision?.reason ?? "Host permission denied" };
    } catch { return { can: false, reason: "Host permission check failed" }; }
  },
  options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 0 } },
};
export const integrationAccessControlGuide = "Implement window.qiyHostAuth.can to map host permissions to Refine resource/action/params decisions. Missing or failed checks deny access. Server authorization remains the host API's responsibility.";
`;
  apps["apps/web/app/root.tsx"] = 'import { qiyIntegrationAccessControlProvider } from "./host/access-control";\n' + apps["apps/web/app/root.tsx"]!.replace("dataProvider={dataProvider}", "dataProvider={dataProvider} accessControlProvider={qiyIntegrationAccessControlProvider}");
  if (options.integration.authTransport !== "none") {
    apps["apps/web/app/routes/login.tsx"] = 'export { default } from "../extensions/host-login";\n';
    apps["apps/web/app/extensions/host-login.tsx"] = `import { Alert, Button, Card, Typography, message } from "antd";

export default function HostLoginExtension() { const startLogin = async () => { const login = window.qiyHostAuth?.login; if (!login) { void message.error("Implement window.qiyHostAuth.login in the host auth adapter."); return; } await login(); }; return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title="Host application login" style={{ width: 440 }}><Alert type="info" showIcon message="Authentication is managed by the host application." description="Implement the login experience in this extension and window.qiyHostAuth.login/check in app/host/auth.ts. The Qiy model does not create a second user system." /><Typography.Paragraph style={{ marginTop: 16 }}>Configured transport: ${options.integration.authTransport}</Typography.Paragraph><Button type="primary" onClick={() => void startLogin()}>Continue with host login</Button></Card></main>; }
`;
  }
  apps["apps/web/QIY_INTEGRATION.md"] = `# Qiy integration extension points

This Qiy model generated only the Refine admin package. It did not generate a server, database schema, migration, deployment file, or a second authentication system.

- app/host/data-provider.ts: map Refine CRUD and custom actions to the existing API's URLs, response envelope, and error shape. Use hostRequest() (or qiyIntegrationFetch()) for the configured auth transport.
- app/host/auth.ts: provide window.qiyHostAuth.getAccessToken for Bearer/portal mode, or configure a readable CSRF cookie and header for cookie mode; implement host login/session/refresh/identity/logout here. Do not copy secrets into the Qiy model.
- app/host/access-control.ts: implement window.qiyHostAuth.can({ resource, action, params }) to map host permissions to UI visibility and business-page access. Missing or failed checks deny access. The host API remains the authorization authority.

The app/host/ files are intentionally not Qiy-owned. qiy init --sync preserves local changes there.
`;
  apps["apps/web/vite.config.ts"] = `import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [reactRouter()] });
`;
  const environments = generateEnvironmentFiles(database, options);
  for (const [path, content] of Object.entries(environments)) {
    if (!path.startsWith("apps/web/")) continue;
    apps[path] = `${content.replace(/\n?$/, "\n")}VITE_QIY_API_BASE=${options.integration.apiBase}\n`;
  }
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
  if (options.auth?.provider === "local" || options.auth?.provider === "otp") values.set("QIY_AUTH_SECRET", "");
  if (options.auth?.provider === "otp") {
    values.set("QIY_OTP_DELIVERY_URL", "");
    values.set("QIY_OTP_DELIVERY_TOKEN", "");
    values.set("QIY_OTP_DEV_CODE", "");
  }
  if (options.auth && options.auth.provider !== "local" && options.auth.provider !== "otp") {
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
  if (options.auth?.provider === "otp") {
    lines.push("", "# Required for OTP auth. Use an HTTPS delivery adapter in production; never set QIY_OTP_DEV_CODE there.");
  }
  if (options.auth && options.auth.provider !== "local" && options.auth.provider !== "otp") {
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
