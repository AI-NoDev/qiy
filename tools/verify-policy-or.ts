import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for composable policy groups: `when ( a claim x or b in ... )`
 * is OR-ed internally and AND-ed with the other row predicates, and a claim that
 * is missing inside a group drops only that branch.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-policy-or-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "policy-or.sqlite");

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
application policy-or {
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
  }
  entity notes {
    field id UUID @id;
    field title Text;
    field ownerId Text;
    field backupOwner Text;
  }
  restrict orders {
    allow roles admin, operator;
    when tenantId claim tenant;
    when ( ownerId claim user.id or amount in "0" );
  }
  restrict notes {
    allow roles admin;
    when ( ownerId claim user.id or backupOwner claim backupOwner );
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "policy-or.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { notes, orders } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { NotesRepository } from "./src/modules/notes/notes.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const as = (claims: Record<string, string>, role: "admin" | "operator" = "operator") => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims });
const app = (claims: Record<string, string>, role: "admin" | "operator" = "operator") => createApp({ users: UsersRepository, orders: OrdersRepository, notes: NotesRepository }, as(claims, role) as never);
const titles = async (claims: Record<string, string>, role: "admin" | "operator" = "operator") => {
  const response = await (await app(claims, role)).handle(new Request("http://localhost/api/v1/orders?pageSize=100"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: Array<{ title: string }> }).data.map((row) => row.title).sort();
};

test("OR group is AND-ed with the other predicates", async () => {
  await db.insert(orders).values([
    { id: crypto.randomUUID(), title: "eu-mine", tenantId: "eu", ownerId: "u1", amount: 5 },
    { id: crypto.randomUUID(), title: "eu-free", tenantId: "eu", ownerId: "u2", amount: 0 },
    { id: crypto.randomUUID(), title: "eu-other", tenantId: "eu", ownerId: "u2", amount: 5 },
    { id: crypto.randomUUID(), title: "us-mine", tenantId: "us", ownerId: "u1", amount: 5 },
  ]);
  // tenant AND (owner or amount = 0)
  expect(await titles({ tenant: "eu", "user.id": "u1" })).toEqual(["eu-free", "eu-mine"]);
  // A different owner still sees the amount branch inside the same tenant.
  expect(await titles({ tenant: "eu", "user.id": "u3" })).toEqual(["eu-free"]);
  expect(await titles({ tenant: "us", "user.id": "u1" })).toEqual(["us-mine"]);
  // Missing claim inside the group drops only its branch; the tenant predicate still applies.
  expect(await titles({ tenant: "eu" })).toEqual(["eu-free"]);
  // Missing tenant claim is a deny predicate, so the whole request fails closed.
  const denied = await (await app({ "user.id": "u1" })).handle(new Request("http://localhost/api/v1/orders"));
  expect(denied.status).toBe(403);
  expect((await denied.json() as { errorKey?: string }).errorKey).toBe("policy.missingClaim");
});

test("a group with no available branch fails closed", async () => {
  await db.insert(notes).values([{ id: crypto.randomUUID(), title: "note", ownerId: "u1", backupOwner: "u2" }]);
  const seen = async (claims: Record<string, string>) => (await (await app(claims, "admin")).handle(new Request("http://localhost/api/v1/notes")))
    .json() as Promise<{ data: Array<{ title: string }> }>;
  expect((await seen({ "user.id": "u1" })).data.map((row) => row.title)).toEqual(["note"]);
  expect((await seen({ backupOwner: "u2" })).data.map((row) => row.title)).toEqual(["note"]);
  // Neither branch claim is present, so the group cannot be satisfied.
  const missing = await (await app({}, "admin")).handle(new Request("http://localhost/api/v1/notes"));
  expect(missing.status).toBe(403);
  expect((await missing.json() as { errorKey?: string }).errorKey).toBe("policy.missingClaim");
});

test("REST and GraphQL share the composed predicate", async () => {
  const graphql = await (await app({ tenant: "eu", "user.id": "u1" })).handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ orders(pageSize: 100) { items { title } total } }" }) }));
  const body = (await graphql.json()) as { data: { orders: { items: Array<{ title: string }>; total: number } } };
  expect(body.data.orders.total).toBe(2);
  expect(body.data.orders.items.map((row) => row.title).sort()).toEqual(["eu-free", "eu-mine"]);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "policy-or.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "run", "typecheck"], join(admin, "apps/web"), { DATABASE_URL: ":memory:" }));
  console.log(`composable policy acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
