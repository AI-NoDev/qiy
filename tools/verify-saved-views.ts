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
const dialect = Bun.env.QIY_ACCEPTANCE_DIALECT ?? "sqlite";
const databaseUrl = Bun.env.QIY_ACCEPTANCE_DATABASE_URL ?? join(root, "views.sqlite");

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

type SavedView = { id: string; name: string; ownerId: string; shared: boolean; mine: boolean; columns?: string[]; filters?: unknown[]; search?: string; updatedAt: string };
const identities: Record<string, { id: string; name: string; role: "admin" | "operator" }> = {
  alice: { id: "00000000-0000-4000-8000-0000000000a1", name: "alice", role: "admin" },
  bob: { id: "00000000-0000-4000-8000-0000000000b1", name: "bob", role: "operator" },
};
const app = (user?: keyof typeof identities) => createApp({ users: UsersRepository, items: ItemsRepository, notes: NotesRepository }, (async () => (user ? identities[user] : null)) as never);
const request = async (user: keyof typeof identities | undefined, path: string, init?: RequestInit) => (await app(user)).handle(new Request("http://localhost" + path, init));
const createView = (user: keyof typeof identities, body: Record<string, unknown>) => request(user, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const removeView = (user: keyof typeof identities | undefined, id: string) => request(user, "/api/v1/saved-views/" + id, { method: "DELETE" });
const listViews = async (user: keyof typeof identities, resource = "items"): Promise<SavedView[]> => {
  const response = await request(user, "/api/v1/saved-views?resource=" + resource);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: SavedView[] }).items;
};

test("persists private and shared views per user with ownership flags", async () => {
  const privateView = await createView("alice", { resource: "items", name: "My open items", filters: [{ field: "title", operator: "contains", value: "a" }], columns: ["title", "amount"] });
  expect(privateView.status).toBe(201);
  const created = (await privateView.json()) as SavedView;
  expect(created).toMatchObject({ name: "My open items", shared: false, ownerId: identities.alice!.id, mine: true, columns: ["title", "amount"] });
  expect(created.filters).toEqual([{ field: "title", operator: "contains", value: "a" }]);

  const sharedView = await createView("alice", { resource: "items", name: "Team view", shared: true, columns: ["title"] });
  expect(sharedView.status).toBe(201);

  // The owner sees both; another user only sees the shared one, flagged as not mine.
  expect((await listViews("alice")).map((view) => view.name).sort()).toEqual(["My open items", "Team view"]);
  const bobViews = await listViews("bob");
  expect(bobViews.map((view) => view.name)).toEqual(["Team view"]);
  expect(bobViews[0]).toMatchObject({ ownerId: identities.alice!.id, mine: false });
  // Views are scoped to their resource.
  expect(await listViews("alice", "notes")).toEqual([]);
  // Durable rows, not request memory.
  expect((await db.select().from(qiySavedViews)).map((row) => row.name).sort()).toEqual(["My open items", "Team view"]);
});

test("republishing a name upserts one row and refreshes the payload", async () => {
  const first = await createView("alice", { resource: "items", name: "aaa", shared: true, search: "one", columns: ["title"] });
  expect(first.status).toBe(201);
  const created = (await first.json()) as SavedView;
  expect(created).toMatchObject({ name: "aaa", shared: true, mine: true, search: "one" });

  const second = await createView("alice", { resource: "items", name: "aaa", shared: true, search: "two", columns: ["title", "amount"] });
  expect(second.status).toBe(201);
  const updated = (await second.json()) as SavedView;
  expect(updated.id).toBe(created.id);
  expect(updated).toMatchObject({ search: "two", columns: ["title", "amount"] });
  // The shared view still appears exactly once in every dropdown, newest first.
  const names = (await listViews("alice")).map((view) => view.name);
  expect(names.filter((name) => name === "aaa")).toHaveLength(1);
  expect(names[0]).toBe("aaa");
  expect((await listViews("bob")).filter((view) => view.name === "aaa")).toHaveLength(1);
  expect((await db.select().from(qiySavedViews)).filter((row) => row.name === "aaa")).toHaveLength(1);
});

test("owners and admins can delete while other users are forbidden", async () => {
  const adminView = (await (await createView("alice", { resource: "items", name: "Alice only" })).json()) as SavedView;
  const bobShared = (await (await createView("bob", { resource: "items", name: "Bob shared", shared: true })).json()) as SavedView;

  // A non-owner cannot delete another user's view, even a shared one.
  expect((await removeView("bob", adminView.id)).status).toBe(403);
  // An admin can clean up another user's shared view.
  expect((await removeView("alice", bobShared.id)).status).toBe(204);
  expect((await listViews("bob")).some((view) => view.id === bobShared.id)).toBe(false);
  // Owners delete their own views; a second delete is 404.
  const bobOwn = (await (await createView("bob", { resource: "items", name: "Bob own" })).json()) as SavedView;
  expect((await removeView("bob", bobOwn.id)).status).toBe(204);
  expect((await removeView("bob", bobOwn.id)).status).toBe(404);
  // Missing ids are 404, anonymous deletes are 401, and the admin row survived.
  expect((await removeView("alice", "missing")).status).toBe(404);
  expect((await removeView(undefined, adminView.id)).status).toBe(401);
  expect((await listViews("alice")).some((view) => view.id === adminView.id)).toBe(true);
});

test("validates resources, names and authenticated callers", async () => {
  // Unauthenticated reads and writes are refused, not silently empty.
  expect((await request(undefined, "/api/v1/saved-views?resource=items")).status).toBe(401);
  const unknown = await createView("alice", { resource: "missing", name: "x" });
  expect(unknown.status).toBe(400);
  expect(((await unknown.json()) as { errorKey?: string }).errorKey).toBe("views.unknownResource");
  // A view name is required after trimming.
  expect((await createView("alice", { resource: "items", name: "   " })).status).toBe(400);
  const anonymous = await request(undefined, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "items", name: "x" }) });
  expect(anonymous.status).toBe(401);
});

test("caps distinct view names per user but keeps upserting existing names", async () => {
  for (let index = 0; index < 100; index++) {
    expect((await createView("bob", { resource: "items", name: "bulk-" + index })).status).toBe(201);
  }
  // Republishing an existing name is an update, so the cap does not reject it.
  expect((await createView("bob", { resource: "items", name: "bulk-0", search: "updated" })).status).toBe(201);
  expect((await listViews("bob")).filter((view) => view.ownerId === identities.bob!.id && view.name.startsWith("bulk-"))).toHaveLength(100);
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
  // setup.ts forces DATABASE_URL to :memory: unless QIY_TEST_DATABASE_URL points at
  // the migrated acceptance database, so pass both for the DB-backed route tests.
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "views.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl, QIY_TEST_DATABASE_URL: databaseUrl }));
  console.log(`saved views acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
