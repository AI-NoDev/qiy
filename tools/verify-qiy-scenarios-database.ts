import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateApp } from "./commands/generate-app";
import { parseQiyProject, serializeQiyProject } from "./qiy-project";

const dialect = process.argv[3] ?? "postgresql";
if (dialect !== "postgresql" && dialect !== "mysql") throw new Error("Expected postgresql or mysql");
const mysql = dialect === "mysql";
const container = process.argv[2] ?? (mysql ? "qiy-dataflow-mysql" : "qiy-erp-pg");
const executable = process.argv[4] ? resolve(process.argv[4]) : undefined;
const root = mkdtempSync(join(tmpdir(), `qiy-${dialect}-scenarios-`));
async function run(command: string[], cwd = root, env: Record<string, string> = {}, succeeds = true) {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  if (succeeds && code !== 0) throw new Error(output.replaceAll(env.DATABASE_URL ?? "__none__", "[database URL]"));
  return { code, output };
}
const inspected = JSON.parse((await run(["docker", "inspect", container])).output)[0];
const settings = Object.fromEntries((inspected.Config.Env as string[]).map((value) => { const index = value.indexOf("="); return [value.slice(0, index), value.slice(index + 1)]; }));
const username = mysql ? "root" : settings.POSTGRES_USER ?? "postgres";
const password = mysql ? settings.MYSQL_ROOT_PASSWORD : settings.POSTGRES_PASSWORD;
const port = inspected.NetworkSettings.Ports[mysql ? "3306/tcp" : "5432/tcp"]?.[0]?.HostPort;
if (!port || !password) throw new Error("Container requires a published port and password");
async function administration(statement: string) {
  await run(mysql
    ? ["docker", "exec", "-e", `MYSQL_PWD=${password}`, container, "mysql", "-u", username, "-e", statement]
    : ["docker", "exec", container, "psql", "-U", username, "-d", "postgres", "-c", statement]);
}
for (const example of ["call", "create-delete", "identity", "side-effects"]) {
  const name = `qiy_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const source = join(root, example);
  mkdirSync(source);
  const project = parseQiyProject(readFileSync(`examples/dataflow/${example}.qiy`, "utf8").replace("database sqlite", `database ${dialect}`));
  if (example === "create-delete") {
    project.database.relations = [{ name: "reviewUser", fromEntity: "reviews", fromField: "userId", toEntity: "users", toField: "id", cardinality: "one", onDelete: "restrict" }];
    project.database.entities.reverse();
  }
  writeFileSync(join(source, "app.qiy"), serializeQiyProject(project));
  writeFileSync(join(source, "app.test.qiy"), readFileSync(`examples/dataflow/${example}.test.qiy`, "utf8"));
  const url = `${mysql ? "mysql" : "postgres"}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${name}`;
  const env = { DATABASE_URL: url, QIY_TEST_DATABASE_URL: url };
  await administration(`CREATE DATABASE ${name}`);
  try {
    const output = join(source, "admin");
    if (executable) await run([executable, "create", "-f", join(source, "app.qiy"), "-n", project.name, "-o", output]);
    else await generateApp(join(source, "app.qiy"), output);
    await run([process.execPath, "install"], output);
    const server = join(output, "apps/server");
    await run([process.execPath, "run", "typecheck"], server, env);
    const rejected = await run([process.execPath, "test", "tests/qiy-scenarios.test.ts"], server, { ...env, QIY_TEST_DATABASE_URL: "" }, false);
    if (rejected.code === 0 || !rejected.output.includes("dedicated qiy_test_* database")) throw new Error("Test database guard did not reject missing opt-in");
    await run([process.execPath, "run", "--bun", "drizzle-kit", "generate"], server, env);
    await run([process.execPath, "run", "--bun", "drizzle-kit", "migrate"], server, env);
    const result = await run([process.execPath, "test", "tests/qiy-scenarios.test.ts", "--timeout", "30000"], server, env);
    writeFileSync(join(source, "acceptance.log"), result.output);
    console.log(`${dialect} ${example}: ${result.output}`);
  } finally {
    await administration(`DROP DATABASE ${name}${mysql ? "" : " WITH (FORCE)"}`);
  }
}
console.log(`Declarative database acceptance passed; evidence: ${root}`);
