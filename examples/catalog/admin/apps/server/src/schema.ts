import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  "id": uuid("id").primaryKey(),
  "title": text("title").notNull(),
  "price": numeric("price", { precision: 12, scale: 2 }).notNull(),
  "embedding": vector("embedding", { dimensions: 1536 }),
}, (table) => [
  index("products_embedding_hnsw").using("hnsw", table["embedding"].op("vector_cosine_ops")),
  index("products_title_idx").on(table["title"]),
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
