import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseQiyProject, serializeQiyProject } from "./qiy-project";
import { generateApp } from "./commands/generate-app";

const dialect = process.argv[3] ?? "postgresql";
if (dialect !== "postgresql" && dialect !== "mysql") throw new Error("Expected postgresql or mysql dialect");
const mysql = dialect === "mysql";
const label = mysql ? "MySQL" : "PostgreSQL";
const container = process.argv[2] ?? (mysql ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const databaseName = `qiy_flow_${crypto.randomUUID().replaceAll("-", "")}`;
const root = mkdtempSync(join(tmpdir(), `qiy-${dialect}-dataflow-`));
async function run(command: string[], cwd = root, databaseUrl?: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}) }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command[0]} ${command[1]} failed (${code}): ${(stdout + stderr).replaceAll(databaseUrl ?? "__no_url__", "[database URL]")}`);
  return command[1] === "test" ? stdout + stderr : stdout;
}
const inspected = JSON.parse(await run(["docker", "inspect", container]))[0];
const settings = Object.fromEntries((inspected.Config.Env as string[]).map((value) => { const index = value.indexOf("="); return [value.slice(0, index), value.slice(index + 1)]; }));
const username = mysql ? "root" : settings.POSTGRES_USER ?? "postgres";
const password = mysql ? settings.MYSQL_ROOT_PASSWORD : settings.POSTGRES_PASSWORD;
const port = inspected.NetworkSettings.Ports[mysql ? "3306/tcp" : "5432/tcp"]?.[0]?.HostPort;
if (!port || !password) throw new Error(`${label} container requires a published port and configured password`);
const databaseUrl = `${mysql ? "mysql" : "postgres"}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
async function administration(statement: string): Promise<void> {
  await run(mysql
    ? ["docker", "exec", "-e", `MYSQL_PWD=${password}`, container, "mysql", "-u", username, "-e", statement]
    : ["docker", "exec", container, "psql", "-U", username, "-d", "postgres", "-c", statement]);
}
await administration(`CREATE DATABASE ${databaseName}`);
try {
  const project = parseQiyProject(readFileSync("examples/dataflow/app.qiy", "utf8").replace("database sqlite", `database ${dialect}`));
  project.database.enums = [{ name: "userRole", values: [{ name: "admin" }, { name: "operator" }, { name: "viewer" }] }];
  project.database.entities.push({
    name: "users",
    tableName: "users",
    fields: [
      { name: "id", type: "UUID", primaryKey: true, nullable: false },
      { name: "email", type: "Text", unique: true, nullable: false },
      { name: "displayName", type: "Text", nullable: true },
      { name: "password", type: "Text", nullable: true },
      { name: "role", type: "Text", enumName: "userRole", nullable: false },
      { name: "tenantId", type: "Text", nullable: true },
    ],
  });
  project.auth = { provider: "local", userEntity: "users", usernameField: "email", passwordField: "password", roleField: "role", subjectField: "id" };
  project.database.entities[0]!.fields.push({ name: "tenantId", columnName: "tenantId", type: "Text", nullable: false, primaryKey: false });
  project.database.enums.push({ name: "reviewDecision", values: [{ name: "approved" }, { name: "rejected" }] });
  project.database.entities[0]!.fields.push({ name: "quantity", type: "Integer", nullable: true }, { name: "decision", type: "Text", enumName: "reviewDecision", nullable: true });
  project.scopes = [{ resource: "connectors", field: "tenantId", claim: "tenant.id" }, { resource: "reviews", field: "tenantId", claim: "tenant.id" }];
  project.dataflows![0]!.steps.push({ name: "publish", order: 25, actions: [{ kind: "emit", event: "connector.revoked", payload: [{ name: "connectorId", source: "context", context: "connector", value: "id" }, { name: "status", source: "context", context: "connector", value: "status" }, { name: "reason", source: "input", value: "reason" }, { name: "source", source: "literal", value: "qiy-acceptance" }] }] });
  project.apiClient = "rest";
  project.realtime = { mode: "auto", resources: [{ resource: "connectors", events: ["updated"], roles: ["admin", "operator"] }] };
  project.actions = [{ name: "batchRevokeConnectors", resource: "connectors", placements: ["list"], batch: true, label: "Revoke selected", target: { kind: "dataflow", dataflow: "revokeConnector" } }];
  const failure = structuredClone(project.dataflows![0]!);
  failure.name = "rollbackConnector";
  failure.steps.push({ name: "rejectAfterWrite", order: 30, actions: [{ kind: "require", left: "connector.status", operator: "==", right: "active", error: "Intentional rollback" }] });
  project.dataflows!.push(failure);
  const reviewEntity = structuredClone(project.database.entities[0]!);
  reviewEntity.name = "reviews";
  reviewEntity.tableName = "reviews";
  project.database.entities.push(reviewEntity);
  const crossTable = structuredClone(project.dataflows![0]!);
  crossTable.name = "revokeWithReview";
  crossTable.input.push({ name: "reviewId", type: "UUID", required: true });
  crossTable.context.push({ name: "review", entity: "reviews", id: "id:input.reviewId", required: true });
  crossTable.steps.push({ name: "recordReview", order: 30, actions: [{ kind: "require", left: "review.status", operator: "==", right: "active", error: "Review is closed" }, { kind: "update", context: "review", values: [{ field: "status", value: "completed" }] }] });
  project.dataflows!.push(crossTable);
  const adminOnly = structuredClone(project.dataflows![0]!);
  adminOnly.name = "adminRevokeConnector";
  adminOnly.roles = ["admin"];
  project.dataflows!.push(adminOnly);
  const typed = structuredClone(project.dataflows![0]!);
  typed.name = "typedRevokeConnector";
  typed.input.push({ name: "quantity", type: "Integer", required: true }, { name: "decision", type: "reviewDecision", required: true });
  typed.steps.unshift({ name: "validateQuantity", order: 5, actions: [{ kind: "require", left: "input.quantity", operator: ">=", right: 0, error: "Quantity must not be negative" }, { kind: "require", left: "input.quantity", operator: "<=", right: 100, error: "Quantity exceeds capacity" }] });
  typed.steps.push({ name: "writeTypedInputs", order: 30, actions: [{ kind: "update", context: "connector", values: [{ field: "quantity", value: "quantity", source: "input" }, { field: "decision", value: "decision", source: "input" }] }] });
  project.dataflows!.push(typed);
  const typedFailure = structuredClone(typed);
  typedFailure.name = "typedRollbackConnector";
  typedFailure.steps.push({ name: "rejectTypedWrite", order: 40, actions: [{ kind: "require", left: "input.quantity", operator: "<", right: 0, error: "Intentional typed rollback" }] });
  project.dataflows!.push(typedFailure);
  const createReview = {
    name: "createReview", roles: ["operator" as const], idempotency: { required: true }, audit: "review.created",
    input: [{ name: "reason", type: "Text", required: true }], context: [],
    steps: [{ name: "create", order: 10, actions: [{ kind: "create" as const, context: "review", entity: "reviews", values: [{ field: "status", value: "active" }, { field: "revokedReason", value: "reason", source: "input" as const }] }] }],
    result: "review",
  };
  const deleteReview = {
    name: "deleteReview", roles: ["operator" as const], idempotency: { required: true }, audit: "review.deleted",
    input: [{ name: "reviewId", type: "UUID", required: true }, { name: "reason", type: "Text", required: true }],
    context: [{ name: "review", entity: "reviews", id: "id:input.reviewId", required: true }],
    steps: [{ name: "delete", order: 10, actions: [{ kind: "delete" as const, context: "review" }] }], result: "review",
  };
  project.dataflows!.push(createReview, deleteReview);
  for (const flow of [createReview, deleteReview]) {
    const rollback = structuredClone(flow) as NonNullable<typeof project.dataflows>[number];
    rollback.name += "Rollback";
    rollback.steps.push({ name: "fail", order: 20, actions: [{ kind: "require", left: "input.reason", operator: "==", right: "never", error: "Intentional mutation rollback" }] });
    project.dataflows!.push(rollback);
  }
  const model = join(root, "app.qiy");
  writeFileSync(model, serializeQiyProject(project));
  const output = join(root, "admin");
  await generateApp(model, output);
  await run([process.execPath, "install"], output);
  const server = join(output, "apps/server");
  await run([process.execPath, "run", "--bun", "drizzle-kit", "generate"], server, databaseUrl);
  await run([process.execPath, "run", "--bun", "drizzle-kit", "migrate"], server, databaseUrl);
  mkdirSync(join(server, "tests"), { recursive: true });
  const testFile = `tests/${dialect}-dataflow.integration.test.ts`;
  writeFileSync(join(server, testFile), `import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { client, db } from "../src/db";
import { auditEvents, connectors, reviews, dataflowOutbox, realtimeOutbox } from "../src/schema";
import { createDataflowRoutes } from "../src/dataflows";
import { createRealtimeRoutes, dispatchRealtimeOutbox } from "../src/realtime";
const actorId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const reviewId = "00000000-0000-4000-8000-000000000003";
const secondConnectorId = "00000000-0000-4000-8000-000000000004";
const app = createDataflowRoutes(async (request) => ({ id: actorId, name: "Operator", role: request.headers.get("x-qiy-test-role") === "admin" ? "admin" : "operator", claims: { "tenant.id": request.headers.get("x-qiy-test-tenant") === "missing" ? null : request.headers.get("x-qiy-test-tenant") ?? "tenant-a" } }));
${mysql ? `async function executeSql(statement: string): Promise<Array<{ total: number }>> {
  const [rows] = await client.query(statement);
  return rows as Array<{ total: number }>;
}` : `async function executeSql(statement: string): Promise<Array<{ total: number }>> {
  return await client.unsafe(statement);
}`}
async function request(key: string, flow = "revokeConnector", reason = "review", tenant = "tenant-a") {
  return app.handle(new Request("http://localhost/api/v1/commands/" + flow, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, "x-qiy-test-tenant": tenant }, body: JSON.stringify({ connectorId, reason, ...(flow === "revokeWithReview" ? { reviewId } : {}) }) }));
}
async function counts() {
  const audit = await executeSql('SELECT count(*) as total FROM audit_events');
  const receipts = await executeSql('SELECT count(*) as total FROM dataflow_idempotency');
  return [Number(audit[0]?.total), Number(receipts[0]?.total)];
}
beforeEach(async () => {
  for (const table of ["connectors", "reviews", "audit_events", "dataflow_idempotency", "dataflow_outbox", "qiy_realtime_outbox"]) await executeSql('DELETE FROM ' + table);
  await db.insert(connectors).values({ id: connectorId, status: "active", tenantId: "tenant-a" });
  await db.insert(reviews).values({ id: reviewId, status: "active", tenantId: "tenant-a" });
});
afterAll(async () => { await client.${mysql ? "end" : "close"}(); });
async function typedRequest(flow: string, key: string, quantity: unknown = 7, decision: unknown = "approved") {
  return app.handle(new Request("http://localhost/api/v1/commands/" + flow, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ connectorId, reason: "typed review", quantity, decision }) }));
}
async function mutationRequest(flow: string, key: string, tenant = "tenant-a") {
  return app.handle(new Request("http://localhost/api/v1/commands/" + flow, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, "x-qiy-test-tenant": tenant }, body: JSON.stringify({ reviewId, reason: "review" }) }));
}
async function batchRequest(key: string, items: Array<{ connectorId: string; reason: string }>) {
  return app.handle(new Request("http://localhost/api/v1/commands/revokeConnector/batch", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, "x-qiy-test-tenant": "tenant-a" }, body: JSON.stringify({ items }) }));
}
test("concurrent scoped creation inserts once and rejects replay under another tenant", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => mutationRequest("createReview", "create")));
  expect(responses.map((response) => response.status)).toEqual(Array(12).fill(200));
  const results = await Promise.all(responses.map((response) => response.json()));
  expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
  expect(results[0]).toMatchObject({ tenantId: "tenant-a", revokedReason: "review" });
  expect(await db.select().from(reviews)).toHaveLength(2);
  expect((await mutationRequest("createReview", "create", "tenant-b")).status).toBe(409);
  expect((await mutationRequest("createReview", "missing", "missing")).status).toBe(403);
  expect(await counts()).toEqual([1, 1]);
});
test("concurrent deletion replays its snapshot after the row is gone", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => mutationRequest("deleteReview", "delete")));
  expect(responses.map((response) => response.status)).toEqual(Array(12).fill(200));
  const results = await Promise.all(responses.map((response) => response.json()));
  expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
  expect(results[0]).toMatchObject({ id: reviewId, tenantId: "tenant-a" });
  expect(await db.select().from(reviews)).toHaveLength(0);
  expect((await mutationRequest("deleteReview", "delete", "tenant-b")).status).toBe(409);
  expect(await counts()).toEqual([1, 1]);
});
for (const flow of ["createReview", "deleteReview"]) {
  test(flow + " late business failure restores the original rows", async () => {
    const before = await db.select().from(reviews);
    expect((await mutationRequest(flow + "Rollback", "late-mutation")).status).toBe(409);
    expect(await db.select().from(reviews)).toEqual(before);
    expect(await counts()).toEqual([0, 0]);
    expect((await mutationRequest(flow, "late-mutation")).status).toBe(200);
  });
  for (const table of ["audit_events", "dataflow_idempotency"]) {
    test(flow + " rolls back on " + table + " failure and permits retry", async () => {
      const before = await db.select().from(reviews);
      await executeSql('ALTER TABLE ' + table + ' ADD CONSTRAINT qiy_injected_failure CHECK (false)${mysql ? "" : " NOT VALID"}');
      try {
        expect((await mutationRequest(flow, "mutation-failure")).status).toBe(500);
        expect(await db.select().from(reviews)).toEqual(before);
        expect(await counts()).toEqual([0, 0]);
      } finally {
        await executeSql('ALTER TABLE ' + table + ' DROP ${mysql ? "CHECK" : "CONSTRAINT"} qiy_injected_failure');
      }
      expect((await mutationRequest(flow, "mutation-failure")).status).toBe(200);
      expect(await counts()).toEqual([1, 1]);
    });
  }
}
test("typed integer and enum writes commit and replay with real database storage", async () => {
  expect((await typedRequest("typedRevokeConnector", "typed")).status).toBe(200);
  expect((await db.select().from(connectors))[0]).toMatchObject({ quantity: 7, decision: "approved" });
  expect((await typedRequest("typedRevokeConnector", "typed")).status).toBe(200);
  expect((await typedRequest("typedRevokeConnector", "typed", 8, "rejected")).status).toBe(409);
  expect(await counts()).toEqual([1, 1]);
});
test("typed inputs reject invalid payloads and roll back after late business failure", async () => {
  for (const [quantity, decision] of [[2147483648, "approved"], [1.5, "approved"], [7, "undeclared"]]) {
    expect((await typedRequest("typedRevokeConnector", "invalid-typed", quantity, decision)).status).toBe(422);
  }
  expect((await typedRequest("typedRollbackConnector", "typed-rollback")).status).toBe(409);
  expect((await db.select().from(connectors))[0]).toMatchObject({ status: "active", quantity: null, decision: null });
  expect(await counts()).toEqual([0, 0]);
  expect((await typedRequest("typedRevokeConnector", "typed-rollback")).status).toBe(200);
});
test("numeric domain guards reject valid integers without writes and allow same-key retry", async () => {
  for (const quantity of [-1, 101]) {
    expect((await typedRequest("typedRevokeConnector", "numeric-guard", quantity)).status).toBe(409);
    expect((await db.select().from(connectors))[0]?.status).toBe("active");
    expect(await counts()).toEqual([0, 0]);
  }
  expect((await typedRequest("typedRevokeConnector", "numeric-guard", 100)).status).toBe(200);
  expect((await db.select().from(connectors))[0]?.quantity).toBe(100);
  expect(await counts()).toEqual([1, 1]);
});
test("atomic batch rolls back an earlier item and persists one receipt after retry", async () => {
  await db.insert(connectors).values({ id: secondConnectorId, status: "revoked", tenantId: "tenant-a" });
  const items = [{ connectorId, reason: "batch review" }, { connectorId: secondConnectorId, reason: "batch review" }];
  const failed = await batchRequest("batch-atomic", items);
  expect(failed.status).toBe(409);
  expect(await failed.json()).toMatchObject({ item: { index: 1, id: secondConnectorId } });
  expect((await db.select().from(connectors)).map((row) => ({ id: row.id, status: row.status }))).toEqual(expect.arrayContaining([{ id: connectorId, status: "active" }, { id: secondConnectorId, status: "revoked" }]));
  expect(await counts()).toEqual([0, 0]);
  expect(await db.select().from(dataflowOutbox)).toHaveLength(0);
  await db.update(connectors).set({ status: "active" }).where(eq(connectors.id, secondConnectorId));
  const success = await batchRequest("batch-atomic", items);
  expect(success.status).toBe(200);
  const result = await success.json();
  expect(result).toHaveLength(2);
  expect((await db.select().from(connectors)).every((row) => row.status === "revoked")).toBe(true);
  expect(await counts()).toEqual([2, 1]);
  expect(await db.select().from(dataflowOutbox)).toHaveLength(2);
  expect(await (await batchRequest("batch-atomic", items)).json()).toEqual(result);
  expect((await batchRequest("batch-atomic", [...items].reverse())).status).toBe(409);
  expect((await batchRequest("batch-duplicate", [items[0]!, items[0]!])).status).toBe(400);
});
test("missing and foreign tenant claims cannot mutate business data", async () => {
  expect((await request("missing-claim", "revokeConnector", "review", "missing")).status).toBe(403);
  expect((await request("foreign-claim", "revokeConnector", "review", "tenant-b")).status).toBe(404);
  expect((await db.select().from(connectors))[0]?.status).toBe("active");
  expect(await counts()).toEqual([0, 0]);
});
test("committed receipts do not bypass current tenant scope", async () => {
  expect((await request("scope-replay")).status).toBe(200);
  expect((await request("scope-replay", "revokeConnector", "review", "tenant-b")).status).toBe(409);
  expect((await request("scope-replay", "revokeConnector", "review", "missing")).status).toBe(403);
  expect(await counts()).toEqual([1, 1]);
  expect((await request("scope-replay")).status).toBe(200);
});
test("command allowlist rejects an operator and rechecks permission on replay", async () => {
  expect((await request("restricted", "adminRevokeConnector")).status).toBe(403);
  expect((await db.select().from(connectors))[0]?.status).toBe("active");
  expect(await counts()).toEqual([0, 0]);
  const allowed = await app.handle(new Request("http://localhost/api/v1/commands/adminRevokeConnector", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "restricted", "x-qiy-test-role": "admin" }, body: JSON.stringify({ connectorId, reason: "approved by admin" }) }));
  expect(allowed.status).toBe(200);
  expect((await request("restricted", "adminRevokeConnector", "approved by admin")).status).toBe(403);
  expect((await db.select().from(connectors))[0]?.revokedReason).toBe("approved by admin");
  expect(await counts()).toEqual([1, 1]);
});
test("concurrent identical keys replay one committed command", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => request("same-key")));
  expect(responses.map((response) => response.status)).toEqual(Array(12).fill(200));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  expect(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true);
  expect(bodies[0]).toMatchObject({ revokedReason: "review" });
  expect((await db.select().from(connectors))[0]?.revokedReason).toBe("review");
  expect(await counts()).toEqual([1, 1]);
});
test("concurrent distinct keys enforce state transition once", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => request("key-" + index)));
  expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(11);
  expect(await counts()).toEqual([1, 1]);
});
test("failure after update rolls back state, audit and receipt", async () => {
  expect((await request("rollback", "rollbackConnector")).status).toBe(409);
  expect((await db.select().from(connectors))[0]?.status).toBe("active");
  expect(await counts()).toEqual([0, 0]);
  expect(await db.select().from(dataflowOutbox)).toHaveLength(0);
  expect(await db.select().from(realtimeOutbox)).toHaveLength(0);
  expect((await request("rollback")).status).toBe(200);
  expect(await db.select().from(dataflowOutbox)).toHaveLength(1);
  expect(await db.select().from(realtimeOutbox)).toHaveLength(1);
});
test("concurrent retries persist one event with a JSON text payload and actor", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => request("emit-once")));
  expect(responses.map((response) => response.status)).toEqual(Array(12).fill(200));
  const events = await db.select().from(dataflowOutbox);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ actorId, event: "connector.revoked" });
  expect(JSON.parse(events[0]!.payload)).toEqual({ flow: "revokeConnector", connectorId, status: "revoked", reason: "review", source: "qiy-acceptance" });
  expect(events[0]!.createdAt).toBeInstanceOf(Date);
  const realtimeEvents = await db.select().from(realtimeOutbox);
  expect(realtimeEvents).toHaveLength(1);
  expect(realtimeEvents[0]).toMatchObject({ channel: "qiy:event:connector.revoked", type: "connector.revoked", attempts: 0, deliveredAt: null });
  expect(JSON.parse(realtimeEvents[0]!.payload)).toEqual(JSON.parse(events[0]!.payload));
});
test("concurrent realtime workers claim one row with a database lease", async () => {
  expect((await request("realtime-lease")).status).toBe(200);
  await db.update(realtimeOutbox).set({ availableAt: new Date(0) });
  Bun.env.QIY_REALTIME_DISABLED = "0";
  Bun.env.QIY_REALTIME_LEASE_MS = "30000";
  const published: Array<{ channel: string; type: string }> = [];
  const client = { auth: { createTokenRequest: async () => ({}) }, channels: { get: (channel: string) => ({ publish: async (type: string) => { await Bun.sleep(100); published.push({ channel, type }); } }) } } as any;
  try {
    const results = await Promise.all([
      dispatchRealtimeOutbox(10, () => client, undefined, "worker-a"),
      dispatchRealtimeOutbox(10, () => client, undefined, "worker-b"),
    ]);
    expect(results.reduce((total, result) => total + result.delivered, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.failed, 0)).toBe(0);
    expect(published).toEqual([{ channel: "qiy:event:connector.revoked", type: "connector.revoked" }]);
    const rows = await db.select().from(realtimeOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(rows[0]?.leaseOwner).toBeNull();
    expect(rows[0]?.leaseUntil).toBeNull();
  } finally {
    Bun.env.QIY_REALTIME_DISABLED = "1";
  }
});
test("failed realtime delivery becomes an admin-replayable dead letter and delivered rows can be cleaned", async () => {
  const eventId = "00000000-0000-4000-8000-000000000099";
  const secondEventId = "00000000-0000-4000-8000-000000000100";
  const missingEventId = "00000000-0000-4000-8000-000000000101";
  await db.insert(realtimeOutbox).values({ id: eventId, channel: "qiy:event:test", type: "test.failed", payload: JSON.stringify({ id: eventId }), attempts: 0, availableAt: new Date(0), createdAt: new Date(0) });
  Bun.env.QIY_REALTIME_DISABLED = "0";
  Bun.env.QIY_REALTIME_MAX_ATTEMPTS = "1";
  const unavailable = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { throw new Error("provider unavailable"); } }) } } as any;
  try {
    expect(await dispatchRealtimeOutbox(10, () => unavailable, undefined, "worker-dead")).toEqual({ delivered: 0, failed: 0, deadLettered: 1 });
    expect((await db.select().from(realtimeOutbox))[0]).toMatchObject({ id: eventId, attempts: 1, leaseOwner: null, leaseUntil: null });
    expect((await db.select().from(realtimeOutbox))[0]?.deadLetteredAt).toBeInstanceOf(Date);
    await db.insert(realtimeOutbox).values({ id: secondEventId, channel: "qiy:event:test", type: "test.failed", payload: JSON.stringify({ id: secondEventId }), attempts: 1, availableAt: new Date(0), deadLetteredAt: new Date(0), createdAt: new Date(0) });
    const admin = new Elysia().use(createRealtimeRoutes(async () => ({ id: actorId, name: "Admin", role: "admin" }), () => unavailable));
    const list = await admin.handle(new Request("http://localhost/api/v1/realtime/outbox/dead"));
    expect(list.status).toBe(200);
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(2);
    const deadMetrics = await admin.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics"));
    expect(deadMetrics.status).toBe(200);
    expect(await deadMetrics.json()).toEqual({ pending: 0, leased: 0, deadLettered: 2, delivered: 0, oldestPendingAt: null });
    const bulkReplay = await admin.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [secondEventId, missingEventId] }) }));
    expect(bulkReplay.status).toBe(200);
    expect(await bulkReplay.json()).toEqual({ replayed: [secondEventId], notFound: [missingEventId] });
    expect((await admin.handle(new Request("http://localhost/api/v1/realtime/outbox/" + eventId + "/replay", { method: "POST" }))).status).toBe(200);
    expect((await db.select().from(realtimeOutbox)).every((row) => row.attempts === 0 && row.deadLetteredAt === null && row.lastError === null)).toBe(true);
    expect(await (await admin.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics"))).json()).toEqual({ pending: 2, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: "1970-01-01T00:00:00.000Z" });
    await db.update(realtimeOutbox).set({ deliveredAt: new Date(0) });
    const cleanup = await admin.handle(new Request("http://localhost/api/v1/realtime/outbox/delivered?retentionDays=1", { method: "DELETE" }));
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ deleted: 2, retentionDays: 1 });
    expect(await db.select().from(realtimeOutbox)).toHaveLength(0);
    const adminAudits = await db.select().from(auditEvents);
    expect(adminAudits.map((audit) => audit.action).sort()).toEqual(["realtime.outbox.bulk_replayed", "realtime.outbox.cleaned", "realtime.outbox.replayed"]);
    expect(adminAudits.every((audit) => audit.actorId === actorId && audit.resource === "qiy_realtime_outbox")).toBe(true);
  } finally {
    Bun.env.QIY_REALTIME_DISABLED = "1";
    Bun.env.QIY_REALTIME_MAX_ATTEMPTS = "10";
  }
});
test("outbox insertion failure rolls back the command and permits same-key retry", async () => {
  await executeSql('ALTER TABLE dataflow_outbox ADD CONSTRAINT qiy_injected_failure CHECK (false)${mysql ? "" : " NOT VALID"}');
  try {
    expect((await request("emit-failure")).status).toBe(500);
    expect((await db.select().from(connectors))[0]?.status).toBe("active");
    expect(await counts()).toEqual([0, 0]);
    expect(await db.select().from(dataflowOutbox)).toHaveLength(0);
    expect(await db.select().from(realtimeOutbox)).toHaveLength(0);
  } finally {
    await executeSql('ALTER TABLE dataflow_outbox DROP ${mysql ? "CHECK" : "CONSTRAINT"} qiy_injected_failure');
  }
  expect((await request("emit-failure")).status).toBe(200);
  expect(await counts()).toEqual([1, 1]);
  expect(await db.select().from(dataflowOutbox)).toHaveLength(1);
  expect(await db.select().from(realtimeOutbox)).toHaveLength(1);
});
test("realtime outbox insertion failure rolls back the command and permits same-key retry", async () => {
  await executeSql('ALTER TABLE qiy_realtime_outbox ADD CONSTRAINT qiy_realtime_injected_failure CHECK (false)${mysql ? "" : " NOT VALID"}');
  try {
    expect((await request("realtime-emit-failure")).status).toBe(500);
    expect((await db.select().from(connectors))[0]?.status).toBe("active");
    expect(await counts()).toEqual([0, 0]);
    expect(await db.select().from(dataflowOutbox)).toHaveLength(0);
    expect(await db.select().from(realtimeOutbox)).toHaveLength(0);
  } finally {
    await executeSql('ALTER TABLE qiy_realtime_outbox DROP ${mysql ? "CHECK" : "CONSTRAINT"} qiy_realtime_injected_failure');
  }
  expect((await request("realtime-emit-failure")).status).toBe(200);
  expect(await counts()).toEqual([1, 1]);
  expect(await db.select().from(dataflowOutbox)).toHaveLength(1);
  expect(await db.select().from(realtimeOutbox)).toHaveLength(1);
});
test("reused key with a changed input is rejected", async () => {
  expect((await request("conflict")).status).toBe(200);
  expect((await request("conflict", "revokeConnector", "different")).status).toBe(409);
  expect(await counts()).toEqual([1, 1]);
});
for (const table of ["audit_events", "dataflow_idempotency"]) {
  test(table + " write failure rolls back both tables and allows same-key retry", async () => {
    await executeSql('ALTER TABLE ' + table + ' ADD CONSTRAINT qiy_injected_failure CHECK (false)${mysql ? "" : " NOT VALID"}');
    try {
      expect((await request("write-failure", "revokeWithReview")).status).toBe(500);
      expect((await db.select().from(connectors))[0]?.status).toBe("active");
      expect((await db.select().from(reviews))[0]?.status).toBe("active");
      expect(await counts()).toEqual([0, 0]);
      expect(await db.select().from(dataflowOutbox)).toHaveLength(0);
    } finally {
      await executeSql('ALTER TABLE ' + table + ' DROP ${mysql ? "CHECK" : "CONSTRAINT"} qiy_injected_failure');
    }
    expect((await request("write-failure", "revokeWithReview")).status).toBe(200);
    expect((await db.select().from(connectors))[0]?.status).toBe("revoked");
    expect((await db.select().from(reviews))[0]?.status).toBe("completed");
    expect(await counts()).toEqual([1, 1]);
    expect(await db.select().from(dataflowOutbox)).toHaveLength(1);
  });
}
test("cross-table concurrent command produces one transition and identical replays", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => request("cross-table", "revokeWithReview")));
  expect(responses.map((response) => response.status)).toEqual(Array(12).fill(200));
  expect((await db.select().from(connectors))[0]?.status).toBe("revoked");
  expect((await db.select().from(reviews))[0]?.status).toBe("completed");
  expect(await counts()).toEqual([1, 1]);
});
test("late failure on the second table rolls back the first update", async () => {
  await executeSql("UPDATE reviews SET status = 'closed'");
  expect((await request("late-failure", "revokeWithReview")).status).toBe(409);
  expect((await db.select().from(connectors))[0]?.status).toBe("active");
  expect((await db.select().from(reviews))[0]?.status).toBe("closed");
  expect(await counts()).toEqual([0, 0]);
});
`);
  const result = await run([process.execPath, "test", testFile, "--timeout", "30000"], server, databaseUrl);
  await run([process.execPath, "run", "typecheck"], server, databaseUrl);
  console.log(result);
  console.log(`${label} migration, Dataflow concurrency/rollback and typecheck passed: ${output}`);
} finally {
  await administration(`DROP DATABASE ${databaseName}${mysql ? "" : " WITH (FORCE)"}`);
}
