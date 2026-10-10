import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL trend uses the authorized data scope", async () => {
  const rows = [{ day: "2026-10-06", count: 3 }];
  const seen: unknown[] = [];
  const repository = { trend: async (_field: string, _days: number, scope?: unknown) => { seen.push(scope); return rows; }, distribution: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(["records"].map((name) => [name, repository])) as unknown as Repositories;
  const principal = { id: "admin", name: "Admin", role: "admin" as const, claims: {"tenant.id":"tenant-a"} };
  const app = await createApp(repositories, async () => principal, false, false);
  const endpoint = "http://localhost/api/v1/records/trend?field=createdAt&days=30";
  expect(await (await app.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await app.handle(new Request(endpoint.replace("createdAt", "missing")))).status).toBe(400);
  expect((await app.handle(new Request(endpoint.replace("days=30", "days=366")))).status).toBe(422);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { recordsTrend(field: \"createdAt\", days: 30) { day count } }" }) }));
  expect(graph.status).toBe(200);
  expect((await graph.json() as { data: { recordsTrend: typeof rows } }).data.recordsTrend).toEqual(rows);
  expect(seen).toEqual([{ field: "tenantId", value: "tenant-a" }, { field: "tenantId", value: "tenant-a" }]);
  const anonymous = await createApp(repositories, async () => null, false, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
  const missing = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin" }), false, false);
  expect((await missing.handle(new Request(endpoint))).status).toBe(403);
  expect((await missing.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { recordsTrend(field: \"createdAt\", days: 30) { day } }" }) }))).status).toBe(403);
});
