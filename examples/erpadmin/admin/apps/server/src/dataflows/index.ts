import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
 import { orders, dataflowIdempotency, auditEvents, dataflowOutbox } from "../schema";
import type { Authenticator } from "../auth/guard";



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
     * Statemachine orderLifecycle: draft -> submitted
     */
    .post("/orderLifecycleSubmit", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const dataScope0 = principal?.claims?.["tenant.customerId"];
      if (dataScope0 === undefined || dataScope0 === null || dataScope0 === "") return status(403, { error: "Missing required data scope claim: " + "tenant.customerId" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["recordId"], dataScope0 ]));
      let outcome;
      try {
      outcome = await db.transaction(async (tx) => {
        const previous = (await tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleSubmit"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1))[0];
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = (await tx.select().from(orders).where(and(eq(orders["id"], body["recordId"]), eq(orders["customerId"], String(dataScope0)))).limit(1).for("update"))[0];
        if (!context0) throw new DataflowFailure(404, "Not found", "orders");

        if (!(context0["status"] == "draft")) throw new DataflowFailure(409, "submit is not allowed while status is not draft", undefined, "state.invalidTransition");
        {
        const updated = (await tx.update(orders).set({ "status": "submitted" }).where(eq(orders.id, context0.id)).returning())[0];
        if (!updated) throw new DataflowFailure(404, "Not found", "orders");
        context0 = updated;
        }
        await tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "orders.submit", payload: JSON.stringify({ flow: "orderLifecycleSubmit", "id": context0["id"], "status": "submitted" }), createdAt: new Date() });

        const value = context0;
        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "orders.submit", resource: "orders", resourceId: String(value.id), metadata: { flow: "orderLifecycleSubmit" }, createdAt: new Date() });
        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "orderLifecycleSubmit", requestKeyHash, requestHash, response: JSON.stringify(value) });
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleSubmit"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "recordId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "提交订单", description: "Statemachine orderLifecycle: draft -> submitted", tags: ["Dataflow"] } })
    /**
     * Statemachine orderLifecycle: submitted -> approved
     */
    .post("/orderLifecycleApprove", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const dataScope0 = principal?.claims?.["tenant.customerId"];
      if (dataScope0 === undefined || dataScope0 === null || dataScope0 === "") return status(403, { error: "Missing required data scope claim: " + "tenant.customerId" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["recordId"], dataScope0 ]));
      let outcome;
      try {
      outcome = await db.transaction(async (tx) => {
        const previous = (await tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleApprove"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1))[0];
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = (await tx.select().from(orders).where(and(eq(orders["id"], body["recordId"]), eq(orders["customerId"], String(dataScope0)))).limit(1).for("update"))[0];
        if (!context0) throw new DataflowFailure(404, "Not found", "orders");

        if (!(context0["status"] == "submitted")) throw new DataflowFailure(409, "approve is not allowed while status is not submitted", undefined, "state.invalidTransition");
        {
        const updated = (await tx.update(orders).set({ "status": "approved" }).where(eq(orders.id, context0.id)).returning())[0];
        if (!updated) throw new DataflowFailure(404, "Not found", "orders");
        context0 = updated;
        }
        await tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "orders.approve", payload: JSON.stringify({ flow: "orderLifecycleApprove", "id": context0["id"], "status": "approved" }), createdAt: new Date() });

        const value = context0;
        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "orders.approve", resource: "orders", resourceId: String(value.id), metadata: { flow: "orderLifecycleApprove" }, createdAt: new Date() });
        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "orderLifecycleApprove", requestKeyHash, requestHash, response: JSON.stringify(value) });
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleApprove"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "recordId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "审批", description: "Statemachine orderLifecycle: submitted -> approved", tags: ["Dataflow"] } })
    /**
     * Statemachine orderLifecycle: approved -> shipped
     */
    .post("/orderLifecycleShip", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const dataScope0 = principal?.claims?.["tenant.customerId"];
      if (dataScope0 === undefined || dataScope0 === null || dataScope0 === "") return status(403, { error: "Missing required data scope claim: " + "tenant.customerId" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["recordId"], dataScope0 ]));
      let outcome;
      try {
      outcome = await db.transaction(async (tx) => {
        const previous = (await tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleShip"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1))[0];
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = (await tx.select().from(orders).where(and(eq(orders["id"], body["recordId"]), eq(orders["customerId"], String(dataScope0)))).limit(1).for("update"))[0];
        if (!context0) throw new DataflowFailure(404, "Not found", "orders");

        if (!(context0["status"] == "approved")) throw new DataflowFailure(409, "ship is not allowed while status is not approved", undefined, "state.invalidTransition");
        {
        const updated = (await tx.update(orders).set({ "status": "shipped" }).where(eq(orders.id, context0.id)).returning())[0];
        if (!updated) throw new DataflowFailure(404, "Not found", "orders");
        context0 = updated;
        }
        await tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "orders.ship", payload: JSON.stringify({ flow: "orderLifecycleShip", "id": context0["id"], "status": "shipped" }), createdAt: new Date() });

        const value = context0;
        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "orders.ship", resource: "orders", resourceId: String(value.id), metadata: { flow: "orderLifecycleShip" }, createdAt: new Date() });
        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "orderLifecycleShip", requestKeyHash, requestHash, response: JSON.stringify(value) });
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleShip"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "recordId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "出库", description: "Statemachine orderLifecycle: approved -> shipped", tags: ["Dataflow"] } })
    /**
     * Statemachine orderLifecycle: draft, submitted -> cancelled
     */
    .post("/orderLifecycleCancel", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!["admin","operator"].includes(principal.role)) return status(403, { error: "Command execution is restricted" });
      const dataScope0 = principal?.claims?.["tenant.customerId"];
      if (dataScope0 === undefined || dataScope0 === null || dataScope0 === "") return status(403, { error: "Missing required data scope claim: " + "tenant.customerId" });
      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\x21-\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([body["recordId"], dataScope0 ]));
      let outcome;
      try {
      outcome = await db.transaction(async (tx) => {
        const previous = (await tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleCancel"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1))[0];
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };

        let context0 = (await tx.select().from(orders).where(and(eq(orders["id"], body["recordId"]), eq(orders["customerId"], String(dataScope0)))).limit(1).for("update"))[0];
        if (!context0) throw new DataflowFailure(404, "Not found", "orders");

        if (!(context0["status"] != "approved")) throw new DataflowFailure(409, "cancel is not allowed while status is not draft or submitted", undefined, "state.invalidTransition");
        if (!(context0["status"] != "shipped")) throw new DataflowFailure(409, "cancel is not allowed while status is not draft or submitted", undefined, "state.invalidTransition");
        if (!(context0["status"] != "cancelled")) throw new DataflowFailure(409, "cancel is not allowed while status is not draft or submitted", undefined, "state.invalidTransition");
        {
        const updated = (await tx.update(orders).set({ "status": "cancelled" }).where(eq(orders.id, context0.id)).returning())[0];
        if (!updated) throw new DataflowFailure(404, "Not found", "orders");
        context0 = updated;
        }
        await tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: "orders.cancel", payload: JSON.stringify({ flow: "orderLifecycleCancel", "id": context0["id"], "status": "cancelled" }), createdAt: new Date() });

        const value = context0;
        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: "orders.cancel", resource: "orders", resourceId: String(value.id), metadata: { flow: "orderLifecycleCancel" }, createdAt: new Date() });
        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: "orderLifecycleCancel", requestKeyHash, requestHash, response: JSON.stringify(value) });
        return { kind: "ok" as const, value };
      });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, "orderLifecycleCancel"), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });

      return outcome.value;
    }, { body: t.Object({
      "recordId": t.String({ format: "uuid" }),
    }, { additionalProperties: false }), detail: { summary: "取消订单", description: "Statemachine orderLifecycle: draft, submitted -> cancelled", tags: ["Dataflow"] } });
}
