import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for plan #3: a restrict expression can mention `scope`, so the
 * row policy becomes "inside my subtree OR other conditions" instead of the
 * implicit scope filter AND-ed on top. Reads must honour the union; writes stay
 * inside the caller's own node.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-scope-policy-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const dialect = Bun.env.QIY_ACCEPTANCE_DIALECT ?? "sqlite";
const databaseUrl = Bun.env.QIY_ACCEPTANCE_DATABASE_URL ?? join(root, "scope-policy.sqlite");

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
application scope-policy {
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
  entity regions {
    field id UUID @id;
    field name Text;
    field parentId UUID @nullable;
  }
  entity orders {
    field id UUID @id;
    field title Text;
    field region UUID @nullable;
    field owner Text;
    field amount Integer;
  }
  scope orders region claim region tree regions parentId;
  restrict orders {
    allow roles admin, operator;
    when ( scope or owner claim sub );
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "scope-policy.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders, regions } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { RegionsRepository } from "./src/modules/regions/regions.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

type Claims = Record<string, string>;
const principal = (sub: string, claims: Claims) => async () => ({ id: "00000000-0000-4000-8000-0000000000ff", name: sub, role: "operator" as const, claims });
const app = (sub: string, claims: Claims) => createApp({ users: UsersRepository, orders: OrdersRepository, regions: RegionsRepository }, principal(sub, claims) as never);
const request = async (sub: string, claims: Claims, path: string, init?: RequestInit) => (await app(sub, claims)).handle(new Request("http://localhost" + path, init));

const ids = { eu: crypto.randomUUID(), west: crypto.randomUUID(), us: crypto.randomUUID(), east: crypto.randomUUID() };

test("scope atom unions the subtree with other policy branches", async () => {
  // The repository always assigns its own ids, so create the tree first and read it back.
  const seedAdmin = await app("seed", { region: ids.eu, sub: "seed" });
  for (const [name, parentName] of [["eu", null], ["eu-west", "eu"], ["us", null], ["us-east", "us"]] as const) {
    const parent = parentName ? (await db.select().from(regions)).find((row) => row.name === parentName)! : undefined;
    const created = await seedAdmin.handle(new Request("http://localhost/api/v1/regions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId: parent?.id ?? null }) }));
    if (created.status !== 201) throw new Error("seed region " + name + " failed: " + created.status + " " + (await created.text()));
  }
  const regionRows = await db.select().from(regions);
  const regionId = (name: string) => regionRows.find((row) => row.name === name)!.id;
  ids.eu = regionId("eu");
  ids.west = regionId("eu-west");
  ids.us = regionId("us");
  ids.east = regionId("us-east");
  const seedRegion = { "subtree-row": ids.west, "own-outside-subtree": ids.east, "foreign-outside-subtree": ids.east, "root-row": ids.eu } as const;
  for (const [title, owner, amount] of [
    ["subtree-row", "someone-else", 10],
    ["own-outside-subtree", "op", 20],
    ["foreign-outside-subtree", "someone-else", 40],
    ["root-row", "someone-else", 5],
  ] as const) {
    const region = seedRegion[title];
    // Each row is created by a principal scoped to its own node so the write policy passes.
    const rowWriter = await app("seed", { region, sub: "seed-" + title });
    const created = await rowWriter.handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, region, owner, amount }) }));
    if (created.status !== 201) throw new Error("seed row " + title + " failed: " + created.status + " " + (await created.text()));
  }
  // operator claims region=eu (subtree = eu + eu-west) and owns the us-east row.
  const list = await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders");
  expect(list.status).toBe(200);
  const listed = (await list.json()) as { data: Array<{ title: string }>; total: number };
  expect(listed.total).toBe(3);
  expect(listed.data.map((row) => row.title).sort()).toEqual(["own-outside-subtree", "root-row", "subtree-row"]);
  // The own row outside the subtree is readable through the union.
  const own = await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders");
  const ownRows = (await own.json()) as { data: Array<{ title: string; id: string }> };
  const ownId = ownRows.data.find((row) => row.title === "own-outside-subtree")!.id;
  expect((await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders/" + ownId)).status).toBe(200);
  // Foreign rows outside the subtree stay hidden, including by direct id.
  const hidden = (await db.select().from(orders)).find((row) => row.title === "foreign-outside-subtree")!;
  expect((await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders/" + hidden.id)).status).toBe(404);
  // Aggregates honour the same union: 10 + 20 + 5.
  const aggregate = await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders/aggregate?field=amount&op=sum");
  expect(aggregate.status).toBe(200);
  expect(((await aggregate.json()) as { value: number }).value).toBe(35);
  // A principal without any claim cannot satisfy the expression: fail closed.
  const anonymousClaims = await request("ghost", {}, "/api/v1/orders");
  expect(anonymousClaims.status).toBe(403);
  const denied = (await anonymousClaims.json()) as { errorKey?: string; error?: string };
  // The scope resolver fails closed before the policy runs, so accept either shape.
  expect(String(denied.errorKey ?? "") + " " + String(denied.error ?? "")).toMatch(/missingClaim|Missing required data scope claim/i);
  // The seed principal (region=eu) also sees the subtree.
  const seeded = (await (await request("seed", { region: ids.eu, sub: "seed" }, "/api/v1/orders")).json()) as { total: number };
  expect(seeded.total).toBe(2);
});

test("writes stay inside the caller's own node", async () => {
  // Updating a foreign row outside the subtree is refused by the scope filter.
  const foreign = (await db.select().from(orders)).find((row) => row.title === "foreign-outside-subtree")!;
  const response = await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders/" + foreign.id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "hijacked" }),
  });
  expect(response.status).toBe(404);
  const unchanged = (await db.select().from(orders)).find((row) => row.id === foreign.id)!;
  expect(unchanged.title).toBe("foreign-outside-subtree");
  // Creating a row stamps the caller's own scope node.
  const created = await request("op", { region: ids.eu, sub: "op" }, "/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "created-by-op", owner: "op", amount: 1 }),
  });
  expect(created.status).toBe(201);
  expect(((await created.json()) as { region?: string }).region).toBe(ids.eu);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "scope-policy.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`scope policy acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
