import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the `restrict` record/field policy. The verifier generates
 * the example with the requested dialect, installs it, runs the generated
 * migration against a dedicated database, typechecks the generated server and
 * executes a policy probe that exercises row predicates and field masks through
 * the generated repository. PostgreSQL/MySQL run against an isolated database
 * that is dropped afterwards; no existing database is touched.
 */
const dialect = (process.argv[2] ?? "sqlite") as "sqlite" | "postgresql" | "mysql";
if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`Unsupported dialect ${dialect}`);
const container = process.argv[3] ?? (dialect === "mysql" ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const root = mkdtempSync(join(tmpdir(), `qiy-resource-policy-${dialect}-`));

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}) in ${cwd}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

const probe = `import { afterAll, expect, test } from "bun:test";
import { client } from "../src/db";
import { QiyPolicyError, resolvePolicy } from "../src/security/policy";
import { records } from "../src/schema";
import { RecordsRepository } from "../src/modules/records/records.repository";
import type { Principal } from "../src/auth/guard";

// MySQL keeps its pool alive, so the probe must close the dialect client itself
// instead of relying on the runner to exit.
afterAll(async () => {
  const closable = client as { end?: () => Promise<void>; close?: () => void };
  if (typeof closable.end === "function") await closable.end();
  else closable.close?.();
});

const columns = { id: records.id, ownerId: records.ownerId, status: records.status, salary: records.salary, note: records.note, score: records.score };
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const scope = { field: "ownerId", value: owner };
function principal(role: Principal["role"], claims: Record<string, string>): Principal {
  return { id: owner, name: role, role, claims };
}
const visibleValues = { ownerId: owner, status: "draft", salary: "10.00", note: "secret", score: 2 };
const hiddenValues = { ownerId: owner, status: "closed", salary: "10.00", note: "closed", score: 0 };

test("enforces record predicates and field masks through the generated repository", async () => {
  const operator = resolvePolicy("records", principal("operator", { "user.id": owner, "tenant.ownerId": owner, "compliance.level": "ok" }), columns);
  const otherOwner = resolvePolicy("records", principal("operator", { "user.id": other, "tenant.ownerId": owner, "compliance.level": "ok" }), columns);
  const admin = resolvePolicy("records", principal("admin", { "user.id": owner, "tenant.ownerId": owner }), columns);
  expect(() => resolvePolicy("records", principal("viewer", { "user.id": owner, "tenant.ownerId": owner }), columns)).toThrow(QiyPolicyError);
  expect(() => resolvePolicy("records", principal("operator", { "tenant.ownerId": owner }), columns)).toThrow(QiyPolicyError);

  const created = await RecordsRepository.create(visibleValues, owner, scope, operator);
  expect(operator.mask(created).salary).toBe("***");
  expect(operator.mask(created).note).toBe("secret");
  expect(Number(admin.mask(created).salary)).toBe(10);
  expect(admin.mask(created).note).toBeUndefined();
  // Asserted with an explicit try/catch: Bun's \`expect(...).rejects\` matcher does
  // not settle on the drizzle MySQL transaction rollback path.
  let outsidePolicy = "";
  try { await RecordsRepository.create(hiddenValues, owner, scope, operator); } catch (error) { outsidePolicy = (error as Error).message; }
  expect(outsidePolicy).toBe("Write is outside the record policy");

  const listed = await RecordsRepository.list(1, 20, { scope, policy: operator });
  expect(listed.total).toBe(1);
  expect(listed.data.map((record) => operator.mask(record).salary)).toEqual(["***"]);
  expect((await RecordsRepository.list(1, 20, { scope, policy: otherOwner })).total).toBe(0);
  expect(await RecordsRepository.one(String(created.id), scope, otherOwner)).toBeUndefined();
  expect(await RecordsRepository.update(String(created.id), { note: "changed" }, owner, scope, otherOwner)).toBeUndefined();
  expect((await RecordsRepository.one(String(created.id), scope, operator))?.note).toBe("secret");
});
`;

async function inspectContainer(): Promise<{ prefix: string; username: string; password: string; container: string }> {
  const inspected = JSON.parse(await run(["docker", "inspect", container], root))[0] as { Config: { Env: string[] }; NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }> | undefined> } };
  const settings = Object.fromEntries(inspected.Config.Env.map((value) => {
    const index = value.indexOf("=");
    return [value.slice(0, index), value.slice(index + 1)];
  }));
  const mysql = dialect === "mysql";
  const username = mysql ? "root" : settings.POSTGRES_USER ?? "postgres";
  const password = (mysql ? settings.MYSQL_ROOT_PASSWORD : settings.POSTGRES_PASSWORD) ?? "";
  const port = inspected.NetworkSettings.Ports[mysql ? "3306/tcp" : "5432/tcp"]?.[0]?.HostPort;
  if (!port || !password) throw new Error(`${dialect} container requires a published port and configured password`);
  return { prefix: `${mysql ? "mysql" : "postgres"}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}`, username, password, container };
}

const databaseName = `qiy_policy_${crypto.randomUUID().replaceAll("-", "")}`;
let databaseUrl = join(root, "policy.sqlite");
let server: Awaited<ReturnType<typeof inspectContainer>> | undefined;
const administration = async (statement: string): Promise<void> => {
  if (!server) return;
  await run(dialect === "mysql"
    ? ["docker", "exec", "-e", `MYSQL_PWD=${server.password}`, server.container, "mysql", "-u", server.username, "-e", statement]
    : ["docker", "exec", server.container, "psql", "-U", server.username, "-d", "postgres", "-c", statement], root);
};
if (dialect !== "sqlite") {
  server = await inspectContainer();
  await administration(`CREATE DATABASE ${databaseName}`);
  databaseUrl = `${server.prefix}/${databaseName}`;
}

try {
  const modelPath = join(mkdtempSync(join(tmpdir(), "qiy-resource-policy-model-")), "app.qiy");
  writeFileSync(modelPath, readFileSync("examples/resource-policy/app.qiy", "utf8").replace("database sqlite", `database ${dialect}`));
  await generateApp(modelPath, root);
  writeFileSync(join(root, "apps/server/tests/policy-acceptance.test.ts"), probe);
  console.log(`workspace ${root}`);
  console.log(`database ${dialect === "sqlite" ? databaseUrl : `${dialect} isolated database ${databaseName}`}`);
  await run(["bun", "install"], root);
  await run(["bun", "run", "db:generate"], join(root, "apps/server"), { DATABASE_URL: databaseUrl });
  await run(["bun", "run", "db:migrate"], join(root, "apps/server"), { DATABASE_URL: databaseUrl });
  console.log(await run(["bun", "run", "typecheck"], join(root, "apps/server"), { DATABASE_URL: databaseUrl }));
  console.log(await run(["bun", "test", "tests/policy-acceptance.test.ts", "--timeout", "30000"], join(root, "apps/server"), { DATABASE_URL: databaseUrl }));
  console.log(`resource policy ${dialect} acceptance passed: ${root}`);
} finally {
  if (dialect !== "sqlite") await administration(`DROP DATABASE ${databaseName}`);
}
