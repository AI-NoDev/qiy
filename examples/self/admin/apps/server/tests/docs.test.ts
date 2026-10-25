import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  buildDocsModel,
  buildOpenApiDocument,
  docsMeta,
  mayUseAction,
  mayUseResource,
  flowAllowed,
  type DocsPrincipal,
  type GeneratedOpenApiDocument,
} from "../src/docs";
import { createDocsRoutes } from "../src/docs-routes";

const admin: DocsPrincipal = { role: "admin" };
const operator: DocsPrincipal = { role: "operator" };
const viewer: DocsPrincipal = { role: "viewer" };
const paths = (document: GeneratedOpenApiDocument) => Object.keys(document.paths).sort();

test("generates a valid OpenAPI 3.1 document with session and API-key security", () => {
  const document = buildOpenApiDocument(admin);
  expect(document.openapi).toBe("3.1.0");
  expect(document.info.title.length).toBeGreaterThan(0);
  expect(document.info.version).toBe("1.0.0");
  expect(document.servers.length).toBeGreaterThan(0);
  expect(Object.keys(document.components.securitySchemes)).toEqual(["bearerSession", "apiKey"]);
  expect(document.security).toEqual([{ bearerSession: [] }, { apiKey: [] }]);
  expect(document["x-qiy-generated"]).toBe(true);
  expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  expect(document.paths["/api/v1/users"]).toBeDefined();
  expect(document.paths["/api/v1/users"]?.get).toBeDefined();
  expect(document.paths["/api/v1/auth/me"]?.get).toBeDefined();
  if (docsMeta.features.apiDocs) expect(document.paths["/api/v1/openapi.json"]?.get).toBeDefined();
  if (docsMeta.features.apiKeys) expect(document.paths["/api/v1/auth/api-keys"]?.get).toBeDefined();
  const list = document.paths["/api/v1/users"]?.get as Record<string, unknown>;
  expect(list["x-qiy-roles"]).toBeDefined();
  expect(list.security).toEqual([{ bearerSession: [] }, { apiKey: [] }]);
});

test("filters operations by the principal permissions and page rules", () => {
  const adminDocument = buildOpenApiDocument(admin);
  const operatorDocument = buildOpenApiDocument(operator);
  const viewerDocument = buildOpenApiDocument(viewer);
  expect(paths(operatorDocument).length).toBeLessThanOrEqual(paths(adminDocument).length);
  expect(paths(viewerDocument).length).toBeLessThanOrEqual(paths(operatorDocument).length);
  for (const entity of docsMeta.entities) {
    const listPath = "/api/v1/" + entity.tableName;
    const adminHas = mayUseResource(entity.tableName, admin);
    const viewerHas = mayUseResource(entity.tableName, viewer);
    if (!adminHas) continue;
    expect(adminDocument.paths[listPath]).toBeDefined();
    if (!viewerHas) expect(viewerDocument.paths[listPath]).toBeUndefined();
    const entityActions = ["list", "show", "create", "edit", "delete"] as const;
    for (const action of entityActions) {
      const method = action === "list" ? "get" : action === "show" ? "get" : action === "create" ? "post" : action === "edit" ? "patch" : "delete";
      const key = action === "list" || action === "create" ? listPath : listPath + "/{id}";
      const document = operatorDocument;
      if (mayUseAction(entity.tableName, action, operator)) continue;
      expect(document.paths[key]?.[method]).toBeUndefined();
    }
    for (const method of Object.keys(viewerDocument.paths[listPath] ?? {})) expect(method).toBe("get");
  }
  for (const flow of docsMeta.dataflows) {
    const commandPath = "/api/v1/commands/" + flow.name;
    if (flowAllowed(flow, operator)) expect(operatorDocument.paths[commandPath]?.post).toBeDefined();
    else expect(operatorDocument.paths[commandPath]).toBeUndefined();
  }
});

test("serves the docs endpoints only to authenticated principals", async () => {
  const app = new Elysia().use(createDocsRoutes(async (request) => request.headers.get("authorization") === "Bearer session-admin" ? { id: "admin", name: "Admin", role: "admin" } : null));
  const anonymous = await app.handle(new Request("http://localhost/api/v1/openapi.json"));
  expect(anonymous.status).toBe(401);
  const authorized = await app.handle(new Request("http://localhost/api/v1/openapi.json", { headers: { authorization: "Bearer session-admin" } }));
  expect(authorized.status).toBe(200);
  expect(authorized.headers.get("cache-control")).toBe("no-store");
  const spec = await authorized.json() as GeneratedOpenApiDocument;
  expect(spec.openapi).toBe("3.1.0");
  const modelResponse = await app.handle(new Request("http://localhost/api/v1/docs/model", { headers: { authorization: "Bearer session-admin" } }));
  expect(modelResponse.status).toBe(200);
  const model = await modelResponse.json() as { entities: unknown[]; dataflows: unknown[]; app: { name: string } };
  expect(model.entities.length).toBeGreaterThan(0);
  expect(model.app.name.length).toBeGreaterThan(0);
});
