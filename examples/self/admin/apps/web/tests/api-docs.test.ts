import { expect, test } from "bun:test";
import {
  buildCurlExample,
  filterOpenApiOperations,
  groupOpenApiOperations,
  openApiOperationCount,
  openApiOperationMatches,
  openApiServerBaseUrl,
  schemaExample,
  schemaSummary,
} from "../app/docs";

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

test("searches operations by path, method, summary and tag", () => {
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "orders")).toBe(true);
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "list")).toBe(true);
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "post")).toBe(false);
  const byPath = filterOpenApiOperations(groupOpenApiOperations(spec), "auth/me");
  expect(byPath.total).toBe(1);
  expect(byPath.groups.map((group) => group.name)).toEqual(["auth"]);
  const byMethod = filterOpenApiOperations(groupOpenApiOperations(spec), "get");
  expect(byMethod.total).toBe(2);
  const byTag = filterOpenApiOperations(groupOpenApiOperations(spec), "orders");
  expect(byTag.total).toBe(2);
  const none = filterOpenApiOperations(groupOpenApiOperations(spec), "missing");
  expect(none.total).toBe(0);
  expect(none.groups).toEqual([]);
  expect(filterOpenApiOperations(groupOpenApiOperations(spec), "  ").total).toBe(3);
});

test("summarizes schemas and builds read-only curl examples", () => {
  expect(schemaSummary({ type: "string" })).toBe("string");
  expect(schemaSummary({ type: "string", format: "date-time" })).toBe("string (date-time)");
  expect(schemaSummary({ type: "string", enum: ["a", "b"] })).toBe("string (a | b)");
  expect(schemaSummary({ type: "integer", nullable: true })).toBe("integer?");
  expect(schemaSummary({ type: "array", items: { type: "string" } })).toBe("array<string>");
  expect(schemaSummary({ type: "object", properties: { id: { type: "string" }, total: { type: "integer" } } })).toContain("id: string");
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
  expect(postCurl).toContain("\n");
  expect(openApiServerBaseUrl(spec, "http://localhost:3000")).toBe("http://localhost:3000");
  expect(openApiServerBaseUrl({ servers: [{ url: "https://api.example.com" }] }, "http://localhost:3000")).toBe("https://api.example.com");
});
