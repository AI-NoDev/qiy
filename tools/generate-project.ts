import type { DatabaseIR } from "./database-ir";
import { renderAdminTemplate, renderWorkspaceTemplate } from "./admin-template";
import { generateEnvironmentFiles } from "./environment-files";
import { generateServer } from "./generate-server";
import { generateWeb } from "./generate-web";
import type { QiyProject } from "./qiy-project";
import { authHasLocal, authIsHybrid, authOAuthProviders, authUsesProviderChooser } from "./qiy-project";
import type { QiyTestSuite } from "./qiy-test";

type ProjectOptions = Pick<QiyProject, "comment" | "commentKey" | "mode" | "integration" | "ui" | "messages" | "dataflows" | "actions" | "apiClient" | "corsOrigins" | "elysiaPlugins" | "menuGroups" | "dashboardMetrics" | "charts" | "chartPanels" | "realtime" | "storageProvider" | "auth" | "permissions" | "environment" | "scopes" | "restrictions" | "pages" | "workflows"> & { testSuite?: QiyTestSuite };

export function generateProject(database: DatabaseIR, name: string, options: ProjectOptions = {}): Record<string, string> {
  if (options.realtime && !options.auth) throw new Error("Realtime requires generated authentication");
  if (options.mode === "integration" && options.dataflows?.length) {
    throw new Error("Dataflow server generation is unavailable in integration mode; implement host commands in the existing API.");
  }
  if (options.mode === "integration") return generateIntegrationProject(database, options);
  const template = { ...renderWorkspaceTemplate(name, database.entities[0]?.tableName ?? ""), ...renderAdminTemplate(name, database.entities[0]?.tableName ?? "") };
  if (options.comment) {
    for (const path of ["package.json", "apps/server/package.json", "apps/web/package.json"]) {
      const packageJson = JSON.parse(template[path]!) as Record<string, unknown>;
      packageJson.description = options.comment;
      template[path] = `${JSON.stringify(packageJson, null, 2)}\n`;
    }
  }
  template["apps/server/.env.example"] = renderEnvironmentExample(database, options);
  const testDatabaseUrl = database.dialect === "sqlite"
    ? ":memory:"
    : database.dialect === "mysql"
      ? "mysql://qiy:qiy@127.0.0.1:3306/qiy_test"
      : "postgres://qiy:qiy@127.0.0.1:5432/qiy_test";
  // Tests are hermetic: they must never borrow the development database from a
  // loaded .env file. Run them against an in-memory / dedicated test database
  // unless QIY_TEST_DATABASE_URL explicitly asks for a disposable server.
  template["apps/server/tests/setup.ts"] = template["apps/server/tests/setup.ts"]!.replace(
    /Bun\.env\.DATABASE_URL \?\?= .*;/,
    `Bun.env.DATABASE_URL = Bun.env.QIY_TEST_DATABASE_URL ?? ${JSON.stringify(testDatabaseUrl)};`,
  );
  if (options.elysiaPlugins?.jwt) {
    template["apps/server/tests/setup.ts"] += `Bun.env[${JSON.stringify(options.elysiaPlugins.jwt.secretEnv)}] ??= "qiy-test-only-jwt-secret";\n`;
  }
  if ((options.auth && authHasLocal(options.auth)) || options.auth?.provider === "otp") template["apps/server/tests/setup.ts"] += 'Bun.env.QIY_AUTH_SECRET ??= "qiy-local-auth-test-secret-value-32";\n';
  if (options.realtime) template["apps/server/tests/setup.ts"] += 'Bun.env.QIY_REALTIME_DISABLED = "1";\n';
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
  if (options.realtime) {
    Object.assign(apps, generateRealtimeObservability(name));
    apps["deploy/kubernetes/deployment.yaml"] = apps["deploy/kubernetes/deployment.yaml"]!.replace(
      '            - name: QIY_DEV_MODE\n              value: "0"',
      '            - name: QIY_DEV_MODE\n              value: "0"\n            - name: QIY_ABLY_API_KEY\n              valueFrom:\n                secretKeyRef:\n                  name: ' + name + '\n                  key: QIY_ABLY_API_KEY\n            - name: QIY_REALTIME_METRICS_TOKEN\n              valueFrom:\n                secretKeyRef:\n                  name: ' + name + '\n                  key: QIY_REALTIME_METRICS_TOKEN',
    );
    apps["deploy/kubernetes/secret.example.yaml"] = apps["deploy/kubernetes/secret.example.yaml"]!.replace(
      '  QIY_AUTH_SECRET: "replace-with-a-random-32-character-minimum-secret"',
      '  QIY_AUTH_SECRET: "replace-with-a-random-32-character-minimum-secret"\n  QIY_ABLY_API_KEY: "replace-with-your-server-only-ably-key"\n  QIY_REALTIME_METRICS_TOKEN: "replace-with-a-random-read-only-scrape-token"',
    );
  }
  if ((options.elysiaPlugins && Object.keys(options.elysiaPlugins).length > 0) || options.realtime) {
    const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { dependencies: Record<string, string> };
    const generatedServerPackage = JSON.parse(files["api/package.json"]!) as { dependencies?: Record<string, string> };
    serverPackage.dependencies = { ...serverPackage.dependencies, ...generatedServerPackage.dependencies };
    apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  }
  if (options.auth && authHasLocal(options.auth)) {
    const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { scripts: Record<string, string> };
    serverPackage.scripts["auth:bootstrap-admin"] = "bun src/auth/bootstrap-admin.ts";
    serverPackage.scripts["auth:set-password"] = "bun src/auth/set-password.ts";
    apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  }
  const serverPackage = JSON.parse(apps["apps/server/package.json"]!) as { scripts: Record<string, string> };
  serverPackage.scripts.dev = "bun --env-file=.env.development --watch src/server.ts";
  serverPackage.scripts.start = "bun --env-file=.env.production src/server.ts";
  serverPackage.scripts.preview = "bun --env-file=.env.development src/preview.ts";
  serverPackage.scripts["db:generate"] = "bun --env-file=.env.development run drizzle-kit generate";
  serverPackage.scripts["db:migrate"] = "bun --env-file=.env.development src/db-migrate.ts";
  serverPackage.scripts["db:migrate:production"] = "bun --env-file=.env.production src/db-migrate.ts";
  serverPackage.scripts["db:rollback"] = "bun --env-file=.env.production src/db-rollback.ts";
  serverPackage.scripts["db:backup"] = "bun --env-file=.env.production src/db-backup.ts";
  serverPackage.scripts["db:restore"] = "bun --env-file=.env.production src/db-restore.ts";
  serverPackage.scripts["db:check"] = "bun --env-file=.env.development src/db-check.ts";
  if (options.auth && authHasLocal(options.auth)) {
    serverPackage.scripts["auth:bootstrap-admin"] = "bun --env-file=.env.production src/auth/bootstrap-admin.ts";
    serverPackage.scripts["auth:set-password"] = "bun --env-file=.env.production src/auth/set-password.ts";
  }
  if (options.realtime) serverPackage.scripts["realtime:admin"] = "bun --env-file=.env.production src/realtime-admin.ts";  apps["apps/server/package.json"] = `${JSON.stringify(serverPackage, null, 2)}\n`;
  if (options.comment) {
    for (const path of ["apps/server/package.json", "apps/web/package.json"]) {
      const packageJson = JSON.parse(apps[path]!) as Record<string, unknown>;
      packageJson.description = options.comment;
      apps[path] = `${JSON.stringify(packageJson, null, 2)}\n`;
    }
  }
  delete apps["apps/server/src/repositories.ts"];
  delete apps["apps/server/src/routes/index.ts"];
  return apps;
}

function generateIntegrationProject(database: DatabaseIR, options: ProjectOptions): Record<string, string> {
  if (!options.integration) throw new Error("Integration generation requires integration settings.");
  const apps = Object.fromEntries(Object.entries(generateWeb(database, { ...options, readOnly: true })).map(([path, content]) => [
    path.replace(/^web\//, "apps/web/"), content,
  ]));
  if (options.comment && apps["apps/web/package.json"]) {
    const packageJson = JSON.parse(apps["apps/web/package.json"]) as Record<string, unknown>;
    packageJson.description = options.comment;
    apps["apps/web/package.json"] = `${JSON.stringify(packageJson, null, 2)}\n`;
  }
  for (const path of Object.keys(apps)) if (path.startsWith("apps/web/tests/")) delete apps[path];
  const apiBase = JSON.stringify(options.integration.apiBase);
  const authTransport = JSON.stringify(options.integration.authTransport);
  const responseContract = JSON.stringify({
    data: options.integration.response?.data ?? "data",
    total: options.integration.response?.total ?? null,
    error: options.integration.response?.error ?? "error",
  });
  const paginationStyle = JSON.stringify(options.integration.pagination ?? "page");
  const tenantHeader = JSON.stringify(options.integration.tenant?.header ?? null);
  const tenantIdentity = JSON.stringify(options.integration.tenant?.identity ?? null);
  const tenantGuide = options.integration.tenant
    ? ` The configured tenant header is read from window.qiyHostAuth.getIdentity().${options.integration.tenant.identity} on every request and the call fails closed when it is missing.`
    : "";
  apps["apps/web/app/data-provider.ts"] = 'export { dataProvider } from "./host/data-provider";\n';
  apps["apps/web/app/host/data-provider.ts"] = `import type { DataProvider } from "@refinedev/core";
import { qiyIntegrationFetch } from "./auth";

export const apiBase = import.meta.env.VITE_QIY_API_BASE ?? ${apiBase};
export const authTransport = ${authTransport} as "none" | "cookie" | "bearer" | "portal";

/**
 * Host response envelope. Paths are dotted keys inside the JSON body. \`total\` is
 * null when the host does not return a total count for list requests.
 */
export const responseContract: { data: string; total: string | null; error: string } = ${responseContract};
export const paginationStyle = ${paginationStyle} as "page" | "offset" | "none";

export function readPath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export async function hostRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await qiyIntegrationFetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readPath(payload, responseContract.error);
    throw Object.assign(new Error(typeof detail === "string" && detail ? detail : \`Host API error \${response.status}\`), { statusCode: response.status });
  }
  return payload;
}

/** List rows: the declared envelope path, or the body itself when it is already an array. */
export function hostRecords(payload: unknown): Array<Record<string, unknown>> {
  const value = readPath(payload, responseContract.data);
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  return [];
}

/** One record: the declared envelope path, or the body itself when it is already an object. */
export function hostRecord(payload: unknown): Record<string, unknown> {
  const value = readPath(payload, responseContract.data);
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
  throw new Error("Host API returned no record");
}

export function hostTotal(payload: unknown, fallback: number): number {
  if (!responseContract.total) return fallback;
  const value = readPath(payload, responseContract.total);
  const total = typeof value === "number" ? value : Number(value);
  return Number.isFinite(total) ? total : fallback;
}

function resourcePath(resource: string): string {
  return resource.replace(/^\\/+/, "");
}

/**
 * Baseline CRUD mapping generated from the declared envelope and pagination.
 * Host-specific sorting, filtering, nested resources and bulk endpoints belong
 * in this unowned adapter.
 */
export const dataProvider = {
  getApiUrl: () => apiBase,
  getList: async ({ resource, pagination }) => {
    const currentPage = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 20;
    const params = new URLSearchParams();
    if (paginationStyle === "page") { params.set("page", String(currentPage)); params.set("pageSize", String(pageSize)); }
    else if (paginationStyle === "offset") { params.set("offset", String((currentPage - 1) * pageSize)); params.set("limit", String(pageSize)); }
    const query = params.toString();
    const payload = await hostRequest(resourcePath(resource) + (query ? "?" + query : ""));
    const data = hostRecords(payload);
    return { data, total: hostTotal(payload, data.length) };
  },
  getOne: async ({ resource, id }) => ({ data: hostRecord(await hostRequest(resourcePath(resource) + "/" + encodeURIComponent(String(id)))) }),
  create: async ({ resource, variables }) => ({ data: hostRecord(await hostRequest(resourcePath(resource), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(variables ?? {}) })) }),
  update: async ({ resource, id, variables }) => ({ data: hostRecord(await hostRequest(resourcePath(resource) + "/" + encodeURIComponent(String(id)), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(variables ?? {}) })) }),
  deleteOne: async ({ resource, id, variables }) => {
    const payload = await hostRequest(resourcePath(resource) + "/" + encodeURIComponent(String(id)), variables ? { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(variables) } : { method: "DELETE" });
    if (payload && typeof payload === "object" && Object.keys(payload as Record<string, unknown>).length > 0) return { data: hostRecord(payload) };
    return { data: { id } as Record<string, unknown> };
  },
} as DataProvider;

export const dataProviderGuide = "getList/getOne/create/update/deleteOne are generated from the declared response envelope and pagination. Map host-specific sorting, filtering, nested resources and bulk operations in this unowned adapter.";
`;
  apps["apps/web/app/host/auth.ts"] = `import type { AuthProvider } from "@refinedev/core";

export const authTransport = ${authTransport} as "none" | "cookie" | "bearer" | "portal";
const apiBase = import.meta.env.VITE_QIY_API_BASE ?? ${apiBase};
const csrfCookieName = ${JSON.stringify(options.integration.csrfCookie ?? "csrf_token")};
const csrfHeaderName = ${JSON.stringify(options.integration.csrfHeader ?? "x-csrf-token")};
const tenantHeaderName = ${tenantHeader};
const tenantIdentityKey = ${tenantIdentity};

export interface QiyHostAuthBridge {
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  check?: () => boolean | Promise<boolean>;
  login?: () => void | Promise<void>;
  getIdentity?: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  getPermissions?: () => unknown | Promise<unknown>;
  can?: (request: { resource?: string; action: string; params?: unknown }) => { can: boolean; reason?: string } | Promise<{ can: boolean; reason?: string }>;
  logout?: () => void | Promise<void>;
  onError?: (error: unknown) => { logout?: boolean; redirectTo?: string } | Promise<{ logout?: boolean; redirectTo?: string }>;
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
  if (tenantHeaderName && tenantIdentityKey) {
    const identity = typeof window === "undefined" ? null : await window.qiyHostAuth?.getIdentity?.();
    const tenant = identity ? identity[tenantIdentityKey] : undefined;
    if (tenant === undefined || tenant === null || tenant === "") throw new Error("Host tenant identity is missing");
    headers.set(tenantHeaderName, String(tenant));
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
  onError: async (error) => {
    const handler = bridge()?.onError;
    if (handler) return await handler(error);
    return error?.statusCode === 401 ? { logout: false, redirectTo: "/auth/login" } : {};
  },
};

export const integrationAuthGuide = "Provide window.qiyHostAuth.getAccessToken for bearer/portal mode. Cookie mode includes credentials and copies the configured readable CSRF cookie into its request header.${tenantGuide} Implement host login, refresh, identity, logout, and authorization in this unowned adapter; keep secrets out of the Qiy model.";
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

- app/host/data-provider.ts: a baseline getList/getOne/create/update/deleteOne mapping is generated from the declared \`response\`, \`pagination\` and \`apiBase\` settings, using the model resource names as URL paths. Map host-specific sorting, filtering, nested resources, bulk endpoints and a different URL layout in this unowned adapter. Use hostRequest() (or qiyIntegrationFetch()) for the configured auth transport.
- app/host/auth.ts: provide window.qiyHostAuth.getAccessToken for Bearer/portal mode, or configure a readable CSRF cookie and header for cookie mode; implement host login/session/refresh/identity/logout here.${tenantGuide ? ` The declared tenant header is copied from window.qiyHostAuth.getIdentity() on every request and missing tenant data fails closed.` : ""} Do not copy secrets into the Qiy model.
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
  options: Pick<QiyProject, "corsOrigins" | "elysiaPlugins" | "realtime" | "storageProvider" | "auth">,
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
  const auth = options.auth;
  const authOAuth = auth ? authOAuthProviders(auth) : [];
  const providerChooser = Boolean(auth && authUsesProviderChooser(auth));
  if (auth && authHasLocal(auth)) values.set("QIY_AUTH_SECRET", "");
  if (auth?.provider === "otp") {
    values.set("QIY_OTP_DELIVERY_URL", "");
    values.set("QIY_OTP_DELIVERY_TOKEN", "");
    values.set("QIY_OTP_DELIVERY_TIMEOUT_MS", "10000");
    values.set("QIY_OTP_DEV_CODE", "");
  }
  if (auth && authOAuth.length > 0) {
    values.set("QIY_OIDC_JWKS_TIMEOUT_MS", "5000");
    values.set("QIY_OIDC_JWKS_COOLDOWN_MS", "30000");
    values.set("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", "600000");
  }
  if (auth && providerChooser) {
    for (const provider of authOAuth) {
      const suffix = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      values.set(`QIY_OIDC_${suffix}_ISSUER`, "");
      values.set(`QIY_OIDC_${suffix}_AUDIENCE`, "");
      values.set(`QIY_OIDC_${suffix}_JWKS_URL`, "");
      values.set(`QIY_OIDC_${suffix}_AUTHORIZATION_URL`, "");
      values.set(`QIY_OIDC_${suffix}_TOKEN_URL`, "");
      values.set(`QIY_OIDC_${suffix}_CLIENT_ID`, "");
      values.set(`QIY_OIDC_${suffix}_SCOPE`, "openid profile email");
      values.set(`QIY_OIDC_${suffix}_REDIRECT_URI`, "");
    }
    if (authIsHybrid(auth)) values.set("QIY_OIDC_DEFAULT_ROLE", "viewer");
  } else if (auth && authOAuth.length === 1) {
    values.set("QIY_OIDC_ISSUER", "");
    values.set("QIY_OIDC_AUDIENCE", "");
    values.set("QIY_OIDC_JWKS_URL", "");
  }
  if (options.corsOrigins?.length) values.set("QIY_CORS_ORIGINS", options.corsOrigins.join(","));
  if (options.elysiaPlugins?.jwt) values.set(options.elysiaPlugins.jwt.secretEnv, "");
  if (options.elysiaPlugins?.cron?.length) values.set("QIY_CRON_ENABLED", "0");
  if (options.realtime) {
    values.set("QIY_ABLY_API_KEY", "");
    values.set("QIY_REALTIME_DISABLED", "0");
    values.set("QIY_REALTIME_POLL_MS", "5000");
    values.set("QIY_REALTIME_LEASE_MS", "30000");
    values.set("QIY_REALTIME_MAX_ATTEMPTS", "10");
    values.set("QIY_REALTIME_RETENTION_DAYS", "7");
    values.set("QIY_REALTIME_CLEANUP_MS", "86400000");
    values.set("QIY_REALTIME_ADMIN_URL", "http://127.0.0.1:3000/api/v1/realtime/outbox");
    values.set("QIY_REALTIME_ADMIN_TOKEN", "");
    values.set("QIY_REALTIME_METRICS_TOKEN", "");
    values.set("QIY_REALTIME_ALERT_MAX_PENDING", "1000");
    values.set("QIY_REALTIME_ALERT_MAX_DEAD_LETTERED", "0");
    values.set("QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS", "300000");
  }

  const lines = [
    "# Copy this file to .env for local development.",
    "# Docker Compose also loads this file; use a database hostname reachable from the container.",
    ...[...values].map(([key, value]) => `${key}=${value}`),
  ];
  if (auth && authHasLocal(auth)) {
    lines.push("", "# Required for local password auth and OAuth onboarding tokens. Generate a unique value with: openssl rand -hex 32");
  }
  if (auth?.provider === "otp") {
    lines.push("", "# Required for OTP auth. Use an HTTPS delivery adapter in production; never set QIY_OTP_DEV_CODE there.");
  }
  if (auth && providerChooser) {
    lines.push("", "# Required for each configured OAuth/OIDC provider (QIY_OIDC_<PROVIDER>_*). Set CLIENT_SECRET server-side only for confidential clients.", ...(authIsHybrid(auth) ? ["# QIY_OIDC_DEFAULT_ROLE is the role of accounts created by first-time OAuth onboarding (default viewer)."] : []));
  } else if (auth && authOAuth.length === 1) {
    lines.push("", "# Required for OIDC/OAuth2/SSO access-token verification. These are issuer/JWKS settings, not OAuth client credentials.");
  }
  if (options.elysiaPlugins?.jwt) lines.push("", "# Required by the configured Elysia JWT plugin.");
  if (options.realtime) lines.push("", "# Required for Ably realtime. Keep QIY_ABLY_API_KEY server-only; clients receive subscribe-only token requests.", "# realtime:admin calls the protected HTTP API; provide an admin access token through QIY_REALTIME_ADMIN_TOKEN.", "# Prometheus uses the separate read-only QIY_REALTIME_METRICS_TOKEN; do not reuse an administrator access token.");
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

function generateRealtimeObservability(name: string): Record<string, string> {
  const resourceName = name;
  return {
    "deploy/kubernetes/realtime-servicemonitor.yaml": `apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ${resourceName}-realtime
  labels:
    app: ${resourceName}
spec:
  selector:
    matchLabels:
      app: ${resourceName}
  endpoints:
    - port: http
      path: /api/v1/realtime/outbox/metrics/prometheus
      interval: 30s
      scrapeTimeout: 10s
      authorization:
        type: Bearer
        credentials:
          name: ${resourceName}
          key: QIY_REALTIME_METRICS_TOKEN
`,
    "deploy/kubernetes/realtime-prometheusrule.yaml": `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ${resourceName}-realtime
  labels:
    app: ${resourceName}
spec:
  groups:
    - name: ${resourceName}.realtime
      rules:
        - alert: QiyRealtimeOutboxDegraded
          expr: qiy_realtime_outbox_health{service="${resourceName}"} == 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: Qiy realtime outbox is degraded
            description: Pending, dead-lettered, or oldest-event thresholds are exceeded.
        - alert: QiyRealtimeDeadLetters
          expr: qiy_realtime_outbox_dead_lettered{service="${resourceName}"} > 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: Qiy realtime outbox has dead letters
            description: Inspect and replay failed events through the authenticated realtime administration API.
        - alert: QiyRealtimeMetricsAbsent
          expr: absent(qiy_realtime_outbox_health{service="${resourceName}"})
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: Qiy realtime metrics are unavailable
            description: Verify the ServiceMonitor selector, service port, and metrics token secret.
`,
    "deploy/observability/grafana/qiy-realtime-outbox.json": `${JSON.stringify({
      __inputs: [{ name: "DS_PROMETHEUS", label: "Prometheus", type: "datasource", pluginId: "prometheus", pluginName: "Prometheus" }],
      annotations: { list: [] },
      editable: true,
      panels: [
        { type: "stat", title: "Outbox health", targets: [{ expr: "qiy_realtime_outbox_health" }], gridPos: { h: 8, w: 6, x: 0, y: 0 } },
        { type: "timeseries", title: "Pending and leased", targets: [{ expr: "qiy_realtime_outbox_pending", legendFormat: "pending" }, { expr: "qiy_realtime_outbox_leased", legendFormat: "leased" }], gridPos: { h: 8, w: 9, x: 6, y: 0 } },
        { type: "timeseries", title: "Dead letters", targets: [{ expr: "qiy_realtime_outbox_dead_lettered", legendFormat: "dead-lettered" }], gridPos: { h: 8, w: 9, x: 15, y: 0 } },
        { type: "timeseries", title: "Oldest pending age", targets: [{ expr: "qiy_realtime_outbox_oldest_pending_age_seconds", legendFormat: "seconds" }], gridPos: { h: 8, w: 12, x: 0, y: 8 } },
        { type: "timeseries", title: "Delivered retained", targets: [{ expr: "qiy_realtime_outbox_delivered", legendFormat: "delivered" }], gridPos: { h: 8, w: 12, x: 12, y: 8 } },
      ].map((panel, index) => ({ ...panel, id: index + 1, datasource: { type: "prometheus", uid: "${DS_PROMETHEUS}" } })),
      schemaVersion: 39,
      tags: ["qiy", "realtime"],
      templating: { list: [] },
      time: { from: "now-6h", to: "now" },
      title: "Qiy Realtime Outbox",
      uid: `${resourceName}-realtime`,
      version: 1,
    }, null, 2)}\n`,
  };
}
