import { expect, test } from "bun:test";
import { client } from "../src/db";
import { InventoryRepository } from "../src/modules/inventory/inventory.repository";

test("commits CRUD records and realtime outbox rows atomically", async () => {
  client.exec("DROP TABLE IF EXISTS \"inventory\"; DROP TABLE IF EXISTS audit_events; DROP TABLE IF EXISTS qiy_realtime_outbox; CREATE TABLE \"inventory\" (\"id\" text primary key, \"inventoryKey\" text not null, \"warehouseId\" text not null, \"binId\" text not null, \"productId\" text not null, \"quantity\" integer not null, \"reserved\" integer not null, \"lotCode\" text, \"updatedAt\" integer); CREATE TABLE audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null); CREATE TABLE qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, attempts integer not null, availableAt integer not null, deliveredAt integer, deadLetteredAt integer, lastError text, leaseOwner text, leaseUntil integer, createdAt integer not null);");
  const first = await InventoryRepository.create({ "inventoryKey": "Realtime fixture 1", "warehouseId": "00000000-0000-4000-8000-000000000001", "binId": "00000000-0000-4000-8000-000000000001", "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1, "reserved": 1 }, "actor-1");
  expect(first.id).toBeTruthy();
  expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
  expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox").get()).toEqual({ channel: "qiy:inventory", type: "created" });
  client.exec("DROP TABLE qiy_realtime_outbox");
  await expect(InventoryRepository.create({ "inventoryKey": "Realtime fixture 2", "warehouseId": "00000000-0000-4000-8000-000000000002", "binId": "00000000-0000-4000-8000-000000000002", "productId": "00000000-0000-4000-8000-000000000002", "quantity": 2, "reserved": 2 }, "actor-2")).rejects.toThrow();
  expect(client.query<{ total: number }, []>("select count(*) as total from \"inventory\"").get()?.total).toBe(1);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(1);
});
