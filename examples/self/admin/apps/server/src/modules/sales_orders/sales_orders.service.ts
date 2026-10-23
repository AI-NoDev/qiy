import type { Sales_ordersRepository, ListQuery } from "./sales_orders.contract";
 
const dateFields = ["orderedAt"] as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 
export function createSales_ordersService(repository: Sales_ordersRepository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }) => repository.aggregate ? repository.aggregate(field, operator, scope) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }) => repository.distribution(field, scope),
    trend: (field: string, days: number, scope?: { field: string; value: string }) => repository.trend(field, days, scope),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }) => repository.one(id, scope),
    create: (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.create(normalizeDates(values), actorId, scope),
    update: (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.update(id, normalizeDates(values), actorId, scope),
    delete: (id: string, actorId?: string, scope?: { field: string; value: string }) => repository.delete(id, actorId, scope),
    deleteMany: (ids: string[], actorId?: string, scope?: { field: string; value: string }) => repository.deleteMany(ids, actorId, scope),
  };
}
