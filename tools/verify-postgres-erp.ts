import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

const container = process.argv[2] ?? "qiy-erp-pg";
const inspected = JSON.parse(await new Response(Bun.spawn(["docker", "inspect", container], { stdout: "pipe" }).stdout).text())[0];
const env = Object.fromEntries((inspected.Config.Env as string[]).map((item) => { const index = item.indexOf("="); return [item.slice(0, index), item.slice(index + 1)]; }));
const username = env.POSTGRES_USER ?? "postgres";
const password = env.POSTGRES_PASSWORD;
const port = inspected.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort;
if (!password || !port) throw new Error("PostgreSQL container must expose port 5432 and a password");
const databaseName = `qiy_erp_${crypto.randomUUID().replaceAll("-", "")}`;
const databaseUrl = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
const root = mkdtempSync(join(tmpdir(), "qiy-postgres-erp-"));
async function run(command: string[], cwd = root): Promise<string> {
  const child = Bun.spawn(command, { cwd, env: { ...Bun.env, DATABASE_URL: databaseUrl }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return stdout + stderr;
}
async function admin(statement: string) {
  const child = Bun.spawn(["docker", "exec", container, "psql", "-U", username, "-d", "postgres", "-c", statement], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
}
await admin(`CREATE DATABASE ${databaseName}`);
try {
  const output = join(root, "admin");
  await generateApp("examples/erpadmin/app.qiy", output);
  await run([process.execPath, "install"], output);
  const server = join(output, "apps/server");
  await run([process.execPath, "run", "--bun", "drizzle-kit", "generate"], server);
  await run([process.execPath, "run", "--bun", "drizzle-kit", "migrate"], server);
  writeFileSync(join(server, "tests/postgres-workflow.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { client, db } from "../src/db";
import { auditEvents, customers, inventoryItems, orderIdempotency, orderReservations, orderItems, orders, products, users, warehouses } from "../src/schema";
import { eq } from "drizzle-orm";
import { createOrderWorkflowRoutes } from "../src/workflows/order";

const ids = { customer: "00000000-0000-4000-8000-000000000001", user: "00000000-0000-4000-8000-000000000002", warehouse: "00000000-0000-4000-8000-000000000003", product: "00000000-0000-4000-8000-000000000004", inventory: "00000000-0000-4000-8000-000000000005", order: "00000000-0000-4000-8000-000000000006", item: "00000000-0000-4000-8000-000000000007" };
const app = createOrderWorkflowRoutes(async (request) => ({ id: ids.user, name: "ERP operator", role: request.headers.get("x-role") === "admin" ? "admin" : "operator", claims: { "tenant.customerId": request.headers.get("x-tenant") === "missing" ? null : request.headers.get("x-tenant") ?? ids.customer } }));
async function reset() {
  await db.delete(orderIdempotency); await db.delete(orderReservations); await db.delete(auditEvents); await db.delete(orderItems); await db.delete(orders); await db.delete(inventoryItems); await db.delete(products); await db.delete(warehouses); await db.delete(users); await db.delete(customers);
  await db.insert(customers).values({ id: ids.customer, name: "Acceptance customer", email: "erp@example.com", creditLimit: "1000.00" });
  await db.insert(users).values({ id: ids.user, email: "operator@example.com", displayName: "ERP operator", passwordHash: null, externalSubject: null, role: "admin" });
  await db.insert(warehouses).values({ id: ids.warehouse, code: "WH-1", name: "Main", capacity: 100 });
  await db.insert(products).values({ id: ids.product, sku: "SKU-1", name: "Widget", unitPrice: "10.00", reorderPoint: 1 });
  await db.insert(inventoryItems).values({ id: ids.inventory, warehouseId: ids.warehouse, productId: ids.product, quantity: 10, reservedQuantity: 0 });
  await db.insert(orders).values({ id: ids.order, orderNumber: "ERP-1", customerId: ids.customer, status: "draft", totalAmount: "10.00" });
  await db.insert(orderItems).values({ id: ids.item, orderId: ids.order, productId: ids.product, quantity: 3, unitPrice: "10.00" });
}
function request(path: string, role = "operator", key?: string) { return app.handle(new Request("http://localhost/api/v1/orders/" + ids.order + path, { method: "POST", headers: { "x-role": role, ...(key ? { "Idempotency-Key": key } : {}) } })); }
test("real PostgreSQL workflow submits concurrently once, approves and ships", async () => {
  await reset();
  const submitted = await Promise.all(Array.from({ length: 8 }, () => request("/submit", "operator", "submit-1")));
  expect(submitted.every((response) => response.status === 200)).toBe(true);
  expect((await db.select().from(orders))[0]).toMatchObject({ status: "submitted" });
  expect((await db.select().from(inventoryItems))[0]).toMatchObject({ quantity: 10, reservedQuantity: 3 });
  expect((await db.select().from((await import("../src/schema")).orderReservations))).toHaveLength(1);
  expect((await request("/approve", "operator")).status).toBe(403);
  expect((await request("/approve", "admin")).status).toBe(200);
  expect((await request("/ship", "operator")).status).toBe(200);
  expect((await db.select().from(orders))[0]).toMatchObject({ status: "shipped" });
  expect((await db.select().from(inventoryItems))[0]).toMatchObject({ quantity: 7, reservedQuantity: 0 });
  expect((await db.select().from(auditEvents)).map((event) => event.action).sort()).toEqual(["order.approved", "order.shipped", "order.submitted"]);
});
test("state failures do not alter the real database", async () => {
  await reset();
  const before = await db.select().from(orders);
  expect((await app.handle(new Request("http://localhost/api/v1/orders/" + ids.order + "/submit", { method: "POST", headers: { "x-role": "operator" } }))).status).toBe(200);
  expect((await request("/submit", "operator", "changed")).status).toBe(409);
  expect((await db.select().from(orders))[0]?.status).toBe("submitted");
  expect((await request("/ship", "operator")).status).toBe(409);
  expect((await db.select().from(inventoryItems))[0]).toMatchObject({ quantity: 10, reservedQuantity: 3 });
  expect(before[0]?.status).toBe("draft");
});
async function snapshot() {
  return { orders: await db.select().from(orders), stocks: await db.select().from(inventoryItems), reservations: await db.select().from(orderReservations), receipts: await db.select().from(orderIdempotency), audit: await db.select().from(auditEvents) };
}
test("all workflow endpoints reject foreign and missing tenant claims without writes", async () => {
  await reset();
  const before = await snapshot();
  for (const tenant of ["missing", "00000000-0000-4000-8000-000000000099"]) {
    for (const action of ["submit", "approve", "ship", "cancel"]) {
      const response = await app.handle(new Request("http://localhost/api/v1/orders/" + ids.order + "/" + action, { method: "POST", headers: { "x-role": "admin", "x-tenant": tenant, "Idempotency-Key": "foreign-request" } }));
      expect(response.status).toBe(tenant === "missing" ? 403 : 409);
      expect(await snapshot()).toEqual(before);
    }
  }
});
test("later insufficient stock rolls back earlier reservations and idempotency writes", async () => {
  await reset();
  const secondProduct = "00000000-0000-4000-8000-000000000008";
  await db.insert(products).values({ id: secondProduct, sku: "SKU-2", name: "Unavailable", unitPrice: "10.00", reorderPoint: 1 });
  await db.insert(orderItems).values({ id: "00000000-0000-4000-8000-000000000009", orderId: ids.order, productId: secondProduct, quantity: 1, unitPrice: "10.00" });
  const before = await snapshot();
  expect((await request("/submit", "operator", "rollback-key")).status).toBe(409);
  expect(await snapshot()).toEqual(before);
  await db.insert(inventoryItems).values({ id: "00000000-0000-4000-8000-000000000011", warehouseId: ids.warehouse, productId: secondProduct, quantity: 2, reservedQuantity: 0 });
  expect((await request("/submit", "operator", "rollback-key")).status).toBe(200);
  expect(await db.select().from(orderIdempotency)).toHaveLength(1);
  expect(await db.select().from(orderReservations)).toHaveLength(2);
});
test("cancel releases reservations from their original stock rows exactly once", async () => {
  await reset();
  expect((await request("/submit", "operator", "cancel-submit")).status).toBe(200);
  expect((await request("/cancel")).status).toBe(200);
  expect((await db.select().from(inventoryItems))[0]).toMatchObject({ quantity: 10, reservedQuantity: 0 });
  expect(await db.select().from(orderReservations)).toHaveLength(0);
  const cancelled = await snapshot();
  expect((await request("/cancel")).status).toBe(409);
  expect(await snapshot()).toEqual(cancelled);
});
test("shipping a corrupted reservation rolls back stock changes and preserves approval", async () => {
  await reset();
  expect((await request("/submit", "operator", "ship-submit")).status).toBe(200);
  expect((await request("/approve", "admin")).status).toBe(200);
  await db.update(inventoryItems).set({ reservedQuantity: 0 }).where(eq(inventoryItems.id, ids.inventory));
  const before = await snapshot();
  expect((await request("/ship")).status).toBe(409);
  expect(await snapshot()).toEqual(before);
});
`);
  console.log(await run([process.execPath, "test", "./tests/postgres-workflow.acceptance.test.ts"], server));
  await run([process.execPath, "run", "typecheck"], server);
  console.log(`PostgreSQL ERP workflow acceptance passed in ${root}`);
} finally {
  await admin(`DROP DATABASE IF EXISTS ${databaseName}`);
}
