import { expect, test } from "bun:test";

test("SQLite CRUD audit rolls back the mutation when the audit insert fails", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { UsersRepository } = await import("../src/modules/users/users.repository");
  client.exec("DROP TABLE IF EXISTS \"users\"; DROP TABLE IF EXISTS \"audit_events\"; DROP TABLE IF EXISTS \"qiy_code_sequences\"; CREATE TABLE \"users\" (\"id\" text primary key, \"subject\" text not null, \"oktaSubject\" text, \"keycloakSubject\" text, \"googleSubject\" text, \"kindeSubject\" text, \"azureSubject\" text, \"email\" text not null, \"displayName\" text, \"role\" text not null, \"passwordHash\" text, \"oauthProfiles\" text, \"permissions\" text, \"orgId\" text); CREATE TABLE \"audit_events\" (\"id\" text primary key, \"actorId\" text, \"action\" text not null, \"resource\" text not null, \"resourceId\" text, \"metadata\" text, \"createdAt\" integer not null);");
  const actorId = "00000000-0000-4000-8000-000000000001";
  const values = { "subject": "Example", "email": "Example", "role": "admin" };
  const created = await UsersRepository.create(values, actorId);
  expect(created.id).toBeTruthy();
  expect(client.query<{ action: string; actorId: string }, []>("select action, actorId from audit_events").get()).toEqual({ action: "users.created", actorId });
  client.exec("DROP TABLE audit_events");
  await expect(UsersRepository.create(values, actorId)).rejects.toThrow();
  expect(client.query<{ total: number }, []>("select count(*) as total from users").get()?.total).toBe(1);
});
