import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import {
  buildDocsModel,
  buildOpenApiDocument,
  docsMeta,
  flowAllowed,
  mayUseAction,
  mayUseResource,
  type GeneratedOpenApiDocument,
} from "../examples/self/admin/apps/server/src/docs";
import {
  API_KEY_MAX_ACTIVE,
  canCreateApiKey,
  generateApiKey,
  hashApiKey,
  isApiKeyExpired,
  maskApiKeyPrefix,
  parseApiKey,
  toApiKeyRecord,
  validateApiKeyExpiry,
  validateApiKeyName,
  verifyApiKeyHash,
} from "../examples/self/admin/apps/server/src/auth/api-key-hash";

/**
 * System-administration features: the `features { apiDocs; apiKeys }` block and
 * the generated API documentation / API key surface.
 */
const model = (body = "") => `qiy v0; application feature-demo {
  database sqlite {}
  api { client rest; }
  ${body}
  auth { provider local; user users; subjectField subject; roleField role; usernameField email; passwordField passwordHash; }
  messages { default "zh-CN"; locale "zh-CN" { "qiy.resources.users.label" "用户"; } locale "en-US" { "qiy.resources.users.label" "Users"; } }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field subject Text @unique;
    field email Text @unique;
    field role userRole;
    field passwordHash Text @nullable;
  }
  entity orders {
    field id UUID @id;
    field number Text;
    field total Integer;
  }
}`;

const withFeatures = (body = "") => model(`features {
  apiDocs true;
  apiKeys true;
}
${body}`);

describe("generated docs permission metadata", () => {
  test("dataflow allowPermissions carry expanded permission values, not field/group names", () => {
    const declaredValues = new Set(docsMeta.permissions.fields.map((field) => field.value));
    for (const flow of docsMeta.dataflows) {
      for (const permission of flow.allowPermissions) expect(declaredValues.has(permission), `${flow.name}: ${permission}`).toBe(true);
    }
    // A principal that really holds the expanded values must see/execute the flow.
    const permissionFlows = docsMeta.dataflows.filter((flow) => flow.allowPermissions.length > 0);
    expect(permissionFlows.length).toBeGreaterThan(0);
    for (const flow of permissionFlows) {
      expect(flowAllowed(flow, { role: "operator", permissions: flow.allowPermissions })).toBe(true);
    }
  });
});

describe("application feature flags", () => {
  test("parses both flags, defaults them to false and round-trips the block", () => {
    expect(parseQiyProject(model()).features).toBeUndefined();
    const project = parseQiyProject(withFeatures());
    expect(project.features).toEqual({ overview: true, apiDocs: true, apiKeys: true });
    const disabled = parseQiyProject(model("features { apiDocs false; apiKeys false; }"));
    expect(disabled.features).toEqual({ overview: true, apiDocs: false, apiKeys: false });
    const hiddenOverview = parseQiyProject(model("features { overview false; apiDocs true; apiKeys true; }"));
    expect(hiddenOverview.features).toEqual({ overview: false, apiDocs: true, apiKeys: true });
    const serialized = serializeQiyProject(hiddenOverview);
    expect(serialized).toContain("features {");
    expect(serialized).toContain("overview false;");
    expect(serialized).toContain("apiDocs true;");
    expect(serialized).toContain("apiKeys true;");
    expect(parseQiyProject(serialized)).toEqual(hiddenOverview);
  });

  test("rejects unknown flags, non-boolean values, duplicates and API keys without auth", () => {
    expect(() => parseQiyProject(model("features { apiDocs true; telemetry true; }"))).toThrow("Unsupported features setting telemetry");
    expect(() => parseQiyProject(model("features { apiDocs yes; }"))).toThrow();
    expect(() => parseQiyProject(model("features { apiDocs true; apiDocs false; }"))).toThrow("Duplicate features setting apiDocs");
    expect(() => parseQiyProject(`qiy v0; application x { database sqlite {} features { apiKeys true; } }`)).toThrow("features apiKeys requires an auth block");
  });

  test("generates API docs without auth without importing a missing auth module", () => {
    const project = parseQiyProject(`qiy v0; application docs-no-auth {
      database sqlite {}
      features { apiDocs true; }
      entity products { field id UUID @id; field name Text; }
    }`);
    const files = generateProject(project.database, "docs-no-auth", project);
    expect(files["apps/web/app/docs.ts"]).not.toContain('from "./auth"');
    expect(files["apps/web/app/routes/api-docs.tsx"]).not.toContain('from "../auth"');
    expect(files["apps/web/app/routes/api-docs.tsx"]).toContain("Promise.resolve(undefined)");
  });

  test("generates the split developer pages and gates them per flag", () => {
    const project = parseQiyProject(withFeatures());
    const enabled = generateProject(project.database, "feature-demo", project);
    for (const path of [
      "apps/server/src/docs.ts",
      "apps/server/src/docs-routes.ts",
      "apps/server/src/auth/api-key-hash.ts",
      "apps/server/src/auth/api-keys.ts",
      "apps/server/tests/docs.test.ts",
      "apps/server/tests/api-keys.test.ts",
      "apps/web/app/docs.ts",
      "apps/web/app/api-keys.ts",
      "apps/web/app/features.ts",
      "apps/web/app/components/mermaid.tsx",
      "apps/web/app/components/docs-page.tsx",
      "apps/web/app/components/api-docs-page.tsx",
      "apps/web/app/components/api-keys-page.tsx",
      "apps/web/app/routes/docs.tsx",
      "apps/web/app/routes/api-docs.tsx",
      "apps/web/app/routes/api-keys.tsx",
      "apps/web/tests/docs.test.ts",
      "apps/web/tests/docs-render.test.tsx",
      "apps/web/tests/api-docs.test.ts",
      "apps/web/tests/api-docs-render.test.tsx",
      "apps/web/tests/api-keys.test.ts",
      "apps/web/tests/api-keys-render.test.tsx",
      "apps/web/tests/features.test.ts",
    ]) expect(enabled[path], path).toBeTruthy();
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("downloadOpenApiDocument");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("Download OpenAPI");
    expect(enabled["apps/server/src/schema.ts"]).toContain('qiyApiKeys = sqliteTable("qiy_api_keys"');
    expect(enabled["apps/server/src/app.ts"]).toContain("withApiKeyAuthentication");
    expect(enabled["apps/server/src/app.ts"]).toContain('import("./auth/api-keys")');
    expect(enabled["apps/server/src/app.ts"]).toContain('import("./docs-routes")');
    expect(enabled["apps/server/src/auth/guard.ts"]).toContain('path === "/api/v1/openapi" || path.startsWith("/api/v1/openapi/")');
    expect(enabled["apps/server/src/auth/api-key-hash.ts"]).toContain("createHmac");
    expect(enabled["apps/web/app/routes.ts"]).toContain('route("system/overview", "./routes/docs.tsx")');
    expect(enabled["apps/web/app/routes.ts"]).toContain('route("system/api-docs", "./routes/api-docs.tsx")');
    expect(enabled["apps/web/app/routes.ts"]).toContain('route("system/api-keys", "./routes/api-keys.tsx")');
    // The overview no longer contains the API explorer or the key manager: those are
    // separate routes/components now.
    expect(enabled["apps/web/app/components/docs-page.tsx"]).toContain("buildEntityDiagram");
    expect(enabled["apps/web/app/components/docs-page.tsx"]).not.toContain("groupOpenApiOperations");
    expect(enabled["apps/web/app/components/docs-page.tsx"]).not.toContain("Access keys");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("filterOpenApiOperations");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("Try it");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("X-API-Key");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("Send request");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("credentials: \"include\"");
    expect(enabled["apps/web/app/components/api-docs-page.tsx"]).toContain("Tooltip");
    expect(enabled["apps/web/app/components/api-keys-page.tsx"]).toContain("filterApiKeys");
    expect(enabled["apps/web/app/components/api-keys-page.tsx"]).toContain("apiKeyCurlExamples");
    expect(enabled["apps/web/app/docs.ts"]).toContain("export function groupOpenApiOperations");
    expect(enabled["apps/web/app/docs.ts"]).toContain("export function filterOpenApiOperations");
    expect(enabled["apps/web/app/docs.ts"]).toContain("export function fetchDocsModel");
    expect(enabled["apps/web/app/docs.ts"]).toContain("export function fetchOpenApiDocument");
    expect(enabled["apps/web/app/api-keys.ts"]).toContain("export function filterApiKeys");
    expect(enabled["apps/web/app/api-keys.ts"]).toContain("export function permissionTags");
    expect(enabled["apps/web/app/api-keys.ts"]).toContain("export async function rotateApiKey");
    expect(enabled["apps/web/app/api-keys.ts"]).toContain("export async function listApiKeyEvents");
    expect(enabled["apps/web/app/components/api-keys-page.tsx"]).toContain("Rotate");
    expect(enabled["apps/web/app/components/api-keys-page.tsx"]).toContain("Audit trail");
    expect(enabled["apps/server/src/auth/api-keys.ts"]).toContain('post("/:id/rotate"');
    expect(enabled["apps/server/src/auth/api-keys.ts"]).toContain("qiyApiKeyEvents");
    expect(enabled["apps/server/tests/api-keys.test.ts"]).toContain("rotates a key, revokes the old one and records audit events");
    expect(enabled["apps/web/app/routes/docs.tsx"]).toContain("fetchDocsModel()");
    expect(enabled["apps/web/app/routes/api-docs.tsx"]).toContain("fetchOpenApiDocument()");
    expect(enabled["apps/web/app/routes/api-keys.tsx"]).toContain("listApiKeys()");
    // Auth hooks in these routes caused an infinite render loop (blank page);
    // identity is fetched through the cached non-hook helper instead.
    for (const route of ["apps/web/app/routes/docs.tsx", "apps/web/app/routes/api-docs.tsx", "apps/web/app/routes/api-keys.tsx"]) {
      expect(enabled[route], route).not.toContain("useIsAuthenticated");
      expect(enabled[route], route).not.toContain("useGetIdentity");
    }
    expect(enabled["apps/web/app/routes/api-docs.tsx"]).toContain("fetchCurrentIdentity()");
    expect(enabled["apps/web/app/routes/api-keys.tsx"]).toContain("fetchCurrentIdentity()");
    expect(enabled["apps/web/app/auth.ts"]).toContain("export async function fetchCurrentIdentity");
    expect(enabled["apps/web/app/features.ts"]).toContain('path: "/system/overview"');
    expect(enabled["apps/web/app/features.ts"]).toContain('path: "/system/api-docs"');
    expect(enabled["apps/web/app/features.ts"]).toContain('path: "/system/api-keys"');
    expect(enabled["apps/web/app/components/menu.tsx"]).toContain("qiyMenuLinks");
    expect(JSON.parse(enabled["apps/web/package.json"]!).dependencies.mermaid).toBe("12.2.0");
    expect(JSON.parse(enabled["apps/web/package.json"]!).dependencies["@scalar/api-reference-react"]).toBeUndefined();
    expect(enabled["apps/web/app/i18n.ts"]).toContain('"docs.title": "功能总览"');
    expect(enabled["apps/web/app/i18n.ts"]).toContain('"apiDocs.title": "API 文档"');
    expect(enabled["apps/web/app/i18n.ts"]).toContain('"apiKey.pageTitle": "访问密钥"');
    expect(enabled["apps/web/tests/chrome-i18n.test.ts"]).toContain("qiy.apiDocs.title");
    // Mermaid class labels must be quoted: class X[label] is a parse error.
    expect(enabled["apps/web/app/docs.ts"]).toContain("escapeMermaidLabel(entity.label)");
    expect(enabled["apps/web/app/components/mermaid.tsx"]).toContain("QIY_MERMAID_TIMEOUT_MS");
    expect(enabled["apps/web/app/components/mermaid.tsx"]).toContain("qiy-mermaid-fallback");
    // Diagram theme follows the app color mode (亮色/暗色/跟随系统), not the OS
    // prefers-color-scheme, and re-renders on change.
    expect(enabled["apps/web/app/components/mermaid.tsx"]).toContain("useQiyUi");
    expect(enabled["apps/web/app/components/mermaid.tsx"]).toContain('theme: resolvedColorMode === "dark" ? "dark" : "default"');
    expect(enabled["apps/web/app/components/mermaid.tsx"]).not.toContain("prefers-color-scheme");
    expect(enabled["apps/web/app/styles.css"]).toContain('[data-color-mode="dark"] .qiy-docs-code');
    const disabled = generateProject(parseQiyProject(model()).database, "feature-demo", parseQiyProject(model()));
    for (const path of ["apps/server/src/docs.ts", "apps/server/src/auth/api-keys.ts", "apps/web/app/routes/docs.tsx", "apps/web/app/docs.ts", "apps/web/app/components/api-docs-page.tsx"]) {
      expect(disabled[path], path).toBeUndefined();
    }
    expect(disabled["apps/web/app/routes.ts"]).not.toContain("system/");
    expect(JSON.parse(disabled["apps/web/package.json"]!).dependencies.mermaid).toBeUndefined();
    expect(disabled["apps/web/app/features.ts"]).not.toContain("/system/overview");
  });

  test("gates overview visibility on its own flag and the docs features", () => {
    const generate = (flags: string) => {
      const project = parseQiyProject(model("features { " + flags + " }"));
      return generateProject(project.database, "feature-demo", project);
    };
    // Overview can be hidden while the API pages remain available.
    const noOverview = generate("overview false; apiDocs true; apiKeys true;");
    expect(noOverview["apps/web/app/routes/docs.tsx"]).toBeUndefined();
    expect(noOverview["apps/web/app/components/docs-page.tsx"]).toBeUndefined();
    expect(noOverview["apps/web/app/routes/api-docs.tsx"]).toBeTruthy();
    expect(noOverview["apps/web/app/routes/api-keys.tsx"]).toBeTruthy();
    expect(noOverview["apps/web/app/routes.ts"]).not.toContain("system/overview");
    expect(noOverview["apps/web/app/features.ts"]).not.toContain('path: "/system/overview"');
    expect(noOverview["apps/web/app/features.ts"]).toContain('path: "/system/api-docs"');
    expect(noOverview["apps/web/app/features.ts"]).toContain('path: "/system/api-keys"');
    // Overview + keys, no API docs: the model endpoint is generated for the overview,
    // but the OpenAPI endpoint/page is not.
    const noApiDocs = generate("overview true; apiDocs false; apiKeys true;");
    expect(noApiDocs["apps/web/app/routes/docs.tsx"]).toBeTruthy();
    expect(noApiDocs["apps/web/app/routes/api-keys.tsx"]).toBeTruthy();
    expect(noApiDocs["apps/web/app/routes/api-docs.tsx"]).toBeUndefined();
    expect(noApiDocs["apps/server/src/docs.ts"]).toBeTruthy();
    expect(noApiDocs["apps/server/src/docs-routes.ts"]).toContain('mounted.get("/docs/model"');
    expect(noApiDocs["apps/server/src/docs-routes.ts"]).not.toContain('mounted.get("/openapi.json"');
    expect(noApiDocs["apps/web/app/routes.ts"]).not.toContain("system/api-docs");
    expect(noApiDocs["apps/web/app/features.ts"]).toContain('path: "/system/overview"');
    expect(noApiDocs["apps/web/app/features.ts"]).not.toContain('path: "/system/api-docs"');
    // Overview + API docs, no keys page or key support.
    const noKeys = generate("overview true; apiDocs true; apiKeys false;");
    expect(noKeys["apps/web/app/routes/docs.tsx"]).toBeTruthy();
    expect(noKeys["apps/web/app/routes/api-docs.tsx"]).toBeTruthy();
    expect(noKeys["apps/web/app/routes/api-keys.tsx"]).toBeUndefined();
    expect(noKeys["apps/server/src/auth/api-keys.ts"]).toBeUndefined();
    expect(noKeys["apps/server/src/schema.ts"]).not.toContain("qiyApiKeys");
    expect(noKeys["apps/web/app/routes.ts"]).not.toContain("system/api-keys");
    expect(noKeys["apps/web/app/api-keys.ts"]).toBeUndefined();
    // Everything off (overview defaults true but no docs feature exists).
    const off = generate("overview false; apiDocs false; apiKeys false;");
    expect(off["apps/server/src/docs.ts"]).toBeUndefined();
    expect(off["apps/web/app/routes/docs.tsx"]).toBeUndefined();
    expect(off["apps/web/app/routes.ts"]).not.toContain("system/");
    expect(off["apps/web/app/features.ts"]).not.toContain('path: "/system/');
  });
});

describe("generated OpenAPI document", () => {
  const admin = { role: "admin" as const, permissions: [] as string[] };
  const operator = { role: "operator" as const, permissions: ["inventory:receive"] };
  const viewer = { role: "viewer" as const, permissions: ["report:read"] };

  test("describes the demo model with security schemes and metadata", () => {
    expect(docsMeta.features).toEqual({ overview: true, apiDocs: true, apiKeys: true });
    expect(docsMeta.entities).toHaveLength(17);
    expect(docsMeta.dataflows).toHaveLength(8);
    expect(docsMeta.userTable).toBe("users");
    expect(docsMeta.app.name.length).toBeGreaterThan(0);
    const document = buildOpenApiDocument(admin) as GeneratedOpenApiDocument;
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe("1.0.0");
    expect(document["x-qiy-generated"]).toBe(true);
    expect(Object.keys(document.components.securitySchemes)).toEqual(["bearerSession", "apiKey"]);
    expect(document.security).toEqual([{ bearerSession: [] }, { apiKey: [] }]);
    expect(document.paths["/api/v1/inventory"]).toBeDefined();
    expect(document.paths["/api/v1/inventory/{id}"]?.delete).toBeDefined();
    expect(document.paths["/api/v1/inventory/distribution"]?.get).toBeDefined();
    expect(document.paths["/api/v1/inventory/trend"]?.get).toBeDefined();
    expect(document.paths["/api/v1/inventory/aggregate"]?.get).toBeDefined();
    expect(document.paths["/api/v1/auth/api-keys"]?.get).toBeDefined();
    expect(document.paths["/api/v1/openapi.json"]?.get).toBeDefined();
    expect(document.paths["/api/v1/docs/model"]?.get).toBeDefined();
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    const listOperation = document.paths["/api/v1/inventory"]?.get as Record<string, unknown>;
    expect(listOperation["x-qiy-roles"]).toBeDefined();
    expect(listOperation["x-qiy-permissions"]).toEqual([]);
    expect(listOperation.security).toEqual([{ bearerSession: [] }, { apiKey: [] }]);
  });

  test("filters resources, actions and commands per principal", () => {
    const adminDocument = buildOpenApiDocument(admin);
    const operatorDocument = buildOpenApiDocument(operator);
    const viewerDocument = buildOpenApiDocument(viewer);
    expect(Object.keys(operatorDocument.paths).length).toBeLessThan(Object.keys(adminDocument.paths).length);
    expect(Object.keys(viewerDocument.paths).length).toBeLessThan(Object.keys(operatorDocument.paths).length);
    // The auth user resource is admin-only in every generated surface.
    expect(adminDocument.paths["/api/v1/users"]).toBeDefined();
    expect(operatorDocument.paths["/api/v1/users"]).toBeUndefined();
    expect(viewerDocument.paths["/api/v1/users"]).toBeUndefined();
    // Page rules restrict DELETE on inventory/stock movements to admins.
    expect(adminDocument.paths["/api/v1/inventory/{id}"]?.delete).toBeDefined();
    expect(operatorDocument.paths["/api/v1/inventory/{id}"]?.delete).toBeUndefined();
    // Viewers only get read operations on resource paths.
    for (const [path, methods] of Object.entries(viewerDocument.paths)) {
      if (!path.startsWith("/api/v1/")) continue;
      if (path.startsWith("/api/v1/auth/") || path.startsWith("/api/v1/commands/") || path === "/api/v1/openapi.json" || path === "/api/v1/docs/model") continue;
      for (const method of Object.keys(methods)) expect(method, path).toBe("get");
    }
    // Commands are filtered by their declared allow rules.
    const commandPaths = (document: GeneratedOpenApiDocument) => Object.keys(document.paths).filter((path) => path.startsWith("/api/v1/commands/"));
    expect(commandPaths(adminDocument)).toHaveLength(docsMeta.dataflows.length);
    expect(commandPaths(operatorDocument).length).toBeLessThan(commandPaths(adminDocument).length);
    for (const flow of docsMeta.dataflows) {
      if (flowAllowed(flow, operator)) expect(operatorDocument.paths["/api/v1/commands/" + flow.name]?.post).toBeDefined();
      else expect(operatorDocument.paths["/api/v1/commands/" + flow.name]).toBeUndefined();
    }
    expect(mayUseResource("users", operator)).toBe(false);
    expect(mayUseAction("inventory", "delete", operator)).toBe(false);
    const viewerEntity = docsMeta.entities.find((entity) => mayUseResource(entity.tableName, viewer));
    expect(viewerEntity).toBeDefined();
    expect(mayUseAction(viewerEntity!.tableName, "list", viewer)).toBe(true);
  });

  test("the docs model is filtered for the principal", () => {
    const adminModel = buildDocsModel(admin) as { entities: Array<{ tableName: string }>; dataflows: unknown[]; app: { description?: string } };
    const operatorModel = buildDocsModel(operator) as { entities: Array<{ tableName: string }>; dataflows: unknown[] };
    const viewerModel = buildDocsModel(viewer) as { entities: Array<{ tableName: string }> };
    expect(adminModel.entities).toHaveLength(17);
    expect(operatorModel.entities.some((entity) => entity.tableName === "users")).toBe(false);
    expect(adminModel.dataflows.length).toBeGreaterThan(operatorModel.dataflows.length);
    expect(viewerModel.entities.length).toBeLessThanOrEqual(operatorModel.entities.length);
    expect(adminModel.app.description).toContain("供应链");
  });
});

describe("API key hashing and format", () => {
  const secret = "qiy-api-key-unit-test-secret-32-chars";
  test("hashes secrets, never stores plaintext and validates the format", () => {
    Bun.env.QIY_AUTH_SECRET = secret;
    const generated = generateApiKey();
    expect(generated.key.startsWith("qiy_")).toBe(true);
    const parsed = parseApiKey(generated.key)!;
    expect(parsed.prefix).toBe(generated.prefix);
    expect(parsed.secret.length).toBeGreaterThanOrEqual(32);
    expect(generated.hash).toHaveLength(64);
    expect(generated.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.hash).not.toContain(parsed.secret);
    expect(generated.hash).not.toContain(generated.key);
    expect(hashApiKey(parsed.secret)).toBe(generated.hash);
    expect(verifyApiKeyHash(generated.key, generated.hash)).toBe(true);
    expect(verifyApiKeyHash(generated.key, hashApiKey("other"))).toBe(false);
    expect(parseApiKey("qiy_1234")).toBeNull();
    expect(parseApiKey("Bearer session-token")).toBeNull();
    expect(parseApiKey("qiy_ABCDEF12_" + "x".repeat(43))).toBeNull();
    const record = toApiKeyRecord({ id: "id", name: "name", prefix: generated.prefix, createdAt: new Date("2026-01-01T00:00:00Z"), lastUsedAt: null, expiresAt: null, revokedAt: null });
    expect(record.maskedKey).not.toContain(parsed.secret);
    expect(record.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(maskApiKeyPrefix(generated.prefix)).toBe("qiy_" + generated.prefix + "_********");
  });

  test("validates names, expiry, active limits and expiration", () => {
    expect(validateApiKeyName("  deploy  ")).toBe("deploy");
    expect(() => validateApiKeyName("")).toThrow("name is required");
    expect(() => validateApiKeyName("x".repeat(81))).toThrow("at most 80");
    const future = new Date(Date.now() + 60_000);
    expect(validateApiKeyExpiry(future.toISOString())).toBeInstanceOf(Date);
    expect(() => validateApiKeyExpiry(new Date(Date.now() - 1000).toISOString())).toThrow("future");
    expect(() => validateApiKeyExpiry("not-a-date")).toThrow("ISO date-time");
    expect(isApiKeyExpired(new Date(Date.now() - 1000), new Date())).toBe(true);
    expect(isApiKeyExpired(null, new Date())).toBe(false);
    expect(canCreateApiKey(API_KEY_MAX_ACTIVE - 1)).toBe(true);
    expect(canCreateApiKey(API_KEY_MAX_ACTIVE)).toBe(false);
  });

  test("refuses to hash without a strong QIY_AUTH_SECRET", () => {
    const previous = Bun.env.QIY_AUTH_SECRET;
    delete Bun.env.QIY_AUTH_SECRET;
    try {
      expect(() => generateApiKey()).toThrow("QIY_AUTH_SECRET");
    } finally {
      Bun.env.QIY_AUTH_SECRET = previous;
    }
  });
});
