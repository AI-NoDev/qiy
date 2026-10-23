import { expect, test } from "bun:test";

test("SQLite enforces tenant scope on reads and writes", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { WarehousesRepository: repository } = await import("../src/modules/warehouses/warehouses.repository");
  client.exec("DROP TABLE IF EXISTS \"warehouses\"; DROP TABLE IF EXISTS \"audit_events\"; CREATE TABLE \"warehouses\" (\"id\" text primary key, \"orgId\" text not null, \"code\" text not null, \"name\" text not null, \"active\" text not null); CREATE TABLE \"audit_events\" (\"id\" text primary key, \"actorId\" text, \"action\" text not null, \"resource\" text not null, \"resourceId\" text, \"metadata\" text, \"createdAt\" integer not null);");
  const first = { field: "orgId", value: "tenant-a" };
  const second = { field: "orgId", value: "tenant-b" };
  const values = { "orgId": "00000000-0000-4000-8000-000000000002", "code": "Example", "name": "Example", "active": "active" };
  const owned = await repository.create({ ...values, "orgId": second.value }, "actor", first);
  const foreign = await repository.create(values, "actor", second);
  expect(owned["orgId"]).toBe(first.value);
  expect((await repository.list(1, 20, { scope: first })).total).toBe(1);
  expect((await repository.list(1, 20, { scope: second })).total).toBe(1);
  expect(await repository.one(String(foreign.id), first)).toBeUndefined();
  expect(await repository.update(String(foreign.id), { "orgId": first.value }, "actor", first)).toBeUndefined();
  expect(await repository.delete(String(foreign.id), "actor", first)).toBeUndefined();
  expect(await repository.deleteMany([String(owned.id), String(foreign.id)], "actor", first)).toHaveLength(1);
  expect(await repository.one(String(foreign.id), second)).toBeDefined();
  const updated = await repository.update(String(foreign.id), { "orgId": first.value }, "actor", second);
  expect(updated?.["orgId"]).toBe(second.value);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(4);

});
