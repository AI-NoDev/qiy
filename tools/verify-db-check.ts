import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for `bun run db:check`. It migrates a generated project into a
 * dedicated database, proves the check passes, injects a reversible schema drift
 * and proves the check fails with a precise message, restores it, and finally
 * points the check at an unmigrated database to prove missing tables and pending
 * migrations are reported. PostgreSQL and MySQL run against an isolated database
 * that is dropped afterwards.
 */
const dialect = (process.argv[2] ?? "sqlite") as "sqlite" | "postgresql" | "mysql";
if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`Unsupported dialect ${dialect}`);
const container = process.argv[3] ?? (dialect === "mysql" ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const root = mkdtempSync(join(tmpdir(), `qiy-db-check-${dialect}-`));
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

writeFileSync(join(root, "app.qiy"), `qiy v0;
application db-check {
  database ${dialect} {}
  entity orders {
    field id UUID @id;
    field reference Text @unique;
    field amount Decimal(10,2) @nullable;
    field placedAt DateTime @nullable;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

const databaseName = `qiy_drift_${crypto.randomUUID().replaceAll("-", "")}`;
let databaseUrl = join(root, "check.sqlite");
let emptyUrl = join(root, "empty.sqlite");
let credentials: { prefix: string; username: string; password: string } | undefined;
const sql = (statement: string) => dialect === "sqlite"
  ? ["bun", "mutate.ts", statement]
  : ["bun", "mutate.ts", statement];

if (dialect !== "sqlite") {
  const inspected = JSON.parse(await must(["docker", "inspect", container], root))[0] as { Config: { Env: string[] }; NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }> | undefined> } };
  const settings = Object.fromEntries(inspected.Config.Env.map((value) => { const index = value.indexOf("="); return [value.slice(0, index), value.slice(index + 1)]; }));
  const mysql = dialect === "mysql";
  const username = mysql ? "root" : settings.POSTGRES_USER ?? "postgres";
  const password = (mysql ? settings.MYSQL_ROOT_PASSWORD : settings.POSTGRES_PASSWORD) ?? "";
  const port = inspected.NetworkSettings.Ports[mysql ? "3306/tcp" : "5432/tcp"]?.[0]?.HostPort;
  if (!port || !password) throw new Error(`${dialect} container requires a published port and configured password`);
  credentials = { prefix: `${mysql ? "mysql" : "postgres"}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}`, username, password };
  const emptyName = `${databaseName}_empty`;
  const administration = async (statement: string) => must(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${password}`] : []), container, ...(mysql ? ["mysql", "-u", username, "-e", statement] : ["psql", "-U", username, "-d", "postgres", "-c", statement])], root);
  await administration(`CREATE DATABASE ${databaseName}`);
  await administration(`CREATE DATABASE ${emptyName}`);
  databaseUrl = `${credentials.prefix}/${databaseName}`;
  emptyUrl = `${credentials.prefix}/${emptyName}`;
}

writeFileSync(join(server, "mutate.ts"), dialect === "sqlite"
  ? `import { Database } from "bun:sqlite";
const database = new Database(Bun.env.DATABASE_URL!);
database.exec(process.argv[2]!);
database.close();
`
  : dialect === "postgresql"
    ? `import { SQL } from "bun";
const sql = new SQL(Bun.env.DATABASE_URL!);
await sql.unsafe(process.argv[2]!);
await sql.close();
`
    : `import mysql from "mysql2/promise";
const connection = await mysql.createConnection(Bun.env.DATABASE_URL!);
await connection.query(process.argv[2]!);
await connection.end();
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "test", "tests/schema-drift.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));

  const clean = expectCode("clean database", await run(["bun", "run", "db:check"], server, { DATABASE_URL: databaseUrl }), 0);
  if (!clean.includes("0 error(s)")) throw new Error(`clean check did not report zero errors:\n${clean}`);
  console.log(clean);

  await must(sql(`alter table orders rename column reference to reference_old`), server, { DATABASE_URL: databaseUrl });
  const drifted = expectCode("renamed column", await run(["bun", "run", "db:check"], server, { DATABASE_URL: databaseUrl }), 1);
  if (!drifted.includes("drift: orders.reference: missing column")) throw new Error(`missing column was not reported:\n${drifted}`);
  if (!drifted.includes("orders.reference_old: column exists in the database but not in the schema")) throw new Error(`unexpected column was not reported:\n${drifted}`);
  console.log(drifted);

  await must(sql(`alter table orders rename column reference_old to reference`), server, { DATABASE_URL: databaseUrl });
  expectCode("restored database", await run(["bun", "run", "db:check"], server, { DATABASE_URL: databaseUrl }), 0);
  console.log("restored column: db:check passes again");

  const unmigrated = expectCode("unmigrated database", await run(["bun", "run", "db:check"], server, { DATABASE_URL: emptyUrl }), 1);
  if (!unmigrated.includes("drift: missing table orders")) throw new Error(`missing table was not reported:\n${unmigrated}`);
  if (!unmigrated.includes("pending migrations")) throw new Error(`pending migrations were not reported:\n${unmigrated}`);
  console.log(unmigrated);

  console.log(`db:check ${dialect} acceptance passed: ${root}`);
} finally {
  if (credentials && dialect !== "sqlite") {
    const mysql = dialect === "mysql";
    for (const name of [databaseName, `${databaseName}_empty`]) {
      await run(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${credentials.password}`] : []), container, ...(mysql ? ["mysql", "-u", credentials.username, "-e", `DROP DATABASE IF EXISTS ${name}`] : ["psql", "-U", credentials.username, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${name}`])], root);
    }
  }
}
