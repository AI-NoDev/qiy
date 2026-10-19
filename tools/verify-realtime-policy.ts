import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for permission data ranges over the realtime channel. A shared
 * channel cannot apply per-recipient permissions, so this proves that fields
 * masked for a subscribing role never reach the outbox payload, that masks for
 * roles which cannot subscribe leave the payload alone, and that row predicates
 * are refused at generation time instead of leaking rows over the channel.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-realtime-policy-"));

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

const model = (restriction: string) => `qiy v0;
application realtime-policy {
  database sqlite {}
  api { client rest; }
  realtime { mode auto; resource orders { events created, updated, deleted; roles operator; } }
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
    field title Text;
    field salary Integer @nullable;
    field secret Text @nullable;
    field tenantId Text;
  }
  ${restriction}
}
`;

// A row predicate cannot be enforced on a shared channel, so generation must fail
// closed rather than publish records the subscriber cannot read.
let refused = "";
const rowSource = join(root, "row.qiy");
writeFileSync(rowSource, model("restrict orders { when tenantId claim tenant; }"));
try {
  await generateApp(rowSource, join(root, "row-admin"));
} catch (error) { refused = error instanceof Error ? error.message : String(error); }
if (!refused) throw new Error("Realtime and restrict row predicates must not generate quietly");
if (!refused.includes("restrict row predicates cannot be enforced on a shared channel")) throw new Error(`Unexpected refusal: ${refused}`);
console.log(`refused row predicates: ${refused.split("\n")[0]}`);

// Field masks are stripped from the published payload for subscribing roles only.
const admin = join(root, "admin");
const server = join(admin, "apps/server");
writeFileSync(join(root, "app.qiy"), model("restrict orders { mask salary roles operator mode omit; mask secret roles admin mode omit; }"));
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "realtime-policy.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { db } from "./src/db";
import { realtimeOutbox } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";

// The generated suite shares one SQLite connection across files, so this
// acceptance must not close it.

async function payloads(): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select().from(realtimeOutbox);
  return rows.map((row) => ({ type: row.type, ...JSON.parse(row.payload) as Record<string, unknown> }));
}
async function clear(): Promise<void> { await db.delete(realtimeOutbox); }

test("never publishes a field masked for a subscribing role", async () => {
  await clear();
  const created = await OrdersRepository.create({ title: "one", salary: 100, secret: "s3", tenantId: "t1" }, "actor");
  const created_payloads = await payloads();
  const event = created_payloads.find((item) => item.type === "created")!;
  expect(event).toBeDefined();
  // salary is masked for operator, which is the role allowed to subscribe.
  expect(Object.hasOwn(event, "salary")).toBe(false);
  // secret is masked for admin only; admin cannot subscribe, so it stays.
  expect(event.secret).toBe("s3");
  expect(event.title).toBe("one");
  expect(event.id).toBe(created!.id);

  await OrdersRepository.update(created!.id, { title: "two", salary: 200 }, "actor");
  const updated = (await payloads()).find((item) => item.type === "updated")!;
  expect(Object.hasOwn(updated, "salary")).toBe(false);
  expect(updated.title).toBe("two");

  await OrdersRepository.delete(created!.id, "actor");
  const deleted = (await payloads()).find((item) => item.type === "deleted")!;
  expect(Object.hasOwn(deleted, "salary")).toBe(false);
  expect(deleted.title).toBe("two");
});

test("strips masked fields from bulk deletes too", async () => {
  await clear();
  const first = await OrdersRepository.create({ title: "a", salary: 1, secret: "s1", tenantId: "t" }, "actor");
  const second = await OrdersRepository.create({ title: "b", salary: 2, secret: "s2", tenantId: "t" }, "actor");
  await clear();
  await OrdersRepository.deleteMany([first!.id, second!.id], "actor");
  const deleted = (await payloads()).filter((item) => item.type === "deleted");
  expect(deleted).toHaveLength(2);
  for (const event of deleted) expect(Object.hasOwn(event, "salary")).toBe(false);
});
`);

try {
  await must(["bun", "install"], admin);
  const databaseUrl = join(root, "policy.sqlite");
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "realtime-policy.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  // The generated live provider must compile and pass its record-scoping tests.
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "run", "build"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`realtime policy acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
