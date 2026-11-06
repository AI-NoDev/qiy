import { and, asc, avg, count, desc, eq, gt, gte, isNotNull, isNull, lt, lte, max, min, sql, sum, ilike, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { users, auditEvents } from "../../schema";
import type { FilterClause, FilterExpression, UsersRepository as UsersRepositoryContract } from "./users.contract";

import { qiyCreateWithGeneratedValues, type QiyGeneratedField } from "../../generated-values";

const qiyGeneratedFields = [{"field":"customerId","kind":"uuid"}] as QiyGeneratedField[];
const notDeleted = undefined;
const qiyBaseUsersRepository: UsersRepositoryContract = {
  async aggregate(field, operator, scope) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const columns: Record<string, any> = {  };
    const column = columns[field];
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const [row] = await db.select({ value: expression }).from(users).where(and(notDeleted, scopeCondition));
    const value = row?.value === null || row?.value === undefined ? null : Number(row.value);
    return { value: value === null || Number.isFinite(value) ? value : null, operator };
  },
  async distribution(field, scope) {
    const columns: Record<string, any> = { "role": users.role };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    return db.select({ value: column, count: count() }).from(users).where(and(notDeleted, scopeCondition)).groupBy(column);
  },
  async grouped(groupBy, metric, operator, scope) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const groupColumns: Record<string, any> = { "role": users.role };
    const metricColumns: Record<string, any> = {  };
    const group = groupColumns[groupBy];
    const column = metricColumns[metric];
    if (!group) throw new Error("Unsupported distribution field");
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const rows = await db.select({ value: group, count: expression }).from(users).where(and(notDeleted, scopeCondition)).groupBy(group);
    return rows.map((row) => ({ value: row.value === null ? null : String(row.value), count: Number(row.count ?? 0) }));
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = {  };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    return db.select({ day, count: count() }).from(users).where(and(notDeleted, gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [users.email, users.displayName, users.externalSubject, users.role];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => ilike(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const sortColumn = options.sort ? sortColumns[options.sort] : users.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const filterTypes = {"id":"UUID","email":"Text","displayName":"Text","externalSubject":"Text","role":"Text","customerId":"UUID"} as Record<string, string>;
    const filters = Array.isArray(options.filters) ? options.filters : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filterClauses = (expressions: FilterExpression[]): FilterClause[] => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters));
    if (filterClauses(filters as FilterExpression[]).some(({ field }) => !filterColumns[field])) throw new Error("Unsupported filter field");
    const coerce = (field: string, value: string) => filterTypes[field] === "Integer" ? Number(value) : filterTypes[field] === "DateTime" ? new Date(value) : value;
    const filterCondition = ({ field, operator, value }: FilterClause) => {
      const column = filterColumns[field];
      if (operator === "contains") return ilike(column, "%" + value + "%");
      if (operator === "startsWith") return ilike(column, value + "%");
      if (operator === "endsWith") return ilike(column, "%" + value);
      if (operator === "gt") return gt(column, coerce(field, value));
      if (operator === "gte") return gte(column, coerce(field, value));
      if (operator === "lt") return lt(column, coerce(field, value));
      if (operator === "lte") return lte(column, coerce(field, value));
      if (operator === "between") {
        const [lower, upper, extra] = value.split(",").map((item) => item.trim());
        if (!lower || !upper || extra !== undefined) throw new Error("Between filter requires two values");
        return and(gte(column, coerce(field, lower)), lte(column, coerce(field, upper)));
      }
      if (operator === "in") {
        const values = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => coerce(field, item));
        if (values.length === 0) throw new Error("In filter requires at least one value");
        return inArray(column, values);
      }
      return eq(column, coerce(field, value));
    };
    const filterExpression = (filter: FilterExpression): any => "field" in filter
      ? filterCondition(filter)
      : filter.operator === "and" ? and(...filter.filters.map(filterExpression)) : or(...filter.filters.map(filterExpression));
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const scopeCondition = options.scope && scopeColumns[options.scope.field] ? eq(scopeColumns[options.scope.field], options.scope.value) : undefined;
    
    const whereCondition = and(notDeleted, searchCondition, scopeCondition, ...(filters as FilterExpression[]).map(filterExpression));
    const [data, totalRows] = await Promise.all([
      db.select().from(
users
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
users
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope) {
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const [record] = await db.select().from(
users
).where(and(notDeleted, eq(
users
.id, id), scopeCondition)).limit(1);
    return record;
  },
  async create(values, actorId, scope) {
    return qiyCreateWithGeneratedValues("users", [{"field":"customerId","kind":"uuid"}], values, (prepared) => db.transaction(async (tx) => {
      
      const [record] = await tx.insert(users).values({ ...prepared, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof users.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.created", resource: "users", resourceId: record.id, metadata: { fields: Object.keys(prepared) } });
       
      return record;
    }));
  },
  async update(id, values, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const [record] = await tx.update(users).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(notDeleted, eq(users.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.updated", resource: "users", resourceId: id, metadata: { fields: Object.keys(values) } });
       if (record) void 0;
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const [record] = await tx.delete(users).where(and(notDeleted, eq(users.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.deleted", resource: "users", resourceId: id, metadata: {} });
       if (record) void 0;
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role, "customerId": users.customerId };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const deletedRows = await tx.delete(users).where(and(notDeleted, inArray(users.id, ids), scopeCondition)).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.deleted", resource: "users", resourceId: record.id, metadata: {} })));
       if (deletedRows.length) void 0;
      return deletedRows;
    });
  },

  async recordExportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "users.exported", resource: "users", resourceId: null, metadata: { rows: input.rows, filters: input.filters } });
  },
  async recordImportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "users.imported", resource: "users", resourceId: null, metadata: { rows: input.rows } });
  },

};

export const UsersRepository: UsersRepositoryContract = qiyBaseUsersRepository;
