import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for page-level rules. `pages <resource> { <action> roles ...; }`
 * must gate the REST page, the matching GraphQL root field and the generated
 * access-control decision, while leaving other pages of the same resource usable.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-page-rules-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "pages.sqlite");

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
application page-rules {
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
  entity orders {
    field id UUID @id;
    field title Text;
    field internalNote Text @nullable;
  }
  pages orders {
    list roles admin, operator;
    show roles admin, operator, viewer;
    create roles admin;
    edit roles admin;
    delete roles admin;
    field internalNote roles admin;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "pages.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const as = (role: "admin" | "operator" | "viewer") => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: {} });
const app = (role: "admin" | "operator" | "viewer") => createApp({ users: UsersRepository, orders: OrdersRepository }, as(role) as never);
const request = async (role: "admin" | "operator" | "viewer", path: string, init?: RequestInit) => (await app(role)).handle(new Request("http://localhost" + path, init));
const graphql = async (role: "admin" | "operator" | "viewer", query: string) => (await app(role)).handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }));

let firstId = "";

test("page rules gate list, create, edit and delete independently", async () => {
  const created = await request("admin", "/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "first" }) });
  expect(created.status).toBe(201);
  firstId = ((await created.json()) as { id: string }).id;

  // viewer: only the detail page is allowed.
  expect((await request("viewer", "/api/v1/orders")).status).toBe(403);
  expect((await request("viewer", "/api/v1/orders/" + firstId)).status).toBe(200);
  expect((await request("viewer", "/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "nope" }) })).status).toBe(403);
  expect((await request("viewer", "/api/v1/orders/" + firstId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "nope" }) })).status).toBe(403);
  expect((await request("viewer", "/api/v1/orders/" + firstId, { method: "DELETE" })).status).toBe(403);

  // operator: list and detail are allowed, mutations are not.
  expect((await request("operator", "/api/v1/orders")).status).toBe(200);
  expect((await request("operator", "/api/v1/orders/" + firstId)).status).toBe(200);
  expect((await request("operator", "/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "nope" }) })).status).toBe(403);
  expect((await request("operator", "/api/v1/orders/" + firstId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "nope" }) })).status).toBe(403);
  // Import writes rows, so it follows the create page rule.
  expect((await request("operator", "/api/v1/orders/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: "title\\nimported\\n" })).status).toBe(403);
  // Export reads rows, so it follows the list page rule.
  expect((await request("operator", "/api/v1/orders/export")).status).toBe(200);

  // admin keeps every page.
  expect((await request("admin", "/api/v1/orders/" + firstId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "renamed" }) })).status).toBe(200);
  expect((await request("admin", "/api/v1/orders/" + firstId, { method: "DELETE" })).status).toBe(200);
});

test("GraphQL root fields follow the same page rules", async () => {
  const rows = await db.insert(orders).values({ id: crypto.randomUUID(), title: "graphql" }).returning().get();
  const deniedList = await graphql("viewer", "{ orders { items { title } total } }");
  expect(deniedList.status).toBe(403);
  expect(await deniedList.text()).toContain("Page access denied");
  // The detail page is allowed for a viewer.
  const detail = await graphql("viewer", "{ ordersById(id: \\"" + rows.id + "\\") { title } }");
  expect(detail.status).toBe(200);
  expect((await detail.json() as { data: { ordersById: { title: string } } }).data.ordersById.title).toBe("graphql");
  // operator may list, but creating is an admin page.
  expect((await graphql("operator", "{ orders { total } }")).status).toBe(200);
  const deniedCreate = await graphql("operator", "mutation { createOrders(input: { title: \\"nope\\" }) { id } }");
  expect(deniedCreate.status).toBe(403);
  expect((await graphql("admin", "mutation { createOrders(input: { title: \\"ok\\" }) { title } }")).status).toBe(200);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "pages.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`page rules acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
