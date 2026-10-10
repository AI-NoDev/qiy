import { and, asc, count, desc, eq, gte, lt, sql, ilike, inArray, or } from "drizzle-orm";
import { db } from "../../db";
import { users, auditEvents } from "../../schema";
import type { UsersRepository as UsersRepositoryContract } from "./users.contract";

export const UsersRepository: UsersRepositoryContract = {
  async distribution(field, scope) {
    const columns: Record<string, any> = { "role": users.role };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    return db.select({ value: column, count: count() }).from(users).where(scopeCondition).groupBy(column);
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = {  };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    return db.select({ day, count: count() }).from(users).where(and(gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [users.email, users.displayName, users.externalSubject, users.role];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => ilike(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
    const sortColumn = options.sort ? sortColumns[options.sort] : users.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
    const filters = Object.entries(options.filters ?? {});
    if (filters.some(([field]) => !filterColumns[field])) throw new Error("Unsupported filter field");
    const filterConditions = filters.map(([field, value]) => eq(filterColumns[field], value));
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
    const scopeCondition = options.scope && scopeColumns[options.scope.field] ? eq(scopeColumns[options.scope.field], options.scope.value) : undefined;
    const whereCondition = and(searchCondition, scopeCondition, ...filterConditions);
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
    const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    const [record] = await db.select().from(
users
).where(and(eq(
users
.id, id), scopeCondition)).limit(1);
    return record;
  },
  async create(values, actorId, scope) {
    return db.transaction(async (tx) => {
      const [record] = await tx.insert(users).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof users.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.created", resource: "users", resourceId: record.id, metadata: { fields: Object.keys(values) } });
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.update(users).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(users.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.updated", resource: "users", resourceId: id, metadata: { fields: Object.keys(values) } });
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.delete(users).where(and(eq(users.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.deleted", resource: "users", resourceId: id, metadata: {} });
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": users.id, "email": users.email, "displayName": users.displayName, "externalSubject": users.externalSubject, "role": users.role };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = await tx.delete(users).where(and(inArray(users.id, ids), scopeCondition)).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "users.deleted", resource: "users", resourceId: record.id, metadata: {} })));
      return deletedRows;
    });
  },


};
