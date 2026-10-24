import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
 import { purchase_orders, inventory, stock_movements, sales_orders, shipments, work_orders, dataflowIdempotency, auditEvents, dataflowOutbox, realtimeOutbox } from "../../src/schema";
import type { Authenticator } from "../../src/auth/guard";


class DataflowFailure extends Error {
  constructor(public readonly status: 403 | 404 | 409, message: string, public readonly resource?: string, public readonly errorKey?: string) { super(message); }
}

class BatchDataflowFailure extends DataflowFailure {
  constructor(status: 403 | 404 | 409, message: string, public readonly index: number, public readonly id: string, resource?: string, errorKey?: string) { super(status, message, resource, errorKey); }
}

async function hashDataflowValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDataflowRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/commands" })
    /**
     * Append a receipt movement and update the on-hand quantity of the target inventory record.
     */
    .post("/receiveInventory", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["purchaseOrderId"], body["productId"], body["warehouseId"], body["binId"], body["inventoryId"], body["quantity"], body["newOnHand"], body["reference"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "receiveInventory"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(purchase_orders).where(eq(purchase_orders["id"], body["purchaseOrderId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "purchase_orders");

        let context1 = tx.select().from(inventory).where(eq(inventory["id"], body["inventoryId"])).limit(1).get();
        if (!context1) throw new DataflowFailure(404, "Not found", "inventory");

        if (!(context0["status"] == "approved")) throw new DataflowFailure(409, "采购单必须处于已审批状态", undefined, "errors.purchaseOrder.notApproved");
        if (!(body["quantity"] > 0)) throw new DataflowFailure(409, "数量必须大于 0", undefined, "errors.inventory.quantityPositive");
        let context2 = tx.insert(stock_movements).values({ id: crypto.randomUUID(), "productId": body["productId"], "warehouseId": body["warehouseId"], "binId": body["binId"], "type": "receipt", "quantity": body["quantity"], "reference": body["reference"] } as typeof stock_movements.$inferInsert).returning().get();
        if (!context2) throw new DataflowFailure(409, "Unable to create", "stock_movements");
        {
        const updated = tx.update(inventory).set({ "quantity": body["newOnHand"], "binId": body["binId"] }).where(eq(inventory.id, context1.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "inventory");
        context1 = updated;
        }
        {
        const updated = tx.update(purchase_orders).set({ "status": "received" }).where(eq(purchase_orders.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "purchase_orders");
        context0 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "inventory.received", payload: JSON.stringify({ flow: "receiveInventory", "inventoryId": context1["id"], "quantity": body["newOnHand"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:inventory.received", type: "inventory.received", payload: JSON.stringify({ flow: "receiveInventory", "inventoryId": context1["id"], "quantity": body["newOnHand"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context2["id"] == "00000000-0000-4000-8000-000000000000")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context1;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "inventory.received", resource: "inventory", resourceId: String(value.id), metadata: JSON.stringify({ flow: "receiveInventory" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "receiveInventory", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "receiveInventory"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "purchaseOrderId": t.String({ format: "uuid" }),
      "productId": t.String({ format: "uuid" }),
      "warehouseId": t.String({ format: "uuid" }),
      "binId": t.String({ format: "uuid" }),
      "inventoryId": t.String({ format: "uuid" }),
      /**
       * Quantity received in this posting
       */
      "quantity": t.Integer({ description: "Quantity received in this posting", minimum: -2147483648, maximum: 2147483647 }),
      /**
       * Absolute on-hand quantity after the receipt
       */
      "newOnHand": t.Integer({ description: "Absolute on-hand quantity after the receipt", minimum: -2147483648, maximum: 2147483647 }),
      "reference": t.String({ minLength: 1 }),
    }, { additionalProperties: false }), detail: { summary: "Receive goods", description: "Append a receipt movement and update the on-hand quantity of the target inventory record.", tags: ["Dataflow"] } })
    /**
     * Move an inventory record into another storage bin and record the transfer.
     */
    .post("/putawayStock", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["inventoryId"], body["targetBinId"], body["quantity"], body["productId"], body["warehouseId"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "putawayStock"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(inventory).where(eq(inventory["id"], body["inventoryId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "inventory");

        if (!(body["quantity"] > 0)) throw new DataflowFailure(409, "数量必须大于 0", undefined, "errors.inventory.quantityPositive");
        let context1 = tx.insert(stock_movements).values({ id: crypto.randomUUID(), "productId": body["productId"], "warehouseId": body["warehouseId"], "binId": body["targetBinId"], "type": "transfer", "quantity": body["quantity"] } as typeof stock_movements.$inferInsert).returning().get();
        if (!context1) throw new DataflowFailure(409, "Unable to create", "stock_movements");
        {
        const updated = tx.update(inventory).set({ "binId": body["targetBinId"] }).where(eq(inventory.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "inventory");
        context0 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "inventory.moved", payload: JSON.stringify({ flow: "putawayStock", "inventoryId": context0["id"], "binId": body["targetBinId"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:inventory.moved", type: "inventory.moved", payload: JSON.stringify({ flow: "putawayStock", "inventoryId": context0["id"], "binId": body["targetBinId"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context1["id"] == "00000000-0000-4000-8000-000000000000")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context0;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "inventory.putaway", resource: "inventory", resourceId: String(value.id), metadata: JSON.stringify({ flow: "putawayStock" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "putawayStock", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "putawayStock"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "inventoryId": t.String({ format: "uuid" }),
      "targetBinId": t.String({ format: "uuid" }),
      "quantity": t.Integer({ minimum: -2147483648, maximum: 2147483647 }),
      "productId": t.String({ format: "uuid" }),
      "warehouseId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "Put away", description: "Move an inventory record into another storage bin and record the transfer.", tags: ["Dataflow"] } })
    /**
     * Reserve an absolute quantity of an inventory record for a sales order.
     */
    .post("/reserveStock", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["inventoryId"], body["reservedQuantity"], body["salesOrderId"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "reserveStock"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(inventory).where(eq(inventory["id"], body["inventoryId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "inventory");

        let context1 = tx.select().from(sales_orders).where(eq(sales_orders["id"], body["salesOrderId"])).limit(1).get();
        if (!context1) throw new DataflowFailure(404, "Not found", "sales_orders");

        {
        const updated = tx.update(inventory).set({ "reserved": body["reservedQuantity"] }).where(eq(inventory.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "inventory");
        context0 = updated;
        }
        {
        const updated = tx.update(sales_orders).set({ "status": "allocated" }).where(eq(sales_orders.id, context1.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "sales_orders");
        context1 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "sales.allocated", payload: JSON.stringify({ flow: "reserveStock", "salesOrderId": context1["id"], "inventoryId": context0["id"], "reserved": body["reservedQuantity"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:sales.allocated", type: "sales.allocated", payload: JSON.stringify({ flow: "reserveStock", "salesOrderId": context1["id"], "inventoryId": context0["id"], "reserved": body["reservedQuantity"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context1["status"] != "allocated")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context0;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "inventory.reserved", resource: "inventory", resourceId: String(value.id), metadata: JSON.stringify({ flow: "reserveStock" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "reserveStock", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "reserveStock"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "inventoryId": t.String({ format: "uuid" }),
      /**
       * Absolute reserved quantity after this operation
       */
      "reservedQuantity": t.Integer({ description: "Absolute reserved quantity after this operation", minimum: -2147483648, maximum: 2147483647 }),
      "salesOrderId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "Reserve stock", description: "Reserve an absolute quantity of an inventory record for a sales order.", tags: ["Dataflow"] } })
    /**
     * Record a cycle count and set the counted on-hand quantity.
     */
    .post("/adjustStock", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["inventoryId"], body["countedQuantity"], body["reason"], body["productId"], body["warehouseId"], body["binId"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "adjustStock"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(inventory).where(eq(inventory["id"], body["inventoryId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "inventory");

        let context1 = tx.insert(stock_movements).values({ id: crypto.randomUUID(), "productId": body["productId"], "warehouseId": body["warehouseId"], "binId": body["binId"], "type": "adjust", "quantity": body["countedQuantity"], "reference": body["reason"] } as typeof stock_movements.$inferInsert).returning().get();
        if (!context1) throw new DataflowFailure(409, "Unable to create", "stock_movements");
        {
        const updated = tx.update(inventory).set({ "quantity": body["countedQuantity"] }).where(eq(inventory.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "inventory");
        context0 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "inventory.adjusted", payload: JSON.stringify({ flow: "adjustStock", "inventoryId": context0["id"], "counted": body["countedQuantity"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:inventory.adjusted", type: "inventory.adjusted", payload: JSON.stringify({ flow: "adjustStock", "inventoryId": context0["id"], "counted": body["countedQuantity"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context1["id"] == "00000000-0000-4000-8000-000000000000")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context0;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "inventory.adjusted", resource: "inventory", resourceId: String(value.id), metadata: JSON.stringify({ flow: "adjustStock" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "adjustStock", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "adjustStock"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "inventoryId": t.String({ format: "uuid" }),
      "countedQuantity": t.Integer({ minimum: -2147483648, maximum: 2147483647 }),
      "reason": t.String({ minLength: 1 }),
      "productId": t.String({ format: "uuid" }),
      "warehouseId": t.String({ format: "uuid" }),
      "binId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "Adjust stock", description: "Record a cycle count and set the counted on-hand quantity.", tags: ["Dataflow"] } })
    /**
     * Create a shipment for a sales order and mark it shipped.
     */
    .post("/shipSalesOrder", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["salesOrderId"], body["warehouseId"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "shipSalesOrder"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(sales_orders).where(eq(sales_orders["id"], body["salesOrderId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "sales_orders");

        if (!(context0["status"] == "allocated")) throw new DataflowFailure(409, "销售单必须先完成库存分配", undefined, "errors.salesOrder.notAllocated");
        let context1 = tx.insert(shipments).values({ id: crypto.randomUUID(), "salesOrderId": body["salesOrderId"], "warehouseId": body["warehouseId"], "status": "shipped" } as typeof shipments.$inferInsert).returning().get();
        if (!context1) throw new DataflowFailure(409, "Unable to create", "shipments");
        {
        const updated = tx.update(sales_orders).set({ "status": "shipped" }).where(eq(sales_orders.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "sales_orders");
        context0 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "sales.shipped", payload: JSON.stringify({ flow: "shipSalesOrder", "salesOrderId": context0["id"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:sales.shipped", type: "sales.shipped", payload: JSON.stringify({ flow: "shipSalesOrder", "salesOrderId": context0["id"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context1["id"] == "00000000-0000-4000-8000-000000000000")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context1;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "sales.shipped", resource: "shipments", resourceId: String(value.id), metadata: JSON.stringify({ flow: "shipSalesOrder" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "shipSalesOrder", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "shipSalesOrder"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "salesOrderId": t.String({ format: "uuid" }),
      "warehouseId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "Ship order", description: "Create a shipment for a sales order and mark it shipped.", tags: ["Dataflow"] } })
    /**
     * Transfer stock between warehouses or bins with an audit movement.
     */
    .post("/transferInventory", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["inventoryId"], body["targetWarehouseId"], body["targetBinId"], body["quantity"], body["productId"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "transferInventory"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(inventory).where(eq(inventory["id"], body["inventoryId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "inventory");

        let context1 = tx.insert(stock_movements).values({ id: crypto.randomUUID(), "productId": body["productId"], "warehouseId": body["targetWarehouseId"], "binId": body["targetBinId"], "type": "transfer", "quantity": body["quantity"] } as typeof stock_movements.$inferInsert).returning().get();
        if (!context1) throw new DataflowFailure(409, "Unable to create", "stock_movements");
        {
        const updated = tx.update(inventory).set({ "warehouseId": body["targetWarehouseId"], "binId": body["targetBinId"] }).where(eq(inventory.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "inventory");
        context0 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "inventory.transferred", payload: JSON.stringify({ flow: "transferInventory", "inventoryId": context0["id"], "warehouseId": body["targetWarehouseId"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:inventory.transferred", type: "inventory.transferred", payload: JSON.stringify({ flow: "transferInventory", "inventoryId": context0["id"], "warehouseId": body["targetWarehouseId"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context1["id"] == "00000000-0000-4000-8000-000000000000")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context0;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "inventory.transferred", resource: "inventory", resourceId: String(value.id), metadata: JSON.stringify({ flow: "transferInventory" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "transferInventory", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "transferInventory"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "inventoryId": t.String({ format: "uuid" }),
      "targetWarehouseId": t.String({ format: "uuid" }),
      "targetBinId": t.String({ format: "uuid" }),
      "quantity": t.Integer({ minimum: -2147483648, maximum: 2147483647 }),
      "productId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "Transfer inventory", description: "Transfer stock between warehouses or bins with an audit movement.", tags: ["Dataflow"] } })
    /**
     * Consume components and book the produced quantity, then close the work order.
     */
    .post("/completeWorkOrder", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["workOrderId"], body["componentId"], body["componentQuantity"], body["outputBinId"], body["outputQuantity"], body["warehouseId"], body["productId"] ]));
      let outcome;
      try {
      outcome = await db.transaction((tx) => {
        const previous = tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "completeWorkOrder"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1).get();
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = tx.select().from(work_orders).where(eq(work_orders["id"], body["workOrderId"])).limit(1).get();
        if (!context0) throw new DataflowFailure(404, "Not found", "work_orders");

        if (!(context0["status"] == "in_progress")) throw new DataflowFailure(409, "工单必须处于生产中状态", undefined, "errors.workOrder.notInProgress");
        let context1 = tx.insert(stock_movements).values({ id: crypto.randomUUID(), "productId": body["componentId"], "warehouseId": body["warehouseId"], "binId": body["outputBinId"], "type": "consumption", "quantity": body["componentQuantity"] } as typeof stock_movements.$inferInsert).returning().get();
        if (!context1) throw new DataflowFailure(409, "Unable to create", "stock_movements");
        let context2 = tx.insert(stock_movements).values({ id: crypto.randomUUID(), "productId": body["productId"], "warehouseId": body["warehouseId"], "binId": body["outputBinId"], "type": "production", "quantity": body["outputQuantity"] } as typeof stock_movements.$inferInsert).returning().get();
        if (!context2) throw new DataflowFailure(409, "Unable to create", "stock_movements");
        {
        const updated = tx.update(work_orders).set({ "status": "completed" }).where(eq(work_orders.id, context0.id)).returning().get();
        if (!updated) throw new DataflowFailure(404, "Not found", "work_orders");
        context0 = updated;
        }
        tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "production.completed", payload: JSON.stringify({ flow: "completeWorkOrder", "workOrderId": context0["id"], "produced": body["outputQuantity"] }), createdAt: new Date() }).run();
        tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:event:production.completed", type: "production.completed", payload: JSON.stringify({ flow: "completeWorkOrder", "workOrderId": context0["id"], "produced": body["outputQuantity"] }), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
        if (!(context2["id"] == "00000000-0000-4000-8000-000000000000")) throw new DataflowFailure(409, "qiy.test.lateFailure");

        const value = context0;
        tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "production.completed", resource: "work_orders", resourceId: String(value.id), metadata: JSON.stringify({ flow: "completeWorkOrder" }), createdAt: new Date() }).run();
        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "completeWorkOrder", requestKeyHash, requestHash, response: JSON.stringify(value) }).run();
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "completeWorkOrder"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "workOrderId": t.String({ format: "uuid" }),
      "componentId": t.String({ format: "uuid" }),
      "componentQuantity": t.Integer({ minimum: -2147483648, maximum: 2147483647 }),
      "outputBinId": t.String({ format: "uuid" }),
      "outputQuantity": t.Integer({ minimum: -2147483648, maximum: 2147483647 }),
      "warehouseId": t.String({ format: "uuid" }),
      "productId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "Complete work order", description: "Consume components and book the produced quantity, then close the work order.", tags: ["Dataflow"] } });
}
