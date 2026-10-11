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
  project.database.entities[0]!.fields.push({ name: "tenantId", columnName: "tenantId", type: "Text", nullable: false, primaryKey: false });
  project.database.enums = [{ name: "reviewDecision", values: [{ name: "approved" }, { name: "rejected" }] }];
  project.database.entities[0]!.fields.push({ name: "quantity", type: "Integer", nullable: true }, { name: "decision", type: "Text", enumName: "reviewDecision", nullable: true });
  project.scopes = [{ resource: "connectors", field: "tenantId", claim: "tenant.id" }, { resource: "reviews", field: "tenantId", claim: "tenant.id" }];
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
import { client, db } from "../src/db";
import { connectors, reviews } from "../src/schema";
import { createDataflowRoutes } from "../src/dataflows";
const actorId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const reviewId = "00000000-0000-4000-8000-000000000003";
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
  for (const table of ["connectors", "reviews", "audit_events", "dataflow_idempotency"]) await executeSql('DELETE FROM ' + table);
  await db.insert(connectors).values({ id: connectorId, status: "active", tenantId: "tenant-a" });
  await db.insert(reviews).values({ id: reviewId, status: "active", tenantId: "tenant-a" });
});
afterAll(async () => { await client.${mysql ? "end" : "close"}(); });
async function typedRequest(flow: string, key: string, quantity: unknown = 7, decision: unknown = "approved") {
  return app.handle(new Request("http://localhost/api/v1/commands/" + flow, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ connectorId, reason: "typed review", quantity, decision }) }));
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
test("missing and foreign tenant claims cannot mutate business data", async () => {
  expect((await request("missing-claim", "revokeConnector", "review", "missing")).status).toBe(403);
  expect((await request("foreign-claim", "revokeConnector", "review", "tenant-b")).status).toBe(404);
  expect((await db.select().from(connectors))[0]?.status).toBe("active");
  expect(await counts()).toEqual([0, 0]);
});
test("committed receipts do not bypass current tenant scope", async () => {
  expect((await request("scope-replay")).status).toBe(200);
  expect((await request("scope-replay", "revokeConnector", "review", "tenant-b")).status).toBe(404);
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
  expect((await request("rollback")).status).toBe(200);
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
    } finally {
      await executeSql('ALTER TABLE ' + table + ' DROP ${mysql ? "CHECK" : "CONSTRAINT"} qiy_injected_failure');
    }
    expect((await request("write-failure", "revokeWithReview")).status).toBe(200);
    expect((await db.select().from(connectors))[0]?.status).toBe("revoked");
    expect((await db.select().from(reviews))[0]?.status).toBe("completed");
    expect(await counts()).toEqual([1, 1]);
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
