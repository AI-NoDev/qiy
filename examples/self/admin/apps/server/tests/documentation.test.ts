import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("publishes model descriptions in the actual OpenAPI request schemas", async () => {
  const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(["users","orgs","suppliers","customers","products","boms","purchase_orders","purchase_order_lines","receipts","sales_orders","sales_order_lines","shipments","warehouses","bins","inventory","stock_movements","work_orders"].map((name) => [name, repository])) as unknown as Repositories;
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
  const dataflows: Array<{ name: string; summary: string; description: string }> = [{"name":"receiveInventory","summary":"Receive goods","description":"Append a receipt movement and update the on-hand quantity of the target inventory record."},{"name":"putawayStock","summary":"Put away","description":"Move an inventory record into another storage bin and record the transfer."},{"name":"reserveStock","summary":"Reserve stock","description":"Reserve an absolute quantity of an inventory record for a sales order."},{"name":"adjustStock","summary":"Adjust stock","description":"Record a cycle count and set the counted on-hand quantity."},{"name":"shipSalesOrder","summary":"Ship order","description":"Create a shipment for a sales order and mark it shipped."},{"name":"transferInventory","summary":"Transfer inventory","description":"Transfer stock between warehouses or bins with an audit movement."},{"name":"completeWorkOrder","summary":"Complete work order","description":"Consume components and book the produced quantity, then close the work order."}];
  for (const flow of dataflows) {
    const operation = specification.paths["/api/v1/commands/" + flow.name].post;
    expect(operation.summary).toBe(flow.summary);
    expect(operation.description).toBe(flow.description);
    expect(operation.tags).toContain("Dataflow");
  }
});
