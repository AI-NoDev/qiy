import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for attachment orphan scanning. It generates an admin with a
 * File field and local storage, uploads files over real HTTP, strands one object
 * by deleting its metadata row, and then proves the scanner reports it, does not
 * delete on a dry run, deletes it with --apply, leaves referenced objects alone,
 * and reports the opposite direction (metadata without an object).
 */
const root = mkdtempSync(join(tmpdir(), "qiy-orphans-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");

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
application orphan-demo {
  database sqlite {}
  storage { provider local; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity products {
    field id UUID @id;
    field title Text;
    field datasheet File @nullable @upload(both) @maxBytes(1048576) @mime("application/pdf") @maxFiles(1);
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

const databaseUrl = join(root, "orphans.sqlite");
const storageRoot = join(root, "storage");

writeFileSync(join(server, "orphan.acceptance.test.ts"), `import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { createStorageRoutes, scanOrphanAttachmentObjects, cleanupMissingAttachmentObjects } from "./src/storage/routes";
import { createStorageFromEnv } from "./src/storage/index";
import { db, client } from "./src/db";
import { attachments } from "./src/schema";

// The test preload defaults to in-memory metadata and its own storage root; this
// acceptance needs the same database-backed metadata and directory the CLI uses.
Bun.env.QIY_STORAGE_PROVIDER = "local";
Bun.env.QIY_STORAGE_METADATA = "database";
Bun.env.QIY_STORAGE_ROOT = ${JSON.stringify(storageRoot)};

const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Admin", role: "admin" as const };
const app = new Elysia().use(createStorageRoutes(async () => admin));
const post = async (key: string, data: string) => {
  const body = { key, data, contentType: "application/pdf", resource: "products", field: "datasheet", fileName: key.split("/").pop() ?? "file.pdf" };
  const response = await app.handle(new Request("http://localhost/api/v1/files/base64", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json().catch(() => null) };
};
const base64 = (text: string) => Buffer.from(text).toString("base64");

afterAll(() => { client.close(); });

test("scans stored objects against attachment metadata", async () => {
  expect((await post("keep/one.pdf", base64("one"))).status).toBe(200);
  expect((await post("stranded/two.pdf", base64("two"))).status).toBe(200);
  expect((await db.select().from(attachments)).length).toBe(2);

  // A failed metadata write or a manual delete leaves the object behind.
  await db.delete(attachments).where(eq(attachments.storageKey, "stranded/two.pdf"));

  const dryRun = await scanOrphanAttachmentObjects();
  expect(dryRun.dryRun).toBe(true);
  expect(dryRun.objects).toBe(2);
  expect(dryRun.metadata).toBe(1);
  expect(dryRun.orphans).toEqual(["stranded/two.pdf"]);
  expect(dryRun.removed).toBe(0);
  expect(dryRun.missingObjects).toBe(0);
  const storage = createStorageFromEnv();
  expect(await storage.exists("stranded/two.pdf")).toBe(true);

  const applied = await scanOrphanAttachmentObjects({ dryRun: false });
  expect(applied.removed).toBe(1);
  expect(await storage.exists("stranded/two.pdf")).toBe(false);
  expect(await storage.exists("keep/one.pdf")).toBe(true);
  const clean = await scanOrphanAttachmentObjects();
  expect(clean.orphans).toEqual([]);
  expect(clean.objects).toBe(1);

  // The opposite direction is reported separately and is not deleted by this scan.
  await db.insert(attachments).values({ id: crypto.randomUUID(), storageKey: "gone/three.pdf", fileName: null, contentType: "application/pdf", size: 3, ownerId: admin.id, resource: "products", resourceId: null });
  const withMissing = await scanOrphanAttachmentObjects();
  expect(withMissing.missingObjects).toBe(1);
  expect(withMissing.orphans).toEqual([]);
  expect((await db.select().from(attachments)).length).toBe(2);
  expect((await cleanupMissingAttachmentObjects({ dryRun: false })).removed).toBe(1);
  expect((await db.select().from(attachments)).length).toBe(1);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  const environment = { DATABASE_URL: databaseUrl, QIY_STORAGE_PROVIDER: "local", QIY_STORAGE_METADATA: "database", QIY_STORAGE_ROOT: storageRoot };
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "orphan.acceptance.test.ts"], server, environment));

  // The shipped CLI stays a dry run by default and applies only with --apply.
  const cli = await run(["bun", "src/storage/orphans.ts"], server, environment);
  if (cli.code !== 0) throw new Error(`attachments:orphans failed:\n${cli.output}`);
  if (!cli.output.includes('"orphans":[]')) throw new Error(`the CLI did not report a clean state:\n${cli.output}`);
  console.log(cli.output.trim());
  console.log(`orphan scan acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
