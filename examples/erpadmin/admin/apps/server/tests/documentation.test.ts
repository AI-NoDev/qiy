import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("publishes model descriptions in the actual OpenAPI request schemas", async () => {
  const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories);
  const response = await app.handle(new Request("http://localhost/api/v1/openapi/json"));
  expect(response.status).toBe(200);
  const specification = await response.json();
  const expected: Array<{ resource: string; description?: string; fields: Record<string, string> }> = [];
  for (const entity of expected) {
    for (const method of ["post", "patch"]) {
      const path = "/api/v1/" + entity.resource + (method === "post" ? "/" : "/{id}");
      const original = specification.paths[path][method].requestBody.content["application/json"].schema;
      const schema = original.$ref ? specification.components.schemas[original.$ref.split("/").at(-1)] : original;
      if (entity.description !== undefined) expect(schema.description).toBe(entity.description);
      for (const [name, description] of Object.entries(entity.fields)) expect(schema.properties[name].description).toBe(description);
    }
  }
  const dataflows: Array<{ name: string; summary: string; description: string }> = [{"name":"orderLifecycleSubmit","summary":"提交订单","description":"Statemachine orderLifecycle: draft -> submitted"},{"name":"orderLifecycleApprove","summary":"审批","description":"Statemachine orderLifecycle: submitted -> approved"},{"name":"orderLifecycleShip","summary":"出库","description":"Statemachine orderLifecycle: approved -> shipped"},{"name":"orderLifecycleCancel","summary":"取消订单","description":"Statemachine orderLifecycle: draft, submitted -> cancelled"}];
  for (const flow of dataflows) {
    const operation = specification.paths["/api/v1/commands/" + flow.name].post;
    expect(operation.summary).toBe(flow.summary);
    expect(operation.description).toBe(flow.description);
    expect(operation.tags).toContain("Dataflow");
  }
});
