import type { QiyPolicy } from "../../security/policy";
import type { ProductsRepository, ListQuery } from "./products.contract";
 
const dateFields = [] as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 
export function createProductsService(repository: ProductsRepository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.aggregate ? repository.aggregate(field, operator, scope, policy) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.distribution(field, scope, policy),
    trend: (field: string, days: number, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.trend(field, days, scope, policy),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.one(id, scope, policy),
    create: (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.create(normalizeDates(values), actorId, scope, policy),
    update: (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.update(id, normalizeDates(values), actorId, scope, policy),
    delete: (id: string, actorId?: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.delete(id, actorId, scope, policy),
    deleteMany: (ids: string[], actorId?: string, scope?: { field: string; value: string }, policy?: QiyPolicy) => repository.deleteMany(ids, actorId, scope, policy),
  };
}
