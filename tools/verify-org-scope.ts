import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for hierarchical data scope. `scope orders orgId claim org tree
 * organizations parentId` must widen the claim to the whole subtree, and the same
 * predicate must govern list, detail, aggregate and GraphQL reads.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-org-scope-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "org-scope.sqlite");

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
application org-scope {
  database sqlite {}
  api { client graphql; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity organizations {
    field id UUID @id;
    field name Text;
    field parentId UUID @nullable;
  }
  entity orders {
    field id UUID @id;
    field title Text;
    field orgId UUID;
    field amount Integer;
  }
  scope orders orgId claim org tree organizations parentId;
  dashboard {
    metric orderAmount orders @label("Amount") @type(aggregate) @field(amount) @agg(sum);
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "scope.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders, organizations } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const orgIds = { root: "00000000-0000-4000-8000-0000000000a0", a: "00000000-0000-4000-8000-0000000000a1", a1: "00000000-0000-4000-8000-0000000000a2", b: "00000000-0000-4000-8000-0000000000a3" };
const as = (org?: string) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: "admin", role: "admin", ...(org ? { claims: { org } } : {}) });
const app = (org?: string) => createApp({ users: UsersRepository, orders: OrdersRepository }, as(org) as never);

test("widens the claim to the whole subtree", async () => {
  await db.insert(organizations).values([
    { id: orgIds.root, name: "root", parentId: null },
    { id: orgIds.a, name: "a", parentId: orgIds.root },
    { id: orgIds.a1, name: "a1", parentId: orgIds.a },
    { id: orgIds.b, name: "b", parentId: orgIds.root },
  ]);
  await db.insert(orders).values([
    { id: crypto.randomUUID(), title: "root-order", orgId: orgIds.root, amount: 1 },
    { id: crypto.randomUUID(), title: "a-order", orgId: orgIds.a, amount: 10 },
    { id: crypto.randomUUID(), title: "a1-order", orgId: orgIds.a1, amount: 100 },
    { id: crypto.randomUUID(), title: "b-order", orgId: orgIds.b, amount: 1000 },
  ]);

  const list = async (org: string) => (await (await app(org)).handle(new Request("http://localhost/api/v1/orders?pageSize=100"))).json() as Promise<{ data: Array<{ title: string }>; total: number }>;
  expect((await list(orgIds.root)).data.map((row) => row.title).sort()).toEqual(["a-order", "a1-order", "b-order", "root-order"]);
  // A mid-level claim sees itself plus its descendants, never its parent or siblings.
  expect((await list(orgIds.a)).data.map((row) => row.title).sort()).toEqual(["a-order", "a1-order"]);
  expect((await list(orgIds.a1)).data.map((row) => row.title)).toEqual(["a1-order"]);
  expect((await list(orgIds.b)).data.map((row) => row.title)).toEqual(["b-order"]);
  // An unknown claim matches no node, so the subtree is empty instead of falling back to everything.
  expect((await list("00000000-0000-4000-8000-0000000000ff")).data).toEqual([]);

  // The same predicate governs detail, aggregate and GraphQL reads.
  const aOrder = (await (await app(orgIds.a)).handle(new Request("http://localhost/api/v1/orders?pageSize=1"))).json() as Promise<{ data: Array<{ id: string }> }>;
  const firstId = (await aOrder).data[0]!.id;
  const bOrder = (await db.select().from(orders)).find((row) => row.title === "b-order")!;
  expect((await (await app(orgIds.a)).handle(new Request("http://localhost/api/v1/orders/" + firstId))).status).toBe(200);
  expect((await (await app(orgIds.a)).handle(new Request("http://localhost/api/v1/orders/" + bOrder.id))).status).toBe(404);
  const aggregate = async (org: string) => (await (await app(org)).handle(new Request("http://localhost/api/v1/orders/aggregate?field=amount&op=sum"))).json() as Promise<{ value: number }>;
  expect((await aggregate(orgIds.a)).value).toBe(110);
  expect((await aggregate(orgIds.a1)).value).toBe(100);
  expect((await aggregate(orgIds.root)).value).toBe(1111);

  const graphql = await (await app(orgIds.a)).handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ orders(pageSize: 100) { items { title } total } ordersAggregate(field: \\"amount\\", op: \\"sum\\") }" }) }));
  const body = (await graphql.json()) as { data: { orders: { items: Array<{ title: string }>; total: number }; ordersAggregate: number } };
  expect(body.data.orders.total).toBe(2);
  expect(body.data.orders.items.map((row) => row.title).sort()).toEqual(["a-order", "a1-order"]);
  expect(body.data.ordersAggregate).toBe(110);
});

test("requires the claim and fails closed on writes", async () => {
  // The scope claim is mandatory: a principal without it cannot read the resource at all.
  const anonymous = await (await app()).handle(new Request("http://localhost/api/v1/orders"));
  expect(anonymous.status).toBe(403);
  expect(await anonymous.text()).toContain("Missing required data scope claim");
  expect((await (await app(undefined)).handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ orders { total } }" }) }))).status).toBe(403);

  // Writes land on the caller's own node, so a child-org row cannot be smuggled in.
  const created = await (await app(orgIds.a)).handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "written", orgId: orgIds.b, amount: 5 }) }));
  expect(created.status).toBe(201);
  expect(((await created.json()) as { orgId: string }).orgId).toBe(orgIds.a);
  const visibleToA = (await (await app(orgIds.a)).handle(new Request("http://localhost/api/v1/orders?pageSize=100")).then((response) => response.json()) as { data: Array<{ title: string }> }).data.map((row) => row.title);
  expect(visibleToA).toContain("written");
  const visibleToB = (await (await app(orgIds.b)).handle(new Request("http://localhost/api/v1/orders?pageSize=100")).then((response) => response.json()) as { data: Array<{ title: string }> }).data.map((row) => row.title);
  expect(visibleToB).not.toContain("written");
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "scope.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  // The tree management page is generated from the scope ... tree declaration.
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`org scope acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
