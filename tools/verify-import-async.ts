import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for background imports. `POST /import?async=1` must record a
 * durable job and return before writing, the status endpoint must report progress,
 * a failing row must still compensate, and the synchronous path must be unchanged.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-import-async-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "import-async.sqlite");

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
application import-async {
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
  pages items {
    list roles admin, operator;
    create roles admin;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "import-async.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { desc } from "drizzle-orm";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { items, qiyImportJobs } from "./src/schema";
import { ItemsRepository } from "./src/modules/items/items.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const as = (role: "admin" | "operator") => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: {} });
const app = (role: "admin" | "operator") => createApp({ users: UsersRepository, items: ItemsRepository }, as(role) as never);
const startImport = async (role: "admin" | "operator", csv: string) => (await app(role)).handle(new Request("http://localhost/api/v1/items/import?async=1", { method: "POST", headers: { "Content-Type": "text/csv" }, body: csv }));
const jobStatus = async (id: string) => (await (await app("admin")).handle(new Request("http://localhost/api/v1/items/import/jobs/" + id))).json() as Promise<{ status: string; total: number; processed: number; failed: number; errors: string[]; resource: string; actorId: string | null }>;
type Job = { status: string; total: number; processed: number; failed: number; errors: string[]; resource: string; actorId: string | null };
async function waitForJob(id: string): Promise<Job> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await jobStatus(id);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
    await Bun.sleep(50);
  }
  throw new Error("Import job did not finish");
}

test("records a durable job and imports in the background", async () => {
  const response = await startImport("admin", "title,qty\\nfirst,1\\nsecond,2\\nthird,3\\n");
  expect(response.status).toBe(202);
  const started = (await response.json()) as { jobId: string; total: number };
  expect(started.total).toBe(3);
  const job = await waitForJob(started.jobId);
  expect(job.status).toBe("completed");
  expect(job).toMatchObject({ status: "completed", total: 3, processed: 3, failed: 0, errors: [], resource: "items" });
  expect(job.actorId).toBe("00000000-0000-4000-8000-000000000001");
  // The job row is durable, not request-scoped memory.
  const rows = await db.select().from(qiyImportJobs).orderBy(desc(qiyImportJobs.createdAt));
  expect(rows[0]?.id).toBe(started.jobId);
  const listed = (await (await (await app("admin")).handle(new Request("http://localhost/api/v1/items?pageSize=100"))).json()) as { data: Array<{ title: string }>; total: number };
  expect(listed.total).toBe(3);
  expect(listed.data.map((row) => row.title).sort()).toEqual(["first", "second", "third"]);
});

test("a failing row fails the job and compensates the partial import", async () => {
  const response = await startImport("admin", "title,qty\\nkept,1\\nbad,not-a-number\\n");
  expect(response.status).toBe(202);
  const job = await waitForJob(((await response.json()) as { jobId: string }).jobId);
  expect(job.status).toBe("failed");
  expect(job.errors[0]).toContain("Row 3");
  expect(job.failed).toBeGreaterThan(0);
  // Nothing from the failed job survives, so no half-import is visible.
  const listed = (await (await (await app("admin")).handle(new Request("http://localhost/api/v1/items?pageSize=100"))).json()) as { total: number };
  expect(listed.total).toBe(3);
});

test("keeps the synchronous path and refusals", async () => {
  const sync = await (await app("admin")).handle(new Request("http://localhost/api/v1/items/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: "title,qty\\nsync,9\\n" }));
  expect(sync.status).toBe(201);
  expect((await sync.json()) as { imported: number }).toEqual({ imported: 1 });

  // Importing writes rows, so the create page rule applies even in async mode.
  expect((await startImport("operator", "title,qty\\nblocked,1\\n")).status).toBe(403);
  const anonymous = await (await createApp({ users: UsersRepository, items: ItemsRepository })).handle(new Request("http://localhost/api/v1/items/import?async=1", { method: "POST", headers: { "Content-Type": "text/csv" }, body: "title,qty\\nx,1\\n" }));
  expect(anonymous.status).toBe(401);
  // Unknown job ids are not silently reported as finished.
  expect((await (await app("admin")).handle(new Request("http://localhost/api/v1/items/import/jobs/missing"))).status).toBe(404);
});

test("cancels a running job and compensates its rows", async () => {
  const csv = "title,qty\\n" + Array.from({ length: 80 }, (_, index) => "cancel-" + index + ",1").join("\\n") + "\\n";
  Bun.env.QIY_IMPORT_JOB_DELAY_MS = "15";
  try {
    const response = await startImport("admin", csv);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    await Bun.sleep(120);
    const cancelled = await (await app("admin")).handle(new Request("http://localhost/api/v1/items/import/jobs/" + jobId + "/cancel", { method: "POST" }));
    expect(cancelled.status).toBe(202);
    const job = await waitForJob(jobId);
    expect(job.status).toBe("cancelled");
    expect(job.processed).toBeLessThan(80);
    // Everything the cancelled job wrote has been removed again.
    const listed = (await (await (await app("admin")).handle(new Request("http://localhost/api/v1/items?pageSize=100"))).json()) as { data: Array<{ title: string }> };
    const leftovers = listed.data.map((row) => String(row.title)).filter((title) => title.startsWith("cancel-"));
    expect(leftovers).toEqual([]);
    // A finished job cannot be cancelled twice.
    const again = await (await app("admin")).handle(new Request("http://localhost/api/v1/items/import/jobs/" + jobId + "/cancel", { method: "POST" }));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { errorKey?: string }).errorKey).toBe("import.notRunning");
  } finally { delete Bun.env.QIY_IMPORT_JOB_DELAY_MS; }
});

test("ages out a job whose process stopped reporting", async () => {
  const staleId = crypto.randomUUID();
  await db.insert(qiyImportJobs).values({ id: staleId, resource: "items", status: "running", total: 10, processed: 3, failed: 0, errors: null, actorId: null, createdAt: new Date(Date.now() - 900_000), updatedAt: new Date(Date.now() - 900_000) });
  const job = await jobStatus(staleId);
  expect(job.status).toBe("failed");
  expect(job.errors[0]).toBe("Stale import job timed out");
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "import-async.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`async import acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
