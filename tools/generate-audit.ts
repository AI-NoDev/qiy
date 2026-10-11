import type { DatabaseIR } from "./database-ir";
import type { QiyProject } from "./qiy-project";

export function generateAudit(database: DatabaseIR, auth: NonNullable<QiyProject["auth"]>, scopes: QiyProject["scopes"]): Record<string, string> {
  const user = database.entities.find((entity) => entity.name === auth.userEntity)!;
  const nameField = user.fields.find((field) => field.name === "displayName")?.name;
  const scoped = database.entities.filter((entity) => scopes?.some((scope) => scope.resource === entity.name || scope.resource === entity.tableName)).map((entity) => entity.tableName);
  return {
    ...(database.dialect === "sqlite" ? {
      "api/tests/audit-read.test.ts": `import { expect, test } from "bun:test";
import { client } from "../src/db";
import { readAudit } from "../src/audit/repository";

test("audit query joins the configured author model without exposing credentials and retains deleted authors", async () => {
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS audit_events; CREATE TABLE audit_events (id text primary key, actorId text, resource text not null, resourceId text, action text not null, metadata text, createdAt integer not null); DROP TABLE IF EXISTS "${user.tableName}"; CREATE TABLE "${user.tableName}" ("${user.fields.find((field) => field.name === "id")?.columnName ?? "id"}" text primary key${nameField ? `, "${user.fields.find((field) => field.name === nameField)?.columnName ?? nameField}" text` : ""});`)});
  client.query(${JSON.stringify(`INSERT INTO "${user.tableName}" VALUES (?${nameField ? ", ?" : ""})`)}).run("author-id"${nameField ? ', "Public author"' : ""});
  const insert = client.query("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?)");
  insert.run("event-1", "author-id", "${database.entities[0]!.tableName}", "record", "updated", '{"password":"never-expose"}', 1000);
  insert.run("event-2", "author-id", "${database.entities[0]!.tableName}", "other", "deleted", "{}", 2000);
  const result = await readAudit({ resource: "${database.entities[0]!.tableName}", resourceId: "record", page: 1, pageSize: 10 });
  expect(result.total).toBe(1); expect(result.data[0]?.author).toMatchObject({ id: "author-id", deleted: false });
  expect(JSON.stringify(result)).not.toContain("never-expose");
  expect(result.data[0]?.createdAt).toBe("1970-01-01T00:00:01.000Z");
  expect((await readAudit({ resource: "${database.entities[0]!.tableName}", page: 2, pageSize: 1 })).data[0]?.id).toBe("event-1");
  client.query(${JSON.stringify(`DELETE FROM "${user.tableName}"`)}).run();
  expect((await readAudit({ resource: "${database.entities[0]!.tableName}", action: "updated", actorId: "author-id", page: 1, pageSize: 10 })).data[0]?.author).toEqual({ id: "author-id", name: "author-id", deleted: true });
});
`,
    } : {}),
    "api/src/audit/routes.ts": `import { Elysia, t } from "elysia";
import type { Authenticator } from "../auth/guard";

export type AuditQuery = { resource: string; resourceId?: string; action?: string; actorId?: string; page: number; pageSize: number };
export type AuditReader = (query: AuditQuery) => Promise<{ data: unknown[]; total: number }>;
const resources = new Set<string>(${JSON.stringify(database.entities.map((entity) => entity.tableName))});
const scopedResources = new Set<string>(${JSON.stringify(scoped)});
export function createAuditRoutes(authenticate: Authenticator, read: AuditReader = async (query) => (await import("./repository")).readAudit(query)) {
  return new Elysia({ prefix: "/api/v1/audit-logs" }).get("/", async ({ request, query, status, set }) => {
    set.headers["Cache-Control"] = "no-store";
    let principal;
    try { principal = await authenticate(request); } catch { return status(401, { error: "Invalid credentials" }); }
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Audit history is restricted to administrators" });
    if (!resources.has(query.resource)) return status(400, { error: "Unknown audit resource" });
    if (scopedResources.has(query.resource)) return status(403, { error: "Tenant audit history requires persisted scope metadata" });
    return read({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 20 });
  }, { query: t.Object({ resource: t.String(), resourceId: t.Optional(t.String({ maxLength: 200 })), action: t.Optional(t.String({ maxLength: 200 })), actorId: t.Optional(t.String({ format: "uuid" })), page: t.Optional(t.Numeric({ minimum: 1, maximum: 1000000, multipleOf: 1 })), pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })) }), detail: { tags: ["Audit"], summary: "Read authoritative resource audit history" } });
}
`,
    "api/src/audit/repository.ts": `import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, ${user.name} } from "../schema";
import type { AuditQuery } from "./routes";

export async function readAudit(query: AuditQuery) {
  const condition = and(eq(auditEvents.resource, query.resource), query.resourceId === undefined ? undefined : eq(auditEvents.resourceId, query.resourceId), query.action === undefined ? undefined : eq(auditEvents.action, query.action), query.actorId === undefined ? undefined : eq(auditEvents.actorId, query.actorId));
  const rows = await db.select({ id: auditEvents.id, actorId: auditEvents.actorId, action: auditEvents.action, resource: auditEvents.resource, resourceId: auditEvents.resourceId, createdAt: auditEvents.createdAt, authorId: ${user.name}.id${nameField ? `, authorName: ${user.name}.${nameField}` : ""} }).from(auditEvents).leftJoin(${user.name}, eq(auditEvents.actorId, ${user.name}.id)).where(condition).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  const totals = await db.select({ total: count() }).from(auditEvents).where(condition);
  return { data: rows.map((row) => ({ id: row.id, resource: row.resource, action: row.action, createdAt: ${database.dialect === "mysql" ? "new Date(row.createdAt)" : "row.createdAt"}.toISOString(), author: row.actorId ? { id: row.actorId, name: ${nameField ? "row.authorName ?? " : ""}row.actorId, deleted: row.authorId === null } : null, meta: { id: row.resourceId } })), total: Number(totals[0]?.total ?? 0) };
}
`,
    "api/tests/audit-routes.test.ts": `import { expect, test } from "bun:test";
import { createAuditRoutes, type AuditQuery } from "../src/audit/routes";
import type { Principal } from "../src/auth/guard";

test("audit API protects history and validates pagination without trusting client authors", async () => {
  let principal: Principal | null = null;
  const calls: AuditQuery[] = [];
  const app = createAuditRoutes(async () => principal, async (query) => { calls.push(query); return { data: [{ id: "event", author: { id: "trusted" } }], total: 1 }; });
  const endpoint = "http://localhost/api/v1/audit-logs/?resource=" + ${JSON.stringify(database.entities.find((entity) => !scoped.includes(entity.tableName))?.tableName ?? database.entities[0]!.tableName)};
  expect((await app.handle(new Request(endpoint))).status).toBe(401);
  principal = { id: "actor", name: "User", role: "operator" };
  expect((await app.handle(new Request(endpoint))).status).toBe(403);
  principal.role = "admin";
  expect((await app.handle(new Request(endpoint + "&pageSize=101"))).status).toBe(422);
  expect((await app.handle(new Request(endpoint + "&page=1.5"))).status).toBe(422);
  expect((await app.handle(new Request("http://localhost/api/v1/audit-logs/?resource=unknown"))).status).toBe(400);
  ${database.entities.some((entity) => !scoped.includes(entity.tableName)) ? `const result = await app.handle(new Request(endpoint + "&page=2&pageSize=10&action=reviewed&resourceId=record"));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect((await result.json()).data[0].author.id).toBe("trusted");
  expect(calls[0]).toMatchObject({ page: 2, pageSize: 10, action: "reviewed", resourceId: "record" });` : ""}
  ${scoped.map((resource) => `expect((await app.handle(new Request("http://localhost/api/v1/audit-logs/?resource=${resource}"))).status).toBe(403);`).join("\n  ")}
  expect((await app.handle(new Request(endpoint, { method: "POST", body: "{}" }))).status).toBe(404);
});
`,
  };
}
