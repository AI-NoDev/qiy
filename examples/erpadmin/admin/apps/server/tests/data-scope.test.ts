import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

const scoped = { field: "customerId", value: "00000000-0000-4000-8000-000000000002" };
const seen: Array<unknown> = [];
const repository = {
  distribution: async (_field: string, scope?: unknown) => { seen.push(scope); return []; },
  list: async (_page: number, _size: number, options?: { scope?: unknown }) => { seen.push(options?.scope); return { data: [], total: 0 }; },
  one: async (_id: string, scope?: unknown) => { seen.push(scope); return undefined; },
  create: async (_values: unknown, _actor?: string, scope?: unknown) => { seen.push(scope); return {}; },
  update: async (_id: string, _values: unknown, _actor?: string, scope?: unknown) => { seen.push(scope); return undefined; },
  delete: async (_id: string, _actor?: string, scope?: unknown) => { seen.push(scope); return undefined; },
  deleteMany: async (_ids: string[], _actor?: string, scope?: unknown) => { seen.push(scope); return []; },
};
const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((resource) => [resource, repository])) as unknown as Repositories;
const request = (query: string) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });

test("data scope rejects missing claims without blocking unrelated resources", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin" }), false, false);
  const graph = await app.handle(request("query { orders { total } }"));
  if (graph.status === 200) expect((await graph.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  else expect(graph.status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/orders/"))).status).toBe(403);
  expect((await app.handle(request("query { users { total } }"))).status).toBe(200);
  expect(seen).toEqual([undefined]);
});

test("REST and GraphQL pass the authorized scope to repository operations", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin", claims: { "tenant.customerId": scoped.value } }), false, false);
  const list = await app.handle(request("query { orders { total } }"));
  expect(list.status).toBe(200);
  expect((await list.json() as { data: { orders: { total: number } } }).data.orders.total).toBe(0);
  expect((await app.handle(request('mutation { deleteOrders(id: "00000000-0000-4000-8000-000000000001") { id } }'))).status).toBe(200);
  expect((await app.handle(new Request("http://localhost/api/v1/orders/"))).status).toBe(200);
  expect(seen).toEqual([scoped, scoped, scoped]);
});

test("order workflows reject missing scope claims before database access", async () => {
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin" }), true, false);
  for (const command of ["submit", "approve", "ship", "cancel"]) {
    const response = await app.handle(new Request("http://localhost/api/v1/orders/00000000-0000-4000-8000-000000000001/" + command, { method: "POST" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Missing required data scope claim" });
  }
});

