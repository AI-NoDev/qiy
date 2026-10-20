import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for background exports: the worker materializes the CSV with the
 * same row policy and masks as the synchronous export, stores it on the job and
 * serves it through a one-shot download endpoint.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-export-async-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const dialect = Bun.env.QIY_ACCEPTANCE_DIALECT ?? "sqlite";
const databaseUrl = Bun.env.QIY_ACCEPTANCE_DATABASE_URL ?? join(root, "export-async.sqlite");

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
application export-async {
  database ${dialect} {}
  api { client rest; }
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
    field title Text;
    field region Text;
    field salary Integer;
  }
  restrict orders {
    allow roles admin, operator;
    when region claim region;
    mask salary roles operator mode omit;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "export-async.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { qiyExportJobs } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const as = (role: "admin" | "operator", region: string) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: { region } });
const app = (role: "admin" | "operator", region: string) => createApp({ users: UsersRepository, orders: OrdersRepository }, as(role, region) as never);
const replica = async (role: "admin" | "operator", region: string) => app(role, region);
const request = async (role: "admin" | "operator", region: string, path: string, init?: RequestInit) => (await app(role, region)).handle(new Request("http://localhost" + path, init));
const start = (role: "admin" | "operator", region: string, query = "") => request(role, region, "/api/v1/orders/export?async=1" + query);
type ExportJob = { id: string; resource: string; status: string; total: number; processed: number; errors: string[] };
async function waitForJob(role: "admin" | "operator", region: string, id: string): Promise<ExportJob> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request(role, region, "/api/v1/orders/export/jobs/" + id);
    expect(response.status).toBe(200);
    const job = (await response.json()) as ExportJob;
    if (job.status === "completed" || job.status === "failed") return job;
    await Bun.sleep(50);
  }
  throw new Error("Export job did not finish");
}

test("materializes the CSV in the background and serves it once", async () => {
  for (const [title, region, salary] of [["eu-one", "eu", 10], ["eu-two", "eu", 20], ["us-one", "us", 30]] as const) {
    const writer = await app("admin", region);
    const created = await writer.handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, region, salary }) }));
    expect(created.status).toBe(201);
  }
  const response = await start("operator", "eu");
  expect(response.status).toBe(202);
  const started = (await response.json()) as { jobId: string; total: number };
  expect(started.total).toBe(2);
  const job = await waitForJob("operator", "eu", started.jobId);
  expect(job.status).toBe("completed");
  expect(job.processed).toBe(2);
  // The CSV follows the same row policy and masks as the synchronous export.
  const download = await request("operator", "eu", "/api/v1/orders/export/jobs/" + started.jobId + "/download");
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toContain("text/csv");
  const lines = (await download.text()).trimEnd().split("\\r\\n");
  const header = lines[0]!.split(",");
  expect(header).not.toContain("salary");
  expect(lines).toHaveLength(3);
  expect(lines.slice(1).every((line) => !/,us,/.test(line))).toBe(true);
  // Durable job row, not request memory.
  const rows = await db.select().from(qiyExportJobs);
  expect(rows.map((row) => row.id)).toContain(started.jobId);
});

test("refuses anonymous, oversized and unknown export jobs", async () => {
  const anonymous = await (await createApp({ users: UsersRepository, orders: OrdersRepository })).handle(new Request("http://localhost/api/v1/orders/export?async=1"));
  expect(anonymous.status).toBe(401);
  Bun.env.QIY_EXPORT_MAX_ROWS = "1";
  try {
    const oversized = await start("admin", "eu");
    expect(oversized.status).toBe(400);
    expect(((await oversized.json()) as { errorKey?: string }).errorKey).toBe("export.tooLarge");
  } finally { delete Bun.env.QIY_EXPORT_MAX_ROWS; }
  expect((await request("admin", "eu", "/api/v1/orders/export/jobs/missing")).status).toBe(404);
  expect((await request("admin", "eu", "/api/v1/orders/export/jobs/missing/download")).status).toBe(404);
});

test("a queued export can be finished by another replica", async () => {
  Bun.env.QIY_EXPORT_INLINE = "off";
  try {
    const first = await replica("operator", "eu");
    const second = await replica("admin", "eu");
    const started = (await (await first.handle(new Request("http://localhost/api/v1/orders/export?async=1"))).json()) as { jobId: string };
    // Inline execution is off, so the job stays queued with its request spec stored.
    const queued = (await (await second.handle(new Request("http://localhost/api/v1/orders/export/jobs/" + started.jobId))).json()) as { status: string };
    expect(queued.status).toBe("queued");
    const listed = (await (await second.handle(new Request("http://localhost/api/v1/orders/export/jobs"))).json()) as { items: Array<{ id: string }> };
    expect(listed.items.map((job) => job.id)).toContain(started.jobId);
    const run = await second.handle(new Request("http://localhost/api/v1/orders/export/jobs/" + started.jobId + "/run", { method: "POST" }));
    expect(run.status).toBe(202);
    const done = (await (await second.handle(new Request("http://localhost/api/v1/orders/export/jobs/" + started.jobId))).json()) as { status: string; processed: number };
    expect(done.status).toBe("completed");
    const operatorView = await replica("operator", "eu");\n    const download = await operatorView.handle(new Request("http://localhost/api/v1/orders/export/jobs/" + started.jobId + "/download"));
    expect(download.status).toBe(200);
    const lines = (await download.text()).trimEnd().split("\\r\\n");
    expect(lines[0]!.split(",")).not.toContain("salary");
    expect(lines.length).toBe(done.processed + 1);
    // The same job cannot run twice, and non-admins cannot drive the worker.
    expect((await second.handle(new Request("http://localhost/api/v1/orders/export/jobs/" + started.jobId + "/run", { method: "POST" }))).status).toBe(409);
    const operatorApp = await replica("operator", "eu");
    expect((await operatorApp.handle(new Request("http://localhost/api/v1/orders/export/jobs"))).status).toBe(403);
  } finally { delete Bun.env.QIY_EXPORT_INLINE; }
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "export-async.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`async export acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
