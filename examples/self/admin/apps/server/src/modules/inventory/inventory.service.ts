import type { InventoryRepository, ListQuery } from "./inventory.contract";
 import { dispatchRealtimeOutbox } from "../../realtime";
const dateFields = ["updatedAt"] as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 async function dispatchCommitted(): Promise<void> {
   try { await dispatchRealtimeOutbox(); }
   catch (error) { console.error("Realtime outbox dispatch failed after committed mutation", { resource: "inventory", error }); }
}
export function createInventoryService(repository: InventoryRepository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }) => repository.aggregate ? repository.aggregate(field, operator, scope) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }) => repository.distribution(field, scope),
    trend: (field: string, days: number, scope?: { field: string; value: string }) => repository.trend(field, days, scope),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }) => repository.one(id, scope),
    create: async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.create(normalizeDates(values), actorId, scope); await dispatchCommitted(); return record; },
    update: async (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.update(id, normalizeDates(values), actorId, scope); if (record) await dispatchCommitted(); return record; },
    delete: async (id: string, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.delete(id, actorId, scope); if (record) await dispatchCommitted(); return record; },
    deleteMany: async (ids: string[], actorId?: string, scope?: { field: string; value: string }) => { const records = await repository.deleteMany(ids, actorId, scope); if (records.length) await dispatchCommitted(); return records; },
  };
}
