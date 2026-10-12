import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateApp } from "./commands/generate-app";

const root = mkdtempSync(join(tmpdir(), "qiy-browser-actions-"));
const output = join(root, "admin");
const executable = Bun.argv[2] ? resolve(Bun.argv[2]) : undefined;
async function run(command: string[], cwd = output) {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Browser fixture command failed: ${command.slice(1).join(" ")}`);
}
const source = resolve(import.meta.dir, "../examples/dataflow/browser-actions.qiy");
if (executable) await run([executable, "create", "-f", source, "-n", "browser-actions", "-o", output], root);
else await generateApp(source, output);
await run([process.execPath, "install"]);
await run([process.execPath, "run", "typecheck"]);
await run([process.execPath, "run", "build"]);
const server = join(output, "apps/server");
await run([process.execPath, "run", "db:generate"], server);
await run([process.execPath, "run", "db:migrate"], server);
const seed = join(server, "seed-browser.ts");
writeFileSync(seed, `import { db } from "./src/db";
import { users, reviews } from "./src/schema";
import { hashPassword } from "./src/auth/password";
for (const role of ["admin", "viewer"] as const) {
  await db.insert(users).values({ id: crypto.randomUUID(), email: role + "@qiy.test", displayName: role, passwordHash: await hashPassword("qiy-browser-test-only"), role });
}
await db.insert(reviews).values([
  { id: "00000000-0000-4000-8000-000000000001", status: "pending", note: "First review" },
  { id: "00000000-0000-4000-8000-000000000002", status: "pending", note: "Second review" },
  { id: "00000000-0000-4000-8000-000000000003", status: "locked", note: "Locked review" }
]);
`);
await run([process.execPath, "--env-file=.env.development", seed], server);
writeFileSync(join(root, "acceptance.json"), JSON.stringify({ workspace: output, login: "admin@qiy.test", viewer: "viewer@qiy.test", password: "qiy-browser-test-only", scenario: "single/batch actions, denied navigation, localized errors" }, null, 2));
console.log(`Browser Action fixture ready: ${output}`);
console.log(`Run in apps/server: PORT=3026 bun --env-file=.env.development src/server.ts`);
