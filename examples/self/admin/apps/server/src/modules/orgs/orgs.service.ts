import { qiyStripGeneratedValues, type QiyGeneratedField } from "../../generated-values";
import type { OrgsRepository, ListQuery } from "./orgs.contract";
 
const qiyGeneratedFields = [{"field":"code","kind":"code","template":"ORG-{YYYY}{MM}-{seq:4}"},{"field":"externalId","kind":"uuid"}] as QiyGeneratedField[];
const dateFields = [] as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 
export function createOrgsService(repository: OrgsRepository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }) => repository.aggregate ? repository.aggregate(field, operator, scope) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }) => repository.distribution(field, scope),
    trend: (field: string, days: number, scope?: { field: string; value: string }) => repository.trend(field, days, scope),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }) => repository.one(id, scope),
    create: (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.create(normalizeDates(qiyStripGeneratedValues(values, qiyGeneratedFields)), actorId, scope),
    update: async (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => {
      const prepared = normalizeDates(qiyStripGeneratedValues(values, qiyGeneratedFields));
      if (Object.keys(prepared).length === 0) return repository.one(id, scope);
      return repository.update(id, prepared, actorId, scope);
    },
    delete: (id: string, actorId?: string, scope?: { field: string; value: string }) => repository.delete(id, actorId, scope),
    deleteMany: (ids: string[], actorId?: string, scope?: { field: string; value: string }) => repository.deleteMany(ids, actorId, scope),
  };
}
