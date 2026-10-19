import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the cross-replica import worker. The row payload lives on the
 * job row, a lease decides which replica runs it, and any replica can drain queued
 * work through the generated worker endpoints.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-import-worker-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "worker.sqlite");

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
application import-worker {
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

writeFileSync(join(server, "worker.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { items, qiyImportJobs } from "./src/schema";
import { ItemsRepository } from "./src/modules/items/items.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

type Role = "admin" | "operator";
const identities: Record<Role, { id: string; name: string; role: Role }> = {
  admin: { id: "00000000-0000-4000-8000-0000000000a1", name: "admin", role: "admin" },
  operator: { id: "00000000-0000-4000-8000-0000000000b1", name: "operator", role: "operator" },
};
// Two independent application instances simulate two replicas sharing one database.
const replica = (role: Role = "admin") => createApp({ users: UsersRepository, items: ItemsRepository }, (async () => identities[role]) as never);
const call = async (app: Awaited<ReturnType<typeof replica>>, path: string, init?: RequestInit) => app.handle(new Request("http://localhost" + path, init));
const enqueue = async (app: Awaited<ReturnType<typeof replica>>, csv: string) => {
  const response = await call(app, "/api/v1/items/import?async=1", { method: "POST", headers: { "Content-Type": "text/csv" }, body: csv });
  expect(response.status).toBe(202);
  return (await response.json()) as { jobId: string; total: number };
};
const jobStatus = async (app: Awaited<ReturnType<typeof replica>>, id: string) => (await (await call(app, "/api/v1/items/import/jobs/" + id)).json()) as { status: string; total: number; processed: number; errors: string[] };

Bun.env.QIY_IMPORT_INLINE = "off";

test("queues a job on one replica and runs it on another", async () => {
  const first = await replica();
  const second = await replica();
  const { jobId, total } = await enqueue(first, "title,qty\\nalpha,1\\nbeta,2\\n");
  expect(total).toBe(2);
  // The payload is durable, so the job is still queued after the request returns.
  const queued = await jobStatus(first, jobId);
  expect(queued.status).toBe("queued");
  const listed = (await (await call(second, "/api/v1/items/import/jobs")).json()) as { items: Array<{ id: string; status: string }> };
  expect(listed.items.map((job) => job.id)).toContain(jobId);
  // The other replica drains it.
  const runResponse = await call(second, "/api/v1/items/import/jobs/" + jobId + "/run", { method: "POST" });
  expect(runResponse.status).toBe(202);
  const done = await jobStatus(second, jobId);
  expect(done.status).toBe("completed");
  expect(done.processed).toBe(2);
  const rows = await db.select().from(items);
  expect(rows.map((row) => row.title).sort()).toEqual(["alpha", "beta"]);
  // Running the same job again is refused instead of importing twice.
  expect((await call(first, "/api/v1/items/import/jobs/" + jobId + "/run", { method: "POST" })).status).toBe(409);
  // Worker dispatch is admin-only and unknown jobs are 404.
  expect((await call(await replica("operator"), "/api/v1/items/import/jobs")).status).toBe(403);
  expect((await call(second, "/api/v1/items/import/jobs/missing/run", { method: "POST" })).status).toBe(404);
});

test("two replicas racing for the same job import it exactly once", async () => {
  const first = await replica();
  const second = await replica();
  const before = (await db.select().from(items)).length;
  const { jobId } = await enqueue(first, "title,qty\\nraced,7\\n");
  const [a, b] = await Promise.all([
    call(first, "/api/v1/items/import/jobs/" + jobId + "/run", { method: "POST" }),
    call(second, "/api/v1/items/import/jobs/" + jobId + "/run", { method: "POST" }),
  ]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([202, 409]);
  const after = (await db.select().from(items)).length;
  expect(after).toBe(before + 1);
  expect((await jobStatus(first, jobId)).status).toBe("completed");
});

test("a failed payload run compensates and records the row error", async () => {
  const first = await replica();
  const { jobId } = await enqueue(first, "title,qty\\nkept,1\\nbad,not-a-number\\n");
  expect((await call(first, "/api/v1/items/import/jobs/" + jobId + "/run", { method: "POST" })).status).toBe(202);
  const job = await jobStatus(first, jobId);
  expect(job.status).toBe("failed");
  expect(job.errors[0]).toContain("Row 3");
  const kept = await db.select().from(items).where(eq(items.title, "kept"));
  expect(kept).toHaveLength(0);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "worker.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`import worker acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
