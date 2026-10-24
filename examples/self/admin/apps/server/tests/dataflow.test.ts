import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client, db } from "../src/db";
import { purchase_orders, inventory, stock_movements, sales_orders, shipments, work_orders } from "../src/schema";
import { createDataflowRoutes } from "../src/dataflows";
import { createApp, type Repositories } from "../src/app";
import { createDataflowRoutes as createFailureRoutes } from "./fixtures/dataflow-failure";

beforeAll(() => {
client.exec("CREATE TABLE IF NOT EXISTS purchase_orders (\"id\" text primary key, \"number\" text not null, \"supplierId\" text not null, \"status\" text not null, \"orderedAt\" integer not null, \"expectedDate\" text not null, \"total\" real not null)");
client.exec("CREATE TABLE IF NOT EXISTS inventory (\"id\" text primary key, \"inventoryKey\" text not null, \"warehouseId\" text not null, \"binId\" text not null, \"productId\" text not null, \"quantity\" integer not null, \"reserved\" integer not null, \"lotCode\" text, \"updatedAt\" integer)");
client.exec("CREATE TABLE IF NOT EXISTS stock_movements (\"id\" text primary key, \"productId\" text not null, \"warehouseId\" text not null, \"binId\" text not null, \"type\" text not null, \"quantity\" integer not null, \"reference\" text, \"occurredAt\" integer)");
client.exec("CREATE TABLE IF NOT EXISTS sales_orders (\"id\" text primary key, \"number\" text not null, \"customerId\" text not null, \"status\" text not null, \"orderedAt\" integer not null, \"total\" real not null)");
client.exec("CREATE TABLE IF NOT EXISTS shipments (\"id\" text primary key, \"salesOrderId\" text not null, \"warehouseId\" text not null, \"status\" text not null, \"shippedAt\" integer, \"departureTime\" text)");
client.exec("CREATE TABLE IF NOT EXISTS work_orders (\"id\" text primary key, \"number\" text not null, \"productId\" text not null, \"quantity\" integer not null, \"status\" text not null, \"plannedAt\" integer not null)");
client.exec("CREATE TABLE IF NOT EXISTS audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null)");
client.exec("CREATE TABLE IF NOT EXISTS dataflow_idempotency (id text primary key, actorId text not null, flow text not null, requestKeyHash text not null, requestHash text not null, response text not null, UNIQUE(actorId, flow, requestKeyHash))");
client.exec("CREATE TABLE IF NOT EXISTS dataflow_outbox (id text primary key, actorId text, event text not null, payload text not null, createdAt integer not null)");
client.exec("CREATE TABLE IF NOT EXISTS qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, attempts integer not null, availableAt integer not null, deliveredAt integer, deadLetteredAt integer, lastError text, leaseOwner text, leaseUntil integer, createdAt integer not null)");

});

afterEach(() => {
client.exec("DELETE FROM purchase_orders");
client.exec("DELETE FROM inventory");
client.exec("DELETE FROM stock_movements");
client.exec("DELETE FROM sales_orders");
client.exec("DELETE FROM shipments");
client.exec("DELETE FROM work_orders");
client.exec('DELETE FROM audit_events');
client.exec('DELETE FROM dataflow_idempotency');
client.exec('DELETE FROM dataflow_outbox');
client.exec('DELETE FROM qiy_realtime_outbox');
});

const testRoles: Record<string, "admin" | "operator"> = {"receiveInventory":"admin","putawayStock":"admin","reserveStock":"admin","adjustStock":"admin","shipSalesOrder":"admin","transferInventory":"admin","completeWorkOrder":"admin","approvePurchaseOrder":"admin"};
const app = new Elysia().use(createDataflowRoutes(async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: testRoles[new URL(request.url).pathname.split("/").at(-1)!] ?? "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
const graphqlApp = await createApp({} as Repositories, async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "GraphQL Dataflow Test", role: (request.headers.get("x-test-role") ?? "admin") as "admin" | "operator", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] }), false, false, undefined, true);

describe("generated dataflow routes", () => {
test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(missing.status).toBe(404);
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "quantity": 7 });
    expect(result).toMatchObject({ "binId": "00000000-0000-4000-8000-000000000001" });
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}, "quantity": 2 }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("inventory.received")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("inventory.received");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:inventory.received", type: "inventory.received" });
  });
  test("receiveInventory executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: ReceiveInventoryCommandInput!, $key: String!) { runReceiveInventory(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"},"key":"graphql-receiveInventory-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runReceiveInventory"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"},"key":"graphql-receiveInventory-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"},"key":"graphql-receiveInventory-key"}, input: { ...{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}, "quantity": 2 } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("receiveInventory rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("receiveInventory rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(retry.status).toBe(200);
  });

  test("receiveInventory rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(retry.status).toBe(200);
  });
  test("receiveInventory rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
  test("receiveInventory rejects invalid Integer input quantity without writes", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}, "quantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });

  test("receiveInventory rejects invalid Integer input newOnHand without writes", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}, "newOnHand": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("receiveInventory rejects numeric business rule 1 without writes or receipts", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "approved", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const rejected = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}, "quantity": 0 }) }));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({"error":"数量必须大于 0","errorKey":"errors.inventory.quantityPositive"});
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    const graphFailure = await graphqlApp.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: ReceiveInventoryCommandInput!, $key: String!) { runReceiveInventory(input: $input, idempotencyKey: $key) { id } }", variables: { ...{"input":{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"},"key":"graphql-receiveInventory-key"}, input: { ...{"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}, "quantity": 0 } } }) }));
    const graphFailurePayload = await graphFailure.json() as { errors?: Array<{ extensions?: { status?: number; errorKey?: string } }> };
    expect(graphFailurePayload.errors?.[0]?.extensions).toMatchObject({"status":409,"errorKey":"errors.inventory.quantityPositive"});
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/receiveInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001","inventoryId":"00000000-0000-4000-8000-000000000001","quantity":7,"newOnHand":7,"reference":"Qiy fixture reason"}) }));
    expect(retry.status).toBe(200);
  });

test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "binId": "00000000-0000-4000-8000-000000000001" });
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "quantity": 2 }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("inventory.putaway")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("inventory.moved");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:inventory.moved", type: "inventory.moved" });
  });
  test("putawayStock executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: PutawayStockCommandInput!, $key: String!) { runPutawayStock(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-putawayStock-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runPutawayStock"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-putawayStock-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-putawayStock-key"}, input: { ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "quantity": 2 } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("putawayStock rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("putawayStock rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

  test("putawayStock rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("putawayStock rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
  test("putawayStock rejects invalid Integer input quantity without writes", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "quantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("putawayStock rejects numeric business rule 0 without writes or receipts", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const rejected = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "quantity": 0 }) }));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({"error":"数量必须大于 0","errorKey":"errors.inventory.quantityPositive"});
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    const graphFailure = await graphqlApp.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: PutawayStockCommandInput!, $key: String!) { runPutawayStock(input: $input, idempotencyKey: $key) { id } }", variables: { ...{"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-putawayStock-key"}, input: { ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "quantity": 0 } } }) }));
    const graphFailurePayload = await graphFailure.json() as { errors?: Array<{ extensions?: { status?: number; errorKey?: string } }> };
    expect(graphFailurePayload.errors?.[0]?.extensions).toMatchObject({"status":409,"errorKey":"errors.inventory.quantityPositive"});
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/putawayStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "reserved": 7 });
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}, "reservedQuantity": 2 }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("inventory.reserved")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("sales.allocated");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:sales.allocated", type: "sales.allocated" });
  });
  test("reserveStock executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: ReserveStockCommandInput!, $key: String!) { runReserveStock(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-reserveStock-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runReserveStock"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-reserveStock-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-reserveStock-key"}, input: { ...{"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}, "reservedQuantity": 2 } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("reserveStock rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("reserveStock rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

  test("reserveStock rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("reserveStock rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
  test("reserveStock rejects invalid Integer input reservedQuantity without writes", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/reserveStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","reservedQuantity":7,"salesOrderId":"00000000-0000-4000-8000-000000000001"}, "reservedQuantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });

test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "quantity": 7 });
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}, "countedQuantity": 2 }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("inventory.adjusted")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("inventory.adjusted");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:inventory.adjusted", type: "inventory.adjusted" });
  });
  test("adjustStock executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: AdjustStockCommandInput!, $key: String!) { runAdjustStock(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-adjustStock-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runAdjustStock"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-adjustStock-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-adjustStock-key"}, input: { ...{"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}, "countedQuantity": 2 } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("adjustStock rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("adjustStock rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

  test("adjustStock rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("adjustStock rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
  test("adjustStock rejects invalid Integer input countedQuantity without writes", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/adjustStock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","countedQuantity":7,"reason":"Qiy fixture reason","productId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001","binId":"00000000-0000-4000-8000-000000000001"}, "countedQuantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });

test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "allocated", "orderedAt": new Date(0), "total": 1 } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "salesOrderId": "00000000-0000-4000-8000-000000000001" });
    expect(result).toMatchObject({ "warehouseId": "00000000-0000-4000-8000-000000000001" });
    expect(result).toMatchObject({ "status": "shipped" });
    expect(client.query("SELECT * FROM shipments WHERE id = ?").get(result.id)).toBeTruthy();
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "salesOrderId": "00000000-0000-4000-8000-000000000099" }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("sales.shipped")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("sales.shipped");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:sales.shipped", type: "sales.shipped" });
  });
  test("shipSalesOrder executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "allocated", "orderedAt": new Date(0), "total": 1 } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: ShipSalesOrderCommandInput!, $key: String!) { runShipSalesOrder(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-shipSalesOrder-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runShipSalesOrder"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-shipSalesOrder-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-shipSalesOrder-key"}, input: { ...{"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}, "salesOrderId": "00000000-0000-4000-8000-000000000099" } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("shipSalesOrder rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "allocated", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("shipSalesOrder rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "allocated", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

  test("shipSalesOrder rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "allocated", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("shipSalesOrder rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(sales_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "customerId": "00000000-0000-4000-8000-000000000001", "status": "allocated", "orderedAt": new Date(0), "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/shipSalesOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"salesOrderId":"00000000-0000-4000-8000-000000000001","warehouseId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });

test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "warehouseId": "00000000-0000-4000-8000-000000000001" });
    expect(result).toMatchObject({ "binId": "00000000-0000-4000-8000-000000000001" });
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}, "quantity": 2 }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("inventory.transferred")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("inventory.transferred");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:inventory.transferred", type: "inventory.transferred" });
  });
  test("transferInventory executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: TransferInventoryCommandInput!, $key: String!) { runTransferInventory(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-transferInventory-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runTransferInventory"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-transferInventory-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-transferInventory-key"}, input: { ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}, "quantity": 2 } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("transferInventory rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("transferInventory rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

  test("transferInventory rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("transferInventory rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
  test("transferInventory rejects invalid Integer input quantity without writes", async () => {
    await db.insert(inventory).values({ "id": "00000000-0000-4000-8000-000000000001", "inventoryKey": "Qiy fixture", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1, "lotCode": "Qiy fixture", "updatedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/transferInventory", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"inventoryId":"00000000-0000-4000-8000-000000000001","targetWarehouseId":"00000000-0000-4000-8000-000000000001","targetBinId":"00000000-0000-4000-8000-000000000001","quantity":7,"productId":"00000000-0000-4000-8000-000000000001"}, "quantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });

test("replays a successful command without a second audit event", async () => {
    const missingKey = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missingKey.status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "status": "completed" });
    
    const replay = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}, "componentQuantity": 2 }) }));
    expect(changedPayload.status).toBe(409);
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("production.completed")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("production.completed");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:production.completed", type: "production.completed" });
  });
  test("completeWorkOrder executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: CompleteWorkOrderCommandInput!, $key: String!) { runCompleteWorkOrder(input: $input, idempotencyKey: $key) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-completeWorkOrder-key"}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runCompleteWorkOrder"]?.id).toBeTruthy();
    const replay = await graphqlApp.handle(request({"input":{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-completeWorkOrder-key"}));
    expect(await replay.json()).toEqual(payload);
    const conflict = await graphqlApp.handle(request({ ...{"input":{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"},"key":"graphql-completeWorkOrder-key"}, input: { ...{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}, "componentQuantity": 2 } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);
  });
  test("completeWorkOrder rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });
  test("completeWorkOrder rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });

  test("completeWorkOrder rolls back when dataflow_idempotency insertion fails and allows retry", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON dataflow_idempotency BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("completeWorkOrder rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
  test("completeWorkOrder rejects invalid Integer input componentQuantity without writes", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}, "componentQuantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });

  test("completeWorkOrder rejects invalid Integer input outputQuantity without writes", async () => {
    await db.insert(work_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "status": "in_progress", "plannedAt": new Date(0) } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of [-2147483649,2147483648,1.5,"invalid",null]) {
      const rejected = await app.handle(new Request("http://localhost/api/v1/commands/completeWorkOrder", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }, body: JSON.stringify({ ...{"workOrderId":"00000000-0000-4000-8000-000000000001","componentId":"00000000-0000-4000-8000-000000000001","componentQuantity":7,"outputBinId":"00000000-0000-4000-8000-000000000001","outputQuantity":7,"warehouseId":"00000000-0000-4000-8000-000000000001","productId":"00000000-0000-4000-8000-000000000001"}, "outputQuantity": invalid }) }));
      expect(rejected.status).toBe(422);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
    }
  });

test("approvePurchaseOrder returns not-found and commits its supported update", async () => {

    const missing = await app.handle(new Request("http://localhost/api/v1/commands/approvePurchaseOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(missing.status).toBe(404);
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    const response = await app.handle(new Request("http://localhost/api/v1/commands/approvePurchaseOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ "status": "approved" });
    
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get("purchasing.approved")?.total).toBe(1);
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(1);
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe("purchasing.approved");
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: "qiy:event:purchasing.approved", type: "purchasing.approved" });
  });
  test("approvePurchaseOrder executes through GraphQL with REST-equivalent idempotency", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": "admin" }, body: JSON.stringify({ query: "mutation($input: ApprovePurchaseOrderCommandInput!) { runApprovePurchaseOrder(input: $input) { id } }", variables }) });
    const response = await graphqlApp.handle(request({"input":{"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.["runApprovePurchaseOrder"]?.id).toBeTruthy();
    
    
  });
  test("approvePurchaseOrder rejects unauthenticated and disallowed roles before writing", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...["viewer"]] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request("http://localhost/api/v1/commands/approvePurchaseOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      
    }
  });
  test("approvePurchaseOrder rolls back when audit_events insertion fails and allows retry", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    client.exec("CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      const failed = await app.handle(new Request("http://localhost/api/v1/commands/approvePurchaseOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}) }));
      expect(failed.status).toBe(500);
      expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request("http://localhost/api/v1/commands/approvePurchaseOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(retry.status).toBe(200);
  });
  test("approvePurchaseOrder rolls back earlier writes when a later requirement fails", async () => {
    await db.insert(purchase_orders).values({ "id": "00000000-0000-4000-8000-000000000001", "number": "Qiy fixture", "supplierId": "00000000-0000-4000-8000-000000000001", "status": "draft", "orderedAt": new Date(0), "expectedDate": "2026-11-30", "total": 1 } as any);
    const before = ["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: "admin", permissions: ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"], groups: ["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"] })));
    const failed = await failureApp.handle(new Request("http://localhost/api/v1/commands/approvePurchaseOrder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({"purchaseOrderId":"00000000-0000-4000-8000-000000000001"}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(["purchase_orders","inventory","stock_movements","sales_orders","shipments","work_orders"].map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);
  });
});
