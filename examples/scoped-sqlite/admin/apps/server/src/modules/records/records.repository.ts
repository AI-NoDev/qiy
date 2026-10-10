import { and, asc, count, desc, eq, gte, lt, sql, like, inArray, or } from "drizzle-orm";
import { db } from "../../db";
import { records, auditEvents } from "../../schema";
import type { RecordsRepository as RecordsRepositoryContract } from "./records.contract";

export const RecordsRepository: RecordsRepositoryContract = {
  async distribution(field, scope) {
    const columns: Record<string, any> = {  };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { "tenantId": records.tenantId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    return db.select({ value: column, count: count() }).from(records).where(scopeCondition).groupBy(column);
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = { "createdAt": records.createdAt };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { "tenantId": records.tenantId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;
    return db.select({ day, count: count() }).from(records).where(and(gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [records.tenantId, records.title];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => like(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { "id": records.id, "tenantId": records.tenantId, "title": records.title, "createdAt": records.createdAt };
    const sortColumn = sortColumns[options.sort ?? "id"] ?? records.id;
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { "tenantId": records.tenantId };
    const filterConditions = Object.entries(options.filters ?? {}).map(([field, value]) => filterColumns[field] ? eq(filterColumns[field], value) : undefined).filter(Boolean);
    const scopeCondition = options.scope && filterColumns[options.scope.field] ? eq(filterColumns[options.scope.field], options.scope.value) : undefined;
    const whereCondition = and(searchCondition, scopeCondition, ...filterConditions);
    const [data, totalRows] = await Promise.all([
      db.select().from(
records
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
records
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope) {
    const scopeColumns: Record<string, any> = { "tenantId": records.tenantId };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    const [record] = await db.select().from(
records
).where(and(eq(
records
.id, id), scopeCondition)).limit(1);
    return record;
  },
  async create(values, actorId, scope) {
    return db.transaction((tx) => {
      const record = tx.insert(records).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof records.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "records.created", resource: "records", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "tenantId": records.tenantId };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const record = tx.update(records).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(records.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "records.updated", resource: "records", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "tenantId": records.tenantId };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const record = tx.delete(records).where(and(eq(records.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "records.deleted", resource: "records", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "tenantId": records.tenantId };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = tx.delete(records).where(and(inArray(records.id, ids), scopeCondition)).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "records.deleted", resource: "records", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
      return deletedRows;
    });
  },


};
