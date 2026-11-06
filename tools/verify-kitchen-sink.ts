import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dialect = process.argv[2];
const databaseUrl = process.argv[3];
if (dialect !== "postgresql" && dialect !== "mysql" && dialect !== "sqlite") throw new Error("Usage: bun tools/verify-kitchen-sink.ts <postgresql|mysql|sqlite> [database-url]");
if (dialect !== "sqlite" && !databaseUrl) throw new Error(`${dialect} needs a disposable database URL`);

const root = resolve(import.meta.dir, "..");
const output = mkdtempSync(join(tmpdir(), `qiy-kitchen-${dialect}-`));
const server = join(output, "apps/server");
const web = join(output, "apps/web");
const env = { ...process.env, ...(databaseUrl ? { DATABASE_URL: databaseUrl, QIY_TEST_DATABASE_URL: databaseUrl } : {}) };

async function run(command: string[], cwd: string): Promise<void> {
  console.log(`Kitchen-sink ${dialect}: ${command.slice(1).join(" ")} (${cwd})`);
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
}

await run([process.execPath, join(root, "tools/cli.ts"), "generate", join(root, `tests/fixtures/kitchen-sink/${dialect}.qiy`), output], root);
await run([process.execPath, "install"], output);
if (databaseUrl) {
  await run([process.execPath, "run", "--bun", "drizzle-kit", "generate"], server);
  await run([process.execPath, "run", "--bun", "drizzle-kit", "migrate"], server);
}
await run([process.execPath, "run", "typecheck"], server);
await run([process.execPath, "run", "test", "--timeout", "30000"], server);
await run([process.execPath, "run", "typecheck"], web);
await run([process.execPath, "run", "test"], web);
console.log(`Kitchen-sink ${dialect}: generate, install, ${databaseUrl ? "migrate, " : ""}typecheck and tests passed in ${output}`);
