import { normalizeTemporalValues } from "../../temporal";
import type { ShipmentsRepository, ListQuery } from "./shipments.contract";
 import { dispatchRealtimeOutbox } from "../../realtime";
const temporalFields = {"departureTime":"Time"} as Record<string, "Date" | "Time">;
const dateFields = ["shippedAt"] as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 async function dispatchCommitted(): Promise<void> {
   try { await dispatchRealtimeOutbox(); }
   catch (error) { console.error("Realtime outbox dispatch failed after committed mutation", { resource: "shipments", error }); }
}
export function createShipmentsService(repository: ShipmentsRepository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }) => repository.aggregate ? repository.aggregate(field, operator, scope) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }) => repository.distribution(field, scope),
    trend: (field: string, days: number, scope?: { field: string; value: string }) => repository.trend(field, days, scope),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }) => repository.one(id, scope),
    create: async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.create(normalizeDates(normalizeTemporalValues(values, temporalFields)), actorId, scope); await dispatchCommitted(); return record; },
    update: async (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.update(id, normalizeDates(normalizeTemporalValues(values, temporalFields)), actorId, scope); if (record) await dispatchCommitted(); return record; },
    delete: (id: string, actorId?: string, scope?: { field: string; value: string }) => repository.delete(id, actorId, scope),
    deleteMany: (ids: string[], actorId?: string, scope?: { field: string; value: string }) => repository.deleteMany(ids, actorId, scope),
  };
}
