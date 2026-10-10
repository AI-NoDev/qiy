import { and, eq, gte, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { auditEvents, inventoryItems, orderIdempotency, orderItems, orderReservations, orders } from "../schema";
import type { Authenticator } from "../auth/guard";
import { planInventoryAllocation } from "./allocation";

class WorkflowConflict extends Error {}
function result(status: (code: number, body: unknown) => unknown, code: number, message: string) { return status(code, { error: message }); }
const requiredScopeClaim = "tenant.customerId";
function orderScopeCondition(principal: Awaited<ReturnType<Authenticator>>) {
  if (!requiredScopeClaim) return undefined;
  const value = principal?.claims?.[requiredScopeClaim];
  if (value === undefined || value === null || value === "") return null;
  return eq(orders.customerId, String(value));
}

export function createOrderWorkflowRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/orders" })
    .post("/:id/submit", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return result(status, 403, "Permission denied");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      const key = request.headers.get("idempotency-key");
      if (key && key.length > 128) return result(status, 400, "Idempotency key is too long");
      try {
        const order = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(orders).where(and(eq(orders.id, params.id), scopeCondition)).limit(1).for("update");
          if (!current) throw new WorkflowConflict("Order not found");
          if (key) {
            const [receipt] = await tx.select().from(orderIdempotency).where(and(eq(orderIdempotency.orderId, params.id), eq(orderIdempotency.actorId, principal.id), eq(orderIdempotency.requestKey, key))).limit(1);
            if (receipt) return receipt.response as typeof current;
          }
          if (current.status !== "draft") throw new WorkflowConflict("Only draft orders can be submitted");
          const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, params.id)).orderBy(orderItems.productId, orderItems.id);
          if (items.length === 0) throw new WorkflowConflict("Order requires at least one item");
          for (const item of items) {
            const stocks = await tx.select().from(inventoryItems).where(eq(inventoryItems.productId, item.productId)).orderBy(inventoryItems.id).for("update");
            for (const allocation of planInventoryAllocation(stocks, item.quantity)) {
              const [updatedStock] = await tx.update(inventoryItems).set({ reservedQuantity: sql`${inventoryItems.reservedQuantity} + ${allocation.quantity}` }).where(and(eq(inventoryItems.id, allocation.inventoryItemId), sql`${inventoryItems.quantity} - ${inventoryItems.reservedQuantity} >= ${allocation.quantity}`)).returning();
              if (!updatedStock) throw new WorkflowConflict("Inventory changed concurrently");
              await tx.insert(orderReservations).values({ id: crypto.randomUUID(), orderId: params.id, orderItemId: item.id, inventoryItemId: allocation.inventoryItemId, quantity: allocation.quantity });
            }
          }
          const [updated] = await tx.update(orders).set({ status: "submitted" }).where(and(eq(orders.id, params.id), eq(orders.status, "draft"), scopeCondition)).returning();
          if (!updated) throw new WorkflowConflict("Order changed concurrently");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.submitted", resource: "orders", resourceId: params.id, metadata: { itemCount: items.length } });
          if (key) await tx.insert(orderIdempotency).values({ id: crypto.randomUUID(), orderId: params.id, actorId: principal.id, requestKey: key, response: updated });
          return updated;
        });
        return order;
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to submit order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/:id/approve", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || principal.role !== "admin") return result(status, 403, "Only admins can approve orders");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      try {
        return await db.transaction(async (tx) => {
          const [updated] = await tx.update(orders).set({ status: "approved", approvedBy: principal.id }).where(and(eq(orders.id, params.id), eq(orders.status, "submitted"), scopeCondition)).returning();
          if (!updated) throw new WorkflowConflict("Only submitted orders can be approved");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.approved", resource: "orders", resourceId: params.id, metadata: {} });
          return updated;
        });
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to approve order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/:id/ship", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return result(status, 403, "Permission denied");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      try {
        return await db.transaction(async (tx) => {
          const [current] = await tx.select().from(orders).where(and(eq(orders.id, params.id), scopeCondition)).limit(1).for("update");
          if (!current || current.status !== "approved") throw new WorkflowConflict("Only approved orders can be shipped");
          const allocations = await tx.select().from(orderReservations).where(eq(orderReservations.orderId, params.id)).orderBy(orderReservations.inventoryItemId).for("update");
          if (!allocations.length) throw new WorkflowConflict("Missing inventory reservations");
          for (const allocation of allocations) {
            const [stock] = await tx.update(inventoryItems).set({ quantity: sql`${inventoryItems.quantity} - ${allocation.quantity}`, reservedQuantity: sql`${inventoryItems.reservedQuantity} - ${allocation.quantity}` }).where(and(eq(inventoryItems.id, allocation.inventoryItemId), gte(inventoryItems.quantity, allocation.quantity), gte(inventoryItems.reservedQuantity, allocation.quantity))).returning();
            if (!stock) throw new WorkflowConflict("Inventory reservation changed concurrently");
          }
          await tx.delete(orderReservations).where(eq(orderReservations.orderId, params.id));
          const [shipped] = await tx.update(orders).set({ status: "shipped" }).where(and(eq(orders.id, params.id), eq(orders.status, "approved"), scopeCondition)).returning();
          if (!shipped) throw new WorkflowConflict("Order changed concurrently");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.shipped", resource: "orders", resourceId: params.id, metadata: { allocationCount: allocations.length } });
          return shipped;
        });
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to ship order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/:id/cancel", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return result(status, 403, "Permission denied");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      try {
        const cancelled = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(orders).where(and(eq(orders.id, params.id), scopeCondition)).limit(1).for("update");
          if (!current) throw new WorkflowConflict("Order not found");
          if (current.status !== "draft" && current.status !== "submitted") throw new WorkflowConflict("Only draft or submitted orders can be cancelled");
          if (current.status === "submitted") {
            const allocations = await tx.select().from(orderReservations).where(eq(orderReservations.orderId, params.id)).orderBy(orderReservations.inventoryItemId).for("update");
            if (!allocations.length) throw new WorkflowConflict("Missing inventory reservations");
            for (const allocation of allocations) {
              const [stock] = await tx.update(inventoryItems).set({ reservedQuantity: sql`${inventoryItems.reservedQuantity} - ${allocation.quantity}` }).where(and(eq(inventoryItems.id, allocation.inventoryItemId), gte(inventoryItems.reservedQuantity, allocation.quantity))).returning();
              if (!stock) throw new WorkflowConflict("Inventory reservation changed concurrently");
            }
            await tx.delete(orderReservations).where(eq(orderReservations.orderId, params.id));
          }
          const [updated] = await tx.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, params.id), sql`${orders.status} IN ('draft', 'submitted')`, scopeCondition)).returning();
          if (!updated) throw new WorkflowConflict("Order changed concurrently");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.cancelled", resource: "orders", resourceId: params.id, metadata: { previousStatus: current.status } });
          return updated;
        });
        return cancelled;
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to cancel order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });
}
