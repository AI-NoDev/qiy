import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  "id": uuid("id").primaryKey(),
  "email": text("email").notNull().unique(),
  "displayName": text("displayName").notNull(),
  "passwordHash": text("passwordHash"),
  "externalSubject": text("externalSubject").unique(),
  "role": text("role").notNull(),
}, (table) => [
  uniqueIndex("users_email_idx").on(table["email"]),
]);

export const customers = pgTable("customers", {
  "id": uuid("id").primaryKey(),
  "name": text("name").notNull(),
  "email": text("email"),
  "creditLimit": numeric("creditLimit", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index("customers_name_idx").on(table["name"]),
]);

export const warehouses = pgTable("warehouses", {
  "id": uuid("id").primaryKey(),
  "code": text("code").notNull().unique(),
  "name": text("name").notNull(),
  "capacity": integer("capacity").notNull(),
}, (table) => [
  uniqueIndex("warehouses_code_idx").on(table["code"]),
]);

export const products = pgTable("products", {
  "id": uuid("id").primaryKey(),
  "sku": text("sku").notNull().unique(),
  "name": text("name").notNull(),
  "unitPrice": numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  "reorderPoint": integer("reorderPoint").notNull(),
  "datasheet": text("datasheet"),
}, (table) => [
  uniqueIndex("products_sku_idx").on(table["sku"]),
]);

export const inventoryItems = pgTable("inventory_items", {
  "id": uuid("id").primaryKey(),
  "warehouseId": uuid("warehouseId").references(() => warehouses["id"]).notNull(),
  "productId": uuid("productId").references(() => products["id"], { onDelete: "restrict" }).notNull(),
  "quantity": integer("quantity").notNull(),
  "reservedQuantity": integer("reservedQuantity").notNull(),
}, (table) => [
  uniqueIndex("inventory_warehouse_product_idx").on(table["warehouseId"], table["productId"]),
]);

export const orders = pgTable("orders", {
  "id": uuid("id").primaryKey(),
  "orderNumber": text("orderNumber").notNull().unique(),
  "customerId": uuid("customerId").references(() => customers["id"]).notNull(),
  "status": text("status").notNull(),
  "totalAmount": numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
  "approvedBy": uuid("approvedBy").references(() => users["id"]),
  "createdAt": timestamp("createdAt", { withTimezone: true }),
}, (table) => [
  uniqueIndex("orders_number_idx").on(table["orderNumber"]),
  index("orders_customer_status_idx").on(table["customerId"], table["status"]),
]);

export const orderItems = pgTable("order_items", {
  "id": uuid("id").primaryKey(),
  "orderId": uuid("orderId").references(() => orders["id"], { onDelete: "cascade" }).notNull(),
  "productId": uuid("productId").references(() => products["id"]).notNull(),
  "quantity": integer("quantity").notNull(),
  "unitPrice": numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index("order_items_order_idx").on(table["orderId"]),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actorId"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resourceId"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey(),
  storageKey: text("storageKey").notNull().unique(),
  fileName: text("fileName"),
  contentType: text("contentType").notNull(),
  size: integer("size").notNull(),
  ownerId: uuid("ownerId"),
  resource: text("resource").notNull(),
  resourceId: text("resourceId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);

export const orderReservations = pgTable("order_reservations", {
  id: uuid("id").primaryKey(),
  orderId: uuid("orderId").notNull().references(() => orders.id, { onDelete: "cascade" }),
  orderItemId: uuid("orderItemId").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventoryItemId").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
}, (table) => [index("order_reservations_order_idx").on(table.orderId)]);

export const orderIdempotency = pgTable("order_idempotency", {
  id: uuid("id").primaryKey(),
  orderId: uuid("orderId").notNull().references(() => orders.id, { onDelete: "cascade" }),
  actorId: uuid("actorId").notNull(),
  requestKey: text("requestKey").notNull(),
  response: jsonb("response").notNull(),
}, (table) => [uniqueIndex("order_idempotency_scope_idx").on(table.orderId, table.actorId, table.requestKey)]);
