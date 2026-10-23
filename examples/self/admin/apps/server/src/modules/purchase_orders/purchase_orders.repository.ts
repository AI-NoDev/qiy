import { and, asc, avg, count, desc, eq, gt, gte, lt, lte, max, min, sql, sum, like, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { purchase_orders, auditEvents } from "../../schema";
import type { FilterClause, FilterExpression, Purchase_ordersRepository as Purchase_ordersRepositoryContract } from "./purchase_orders.contract";


export const Purchase_ordersRepository: Purchase_ordersRepositoryContract = {
  async aggregate(field, operator, scope) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const columns: Record<string, any> = { "total": purchase_orders.total };
    const column = columns[field];
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const [row] = await db.select({ value: expression }).from(purchase_orders).where(and(scopeCondition));
    const value = row?.value === null || row?.value === undefined ? null : Number(row.value);
    return { value: value === null || Number.isFinite(value) ? value : null, operator };
  },
  async distribution(field, scope) {
    const columns: Record<string, any> = { "status": purchase_orders.status };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    return db.select({ value: column, count: count() }).from(purchase_orders).where(and(scopeCondition)).groupBy(column);
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = { "orderedAt": purchase_orders.orderedAt };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;
    return db.select({ day, count: count() }).from(purchase_orders).where(and(gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [purchase_orders.number, purchase_orders.status];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => like(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const sortColumn = options.sort ? sortColumns[options.sort] : purchase_orders.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const filterTypes = {"id":"UUID","number":"Text","supplierId":"UUID","status":"Text","orderedAt":"DateTime","total":"Decimal"} as Record<string, string>;
    const filters = Array.isArray(options.filters) ? options.filters : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filterClauses = (expressions: FilterExpression[]): FilterClause[] => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters));
    if (filterClauses(filters as FilterExpression[]).some(({ field }) => !filterColumns[field])) throw new Error("Unsupported filter field");
    const coerce = (field: string, value: string) => filterTypes[field] === "Integer" ? Number(value) : filterTypes[field] === "DateTime" ? new Date(value) : value;
    const filterCondition = ({ field, operator, value }: FilterClause) => {
      const column = filterColumns[field];
      if (operator === "contains") return like(column, "%" + value + "%");
      if (operator === "startsWith") return like(column, value + "%");
      if (operator === "endsWith") return like(column, "%" + value);
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
    const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const scopeCondition = options.scope && scopeColumns[options.scope.field] ? eq(scopeColumns[options.scope.field], options.scope.value) : undefined;
    
    const whereCondition = and(searchCondition, scopeCondition, ...(filters as FilterExpression[]).map(filterExpression));
    const [data, totalRows] = await Promise.all([
      db.select().from(
purchase_orders
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
purchase_orders
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope) {
    const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const [record] = await db.select().from(
purchase_orders
).where(and(eq(
purchase_orders
.id, id), scopeCondition)).limit(1);
    return record;
  },
  async create(values, actorId, scope) {
    return db.transaction((tx) => {
      
      const record = tx.insert(purchase_orders).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof purchase_orders.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "purchase_orders.created", resource: "purchase_orders", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const record = tx.update(purchase_orders).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(purchase_orders.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "purchase_orders.updated", resource: "purchase_orders", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       if (record) void 0;
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const record = tx.delete(purchase_orders).where(and(eq(purchase_orders.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "purchase_orders.deleted", resource: "purchase_orders", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
       if (record) void 0;
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "id": purchase_orders.id, "number": purchase_orders.number, "supplierId": purchase_orders.supplierId, "status": purchase_orders.status, "orderedAt": purchase_orders.orderedAt, "total": purchase_orders.total };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const deletedRows = tx.delete(purchase_orders).where(and(inArray(purchase_orders.id, ids), scopeCondition)).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "purchase_orders.deleted", resource: "purchase_orders", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
       if (deletedRows.length) void 0;
      return deletedRows;
    });
  },

  async recordExportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "purchase_orders.exported", resource: "purchase_orders", resourceId: null, metadata: JSON.stringify({ rows: input.rows, filters: input.filters }), createdAt: new Date() });
  },
  async recordImportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "purchase_orders.imported", resource: "purchase_orders", resourceId: null, metadata: JSON.stringify({ rows: input.rows }), createdAt: new Date() });
  },

};
