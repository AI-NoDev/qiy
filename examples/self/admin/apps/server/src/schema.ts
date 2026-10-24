import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  "id": text("id").primaryKey(),
  "subject": text("subject").notNull().unique(),
  "oktaSubject": text("oktaSubject").unique(),
  "keycloakSubject": text("keycloakSubject").unique(),
  "googleSubject": text("googleSubject").unique(),
  "kindeSubject": text("kindeSubject").unique(),
  "azureSubject": text("azureSubject").unique(),
  "email": text("email").notNull().unique(),
  "displayName": text("displayName"),
  "role": text("role").notNull(),
  "passwordHash": text("passwordHash"),
  "oauthProfiles": text("oauthProfiles"),
  "permissions": text("permissions"),
  "orgId": text("orgId").references(() => orgs["id"], { onDelete: "restrict" }),
});

export const orgs = sqliteTable("orgs", {
  "id": text("id").primaryKey(),
  "code": text("code").notNull().unique(),
  "name": text("name").notNull(),
  "parentId": text("parentId").references((): AnySQLiteColumn => orgs["id"], { onDelete: "set null" }),
  "externalId": text("externalId"),
});

export const suppliers = sqliteTable("suppliers", {
  "id": text("id").primaryKey(),
  "code": text("code").notNull().unique(),
  "name": text("name").notNull(),
  "email": text("email"),
  "leadTimeDays": integer("leadTimeDays").notNull(),
});

export const customers = sqliteTable("customers", {
  "id": text("id").primaryKey(),
  "code": text("code").notNull().unique(),
  "name": text("name").notNull(),
  "email": text("email"),
  "creditLimit": real("creditLimit").notNull(),
});

export const products = sqliteTable("products", {
  "id": text("id").primaryKey(),
  "sku": text("sku").notNull().unique(),
  "name": text("name").notNull(),
  "uom": text("uom").notNull(),
  "unitCost": real("unitCost").notNull(),
  "price": real("price").notNull(),
  "reorderPoint": integer("reorderPoint").notNull(),
  "active": text("active").notNull(),
});

export const boms = sqliteTable("boms", {
  "id": text("id").primaryKey(),
  "productId": text("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "componentId": text("componentId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "quantity": integer("quantity").notNull(),
});

export const purchase_orders = sqliteTable("purchase_orders", {
  "id": text("id").primaryKey(),
  "number": text("number").notNull().unique(),
  "supplierId": text("supplierId").references(() => suppliers["id"], { onDelete: "restrict" }).notNull(),
  "status": text("status").notNull(),
  "orderedAt": integer("orderedAt", { mode: "timestamp_ms" }).notNull(),
  "expectedDate": text("expectedDate").notNull(),
  "total": real("total").notNull(),
});

export const purchase_order_lines = sqliteTable("purchase_order_lines", {
  "id": text("id").primaryKey(),
  "purchaseOrderId": text("purchaseOrderId").references(() => purchase_orders["id"], { onDelete: "cascade" }).notNull(),
  "productId": text("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "quantity": integer("quantity").notNull(),
  "unitCost": real("unitCost").notNull(),
});

export const receipts = sqliteTable("receipts", {
  "id": text("id").primaryKey(),
  "purchaseOrderId": text("purchaseOrderId").references(() => purchase_orders["id"], { onDelete: "restrict" }).notNull(),
  "warehouseId": text("warehouseId").references(() => warehouses["id"], { onDelete: "restrict" }).notNull(),
  "status": text("status").notNull(),
  "receivedAt": integer("receivedAt", { mode: "timestamp_ms" }),
});

export const sales_orders = sqliteTable("sales_orders", {
  "id": text("id").primaryKey(),
  "number": text("number").notNull().unique(),
  "customerId": text("customerId").references(() => customers["id"], { onDelete: "restrict" }).notNull(),
  "status": text("status").notNull(),
  "orderedAt": integer("orderedAt", { mode: "timestamp_ms" }).notNull(),
  "total": real("total").notNull(),
});

export const sales_order_lines = sqliteTable("sales_order_lines", {
  "id": text("id").primaryKey(),
  "salesOrderId": text("salesOrderId").references(() => sales_orders["id"], { onDelete: "cascade" }).notNull(),
  "productId": text("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "quantity": integer("quantity").notNull(),
  "unitPrice": real("unitPrice").notNull(),
  "allocated": integer("allocated").notNull(),
});

export const shipments = sqliteTable("shipments", {
  "id": text("id").primaryKey(),
  "salesOrderId": text("salesOrderId").references(() => sales_orders["id"], { onDelete: "restrict" }).notNull(),
  "warehouseId": text("warehouseId").references(() => warehouses["id"], { onDelete: "restrict" }).notNull(),
  "status": text("status").notNull(),
  "shippedAt": integer("shippedAt", { mode: "timestamp_ms" }),
  "departureTime": text("departureTime"),
});

export const warehouses = sqliteTable("warehouses", {
  "id": text("id").primaryKey(),
  "orgId": text("orgId").references(() => orgs["id"], { onDelete: "restrict" }).notNull(),
  "code": text("code").notNull().unique(),
  "name": text("name").notNull(),
  "active": text("active").notNull(),
});

export const bins = sqliteTable("bins", {
  "id": text("id").primaryKey(),
  "warehouseId": text("warehouseId").references(() => warehouses["id"], { onDelete: "restrict" }).notNull(),
  "code": text("code").notNull().unique(),
  "capacity": integer("capacity").notNull(),
});

export const inventory = sqliteTable("inventory", {
  "id": text("id").primaryKey(),
  "inventoryKey": text("inventoryKey").notNull().unique(),
  "warehouseId": text("warehouseId").references(() => warehouses["id"], { onDelete: "restrict" }).notNull(),
  "binId": text("binId").references(() => bins["id"], { onDelete: "restrict" }).notNull(),
  "productId": text("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "quantity": integer("quantity").notNull(),
  "reserved": integer("reserved").notNull(),
  "lotCode": text("lotCode"),
  "updatedAt": integer("updatedAt", { mode: "timestamp_ms" }),
});

export const stock_movements = sqliteTable("stock_movements", {
  "id": text("id").primaryKey(),
  "productId": text("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "warehouseId": text("warehouseId").references(() => warehouses["id"], { onDelete: "restrict" }).notNull(),
  "binId": text("binId").references(() => bins["id"], { onDelete: "restrict" }).notNull(),
  "type": text("type").notNull(),
  "quantity": integer("quantity").notNull(),
  "reference": text("reference"),
  "occurredAt": integer("occurredAt", { mode: "timestamp_ms" }),
});

export const work_orders = sqliteTable("work_orders", {
  "id": text("id").primaryKey(),
  "number": text("number").notNull().unique(),
  "productId": text("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "quantity": integer("quantity").notNull(),
  "status": text("status").notNull(),
  "plannedAt": integer("plannedAt", { mode: "timestamp_ms" }).notNull(),
});

export const qiyCodeSequences = sqliteTable("qiy_code_sequences", {
  entity: text("entity").notNull(),
  field: text("field").notNull(),
  bucket: text("bucket").notNull(),
  value: integer("value").notNull(),
}, (table) => [primaryKey({ columns: [table.entity, table.field, table.bucket] })]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actorId"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resourceId"),
  metadata: text("metadata"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  storageKey: text("storageKey").notNull().unique(),
  fileName: text("fileName"),
  contentType: text("contentType").notNull(),
  size: integer("size").notNull(),
  ownerId: text("ownerId"),
  resource: text("resource").notNull(),
  resourceId: text("resourceId"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);

export const qiyImportJobs = sqliteTable("qiy_import_jobs", {
  id: text("id").primaryKey(),
  resource: text("resource").notNull(),
  status: text("status").notNull(),
  total: integer("total").notNull(),
  processed: integer("processed").notNull(),
  failed: integer("failed").notNull(),
  errors: text("errors"),
  actorId: text("actorId"),
  payload: text("payload"),
  leaseOwner: text("leaseOwner"),
  leaseUntil: integer("leaseUntil", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("qiy_import_jobs_resource_idx").on(table.resource, table.createdAt)]);

export const qiySavedViews = sqliteTable("qiy_saved_views", {
  id: text("id").primaryKey(),
  resource: text("resource").notNull(),
  name: text("name").notNull(),
  ownerId: text("ownerId").notNull(),
  shared: integer("shared").notNull(),
  search: text("search"),
  filters: text("filters"),
  sorters: text("sorters"),
  columns: text("columns"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("qiy_saved_views_resource_idx").on(table.resource, table.ownerId)]);

export const qiyExportJobs = sqliteTable("qiy_export_jobs", {
  id: text("id").primaryKey(),
  resource: text("resource").notNull(),
  status: text("status").notNull(),
  total: integer("total").notNull(),
  processed: integer("processed").notNull(),
  payload: text("payload"),
  result: text("result"),
  errors: text("errors"),
  actorId: text("actorId"),
  leaseOwner: text("leaseOwner"),
  leaseUntil: integer("leaseUntil", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("qiy_export_jobs_resource_idx").on(table.resource, table.createdAt)]);


export const dataflowIdempotency = sqliteTable("dataflow_idempotency", {
  id: text("id").primaryKey(),
  actorId: text("actorId").notNull(),
  flow: text("flow").notNull(),
  requestKeyHash: text("requestKeyHash").notNull(),
  requestHash: text("requestHash").notNull(),
  response: text("response").notNull(),
}, (table) => [uniqueIndex("dataflow_idempotency_actor_flow_key_idx").on(table.actorId, table.flow, table.requestKeyHash)]);


export const dataflowOutbox = sqliteTable("dataflow_outbox", {
  id: text("id").primaryKey(),
  actorId: text("actorId"),
  event: text("event").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});


export const realtimeOutbox = sqliteTable("qiy_realtime_outbox", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  attempts: integer("attempts").notNull(),
  availableAt: integer("availableAt", { mode: "timestamp_ms" }).notNull(),
  deliveredAt: integer("deliveredAt", { mode: "timestamp_ms" }),
  deadLetteredAt: integer("deadLetteredAt", { mode: "timestamp_ms" }),
  lastError: text("lastError"),
  leaseOwner: text("leaseOwner"),
  leaseUntil: integer("leaseUntil", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("qiy_realtime_outbox_pending_idx").on(table.deliveredAt, table.deadLetteredAt, table.availableAt, table.leaseUntil, table.createdAt)]);
