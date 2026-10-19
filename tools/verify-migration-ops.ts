import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the generated migration operations. It proves that
 * `db:migrate` verifies the live structure after migrating, that concurrent
 * migrators do not race on PostgreSQL/MySQL, and that `db:rollback` only runs
 * with an explicit confirmation plus a reviewed reverse migration.
 */
const dialect = (process.argv[2] ?? "sqlite") as "sqlite" | "postgresql" | "mysql";
if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`Unsupported dialect ${dialect}`);
const container = process.argv[3] ?? (dialect === "mysql" ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const root = mkdtempSync(join(tmpdir(), `qiy-migration-ops-${dialect}-`));
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
application migration-ops {
  database ${dialect} {}
  entity orders {
    field id UUID @id;
    field reference Text @unique;
    field amount Decimal(10,2) @nullable;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

const databaseName = `qiy_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
let databaseUrl = join(root, "migrate.sqlite");
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

const query = async (statement: string): Promise<string> => {
  if (dialect === "sqlite") {
    const script = join(server, "probe.ts");
    writeFileSync(script, `import { Database } from "bun:sqlite";\nconst database = new Database(Bun.env.DATABASE_URL!);\nconsole.log(JSON.stringify(database.query(process.argv[2]!).all()));\ndatabase.close();\n`);
    return must(["bun", "probe.ts", statement], server, { DATABASE_URL: databaseUrl });
  }
  const mysql = dialect === "mysql";
  return must(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${credentials!.password}`] : []), container, ...(mysql ? ["mysql", "-u", credentials!.username, "-N", "-e", statement, databaseName] : ["psql", "-U", credentials!.username, "-d", databaseName, "-tAc", statement])], root);
};
/** Reads the single number a count query returns, whichever dialect produced it. */
async function count(statement: string): Promise<number> {
  const output = await query(statement);
  const numbers = output.match(/\d+/g) ?? [];
  return Number(numbers[numbers.length - 1] ?? "0");
}

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));

  // Concurrent migrators must agree: the lock serialises them and the
  // post-migration verification fails if the structure does not match the code.
  // SQLite has no cross-process lock and is documented as single-process.
  const migrators = dialect === "sqlite"
    ? [await run(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl })]
    : await Promise.all([
      run(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl }),
      run(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl }),
    ]);
  migrators.forEach((migrator, index) => expectCode(`migrator ${index + 1}`, migrator, 0));
  for (const migrator of migrators) {
    if (!migrator.output.includes("database matches src/schema.ts")) throw new Error(`a migrator did not verify the schema:\n${migrator.output}`);
    console.log(migrator.output.trim());
  }
  if (dialect === "postgresql" && !migrators.some((migrator) => migrator.output.includes("advisory lock"))) throw new Error("the advisory lock was never acquired");
  if (dialect === "mysql" && !migrators.some((migrator) => migrator.output.includes("qiy_migrate lock"))) throw new Error("the named lock was never acquired");

  const rows = await count(dialect === "mysql" ? "select count(*) from __drizzle_migrations" : dialect === "sqlite" ? "select count(*) as count from __drizzle_migrations" : "select count(*) from drizzle.__drizzle_migrations");
  if (rows !== 1) throw new Error(`expected exactly one applied migration after the migrators ran, got ${rows}`);
  console.log(`migration bookkeeping rows after ${migrators.length} migrator(s): ${rows}`);

  // Rollback is refused without an explicit confirmation and without a reviewed reverse migration.
  const unconfirmed = expectCode("rollback without --confirm", await run(["bun", "run", "db:rollback"], server, { DATABASE_URL: databaseUrl }), 1);
  if (!unconfirmed.includes("--confirm")) throw new Error(`rollback did not ask for confirmation:\n${unconfirmed}`);
  const missing = expectCode("rollback without a reverse migration", await run(["bun", "run", "db:rollback", "--", "--confirm"], server, { DATABASE_URL: databaseUrl }), 1);
  if (!missing.includes("reviewed reverse migration") || !/drizzle[\\/]down[\\/][^\\/]+\.sql/.test(missing)) throw new Error(`rollback did not point at the reverse migration:\n${missing}`);
  console.log(unconfirmed.trim());
  console.log(missing.trim());

  // A reviewed reverse migration is applied in a transaction and its record removed.
  const journal = JSON.parse(readFileSync(join(server, "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  const tag = journal.entries[0]!.tag;
  mkdirSync(join(server, "drizzle/down"), { recursive: true });
  writeFileSync(join(server, "drizzle/down", `${tag}.sql`), "drop table orders;\n");
  const rolled = expectCode("rollback with a reverse migration", await run(["bun", "run", "db:rollback", "--", "--confirm"], server, { DATABASE_URL: databaseUrl }), 0);
  if (!rolled.includes(`reverted ${tag}`)) throw new Error(`rollback did not report the tag:\n${rolled}`);
  console.log(rolled.trim());

  const left = await count(dialect === "mysql" ? "select count(*) from __drizzle_migrations" : dialect === "sqlite" ? "select count(*) as count from __drizzle_migrations" : "select count(*) from drizzle.__drizzle_migrations");
  if (left !== 0) throw new Error(`expected no applied migration after rollback, got ${left}`);
  const orders = await count(dialect === "sqlite"
    ? "select count(*) as count from sqlite_master where type = 'table' and name = 'orders'"
    : dialect === "mysql"
      ? "select count(*) from information_schema.tables where table_schema = database() and table_name = 'orders'"
      : "select count(*) from information_schema.tables where table_schema = current_schema() and table_name = 'orders'");
  if (orders !== 0) throw new Error(`the reverse migration did not drop the orders table (found ${orders})`);
  console.log(`after rollback: applied migrations ${left}, orders table dropped`);

  console.log(`migration ops ${dialect} acceptance passed: ${root}`);
} finally {
  if (credentials && dialect !== "sqlite") {
    const mysql = dialect === "mysql";
    await run(["docker", "exec", ...(mysql ? ["-e", `MYSQL_PWD=${credentials.password}`] : []), container, ...(mysql ? ["mysql", "-u", credentials.username, "-e", `DROP DATABASE IF EXISTS ${databaseName}`] : ["psql", "-U", credentials.username, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${databaseName}`])], root);
  }
}
