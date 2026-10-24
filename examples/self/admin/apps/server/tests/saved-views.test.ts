import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { QiySavedView } from "../src/saved-views";

const dialect = "sqlite";
const available = true;
const resource = "users";
const ddl = "CREATE TABLE IF NOT EXISTS \"qiy_saved_views\" (\"id\" text primary key, \"resource\" text not null, \"name\" text not null, \"ownerId\" text not null, \"shared\" integer not null, \"search\" text, \"filters\" text, \"sorters\" text, \"columns\" text, \"createdAt\" integer not null, \"updatedAt\" integer not null)";
const carolRows = "DELETE FROM \"qiy_saved_views\" WHERE \"ownerId\" = '00000000-0000-4000-8000-0000000000c1'";

type Principal = { id: string; name: string; role: "admin" | "operator" | "viewer" };
const alice: Principal = { id: "00000000-0000-4000-8000-0000000000a1", name: "Alice", role: "admin" };
const bob: Principal = { id: "00000000-0000-4000-8000-0000000000b1", name: "Bob", role: "operator" };
const carol: Principal = { id: "00000000-0000-4000-8000-0000000000c1", name: "Carol", role: "operator" };

async function sql(statement: string): Promise<void> {
  const { client } = await import("../src/db");
  await client.exec(statement);
}

async function setup() {
  await sql(ddl);
  const { createSavedViewsRoutes } = await import("../src/saved-views");
  let current: Principal | undefined = alice;
  const app = new Elysia().use(createSavedViewsRoutes(async () => current ?? null));
  const request = (user: Principal | undefined, path: string, init?: RequestInit) => { current = user; return app.handle(new Request("http://localhost" + path, init)); };
  const list = async (user: Principal): Promise<QiySavedView[]> => {
    const response = await request(user, "/api/v1/saved-views?resource=" + resource);
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: QiySavedView[] }).items;
  };
  const create = (user: Principal, body: Record<string, unknown>) => request(user, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...body }) });
  const remove = (user: Principal | undefined, id: string) => request(user, "/api/v1/saved-views/" + id, { method: "DELETE" });
  return { request, list, create, remove };
}

test.skipIf(!available)("publishing the same name twice upserts one row and reports ownership", async () => {
  const { list, create } = await setup();
  const first = await create(alice, { name: "open-items", shared: true, search: "one", columns: ["id"] });
  expect(first.status).toBe(201);
  const created = (await first.json()) as QiySavedView;
  expect(created).toMatchObject({ resource, name: "open-items", ownerId: alice.id, shared: true, mine: true, search: "one", columns: ["id"] });

  // Republishing the same name keeps the id and replaces the stored payload.
  const second = await create(alice, { name: "open-items", shared: true, search: "two", columns: ["id", "title"] });
  expect(second.status).toBe(201);
  const updated = (await second.json()) as QiySavedView;
  expect(updated.id).toBe(created.id);
  expect(updated).toMatchObject({ search: "two", columns: ["id", "title"] });
  expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());

  // Exactly one row survives, and another user sees the shared copy flagged as not mine.
  expect((await list(alice)).filter((view) => view.name === "open-items")).toHaveLength(1);
  const sharedCopies = (await list(carol)).filter((view) => view.name === "open-items");
  expect(sharedCopies).toHaveLength(1);
  expect(sharedCopies[0]).toMatchObject({ id: created.id, ownerId: alice.id, mine: false });

  // Private views never leak into another user's list.
  await create(alice, { name: "admin-only" });
  expect((await list(carol)).some((view) => view.name === "admin-only")).toBe(false);
});

test.skipIf(!available)("owners and admins delete views while others get 403, 404 or 401", async () => {
  const { list, create, remove } = await setup();
  const adminView = (await (await create(alice, { name: "admin-private" })).json()) as QiySavedView;
  const bobShared = (await (await create(bob, { name: "bob-shared", shared: true })).json()) as QiySavedView;

  // A non-owner cannot delete another user's row, even a shared one.
  expect((await remove(bob, adminView.id)).status).toBe(403);
  // An admin may clean up another user's shared row.
  expect((await remove(alice, bobShared.id)).status).toBe(204);
  expect((await list(bob)).some((view) => view.id === bobShared.id)).toBe(false);
  // Owners delete their own rows; deleting twice is a 404.
  const ownView = (await (await create(bob, { name: "bob-own" })).json()) as QiySavedView;
  expect((await remove(bob, ownView.id)).status).toBe(204);
  expect((await remove(bob, ownView.id)).status).toBe(404);
  // Anonymous deletes are rejected before ownership is considered.
  expect((await remove(undefined, adminView.id)).status).toBe(401);
  expect((await list(alice)).some((view) => view.id === adminView.id)).toBe(true);
});

test.skipIf(!available)("validates the resource, the name and the caller", async () => {
  const { request, create } = await setup();
  expect((await request(undefined, "/api/v1/saved-views?resource=" + resource)).status).toBe(401);
  expect((await request(alice, "/api/v1/saved-views?resource=not-a-resource")).status).toBe(400);
  expect((await create(alice, { name: "   " })).status).toBe(400);
  expect((await create(alice, { name: "wrong-resource", resource: "not-a-resource" })).status).toBe(400);
  const anonymous = await request(undefined, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, name: "anonymous" }) });
  expect(anonymous.status).toBe(401);
});

test.skipIf(!available)("caps distinct view names but keeps upserting existing names", async () => {
  const { list, create } = await setup();
  // The test principal is unique, so it owns exactly the rows created here.
  await sql(carolRows);
  for (let index = 0; index < 100; index++) expect((await create(carol, { name: "bulk-" + index })).status).toBe(201);
  const rejected = await create(carol, { name: "one-too-many" });
  expect(rejected.status).toBe(400);
  expect(((await rejected.json()) as { errorKey?: string }).errorKey).toBe("views.limit");
  // Republishing an existing name updates in place and is not blocked by the cap.
  expect((await create(carol, { name: "bulk-0", search: "updated" })).status).toBe(201);
  const own = (await list(carol)).filter((view) => view.ownerId === carol.id && view.resource === resource);
  expect(own).toHaveLength(100);
  expect(own.find((view) => view.name === "bulk-0")?.search).toBe("updated");
});
