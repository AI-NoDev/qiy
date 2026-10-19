import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for server-side saved views: per-user persistence, sharing,
 * ownership rules and bounded payloads. This is what lets views follow a user
 * across devices instead of living only in one browser profile.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-saved-views-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "views.sqlite");

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
application saved-views {
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
    field amount Integer;
  }
  entity notes {
    field id UUID @id;
    field title Text;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "views.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { qiySavedViews } from "./src/schema";
import { ItemsRepository } from "./src/modules/items/items.repository";
import { NotesRepository } from "./src/modules/notes/notes.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const identities: Record<string, { id: string; name: string; role: "admin" | "operator" }> = {
  alice: { id: "00000000-0000-4000-8000-0000000000a1", name: "alice", role: "admin" },
  bob: { id: "00000000-0000-4000-8000-0000000000b1", name: "bob", role: "operator" },
};
const app = (user?: keyof typeof identities) => createApp({ users: UsersRepository, items: ItemsRepository, notes: NotesRepository }, (async () => (user ? identities[user] : null)) as never);
const request = async (user: keyof typeof identities | undefined, path: string, init?: RequestInit) => (await app(user)).handle(new Request("http://localhost" + path, init));
const createView = (user: keyof typeof identities, body: Record<string, unknown>) => request(user, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const listViews = async (user: keyof typeof identities, resource = "items") => {
  const response = await request(user, "/api/v1/saved-views?resource=" + resource);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Array<{ id: string; name: string; shared: boolean; ownerId: string; columns?: string[]; filters?: unknown[] }> }).items;
};

test("persists private and shared views per user", async () => {
  const privateView = await createView("alice", { resource: "items", name: "My open items", filters: [{ field: "title", operator: "contains", value: "a" }], columns: ["title", "amount"] });
  expect(privateView.status).toBe(201);
  const created = (await privateView.json()) as { id: string; name: string; shared: boolean; ownerId: string; columns?: string[]; filters?: unknown[] };
  expect(created).toMatchObject({ name: "My open items", shared: false, ownerId: identities.alice!.id, columns: ["title", "amount"] });
  expect(created.filters).toEqual([{ field: "title", operator: "contains", value: "a" }]);

  const sharedView = await createView("alice", { resource: "items", name: "Team view", shared: true, columns: ["title"] });
  expect(sharedView.status).toBe(201);

  // The owner sees both; another user only sees the shared one.
  expect((await listViews("alice")).map((view) => view.name).sort()).toEqual(["My open items", "Team view"]);
  expect((await listViews("bob")).map((view) => view.name)).toEqual(["Team view"]);
  // Views are scoped to their resource.
  expect(await listViews("alice", "notes")).toEqual([]);
  // Durable rows, not request memory.
  const rows = await db.select().from(qiySavedViews);
  expect(rows.map((row) => row.name).sort()).toEqual(["My open items", "Team view"]);
});

test("enforces ownership on delete and validates input", async () => {
  const ownerView = (await (await createView("alice", { resource: "items", name: "Alice only" })).json()) as { id: string };
  // Another user cannot delete it, and a missing id is 404.
  expect((await request("bob", "/api/v1/saved-views/" + ownerView.id, { method: "DELETE" })).status).toBe(403);
  expect((await request("alice", "/api/v1/saved-views/missing", { method: "DELETE" })).status).toBe(404);
  expect((await request("alice", "/api/v1/saved-views/" + ownerView.id, { method: "DELETE" })).status).toBe(204);
  expect((await listViews("alice")).some((view) => view.name === "Alice only")).toBe(false);

  // Unauthenticated access is refused, not silently empty.
  expect((await request(undefined, "/api/v1/saved-views?resource=items")).status).toBe(401);
  expect((await createView("alice", { resource: "missing", name: "x" })).status).toBe(400);
  expect(((await (await createView("alice", { resource: "missing", name: "x" })).json()) as { errorKey?: string }).errorKey).toBe("views.unknownResource");
  // A view name is required.
  expect((await createView("alice", { resource: "items", name: "   " })).status).toBe(400);
});

test("caps how many views one user can keep per resource", async () => {
  for (let index = 0; index < 100; index++) {
    expect((await createView("bob", { resource: "items", name: "bulk-" + index })).status).toBe(201);
  }
  const limit = await createView("bob", { resource: "items", name: "one-too-many" });
  expect(limit.status).toBe(400);
  expect(((await limit.json()) as { errorKey?: string }).errorKey).toBe("views.limit");
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "views.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`saved views acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
