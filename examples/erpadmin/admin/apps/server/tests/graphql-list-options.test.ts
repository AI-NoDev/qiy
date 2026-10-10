import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createGraphQLRoutes } from "../src/graphql";
import type { Repositories } from "../src/app";

const repository = {
  async distribution() { return []; },
  async trend() { return []; },
  async list() { return { data: [], total: 0 }; },
  async one() { return undefined; },
  async create() { return {}; },
  async update() { return undefined; },
  async delete() { return undefined; },
  async deleteMany() { return []; },
};
const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
const app = new Elysia().use(createGraphQLRoutes(repositories, async () => ({ id: "admin", role: "admin", name: "Admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} })));
const request = (query: string, variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });

  test("rejects disabled sort orders.status", async () => {
    const response = await app.handle(request("query($sort: String) { orders(sort: $sort) { total } }", { sort: "status" }));
    const payload = await response.json() as { errors?: Array<{ message: string }> };
    expect(payload.errors?.[0]?.message).toBe("Unsupported sort field");
  });

  test("rejects disabled filter orders.approvedBy", async () => {
    const response = await app.handle(request("query($filters: [QiyFilterInput!]) { orders(filters: $filters) { total } }", { filters: [{ field: "approvedBy", value: "x" }] }));
    const payload = await response.json() as { errors?: Array<{ message: string }> };
    expect(payload.errors?.[0]?.message).toBe("Unsupported filter field");
  });
