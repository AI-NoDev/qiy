import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the generated logical backup. It seeds a migrated database,
 * backs it up, destroys the data, restores it from the file and proves the rows
 * came back, then checks the refusal paths and the retention window. PostgreSQL
 * and MySQL run against an isolated database that is dropped afterwards.
 */
const dialect = (process.argv[2] ?? "sqlite") as "sqlite" | "postgresql" | "mysql";
if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`Unsupported dialect ${dialect}`);
const container = process.argv[3] ?? (dialect === "mysql" ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const root = mkdtempSync(join(tmpdir(), `qiy-backup-${dialect}-`));
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
function expectCode(label: string, result: { code: number; output: string }, expected: number): string {
  if (result.code !== expected) throw new Error(`${label}: expected exit ${expected} but got ${result.code}\n${result.output}`);
  return result.output;
}
const isDate = (value: unknown) => value instanceof Date && !Number.isNaN(value.getTime());

writeFileSync(join(root, "app.qiy"), `qiy v0;
application backup-demo {
  database ${dialect} {}
  entity owners {
    field id UUID @id;
    field email Text @unique;
  }
  entity orders {
    field id UUID @id;
    field ownerId UUID;
    field reference Text;
    field amount Decimal(10,2) @nullable;
    field placedAt DateTime @nullable;
  }
  relation orders_owner orders ownerId owners id one;
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

const databaseName = `qiy_backup_${crypto.randomUUID().replaceAll("-", "")}`;
let databaseUrl = join(root, "backup.sqlite");
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

const probe = join(server, "probe.ts");
writeFileSync(probe, `import { db${dialect === "postgresql" ? "" : ", client"} } from "./src/db";
import { owners, orders } from "./src/schema";
import { eq } from "drizzle-orm";
const ownerId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const placedAt = new Date("2026-03-04T05:06:07.000Z");
const command = process.argv[2]!;
if (command === "seed") {
  await db.insert(owners).values({ id: ownerId, email: "owner@example.com" });
  await db.insert(orders).values({ id: orderId, ownerId, reference: "ORD-1", amount: "42.50", placedAt });
} else if (command === "wipe") {
  await db.delete(orders);
  await db.delete(owners);
} else if (command === "read") {
  const ownerRows = await db.select().from(owners);
  const orderRows = await db.select().from(orders);
  const order = orderRows[0];
  console.log(JSON.stringify({
    owners: ownerRows.length,
    orders: orderRows.length,
    email: ownerRows[0]?.email ?? null,
    reference: order?.reference ?? null,
    amount: order ? String(order.amount) : null,
    placedAt: order?.placedAt ? new Date(order.placedAt).toISOString() : null,
    placedAtIsDate: order ? order.placedAt instanceof Date : false,
  }));
} else if (command === "mutate") {
  await db.update(orders).set({ reference: "CHANGED" }).where(eq(orders.id, orderId));
}
${dialect === "sqlite" ? "client.close();" : dialect === "mysql" ? "await client.end();" : ""}
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  const codec = await run(["bun", "test", "tests/backup-codec.test.ts"], server, { DATABASE_URL: databaseUrl });
  expectCode("backup codec tests", codec, 0);
  console.log(codec.output.trim());

  await must(["bun", "probe.ts", "seed"], server, { DATABASE_URL: databaseUrl });

  const seeded = JSON.parse(await must(["bun", "probe.ts", "read"], server, { DATABASE_URL: databaseUrl }));
  if (seeded.owners !== 1 || seeded.orders !== 1 || !isDate(new Date(seeded.placedAt))) throw new Error(`seed failed: ${JSON.stringify(seeded)}`);

  const backup = await must(["bun", "run", "db:backup"], server, { DATABASE_URL: databaseUrl });
  console.log(backup.trim());
  const file = /to (.+\.json)/.exec(backup)?.[1]?.trim();
  if (!file) throw new Error(`db:backup did not report the file path:\n${backup}`);

  // Destroy and change the data so a restore has to bring the rows back.
  await must(["bun", "probe.ts", "wipe"], server, { DATABASE_URL: databaseUrl });
  const wiped = JSON.parse(await must(["bun", "probe.ts", "read"], server, { DATABASE_URL: databaseUrl }));
  if (wiped.owners !== 0 || wiped.orders !== 0) throw new Error(`wipe failed: ${JSON.stringify(wiped)}`);

  const unconfirmed = expectCode("restore without --confirm", await run(["bun", "run", "db:restore", "--", "--file", file], server, { DATABASE_URL: databaseUrl }), 1);
  if (!unconfirmed.includes("--confirm")) throw new Error(`restore did not ask for confirmation:\n${unconfirmed}`);
  const noFile = expectCode("restore without a file", await run(["bun", "run", "db:restore", "--", "--confirm"], server, { DATABASE_URL: databaseUrl }), 1);
  if (!noFile.includes("--file")) throw new Error(`restore did not require --file:\n${noFile}`);
  console.log(unconfirmed.trim());
  console.log(noFile.trim());

  const restored = await must(["bun", "run", "db:restore", "--", "--file", file, "--confirm"], server, { DATABASE_URL: databaseUrl });
  console.log(restored.trim());
  const after = JSON.parse(await must(["bun", "probe.ts", "read"], server, { DATABASE_URL: databaseUrl }));
  if (after.owners !== 1 || after.orders !== 1 || after.email !== "owner@example.com" || after.reference !== "ORD-1") throw new Error(`restore did not bring the rows back: ${JSON.stringify(after)}`);
  if (Number(after.amount) !== 42.5) throw new Error(`decimal value was not restored: ${JSON.stringify(after)}`);
  if (after.placedAt !== "2026-03-04T05:06:07.000Z" || !after.placedAtIsDate) throw new Error(`timestamp was not restored as a date: ${JSON.stringify(after)}`);
  console.log(`restored rows: ${JSON.stringify(after)}`);

  // Restoring over changed data must replace it, not append it.
  await must(["bun", "probe.ts", "mutate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:restore", "--", "--file", file, "--confirm"], server, { DATABASE_URL: databaseUrl });
  const replaced = JSON.parse(await must(["bun", "probe.ts", "read"], server, { DATABASE_URL: databaseUrl }));
  if (replaced.orders !== 1 || replaced.reference !== "ORD-1") throw new Error(`restore appended instead of replacing: ${JSON.stringify(replaced)}`);
  console.log("restore replaced mutated rows instead of appending");

  // Retention keeps the newest files and removes the rest.
  for (let index = 0; index < 3; index++) await must(["bun", "run", "db:backup"], server, { DATABASE_URL: databaseUrl, QIY_BACKUP_RETENTION: "2" });
  const listing = await must(["bun", "-e", "console.log((await Array.fromAsync(new Bun.Glob('backups/qiy-*.json').scan('.'))).sort().join('\\n'))"], server);
  const kept = listing.trim().split("\n").filter(Boolean);
  if (kept.length !== 2) throw new Error(`retention kept ${kept.length} backups instead of 2:\n${listing}`);
  console.log(`retention kept ${kept.length} backup(s)`);
  const invalid = expectCode("invalid retention", await run(["bun", "run", "db:backup"], server, { DATABASE_URL: databaseUrl, QIY_BACKUP_RETENTION: "-1" }), 1);
  if (!invalid.includes("QIY_BACKUP_RETENTION must be a non-negative integer")) throw new Error(`invalid retention was accepted:\n${invalid}`);

  console.log(`backup ${dialect} acceptance passed: ${root}`);
} finally {
  if (credentials && dialect !== "sqlite") {
    const mysql = dialect === "mysql";
    await run(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${credentials.password}`] : []), container, ...(mysql ? ["mysql", "-u", credentials.username, "-e", `DROP DATABASE IF EXISTS ${databaseName}`] : ["psql", "-U", credentials.username, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${databaseName}`])], root);
  }
}
