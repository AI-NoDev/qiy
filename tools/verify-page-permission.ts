import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Acceptance for page level authorization. It generates an authenticated admin
 * whose resource routes are wrapped in per-action guards, then installs it, runs
 * the generated Web tests (page action decisions for every role), typechecks the
 * real React/TS sources and builds the production SPA.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-page-permission-"));
const admin = join(root, "admin");

async function run(command: string[], cwd: string): Promise<string> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}) in ${cwd}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application page-permission {
  database sqlite {}
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
    field reference Text;
    field amount Decimal(10,2) @nullable;
  }
  restrict orders {
    allow roles admin, operator, viewer;
    mask amount roles viewer mode redact replacement "***";
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);
await run(["bun", "install"], admin);
const web = join(admin, "apps/web");
console.log(await run(["bun", "test"], web));
console.log(await run(["bun", "run", "typecheck"], web));
console.log(await run(["bun", "run", "build"], web));
console.log(`page permission acceptance passed: ${root}`);
