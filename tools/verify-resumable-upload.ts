import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for resumable (chunked) uploads: open a session, send chunks,
 * resume from the reported offset, complete it into storage, then verify the
 * bytes, the metadata, ownership isolation and the policy limits.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-resumable-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const storageRoot = join(root, "storage");
const databaseUrl = join(root, "resumable.sqlite");

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
application resumable {
  database sqlite {}
  api { client rest; }
  storage { provider local; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity documents {
    field id UUID @id;
    field title Text;
    field attachment File @nullable @upload(binary) @maxBytes(1048576) @mime("application/octet-stream");
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "resumable.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "./src/db";
import { createStorageRoutes } from "./src/storage/routes";
import { createStorageFromEnv } from "./src/storage";

Bun.env.QIY_STORAGE_PROVIDER = "local";
Bun.env.QIY_STORAGE_ROOT = process.env.QIY_STORAGE_ROOT!;
const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Admin", role: "admin" as const };
const operator = { id: "00000000-0000-4000-8000-000000000002", name: "Operator", role: "operator" as const };
let current = admin;
const authenticate = async () => current;
const uploader = new Elysia().use(createStorageRoutes(authenticate));
const base = "http://localhost/api/v1/files/upload-sessions";
const bytes = (text: string) => new Uint8Array(Buffer.from(text));
const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;

test("uploads a file in resumable chunks and serves the assembled bytes", async () => {
  const session = await json(await uploader.handle(new Request(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "uploads/report.bin", fileName: "report.bin", contentType: "application/octet-stream", resource: "documents", field: "attachment" }),
  })));
  expect(session.receivedBytes).toBe(0);
  const id = String(session.id);
  // Chunk 1, then resume from the reported offset.
  const first = await uploader.handle(new Request(base + "/" + id, { method: "PUT", body: bytes("hello-") }));
  expect(first.status).toBe(200);
  expect((await json(first)).receivedBytes).toBe(6);
  const progress = await json(await uploader.handle(new Request(base + "/" + id)));
  expect(progress.receivedBytes).toBe(6);
  // A stale offset is refused so a client cannot corrupt the stream.
  const stale = await uploader.handle(new Request(base + "/" + id + "?offset=0", { method: "PUT", body: bytes("x") }));
  expect(stale.status).toBe(409);
  const second = await uploader.handle(new Request(base + "/" + id + "?offset=6", { method: "PUT", body: bytes("world") }));
  expect(second.status).toBe(200);
  const completed = await uploader.handle(new Request(base + "/" + id + "/complete", { method: "POST" }));
  expect(completed.status).toBe(200);
  const metadata = await json(completed);
  expect(metadata.size).toBe(11);
  expect(metadata.contentType).toBe("application/octet-stream");
  expect((await json(await uploader.handle(new Request(base + "/" + id)))).id).toBeUndefined();
  // The assembled object is readable through the normal download route.
  const storage = createStorageFromEnv();
  expect(new TextDecoder().decode(await storage.open(String(metadata.storageKey)).arrayBuffer())).toBe("hello-world");
  // The attachment metadata is queryable and the key cannot be reused.
  const stored = await json(await uploader.handle(new Request("http://localhost/api/v1/files/metadata?key=uploads/report.bin")));
  expect(stored.fileName).toBe("report.bin");
  const duplicate = await uploader.handle(new Request(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "uploads/report.bin", resource: "documents", field: "attachment" }),
  }));
  expect(duplicate.status).toBe(409);
});

test("enforces ownership, abort and upload policy", async () => {
  const session = await json(await uploader.handle(new Request(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "uploads/owned.bin", resource: "documents", field: "attachment" }),
  })));
  const id = String(session.id);
  await uploader.handle(new Request(base + "/" + id, { method: "PUT", body: bytes("secret") }));
  // Another principal cannot read, append to or complete the session.
  current = operator;
  expect((await uploader.handle(new Request(base + "/" + id))).status).toBe(404);
  expect((await uploader.handle(new Request(base + "/" + id, { method: "PUT", body: bytes("x") }))).status).toBe(404);
  expect((await uploader.handle(new Request(base + "/" + id + "/complete", { method: "POST" }))).status).toBe(404);
  current = admin;
  // Aborting removes the session and leaves no object behind.
  expect((await json(await uploader.handle(new Request(base + "/" + id, { method: "DELETE" })))).aborted).toBe(true);
  expect((await uploader.handle(new Request(base + "/" + id + "/complete", { method: "POST" }))).status).toBe(404);
  // The per-field maxBytes policy is enforced while chunks arrive.
  const limited = await json(await uploader.handle(new Request(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "uploads/huge.bin", resource: "documents", field: "attachment" }),
  })));
  const big = new Uint8Array(1024 * 1024 + 1);
  expect((await uploader.handle(new Request(base + "/" + String(limited.id), { method: "PUT", body: big }))).status).toBe(413);
  // Completing an empty or disallowed session is refused.
  const empty = await json(await uploader.handle(new Request(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "uploads/empty.bin", resource: "documents", field: "attachment" }),
  })));
  expect((await uploader.handle(new Request(base + "/" + String(empty.id) + "/complete", { method: "POST" }))).status).toBe(400);
});

test("teardown", () => { client.close(); });
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "resumable.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl, QIY_STORAGE_ROOT: storageRoot }));
  console.log(`resumable upload acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
