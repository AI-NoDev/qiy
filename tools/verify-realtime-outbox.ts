import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the generated Realtime outbox store and worker. The shipped
 * tests inject an in-memory fake store, so the real database store (lease columns,
 * FOR UPDATE SKIP LOCKED claiming, backoff, dead letters, replay and cleanup) was
 * never exercised. This runs it against real SQLite, PostgreSQL and MySQL.
 */
const dialect = (process.argv[2] ?? "sqlite") as "sqlite" | "postgresql" | "mysql";
if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`Unsupported dialect ${dialect}`);
const container = process.argv[3] ?? (dialect === "mysql" ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const root = mkdtempSync(join(tmpdir(), `qiy-realtime-outbox-${dialect}-`));
const admin = join(root, "admin");
const server = join(admin, "apps/server");

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, output: stdout + stderr };
}
async function must(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const result = await run(command, cwd, env);
  if (result.code !== 0) throw new Error(`${command.join(" ")} failed (${result.code}) in ${cwd}:\n${result.output}`);
  return result.output;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application outbox-acceptance {
  database ${dialect} {}
  api { client rest; }
  realtime { mode auto; resource orders { events created, updated, deleted; roles admin, operator; } }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity orders {
    field id UUID @id;
    field number Text @unique;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

const databaseName = `qiy_outbox_${crypto.randomUUID().replaceAll("-", "")}`;
let databaseUrl = join(root, "outbox.sqlite");
let credentials: { username: string; password: string } | undefined;
if (dialect !== "sqlite") {
  const inspected = JSON.parse(await must(["docker", "inspect", container], root))[0] as { Config: { Env: string[] }; NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }> | undefined> } };
  const settings = Object.fromEntries(inspected.Config.Env.map((value) => { const index = value.indexOf("="); return [value.slice(0, index), value.slice(index + 1)]; }));
  const mysql = dialect === "mysql";
  const username = mysql ? "root" : settings.POSTGRES_USER ?? "postgres";
  const password = (mysql ? settings.MYSQL_ROOT_PASSWORD : settings.POSTGRES_PASSWORD) ?? "";
  const port = inspected.NetworkSettings.Ports[mysql ? "3306/tcp" : "5432/tcp"]?.[0]?.HostPort;
  if (!port || !password) throw new Error(`${dialect} container requires a published port and configured password`);
  credentials = { username, password };
  databaseUrl = `${mysql ? "mysql" : "postgres"}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
  await must(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${password}`] : []), container, ...(mysql ? ["mysql", "-u", username, "-e", `CREATE DATABASE ${databaseName}`] : ["psql", "-U", username, "-d", "postgres", "-c", `CREATE DATABASE ${databaseName}`])], root);
}

// SQLite claiming is a plain select+update (documented single-process), so the
// concurrent-claim guarantee is only asserted for the dialects that lock rows.
const concurrencyTest = dialect === "sqlite" ? "" : `test("concurrent workers never deliver the same claim twice", async () => {
  const id = await seed();
  const [first, second] = await Promise.all([
    dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-x"),
    dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-y"),
  ]);
  expect(first.delivered + second.delivered).toBe(1);
  expect(published.filter((item) => (item.payload as { value: string }).value === id)).toHaveLength(1);
  expect((await row(id)).deliveredAt).toBeInstanceOf(Date);
});
`;

writeFileSync(join(server, "outbox.acceptance.test.ts"), `import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { client, db } from "./src/db";
import { auditEvents, realtimeOutbox } from "./src/schema";
import { cleanupRealtimeOutbox, databaseOutboxStore, dispatchRealtimeOutbox } from "./src/realtime";

// The generated test preload disables realtime so CRUD tests never publish; this
// acceptance drives the worker itself.
delete Bun.env.QIY_REALTIME_DISABLED;
Bun.env.QIY_REALTIME_MAX_ATTEMPTS = "2";
Bun.env.QIY_REALTIME_LEASE_MS = "1000";

const published: Array<{ channel: string; type: string; payload: unknown }> = [];
const working = (() => ({ channels: { get: (channel: string) => ({ publish: async (type: string, payload: unknown) => { published.push({ channel, type, payload }); } }) } })) as never;
const failing = (() => ({ channels: { get: () => ({ publish: async () => { throw new Error("provider down"); } }) } })) as never;

async function seed(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(realtimeOutbox).values({ id, channel: "qiy:event:test", type: "test.event", payload: JSON.stringify({ value: id }), attempts: 0, availableAt: new Date(), deliveredAt: null, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null, createdAt: new Date(), ...overrides } as never);
  return id;
}
async function row(id: string) {
  const rows = await db.select().from(realtimeOutbox).where(eq(realtimeOutbox.id, id));
  return rows[0]!;
}
async function makeAvailable(id: string): Promise<void> {
  await db.update(realtimeOutbox).set({ availableAt: new Date(Date.now() - 1000) }).where(eq(realtimeOutbox.id, id));
}

// The dialect clients differ: MySQL exposes a pool with end(), the others close().
afterAll(async () => { const closable = client as unknown as { close?: () => void; end?: () => Promise<void> }; if (typeof closable.end === "function") await closable.end(); else closable.close?.(); });
// Each case starts from an empty outbox and audit trail so a failure cannot cascade.
beforeEach(async () => { await db.delete(realtimeOutbox); await db.delete(auditEvents); });

test("delivers a pending event exactly once and clears the lease", async () => {
  const id = await seed();
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-a")).toEqual({ delivered: 1, failed: 0, deadLettered: 0 });
  const delivered = await row(id);
  expect(delivered.deliveredAt).toBeInstanceOf(Date);
  expect(delivered.leaseOwner).toBeNull();
  expect(delivered.leaseUntil).toBeNull();
  expect(published.filter((item) => (item.payload as { value: string }).value === id)).toHaveLength(1);
  // Already delivered rows are never claimed again.
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-a")).toEqual({ delivered: 0, failed: 0, deadLettered: 0 });
  const metrics = await databaseOutboxStore.metrics(new Date());
  expect(metrics.delivered).toBeGreaterThanOrEqual(1);
  expect(metrics.pending).toBe(0);
});

test("reclaims an expired lease but respects a live one", async () => {
  const id = await seed();
  // A worker takes the lease and then dies; by now its lease has expired.
  await databaseOutboxStore.claim(10, new Date(), "crashed-worker", new Date(Date.now() + 60_000));
  await db.update(realtimeOutbox).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(realtimeOutbox.id, id));
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-b")).toEqual({ delivered: 1, failed: 0, deadLettered: 0 });
  expect((await row(id)).deliveredAt).toBeInstanceOf(Date);

  // A live lease must not be stolen by another worker.
  const held = await seed();
  await databaseOutboxStore.claim(10, new Date(), "slow-worker", new Date(Date.now() + 60_000));
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-c")).toEqual({ delivered: 0, failed: 0, deadLettered: 0 });
  expect((await row(held)).deliveredAt).toBeNull();
  expect((await row(held)).leaseOwner).toBe("slow-worker");
  expect((await databaseOutboxStore.metrics(new Date())).leased).toBe(1);
});

test("retries with backoff, stops while unavailable and then succeeds", async () => {
  const id = await seed();
  expect(await dispatchRealtimeOutbox(10, failing, databaseOutboxStore, "worker-a")).toEqual({ delivered: 0, failed: 1, deadLettered: 0 });
  const retried = await row(id);
  expect(retried.attempts).toBe(1);
  expect(retried.deliveredAt).toBeNull();
  expect(retried.deadLetteredAt).toBeNull();
  expect(retried.leaseOwner).toBeNull();
  expect(retried.lastError).toContain("provider down");
  expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now());

  // The backoff window keeps the row out of the next claim.
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-a")).toEqual({ delivered: 0, failed: 0, deadLettered: 0 });
  await makeAvailable(id);
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-a")).toEqual({ delivered: 1, failed: 0, deadLettered: 0 });
  expect((await row(id)).deliveredAt).toBeInstanceOf(Date);
});

test("dead-letters after the configured attempts and replays on demand", async () => {
  const id = await seed();
  expect(await dispatchRealtimeOutbox(10, failing, databaseOutboxStore, "worker-a")).toEqual({ delivered: 0, failed: 1, deadLettered: 0 });
  await makeAvailable(id);
  expect(await dispatchRealtimeOutbox(10, failing, databaseOutboxStore, "worker-a")).toEqual({ delivered: 0, failed: 0, deadLettered: 1 });
  const dead = await row(id);
  expect(dead.attempts).toBe(2);
  expect(dead.deadLetteredAt).toBeInstanceOf(Date);
  expect((await databaseOutboxStore.deadLetters(10)).some((record) => record.id === id)).toBe(true);

  // Dead letters are not retried until they are replayed explicitly.
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-a")).toEqual({ delivered: 0, failed: 0, deadLettered: 0 });

  const actorId = "00000000-0000-4000-8000-0000000000ad";
  expect(await databaseOutboxStore.replay(id, new Date(), actorId)).toBe(true);
  expect(await databaseOutboxStore.replay(id, new Date(), actorId)).toBe(false);
  const replayed = await row(id);
  expect(replayed.attempts).toBe(0);
  expect(replayed.deadLetteredAt).toBeNull();
  const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "realtime.outbox.replayed"));
  expect(audit).toHaveLength(1);
  await makeAvailable(id);
  expect(await dispatchRealtimeOutbox(10, working, databaseOutboxStore, "worker-a")).toEqual({ delivered: 1, failed: 0, deadLettered: 0 });
});

test("cleanup removes only delivered history and audits the run", async () => {
  const old = await seed({ deliveredAt: new Date(Date.now() - 8 * 86400000) });
  const recent = await seed({ deliveredAt: new Date() });
  const removed = await cleanupRealtimeOutbox(7, databaseOutboxStore, new Date(), "00000000-0000-4000-8000-0000000000ad");
  expect(removed).toBeGreaterThanOrEqual(1);
  expect((await db.select().from(realtimeOutbox).where(eq(realtimeOutbox.id, old))).length).toBe(0);
  expect((await db.select().from(realtimeOutbox).where(eq(realtimeOutbox.id, recent))).length).toBe(1);
  expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "realtime.outbox.cleaned"))).length).toBe(1);
  await expect(cleanupRealtimeOutbox(0, databaseOutboxStore, new Date())).rejects.toThrow("from 1 to 3650");
});

${concurrencyTest}`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "outbox.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`realtime outbox ${dialect} acceptance passed: ${root}`);
} finally {
  if (credentials && dialect !== "sqlite") {
    const mysql = dialect === "mysql";
    await run(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${credentials.password}`] : []), container, ...(mysql ? ["mysql", "-u", credentials.username, "-e", `DROP DATABASE IF EXISTS ${databaseName}`] : ["psql", "-U", credentials.username, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${databaseName}`])], root);
  }
}
