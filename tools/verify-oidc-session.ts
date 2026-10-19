import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Acceptance for the generated OIDC browser session. It generates an OIDC admin
 * and then installs it, runs the generated Web tests (expiry tracking, silent
 * renewal, loop guard, callback fallback), typechecks the real React/TS sources
 * and builds the production SPA.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-oidc-session-"));
const admin = join(root, "admin");

async function run(command: string[], cwd: string): Promise<string> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}) in ${cwd}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application oidc-session {
  database sqlite {}
  auth { provider oidc; user users; subjectField subject; roleField role; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field subject Text @unique;
    field role userRole;
  }
  entity orders {
    field id UUID @id;
    field reference Text;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);
await run(["bun", "install"], admin);
const web = join(admin, "apps/web");
console.log(await run(["bun", "test", "tests/oidc-client.test.ts"], web));
console.log(await run(["bun", "run", "typecheck"], web));
console.log(await run(["bun", "run", "build"], web));
console.log(`OIDC browser session acceptance passed: ${root}`);
