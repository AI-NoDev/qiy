import { and, asc, avg, count, desc, eq, gt, gte, lt, lte, max, min, sql, sum, like, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { stock_movements, auditEvents, realtimeOutbox } from "../../schema";
import type { FilterClause, FilterExpression, Stock_movementsRepository as Stock_movementsRepositoryContract } from "./stock_movements.contract";


export const Stock_movementsRepository: Stock_movementsRepositoryContract = {
  async aggregate(field, operator, scope) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const columns: Record<string, any> = { "quantity": stock_movements.quantity };
    const column = columns[field];
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const [row] = await db.select({ value: expression }).from(stock_movements).where(and(scopeCondition));
    const value = row?.value === null || row?.value === undefined ? null : Number(row.value);
    return { value: value === null || Number.isFinite(value) ? value : null, operator };
  },
  async distribution(field, scope) {
    const columns: Record<string, any> = { "type": stock_movements.type };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    return db.select({ value: column, count: count() }).from(stock_movements).where(and(scopeCondition)).groupBy(column);
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = { "occurredAt": stock_movements.occurredAt };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;
    return db.select({ day, count: count() }).from(stock_movements).where(and(gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [stock_movements.type, stock_movements.reference];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => like(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const sortColumn = options.sort ? sortColumns[options.sort] : stock_movements.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const filterTypes = {"id":"UUID","productId":"UUID","warehouseId":"UUID","binId":"UUID","type":"Text","quantity":"Integer","reference":"Text","occurredAt":"DateTime"} as Record<string, string>;
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
    const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const scopeCondition = options.scope && scopeColumns[options.scope.field] ? eq(scopeColumns[options.scope.field], options.scope.value) : undefined;
    
    const whereCondition = and(searchCondition, scopeCondition, ...(filters as FilterExpression[]).map(filterExpression));
    const [data, totalRows] = await Promise.all([
      db.select().from(
stock_movements
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
stock_movements
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope) {
    const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const [record] = await db.select().from(
stock_movements
).where(and(eq(
stock_movements
.id, id), scopeCondition)).limit(1);
    return record;
  },
  async create(values, actorId, scope) {
    return db.transaction((tx) => {
      
      const record = tx.insert(stock_movements).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof stock_movements.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "stock_movements.created", resource: "stock_movements", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:stock_movements", type: "created", payload: JSON.stringify(record), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() }).run();
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const record = tx.update(stock_movements).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(stock_movements.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "stock_movements.updated", resource: "stock_movements", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       if (record) void 0;
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const record = tx.delete(stock_movements).where(and(eq(stock_movements.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "stock_movements.deleted", resource: "stock_movements", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
       if (record) void 0;
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { "id": stock_movements.id, "productId": stock_movements.productId, "warehouseId": stock_movements.warehouseId, "binId": stock_movements.binId, "type": stock_movements.type, "quantity": stock_movements.quantity, "reference": stock_movements.reference, "occurredAt": stock_movements.occurredAt };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const deletedRows = tx.delete(stock_movements).where(and(inArray(stock_movements.id, ids), scopeCondition)).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "stock_movements.deleted", resource: "stock_movements", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
       if (deletedRows.length) void 0;
      return deletedRows;
    });
  },

  async recordExportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "stock_movements.exported", resource: "stock_movements", resourceId: null, metadata: JSON.stringify({ rows: input.rows, filters: input.filters }), createdAt: new Date() });
  },
  async recordImportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "stock_movements.imported", resource: "stock_movements", resourceId: null, metadata: JSON.stringify({ rows: input.rows }), createdAt: new Date() });
  },

};
