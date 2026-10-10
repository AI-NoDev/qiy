import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("records", {
  "id": text("id").primaryKey(),
  "tenantId": text("tenantId").notNull(),
  "title": text("title").notNull(),
  "createdAt": integer("createdAt", { mode: "timestamp_ms" }),
});

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
