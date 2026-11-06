import { and, asc, avg, count, desc, eq, gt, gte, isNotNull, isNull, lt, lte, max, min, sql, sum, ilike, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { inventoryItems, auditEvents } from "../../schema";
import type { FilterClause, FilterExpression, InventoryItemsRepository as InventoryItemsRepositoryContract } from "./inventoryItems.contract";


const notDeleted = undefined;
const qiyBaseInventoryItemsRepository: InventoryItemsRepositoryContract = {
  async aggregate(field, operator, scope) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const columns: Record<string, any> = { "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const column = columns[field];
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const [row] = await db.select({ value: expression }).from(inventoryItems).where(and(notDeleted, scopeCondition));
    const value = row?.value === null || row?.value === undefined ? null : Number(row.value);
    return { value: value === null || Number.isFinite(value) ? value : null, operator };
  },
  async distribution(field, scope) {
    const columns: Record<string, any> = {  };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    return db.select({ value: column, count: count() }).from(inventoryItems).where(and(notDeleted, scopeCondition)).groupBy(column);
  },
  async grouped(groupBy, metric, operator, scope) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const groupColumns: Record<string, any> = {  };
    const metricColumns: Record<string, any> = { "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const group = groupColumns[groupBy];
    const column = metricColumns[metric];
    if (!group) throw new Error("Unsupported distribution field");
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const rows = await db.select({ value: group, count: expression }).from(inventoryItems).where(and(notDeleted, scopeCondition)).groupBy(group);
    return rows.map((row) => ({ value: row.value === null ? null : String(row.value), count: Number(row.count ?? 0) }));
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = {  };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    return db.select({ day, count: count() }).from(inventoryItems).where(and(notDeleted, gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => ilike(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const sortColumn = options.sort ? sortColumns[options.sort] : inventoryItems.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const filterTypes = {"id":"UUID","warehouseId":"UUID","productId":"UUID","quantity":"Integer","reservedQuantity":"Integer"} as Record<string, string>;
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
    const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const scopeCondition = options.scope && scopeColumns[options.scope.field] ? eq(scopeColumns[options.scope.field], options.scope.value) : undefined;
    
    const whereCondition = and(notDeleted, searchCondition, scopeCondition, ...(filters as FilterExpression[]).map(filterExpression));
    const [data, totalRows] = await Promise.all([
      db.select().from(
inventoryItems
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
inventoryItems
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope) {
    const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    
    const [record] = await db.select().from(
inventoryItems
).where(and(notDeleted, eq(
inventoryItems
.id, id), scopeCondition)).limit(1);
    return record;
  },
  async create(values, actorId, scope) {
    return db.transaction(async (tx) => {
      
      const [record] = await tx.insert(inventoryItems).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof inventoryItems.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "inventory_items.created", resource: "inventory_items", resourceId: record.id, metadata: { fields: Object.keys(values) } });
       
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const [record] = await tx.update(inventoryItems).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(notDeleted, eq(inventoryItems.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "inventory_items.updated", resource: "inventory_items", resourceId: id, metadata: { fields: Object.keys(values) } });
       if (record) void 0;
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const [record] = await tx.delete(inventoryItems).where(and(notDeleted, eq(inventoryItems.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "inventory_items.deleted", resource: "inventory_items", resourceId: id, metadata: {} });
       if (record) void 0;
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { "id": inventoryItems.id, "warehouseId": inventoryItems.warehouseId, "productId": inventoryItems.productId, "quantity": inventoryItems.quantity, "reservedQuantity": inventoryItems.reservedQuantity };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      
      const deletedRows = await tx.delete(inventoryItems).where(and(notDeleted, inArray(inventoryItems.id, ids), scopeCondition)).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "inventory_items.deleted", resource: "inventory_items", resourceId: record.id, metadata: {} })));
       if (deletedRows.length) void 0;
      return deletedRows;
    });
  },

  async recordExportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "inventory_items.exported", resource: "inventory_items", resourceId: null, metadata: { rows: input.rows, filters: input.filters } });
  },
  async recordImportAudit(input) {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "inventory_items.imported", resource: "inventory_items", resourceId: null, metadata: { rows: input.rows } });
  },

};

export const InventoryItemsRepository: InventoryItemsRepositoryContract = qiyBaseInventoryItemsRepository;
