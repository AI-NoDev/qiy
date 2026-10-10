import { expect, test } from "bun:test";

test("SQLite enforces tenant scope on reads and writes", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { RecordsRepository: repository } = await import("../src/modules/records/records.repository");
  client.exec("DROP TABLE IF EXISTS \"records\"; DROP TABLE IF EXISTS \"audit_events\"; CREATE TABLE \"records\" (\"id\" text primary key, \"tenantId\" text not null, \"title\" text not null, \"createdAt\" integer); CREATE TABLE \"audit_events\" (\"id\" text primary key, \"actorId\" text, \"action\" text not null, \"resource\" text not null, \"resourceId\" text, \"metadata\" text, \"createdAt\" integer not null);");
  const first = { field: "tenantId", value: "tenant-a" };
  const second = { field: "tenantId", value: "tenant-b" };
  const values = {"tenantId":"Example","title":"Example"};
  const owned = await repository.create({ ...values, "tenantId": second.value }, "actor", first);
  const foreign = await repository.create(values, "actor", second);
  expect(owned["tenantId"]).toBe(first.value);
  expect((await repository.list(1, 20, { scope: first })).total).toBe(1);
  expect((await repository.list(1, 20, { scope: second })).total).toBe(1);
  expect(await repository.one(String(foreign.id), first)).toBeUndefined();
  expect(await repository.update(String(foreign.id), { "tenantId": first.value }, "actor", first)).toBeUndefined();
  expect(await repository.delete(String(foreign.id), "actor", first)).toBeUndefined();
  expect(await repository.deleteMany([String(owned.id), String(foreign.id)], "actor", first)).toHaveLength(1);
  expect(await repository.one(String(foreign.id), second)).toBeDefined();
  const updated = await repository.update(String(foreign.id), { "tenantId": first.value }, "actor", second);
  expect(updated?.["tenantId"]).toBe(second.value);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(4);
  const { createRecordsService } = await import("../src/modules/records/records.service");
  const service = createRecordsService(repository);
  const dated = await service.create({ ...values, createdAt: "2026-01-01T00:00:00.000Z" }, "actor", first);
  expect(dated.createdAt).toBeInstanceOf(Date);
  expect((dated.createdAt as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  const changed = await service.update(String(dated.id), { createdAt: "2026-01-02T00:00:00.000Z" }, "actor", first);
  expect((changed?.createdAt as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  expect((await repository.one(String(dated.id), first))?.createdAt).toBeInstanceOf(Date);
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const onDay = (offset: number) => new Date(midnight + offset * 86400000 + 12 * 3600000);
  for (const [offset, tenant] of [[-1, first], [0, first], [0, first], [0, second], [-2, first], [1, first]] as const) {
    await repository.create({ ...values, createdAt: onDay(offset) }, "actor", tenant);
  }
  expect(await repository.trend("createdAt", 2, first)).toEqual([
    { day: onDay(-1).toISOString().slice(0, 10), count: 1 },
    { day: onDay(0).toISOString().slice(0, 10), count: 2 },
  ]);
  expect(await repository.trend("createdAt", 2, second)).toEqual([{ day: onDay(0).toISOString().slice(0, 10), count: 1 }]);
  await expect(repository.trend("createdAt", 366, first)).rejects.toThrow("Invalid trend query");

});
