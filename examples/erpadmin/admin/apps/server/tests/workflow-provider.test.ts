import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { createDataProvider, createGraphQLDataProvider } from "../../web/app/data-provider";

const orderId = "00000000-0000-4000-8000-000000000001";
const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
const command = "/api/v1/orders/" + orderId + "/submit";

for (const [transport, createProvider] of [["REST", createDataProvider], ["GraphQL", createGraphQLDataProvider]] as const) {
  test(transport + " provider sends workflow commands to guarded REST route", async () => {
    const app = await createApp(repositories, async () => ({ id: "viewer", name: "Viewer", role: "viewer", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }), true, false);
    const urls: string[] = [];
    const provider = createProvider(async (input, init) => {
      urls.push(String(input));
      return app.handle(new Request(new URL(String(input), "http://localhost"), init));
    });
    const list = await provider.getList({ resource: "orders" });
    expect(list.total).toBe(0);
    expect(urls[0]).toBe(transport === "GraphQL" ? "/graphql" : "/api/v1/orders?page=1&pageSize=20");
    await expect(provider.custom?.({ url: command, method: "post", meta: { idempotencyKey: "request-1" } })).rejects.toThrow("Permission denied");
    expect(urls.at(-1)).toBe(command);
    await expect(provider.custom?.({ url: "/api/v1/orders/" + orderId + "/publish", method: "post" })).rejects.toThrow("Unknown workflow command");
    expect(urls.at(-1)).toBe(command);
  });
  test(transport + " provider preserves workflow validation without a database connection", async () => {
    const app = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }), true, false);
    const provider = createProvider(async (input, init) => app.handle(new Request(new URL(String(input), "http://localhost"), init)));
    await expect(provider.custom?.({ url: command, method: "post", meta: { idempotencyKey: "x".repeat(129) } })).rejects.toThrow("Idempotency key is too long");
  });
}
