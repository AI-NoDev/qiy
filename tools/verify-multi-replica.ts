import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real multi-replica acceptance: two independent server processes share one SQLite
 * database and hand an import job from one replica to the other over real HTTP.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-multi-replica-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "replica.sqlite");
const ports = [4617, 4618];

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

writeFileSync(join(root, "app.qiy"), `qiy v0;
application multi-replica {
  database sqlite {}
  api { client rest; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity items {
    field id UUID @id;
    field title Text;
    field qty Integer;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "replica.ts"), `import { createApp } from "./src/app";
import { ItemsRepository } from "./src/modules/items/items.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

// Test harness replica: a header chooses the principal so real HTTP calls can act as a role.
const authenticate = async (request: Request) => {
  const role = request.headers.get("x-test-role");
  if (!role) return null;
  return { id: "replica-" + role, name: role, role: role as "admin" | "operator" | "viewer", claims: {} };
};
const app = await createApp({ users: UsersRepository, items: ItemsRepository }, authenticate as never);
const port = Number(process.env.PORT ?? 0);
app.listen(port);
console.log("replica-listening " + (app.server as { port: number }).port);
`);

await must(["bun", "install"], admin);
await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));

const replicas = ports.map((port) => {
  const child = Bun.spawn([process.execPath, "run", "replica.ts"], {
    cwd: server,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), QIY_IMPORT_INLINE: "off" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { port, child };
});

const base = (port: number) => `http://127.0.0.1:${port}/api/v1`;
const headers = (role: string) => ({ "Content-Type": "text/csv", "x-test-role": role });
const json = (role: string) => ({ "x-test-role": role });
async function waitReady(port: number): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(base(port) + "/health");
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await Bun.sleep(100);
  }
  throw new Error("replica on port " + port + " did not become ready");
}
const enqueue = async (port: number, csv: string): Promise<string> => {
  const response = await fetch(base(port) + "/items/import?async=1", { method: "POST", headers: headers("admin"), body: csv });
  if (response.status !== 202) throw new Error("enqueue failed: " + response.status + " " + (await response.text()));
  return ((await response.json()) as { jobId: string }).jobId;
};
const jobStatus = async (port: number, id: string): Promise<{ status: string; processed: number; errors: string[] }> =>
  (await (await fetch(base(port) + "/items/import/jobs/" + id, { headers: json("admin") })).json()) as { status: string; processed: number; errors: string[] };

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  await Promise.all(ports.map(waitReady));
  console.log("two replicas listening on " + ports.join(", "));

  // 1) Enqueue on replica A, drain from replica B.
  const jobA = await enqueue(ports[0]!, "title,qty\nalpha,1\nbeta,2\n");
  check("job stays queued because QIY_IMPORT_INLINE=off", (await jobStatus(ports[0]!, jobA)).status === "queued");
  const listed = (await (await fetch(base(ports[1]!) + "/items/import/jobs", { headers: json("admin") })).json()) as { items: Array<{ id: string }> };
  check("replica B lists the job enqueued on replica A", listed.items.some((job) => job.id === jobA));
  const runB = await fetch(base(ports[1]!) + "/items/import/jobs/" + jobA + "/run", { method: "POST", headers: json("admin") });
  check("replica B claims and runs the job", runB.status === 202);
  check("job completes across replicas", (await jobStatus(ports[0]!, jobA)).status === "completed");
  const rowsA = (await (await fetch(base(ports[0]!) + "/items", { headers: json("admin") })).json()) as { total: number };
  check("rows written once and visible from replica A", rowsA.total === 2);
  check("re-running a finished job is refused", (await fetch(base(ports[1]!) + "/items/import/jobs/" + jobA + "/run", { method: "POST", headers: json("admin") })).status === 409);

  // 2) Two replicas racing for the same queued job.
  const jobB = await enqueue(ports[1]!, "title,qty\ngamma,3\n");
  const [raceA, raceB] = await Promise.all([
    fetch(base(ports[0]!) + "/items/import/jobs/" + jobB + "/run", { method: "POST", headers: json("admin") }),
    fetch(base(ports[1]!) + "/items/import/jobs/" + jobB + "/run", { method: "POST", headers: json("admin") }),
  ]);
  check("race resolves to exactly one claim", [raceA.status, raceB.status].sort().join(",") === "202,409");
  check("raced job completes", (await jobStatus(ports[0]!, jobB)).status === "completed");
  const afterRace = (await (await fetch(base(ports[0]!) + "/items", { headers: json("admin") })).json()) as { total: number };
  check("raced job imported exactly once", afterRace.total === 3);

  // 3) Authentication still applies over real HTTP.
  check("anonymous import is rejected", (await fetch(base(ports[0]!) + "/items/import?async=1", { method: "POST", body: "title,qty\nx,1\n" })).status === 401);
  check("non-admin worker access is forbidden", (await fetch(base(ports[0]!) + "/items/import/jobs", { headers: json("operator") })).status === 403);
} finally {
  for (const replica of replicas) replica.child.kill();
  console.log(failures === 0 ? "multi-replica acceptance passed: " + root : "multi-replica acceptance FAILED");
  if (failures > 0) process.exit(1);
}
