import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for multi-file (Files) fields. Qiy generates either a REST or a
 * GraphQL API per application, so this provisions one workspace per client:
 * REST covers uploads, persistence, patching, downloads and the maxFiles bound;
 * GraphQL covers the [String!] list input and output. Both share the same model.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-multifile-"));

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

const model = (client: "rest" | "graphql") => `qiy v0;
application multifile-${client} {
  database sqlite {}
  api { client ${client}; }
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
    field attachments Files @nullable @upload(base64) @maxBytes(1048576) @mime("application/pdf") @maxFiles(3);
  }
}
`;

const restTest = `import { afterAll, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createApp } from "./src/app";
import { client, db } from "./src/db";
import { documents } from "./src/schema";
import { DocumentsRepository } from "./src/modules/documents/documents.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { createStorageRoutes } from "./src/storage/routes";
import { createStorageFromEnv } from "./src/storage";

Bun.env.QIY_STORAGE_PROVIDER = "local";
Bun.env.QIY_STORAGE_ROOT = __STORAGE__;
const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Admin", role: "admin" as const };
const authenticate = async () => admin;
const storage = createStorageFromEnv();
const base64 = (text: string) => Buffer.from(text).toString("base64");

afterAll(() => { client.close(); });

test("uploads several attachments and persists them on one record", async () => {
  const uploader = new Elysia().use(createStorageRoutes(authenticate));
  const keys: string[] = [];
  for (const name of ["a.pdf", "b.pdf"]) {
    const key = "uploads/" + name;
    const response = await uploader.handle(new Request("http://localhost/api/v1/files/base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, fileName: name, resource: "documents", field: "attachments", contentType: "application/pdf", data: base64("pdf-" + name) }),
    }));
    expect(response.status).toBe(200);
    keys.push(key);
  }
  expect(await storage.exists("uploads/a.pdf")).toBe(true);
  expect(await storage.exists("uploads/b.pdf")).toBe(true);

  const app = await createApp({ users: UsersRepository, documents: DocumentsRepository }, authenticate);
  const created = await app.handle(new Request("http://localhost/api/v1/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Bundle", attachments: keys }) }));
  expect(created.status).toBe(201);
  const record = await created.json() as { id: string; attachments: string[] };
  expect(record.attachments).toEqual(keys);

  // The column round-trips a real array rather than a stringified array.
  const stored = await db.select().from(documents);
  expect(Array.isArray(stored[0]!.attachments)).toBe(true);
  expect(stored[0]!.attachments).toEqual(keys);

  const read = await app.handle(new Request("http://localhost/api/v1/documents/" + record.id));
  expect((await read.json() as { attachments: string[] }).attachments).toEqual(keys);

  // Every key stays individually readable through the protected download route.
  for (const key of keys) {
    const download = await app.handle(new Request("http://localhost/api/v1/files?key=" + key));
    expect(await download.text()).toBe("pdf-" + key.split("/").pop());
  }

  // A patch replaces the whole list rather than appending.
  const patched = await app.handle(new Request("http://localhost/api/v1/documents/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachments: [keys[1]] }) }));
  expect((await patched.json() as { attachments: string[] }).attachments).toEqual([keys[1]]);
});

test("enforces the maxFiles bound and the array shape", async () => {
  const app = await createApp({ users: UsersRepository, documents: DocumentsRepository }, authenticate);
  const post = (body: unknown) => app.handle(new Request("http://localhost/api/v1/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  expect((await post({ title: "Too many", attachments: ["uploads/1.pdf", "uploads/2.pdf", "uploads/3.pdf", "uploads/4.pdf"] })).status).toBe(422);
  expect((await post({ title: "Empty", attachments: [] })).status).toBe(422);
  expect((await post({ title: "Wrong", attachments: "uploads/1.pdf" })).status).toBe(422);
  expect((await post({ title: "Not strings", attachments: [1, 2] })).status).toBe(422);
  // Storage keys, not the record schema, are what refuse traversal at upload time.
  expect(() => storage.save("../etc/passwd", new Blob(["x"]))).toThrow("Invalid storage key");
});
`;

const graphqlTest = `import { afterAll, expect, test } from "bun:test";
import { createApp } from "./src/app";
import { client, db } from "./src/db";
import { documents } from "./src/schema";
import { DocumentsRepository } from "./src/modules/documents/documents.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Admin", role: "admin" as const };
const authenticate = async () => admin;

afterAll(() => { client.close(); });

test("exposes Files as a String list in GraphQL", async () => {
  const app = await createApp({ users: UsersRepository, documents: DocumentsRepository }, authenticate);
  const created = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: 'mutation { createDocuments(input: { title: "Graph", attachments: ["uploads/g.pdf", "uploads/h.pdf"] }) { id title attachments } }' }) }));
  const body = await created.json() as { data?: { createDocuments?: { attachments: string[] } }; errors?: unknown };
  expect(body.errors).toBeUndefined();
  expect(body.data?.createDocuments?.attachments).toEqual(["uploads/g.pdf", "uploads/h.pdf"]);

  const stored = await db.select().from(documents);
  expect(Array.isArray(stored[0]!.attachments)).toBe(true);
  expect(stored[0]!.attachments).toEqual(["uploads/g.pdf", "uploads/h.pdf"]);

  const one = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ documents { total items { title attachments } } }" }) }));
  const listed = await one.json() as { data?: { documents?: { total: number; items: Array<{ attachments: string[] }> } }; errors?: unknown };
  expect(listed.errors).toBeUndefined();
  expect(listed.data?.documents?.total).toBe(1);
  expect(listed.data?.documents?.items[0]?.attachments).toEqual(["uploads/g.pdf", "uploads/h.pdf"]);
});
`;

async function accept(client: "rest" | "graphql", testSource: string): Promise<void> {
  const workspace = join(root, client);
  const server = join(workspace, "apps/server");
  const databaseUrl = join(root, `${client}.sqlite`);
  const storageRoot = join(root, `${client}-storage`);
  writeFileSync(join(root, `${client}.qiy`), model(client));
  await generateApp(join(root, `${client}.qiy`), workspace);
  writeFileSync(join(server, `${client}.acceptance.test.ts`), testSource.replace("__STORAGE__", JSON.stringify(storageRoot)));
  await must(["bun", "install"], workspace);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", `${client}.acceptance.test.ts`], server, { DATABASE_URL: databaseUrl }));
}

console.log(`workspace ${root}`);
await accept("rest", restTest);
await accept("graphql", graphqlTest);
console.log(`multi-file acceptance passed: ${root}`);
