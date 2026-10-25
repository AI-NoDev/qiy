import { expect, test } from "bun:test";
import {
  buildCurlExample,
  buildDataflowDiagram,
  buildDataflowDiagrams,
  buildEntityDiagram,
  describeDataflow,
  docsTabLabelKey,
  docsTabs,
  escapeMermaidLabel,
  groupOpenApiOperations,
  mermaidId,
  openApiOperationCount,
  openApiServerBaseUrl,
  schemaExample,
  schemaSummary,
  type DocsModel,
} from "../app/docs";
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyStatus,
  canCreateApiKey,
  countActiveApiKeys,
  defaultApiKeyName,
  formatApiKeyDate,
  maskedApiKey,
} from "../app/api-keys";
import { docsEnabled, qiyFeatureFlags, qiyMenuLinks } from "../app/features";
import { buildMenuTree } from "../app/components/menu";
import { menuGroups, resources } from "../app/resources";

const model: DocsModel = {
  app: { name: "Test app" },
  features: { apiDocs: true, apiKeys: true },
  principal: { role: "operator", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "role", label: "Role", labelKey: "qiy.resources.users.fields.role.label", type: "userRole", nullable: false, enumName: "userRole", enumValues: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }], annotations: [] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "userId", label: "User", labelKey: "qiy.resources.orders.fields.userId.label", type: "UUID", nullable: false, annotations: ["relation:users"], relation: { table: "users", field: "id" } }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [{ name: "userRole", values: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }] }],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin", "operator"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [{ name: "InventoryReceivePermission", value: "inventory:receive", label: "Receive", labelKey: "" }], groups: [{ name: "operator", members: ["InventoryReceivePermission"], label: "operator", labelKey: "" }], verifications: [] },
};

test("builds an escaped UML entity diagram", () => {
  const diagram = buildEntityDiagram(model);
  expect(diagram.startsWith("classDiagram")).toBe(true);
  expect(diagram).toContain("class e_users[Users]");
  expect(diagram).toContain("class e_orders[Orders]");
  expect(diagram).toContain("+id UUID [PK,NN]");
  expect(diagram).toContain("e_orders --> e_users : userId");
  expect(buildEntityDiagram(model)).toBe(diagram);
  expect(escapeMermaidLabel('a "b" {c};\nd')).toBe("a 'b' (c), d");
  expect(mermaidId("orders-line")).toBe("orders_line");
  expect(mermaidId("1bad")).toBe("qiy_1bad");
});

test("builds a flowchart per dataflow with inputs, steps and result", () => {
  const flow = model.dataflows[0]!;
  const diagram = buildDataflowDiagram(flow);
  expect(diagram.startsWith("flowchart LR")).toBe(true);
  expect(diagram).toContain("d_receiveStock_input");
  expect(diagram).toContain("d_receiveStock_step_0");
  expect(diagram).toContain("d_receiveStock_result");
  expect(diagram).toContain("update inventory");
  expect(buildDataflowDiagrams(model)).toHaveLength(1);
  expect(describeDataflow(flow).inputs).toEqual(["quantity: Integer (required)"]);
  expect(describeDataflow(flow).allowRoles).toEqual(["admin", "operator"]);
});

const spec = {
  openapi: "3.1.0",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [{ name: "orders", description: "Orders" }, { name: "auth", description: "Auth" }],
  paths: {
    "/api/v1/orders": {
      get: {
        tags: ["orders"],
        summary: "List orders",
        security: [{ bearerSession: [] }, { apiKey: [] }],
        "x-qiy-roles": ["admin", "operator"],
        "x-qiy-permissions": [],
        parameters: [
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Paginated records", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object" } }, total: { type: "integer" } } } } } }, "401": { description: "Authentication required" } },
      },
      post: {
        tags: ["orders"],
        summary: "Create order",
        security: [{ bearerSession: [] }],
        "x-qiy-roles": ["admin"],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { number: { type: "string" }, total: { type: "integer" } }, required: ["number"] } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/auth/me": { get: { tags: ["auth"], summary: "Current principal", security: [{ bearerSession: [] }], responses: { "200": { description: "Principal" } } } },
  },
  "x-qiy-principal": { role: "operator", permissions: ["inventory:receive"] },
};

test("groups OpenAPI operations into stable tag panels", () => {
  const groups = groupOpenApiOperations(spec);
  expect(groups.map((group) => group.name)).toEqual(["orders", "auth"]);
  expect(groups[0]!.operations.map((operation) => operation.method)).toEqual(["get", "post"]);
  expect(groups[0]!.operations[0]!.summary).toBe("List orders");
  expect(groups[0]!.operations[0]!.parameters.map((parameter) => parameter.name)).toEqual(["page", "search"]);
  expect(groups[0]!.operations[0]!.security).toEqual(["bearerSession", "apiKey"]);
  expect(groups[0]!.operations[1]!.requestSchema).toBeDefined();
  expect(groups[0]!.operations[0]!.roles).toEqual(["admin", "operator"]);
  expect(openApiOperationCount(spec)).toBe(3);
  expect(groupOpenApiOperations(undefined)).toEqual([]);
  expect(openApiOperationCount({ paths: {} })).toBe(0);
});

test("summarizes schemas and builds read-only curl examples", () => {
  expect(schemaSummary({ type: "string" })).toBe("string");
  expect(schemaSummary({ type: "string", format: "date-time" })).toBe("string (date-time)");
  expect(schemaSummary({ type: "string", enum: ["a", "b"] })).toBe("string (a | b)");
  expect(schemaSummary({ type: "integer", nullable: true })).toBe("integer?");
  expect(schemaSummary({ type: "array", items: { type: "string" } })).toBe("array<string>");
  expect(schemaSummary({ type: "object", properties: { id: { type: "string" }, total: { type: "integer" } } })).toContain("id: string");
  expect(schemaSummary(undefined)).not.toBe("");
  expect(schemaExample({ type: "object", properties: { number: { type: "string" }, total: { type: "integer" }, active: { type: "boolean" } } })).toEqual({ number: "", total: 0, active: false });
  expect(schemaExample({ type: "array", items: { type: "integer" } })).toEqual([0]);
  const getCurl = buildCurlExample({ method: "get", path: "/api/v1/orders", baseUrl: "http://localhost:3000", security: ["bearerSession"], locale: "en-US" });
  expect(getCurl).toContain("curl -X GET 'http://localhost:3000/api/v1/orders'");
  expect(getCurl).toContain("Authorization: Bearer <session-token>");
  expect(getCurl).not.toContain("Content-Type");
  const postCurl = buildCurlExample({ method: "post", path: "/api/v1/orders", baseUrl: "http://localhost:3000", security: ["apiKey"], requestBody: { number: "A-1" }, locale: "en-US" });
  expect(postCurl).toContain("X-API-Key: <your-api-key>");
  expect(postCurl).toContain("Content-Type: application/json");
  expect(postCurl).toContain('"number":"A-1"');
  expect(postCurl).toContain(" -");
  expect(postCurl).toContain("\n");
  const zhCurl = buildCurlExample({ method: "get", path: "/api/v1/orders", security: ["bearerSession"], locale: "zh-CN" });
  expect(zhCurl).toContain("<会话令牌>");
  expect(openApiServerBaseUrl(spec, "http://localhost:3000")).toBe("http://localhost:3000");
  expect(openApiServerBaseUrl({ servers: [{ url: "https://api.example.com" }] }, "http://localhost:3000")).toBe("https://api.example.com");
});

test("gates the overview tabs and adds the sidebar page link", () => {
  expect(docsEnabled).toBe(true);
  expect(docsTabs({ apiDocs: true, apiKeys: true })).toEqual(["entities", "dataflows", "api", "permissions", "apiKeys"]);
  expect(docsTabs({ apiDocs: false, apiKeys: true })).toEqual(["apiKeys"]);
  expect(docsTabs({ apiDocs: false, apiKeys: false })).toEqual([]);
  expect(docsTabLabelKey("apiKeys")).toBe("qiy.docs.tabApiKeys");
  expect(qiyMenuLinks).toEqual([{ name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" }]);
  const tree = buildMenuTree({ resources, menuGroups, links: qiyMenuLinks });
  const found = (nodes: typeof tree): boolean => nodes.some((node) => (node.key === "qiy-docs" && node.to === "/system/overview") || found(node.children));
  expect(found(tree)).toBe(true);
  expect(qiyFeatureFlags.apiDocs || qiyFeatureFlags.apiKeys).toBe(true);
});

test("API-key helpers mirror the server rules", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const active = { id: "a", name: "A", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: now.toISOString(), lastUsedAt: null, expiresAt: null, revokedAt: null };
  const expired = { ...active, id: "b", expiresAt: "2025-12-31T00:00:00Z" };
  const revoked = { ...active, id: "c", revokedAt: "2025-12-31T00:00:00Z" };
  expect(maskedApiKey("abcdef12")).toBe("qiy_abcdef12_********");
  expect(apiKeyStatus(active, now)).toBe("active");
  expect(apiKeyStatus(expired, now)).toBe("expired");
  expect(apiKeyStatus(revoked, now)).toBe("revoked");
  expect(countActiveApiKeys([active, expired, revoked], now)).toBe(1);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE - 1 }, () => active), now)).toBe(true);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE }, () => active), now)).toBe(false);
  expect(defaultApiKeyName([], now)).toBe("Key 2026-01-01");
  expect(formatApiKeyDate(null, "en-US")).toBe("\u2014");
  expect(formatApiKeyDate("2026-01-01T00:00:00Z", "en-US")).toContain("2026");
});
