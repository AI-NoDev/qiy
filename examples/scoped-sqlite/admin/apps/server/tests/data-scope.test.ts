import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

const scoped = { field: "tenantId", value: "tenant-a" };
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
const repositories = Object.fromEntries(["records"].map((resource) => [resource, repository])) as unknown as Repositories;
const request = (query: string) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });

test("data scope rejects missing claims without blocking unrelated resources", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin" }), false, false);
  expect((await app.handle(request("query { records { total } }"))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/records/"))).status).toBe(403);
  
  expect(seen).toEqual([]);
});

test("REST and GraphQL pass the authorized scope to repository operations", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin", claims: { "tenant.id": scoped.value } }), false, false);
  const list = await app.handle(request("query { records { total } }"));
  expect(list.status).toBe(200);
  expect((await list.json() as { data: { records: { total: number } } }).data.records.total).toBe(0);
  expect((await app.handle(request('mutation { deleteRecords(id: "00000000-0000-4000-8000-000000000001") { id } }'))).status).toBe(200);
  expect((await app.handle(new Request("http://localhost/api/v1/records/"))).status).toBe(200);
  expect(seen).toEqual([scoped, scoped, scoped]);
});

