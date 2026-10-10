import { expect, test } from "bun:test";

test("SQLite CRUD audit rolls back the mutation when the audit insert fails", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { RecordsRepository } = await import("../src/modules/records/records.repository");
  client.exec("DROP TABLE IF EXISTS \"records\"; DROP TABLE IF EXISTS \"audit_events\"; CREATE TABLE \"records\" (\"id\" text primary key, \"tenantId\" text not null, \"title\" text not null, \"createdAt\" text); CREATE TABLE \"audit_events\" (\"id\" text primary key, \"actorId\" text, \"action\" text not null, \"resource\" text not null, \"resourceId\" text, \"metadata\" text, \"createdAt\" integer not null);");
  const actorId = "00000000-0000-4000-8000-000000000001";
  const values = {"tenantId":"Example","title":"Example"};
  const created = await RecordsRepository.create(values, actorId);
  expect(created.id).toBeTruthy();
  expect(client.query<{ action: string; actorId: string }, []>("select action, actorId from audit_events").get()).toEqual({ action: "records.created", actorId });
  client.exec("DROP TABLE audit_events");
  await expect(RecordsRepository.create(values, actorId)).rejects.toThrow();
  expect(client.query<{ total: number }, []>("select count(*) as total from records").get()?.total).toBe(1);
});
