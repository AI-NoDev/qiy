import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for dashboard aggregate metrics. Aggregation is a read path that
 * can leak a masked or out-of-scope value, so this checks the numbers against a
 * known dataset, the row policy, the mask guard, the REST/GraphQL parity and the
 * generated dashboard contract.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-dashboard-metrics-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "metrics.sqlite");

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
application dashboard-metrics {
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
  entity orders {
    field id UUID @id;
    field title Text;
    field region Text;
    field amount Integer;
    field price Decimal(10, 2) @nullable;
  }
  restrict orders {
    allow roles admin, operator;
    when region claim region;
    mask price roles operator mode omit;
  }
  dashboard {
    metric orderTotal orders @label("Order total") @type(aggregate) @field(amount) @agg(sum);
    metric orderAverage orders @label("Average amount") @type(aggregate) @field(amount) @agg(avg);
    metric orderLargest orders @label("Largest amount") @type(aggregate) @field(amount) @agg(max);
    metric orderCount orders @label("Orders");
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "metrics.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { dashboardMetrics } from "../web/app/dashboard";

const as = (role: "admin" | "operator" | "viewer", region: string) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: { region } });
const app = (role: "admin" | "operator" | "viewer", region = "eu") => createApp({ users: UsersRepository, orders: OrdersRepository }, as(role, region));
const aggregate = async (role: "admin" | "operator" | "viewer", field: string, op: string, region = "eu") => (await app(role, region)).handle(new Request("http://localhost/api/v1/orders/aggregate?field=" + field + "&op=" + op));

test("aggregates the numbers the caller may see", async () => {
  // Seed through the repository with a principal whose own claim matches each row.
  for (const [title, region, amount] of [["a", "eu", 10], ["b", "eu", 30], ["c", "us", 100]] as const) {
    const writer = await app("admin", region);
    const created = await writer.handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, region, amount, price: "1.50" }) }));
    expect(created.status).toBe(201);
  }
  expect(await (await aggregate("admin", "amount", "sum")).json()).toEqual({ value: 40, operator: "sum" });
  expect(await (await aggregate("admin", "amount", "avg")).json()).toEqual({ value: 20, operator: "avg" });
  expect(await (await aggregate("admin", "amount", "min")).json()).toEqual({ value: 10, operator: "min" });
  expect(await (await aggregate("admin", "amount", "max")).json()).toEqual({ value: 30, operator: "max" });
  // The us row is invisible from an eu claim.
  expect(await (await aggregate("admin", "amount", "sum", "us")).json()).toEqual({ value: 100, operator: "sum" });

  // GraphQL returns the same scalar through the generated query.
  const graphql = await (await app("admin")).handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ ordersAggregate(field: \\"amount\\", op: \\"sum\\") }" }) }));
  expect(await graphql.json()).toEqual({ data: { ordersAggregate: 40 } });
});

test("refuses masked fields and invalid operators", async () => {
  const masked = await aggregate("operator", "price", "sum");
  expect(masked.status).toBe(403);
  expect((await masked.json() as { errorKey?: string }).errorKey).toBe("policy.maskedField");
  expect((await aggregate("admin", "price", "sum")).status).toBe(200);
  expect((await aggregate("admin", "title", "sum")).status).toBe(400);
  expect((await aggregate("admin", "amount", "median")).status).toBe(400);
  expect((await aggregate("admin", "missing", "sum")).status).toBe(400);
  const anonymous = await (await createApp({ users: UsersRepository, orders: OrdersRepository })).handle(new Request("http://localhost/api/v1/orders/aggregate?field=amount&op=sum"));
  expect(anonymous.status).toBe(401);
});

test("generates the dashboard metric contract", async () => {
  expect(dashboardMetrics.map((metric) => [metric.name, metric.type ?? "count", metric.field, metric.agg])).toEqual([
    ["orderTotal", "aggregate", "amount", "sum"],
    ["orderAverage", "aggregate", "amount", "avg"],
    ["orderLargest", "aggregate", "amount", "max"],
    ["orderCount", "count", undefined, undefined],
  ]);
  const rows = await db.select().from(orders);
  expect(rows.map((row) => row.title).sort()).toEqual(["a", "b", "c"]);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "metrics.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`dashboard metrics acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
