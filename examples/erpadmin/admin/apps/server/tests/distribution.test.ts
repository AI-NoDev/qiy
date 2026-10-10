import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL expose the full authorized enum distribution", async () => {
  const rows = [{ value: "draft", count: 150 }, { value: "approved", count: 100 }];
  const repository = { distribution: async () => rows, list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const viewer = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }), false, false);
  const endpoint = "http://localhost/api/v1/users/distribution?field=role";
  expect(await (await viewer.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await viewer.handle(new Request(endpoint.replace("role", "not_a_field")))).status).toBe(400);
  const graph = await viewer.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { usersDistribution(field: \"role\") { value count } }" }) }));
  expect((await graph.json() as { data: { usersDistribution: typeof rows } }).data.usersDistribution).toEqual(rows);
  const anonymous = await createApp(repositories, async () => null, false, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
});
