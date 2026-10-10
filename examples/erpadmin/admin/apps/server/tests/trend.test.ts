import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL trend uses the authorized data scope", async () => {
  const rows = [{ day: "2026-10-06", count: 3 }];
  const seen: unknown[] = [];
  const repository = { trend: async (_field: string, _days: number, scope?: unknown) => { seen.push(scope); return rows; }, distribution: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const principal = { id: "admin", name: "Admin", role: "admin" as const, claims: {"tenant.customerId":"tenant-a"} };
  const app = await createApp(repositories, async () => principal, false, false);
  const endpoint = "http://localhost/api/v1/orders/trend?field=createdAt&days=30";
  expect(await (await app.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await app.handle(new Request(endpoint.replace("createdAt", "missing")))).status).toBe(400);
  expect((await app.handle(new Request(endpoint.replace("days=30", "days=366")))).status).toBe(422);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ordersTrend(field: \"createdAt\", days: 30) { day count } }" }) }));
  expect(graph.status).toBe(200);
  expect((await graph.json() as { data: { ordersTrend: typeof rows } }).data.ordersTrend).toEqual(rows);
  expect(seen).toEqual([{ field: "customerId", value: "tenant-a" }, { field: "customerId", value: "tenant-a" }]);
  const anonymous = await createApp(repositories, async () => null, false, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
  const missing = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin" }), false, false);
  expect((await missing.handle(new Request(endpoint))).status).toBe(403);
  const deniedGraph = await missing.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ordersTrend(field: \"createdAt\", days: 30) { day } }" }) }));
  if (deniedGraph.status === 200) expect((await deniedGraph.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  else expect(deniedGraph.status).toBe(403);
  expect(seen).toHaveLength(2);
});
