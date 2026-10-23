import { expect, test } from "bun:test";
import { client } from "../src/db";
import { readAudit } from "../src/audit/repository";

test("audit query joins the configured author model without exposing credentials and retains deleted authors", async () => {
  client.exec("DROP TABLE IF EXISTS audit_events; CREATE TABLE audit_events (id text primary key, actorId text, resource text not null, resourceId text, action text not null, metadata text, createdAt integer not null); DROP TABLE IF EXISTS \"users\"; CREATE TABLE \"users\" (\"id\" text primary key, \"displayName\" text);");
  client.query("INSERT INTO \"users\" VALUES (?, ?)").run("author-id", "Public author");
  const insert = client.query("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?)");
  insert.run("event-1", "author-id", "users", "record", "updated", '{"password":"never-expose"}', 1000);
  insert.run("event-2", "author-id", "users", "other", "deleted", "{}", 2000);
  const result = await readAudit({ resource: "users", resourceId: "record", page: 1, pageSize: 10 });
  expect(result.total).toBe(1); expect(result.data[0]?.author).toMatchObject({ id: "author-id", deleted: false });
  expect(JSON.stringify(result)).not.toContain("never-expose");
  expect(result.data[0]?.createdAt).toBe("1970-01-01T00:00:01.000Z");
  expect((await readAudit({ resource: "users", page: 2, pageSize: 1 })).data[0]?.id).toBe("event-1");
  client.query("DELETE FROM \"users\"").run();
  expect((await readAudit({ resource: "users", action: "updated", actorId: "author-id", page: 1, pageSize: 10 })).data[0]?.author).toEqual({ id: "author-id", name: "author-id", deleted: true });
});
