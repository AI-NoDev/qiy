import { expect, test } from "bun:test";
import { createApp, normalizeCorsOrigins, type Repositories } from "../src/app";
import { createHandler } from "../src/http";

const repository = {
  distribution: async () => [],
  list: async () => ({ data: [], total: 0 }),
  one: async () => undefined,
  create: async () => ({}),
  update: async () => undefined,
  delete: async () => undefined,
  deleteMany: async () => [],
};

test("mounts REST and GraphQL at their public paths", async () => {
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: crypto.randomUUID(), name: "Test Admin", role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }));
  const handle = createHandler((request) => app.handle(request), "./build/client");
  expect((await handle(new Request("http://localhost/api/v1/health"))).status).toBe(200);
  const specification = await handle(new Request("http://localhost/api/v1/openapi/json"));
  expect(specification.status).toBe(200);
  expect((await specification.json() as { paths: Record<string, unknown> }).paths["/api/v1/users/"]).toBeDefined();
  const graphql = await handle(new Request("http://localhost/graphql", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { users { total } }" }),
  }));
  expect(graphql.status).toBe(200);
  expect((await graphql.json() as { data: { users: { total: number } } }).data.users.total).toBe(0);
  expect((await handle(new Request("http://localhost/api/v1/graphql", { method: "POST" }))).status).toBe(404);
});

test("enables CORS only for explicitly configured origins", async () => {
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "cors-test", name: "Admin", role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }), false, false, ["https://admin.example"]);
  const allowed = await app.handle(new Request("http://localhost/api/v1/health", { headers: { Origin: "https://admin.example" } }));
  expect(allowed.headers.get("access-control-allow-origin")).toBe("https://admin.example");
  const preflight = await app.handle(new Request("http://localhost/api/v1/health", { method: "OPTIONS", headers: { Origin: "https://admin.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("https://admin.example");
  expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  const denied = await app.handle(new Request("http://localhost/api/v1/health", { headers: { Origin: "https://untrusted.example" } }));
  expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  expect(normalizeCorsOrigins(["https://admin.example", "https://admin.example"])).toEqual(["https://admin.example"]);
  expect(() => normalizeCorsOrigins(["*"])).toThrow("exact http(s) origin");
  expect(() => normalizeCorsOrigins(["https://admin.example/path"])).toThrow("exact http(s) origin");
});

test("denies anonymous REST and GraphQL and enforces role permissions", async () => {
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const target = "http://localhost/api/v1/customers/";
  const graph = "http://localhost/graphql";
  const anonymous = await createApp(repositories);
  expect((await anonymous.handle(new Request(target))).status).toBe(401);
  expect((await anonymous.handle(new Request(graph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ users { total } }" }) }))).status).toBe(401);
  const viewer = await createApp(repositories, async () => ({ id: "viewer", name: "Viewer", role: "viewer", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }));
  expect((await viewer.handle(new Request(target))).status).toBe(200);
  expect((await viewer.handle(new Request(target, { method: "DELETE" }))).status).toBe(403);
  expect((await viewer.handle(new Request(graph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { deleteUsers(id: \"00000000-0000-4000-8000-000000000002\") { id } }" }) }))).status).toBe(403);
});

test("passes the authenticated actor through REST and GraphQL mutations", async () => {
  const actors: Array<string | undefined> = [];
  const id = "00000000-0000-4000-8000-000000000002";
  const tracked = { ...repository, async delete(_id: string, actorId?: string) { actors.push(actorId); return { id }; } };
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, tracked])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id, name: "Admin", role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }));
  expect((await app.handle(new Request("http://localhost/api/v1/users/" + id, { method: "DELETE" }))).status).toBe(200);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { deleteUsers(id: \"" + id + "\") { id } }" }) }));
  expect(graph.status).toBe(200);
  expect(actors).toEqual([id, id]);
});

test("protects file storage endpoints and rejects traversal", async () => {
  Bun.env.QIY_STORAGE_METADATA = "memory";
  Bun.env.QIY_STORAGE_PROVIDER = "local";
  Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
  const repositories = Object.fromEntries(["users","customers","warehouses","products","inventoryItems","orders","orderItems"].map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }));
  const key = "orders/" + crypto.randomUUID() + ".txt";
  const fileUrl = "http://localhost/api/v1/files?key=" + encodeURIComponent(key) + "&fileName=invoice.txt&resource=orders&resourceId=00000000-0000-4000-8000-000000000001";
  const metadataUrl = "http://localhost/api/v1/files/metadata?key=" + encodeURIComponent(key);
  const upload = await app.handle(new Request(fileUrl, { method: "POST", body: "invoice" }));
  expect(upload.status).toBe(200);
  const metadata = await app.handle(new Request(metadataUrl));
  expect(metadata.status).toBe(200);
  expect(await metadata.json() as { ownerId: string; size: number; storageKey: string; fileName: string; resource: string; resourceId: string }).toMatchObject({ ownerId: "admin", size: 7, storageKey: key, fileName: "invoice.txt", resource: "orders", resourceId: "00000000-0000-4000-8000-000000000001" });
  expect((await app.handle(new Request(fileUrl, { method: "POST", body: "overwritten" }))).status).toBe(409);
  const download = await app.handle(new Request(fileUrl));
  expect(download.status).toBe(200);
  expect(await download.text()).toBe("invoice");
  const viewer = await createApp(repositories, async () => ({ id: "another-user", name: "Viewer", role: "viewer", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }));
  expect((await viewer.handle(new Request(fileUrl))).status).toBe(404);
  expect((await viewer.handle(new Request(metadataUrl))).status).toBe(404);
  expect((await app.handle(new Request("http://localhost/api/v1/files?key=../secret"))).status).toBe(400);
  expect((await app.handle(new Request(fileUrl, { method: "DELETE" }))).status).toBe(200);
  expect((await app.handle(new Request(metadataUrl))).status).toBe(404);
});
