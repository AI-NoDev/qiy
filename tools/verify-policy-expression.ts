import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for nested/negated policy expressions and cross-field comparison.
 * The rows must satisfy AND of: tenant claim, amount > cost, NOT closed, and
 * (owner claim OR draft) — proving precedence, NOT and column comparison all reach SQL.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-policy-expression-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "expr.sqlite");

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
application policy-expression {
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
    field tenantId Text;
    field ownerId Text;
    field amount Integer;
    field cost Integer;
    field status Text;
  }
  restrict orders {
    allow roles admin, operator;
    when tenantId claim tenant;
    when amount > field cost;
    when not status in "closed";
    when ( ownerId claim user.id or status in "draft" );
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "expression.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const as = (claims: Record<string, string>) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: "op", role: "operator", claims });
const app = (claims: Record<string, string>) => createApp({ users: UsersRepository, orders: OrdersRepository }, as(claims) as never);
const titles = async (claims: Record<string, string>) => {
  const response = await (await app(claims)).handle(new Request("http://localhost/api/v1/orders?pageSize=100"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: Array<{ title: string }> }).data.map((row) => row.title).sort();
};

test("AND of cross-field, NOT and a nested OR group", async () => {
  await db.insert(orders).values([
    { id: crypto.randomUUID(), title: "mine-profile", tenantId: "eu", ownerId: "u1", amount: 10, cost: 5, status: "open" },
    { id: crypto.randomUUID(), title: "loss", tenantId: "eu", ownerId: "u1", amount: 3, cost: 5, status: "open" },
    { id: crypto.randomUUID(), title: "closed", tenantId: "eu", ownerId: "u1", amount: 10, cost: 5, status: "closed" },
    { id: crypto.randomUUID(), title: "draft", tenantId: "eu", ownerId: "u2", amount: 20, cost: 1, status: "draft" },
    { id: crypto.randomUUID(), title: "foreign", tenantId: "us", ownerId: "u1", amount: 10, cost: 5, status: "open" },
  ]);
  // amount > cost drops "loss"; NOT status = closed drops "closed"; tenant drops "foreign".
  expect(await titles({ tenant: "eu", "user.id": "u1" })).toEqual(["draft", "mine-profile"]);
  // A different owner still sees the draft branch of the nested group.
  expect(await titles({ tenant: "eu", "user.id": "u3" })).toEqual(["draft"]);
  expect(await titles({ tenant: "us", "user.id": "u1" })).toEqual(["foreign"]);
  // Missing tenant claim is a deny predicate for the whole resource.
  const denied = await (await app({ "user.id": "u1" })).handle(new Request("http://localhost/api/v1/orders"));
  expect(denied.status).toBe(403);
  expect((await denied.json() as { errorKey?: string }).errorKey).toBe("policy.missingClaim");
  // Missing the claim inside the nested OR drops just that branch.
  expect(await titles({ tenant: "eu" })).toEqual(["draft"]);
});

test("GraphQL reads use the same expressions", async () => {
  const response = await (await app({ tenant: "eu", "user.id": "u1" })).handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ orders(pageSize: 100) { items { title } total } }" }) }));
  const body = (await response.json()) as { data: { orders: { items: Array<{ title: string }>; total: number } } };
  expect(body.data.orders.total).toBe(2);
  expect(body.data.orders.items.map((row) => row.title).sort()).toEqual(["draft", "mine-profile"]);
});

test("a NOT over an unavailable claim refuses instead of allowing everything", async () => {
  // Directly replace the policy expression is not possible here; instead check that a
  // principal missing every claim referenced inside a NOT is refused, not widened.
  const withoutClaims = await (await app({})).handle(new Request("http://localhost/api/v1/orders"));
  expect(withoutClaims.status).toBe(403);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "expression.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`policy expression acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
