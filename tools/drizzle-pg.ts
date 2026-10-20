import type { DatabaseIR, EntityIR, FieldIR, IndexIR, RelationIR } from "./database-ir";
import { validateDatabaseIR } from "./database-ir";
import { generatedDocumentation } from "./generated-documentation";

function column(field: FieldIR, relation?: RelationIR): string {
  const name = JSON.stringify(field.columnName ?? field.name);
  let declaration: string;
  switch (field.type) {
    case "UUID": declaration = `uuid(${name})`; break;
    case "Text": declaration = `text(${name})`; break;
    case "File": declaration = `text(${name})`; break;
    case "Files": declaration = `jsonb(${name}).$type<string[]>()`; break;
    case "Integer": declaration = `integer(${name})`; break;
    case "DateTime": declaration = `timestamp(${name}, { withTimezone: true })`; break;
    case "Decimal":
    case "Money": declaration = `numeric(${name}, { precision: ${field.precision}, scale: ${field.scale ?? 0} })`; break;
    case "Vector": declaration = `vector(${name}, { dimensions: ${field.dimension} })`; break;
  }
  if (field.primaryKey) declaration += ".primaryKey()";
  if (relation) declaration += `.references(() => ${relation.toEntity}[${JSON.stringify(relation.toField)}]${relation.onDelete ? `, { onDelete: ${JSON.stringify(relation.onDelete === "setNull" ? "set null" : relation.onDelete)} }` : ""})`;
  if (!field.nullable && !field.primaryKey) declaration += ".notNull()";
  if (field.unique && !field.primaryKey) declaration += ".unique()";
  return declaration;
}

function renderIndex(index: IndexIR): string {
  const columns = index.columns.map(({ fieldName, opclass }) => {
    const access = `table[${JSON.stringify(fieldName)}]`;
    return opclass ? `${access}.op(${JSON.stringify(opclass)})` : access;
  });
  const factory = index.unique ? "uniqueIndex" : "index";
  const method = index.method === "btree" ? "on" : "using";
  const args = index.method === "btree" ? columns.join(", ") : `${JSON.stringify(index.method)}, ${columns.join(", ")}`;
  return `${generatedDocumentation(index, "  ")}  ${factory}(${JSON.stringify(index.name)}).${method}(${args})${index.concurrently ? ".concurrently()" : ""},`;
}

function renderEntity(entity: EntityIR, relations: RelationIR[]): string {
  const fields = entity.fields.map((field) => {
    const relation = relations.find((item) => item.fromEntity === entity.name && item.fromField === field.name);
    return `${generatedDocumentation(relation, "  ")}${generatedDocumentation(field, "  ")}  ${JSON.stringify(field.name)}: ${column(field, relation)},`;
  });
  const indexes = (entity.indexes ?? []).map(renderIndex);
  const extra = indexes.length ? `, (table) => [\n${indexes.join("\n")}\n]` : "";
  return `${generatedDocumentation(entity)}export const ${entity.name} = pgTable(${JSON.stringify(entity.tableName)}, {\n${fields.join("\n")}\n}${extra});`;
}

export function generateDrizzlePostgres(database: DatabaseIR): string {
  const errors = validateDatabaseIR(database);
  if (database.dialect !== "postgresql") errors.unshift("This Drizzle adapter only supports PostgreSQL");
  if (errors.length) throw new Error(errors.join("\n"));

  const imports = new Set(["pgTable", "index", "uniqueIndex", "jsonb", "timestamp", "uuid", "text", "integer", "boolean"]);
  for (const entity of database.entities) {
    for (const field of entity.fields) {
      imports.add(({ UUID: "uuid", Text: "text", Integer: "integer", Decimal: "numeric", Money: "numeric", DateTime: "timestamp", File: "text", Files: "jsonb", Vector: "vector" } as const)[field.type]);
    }
    for (const index of entity.indexes ?? []) imports.add(index.unique ? "uniqueIndex" : "index");
  }
  return `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";\n\n${database.entities.map((entity) => renderEntity(entity, database.relations ?? [])).join("\n\n")}\n\nexport const auditEvents = pgTable("audit_events", {\n  id: uuid("id").primaryKey(),\n  actorId: uuid("actorId"),\n  action: text("action").notNull(),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  metadata: jsonb("metadata"),\n  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),\n}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);\n\nexport const attachments = pgTable("attachments", {\n  id: uuid("id").primaryKey(),\n  storageKey: text("storageKey").notNull().unique(),\n  fileName: text("fileName"),\n  contentType: text("contentType").notNull(),\n  size: integer("size").notNull(),\n  ownerId: uuid("ownerId"),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),\n}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);

export const qiyImportJobs = pgTable("qiy_import_jobs", {
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
  leaseUntil: timestamp("leaseUntil", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("qiy_import_jobs_resource_idx").on(table.resource, table.createdAt)]);

export const qiySavedViews = pgTable("qiy_saved_views", {
  id: text("id").primaryKey(),
  resource: text("resource").notNull(),
  name: text("name").notNull(),
  ownerId: text("ownerId").notNull(),
  shared: boolean("shared").notNull(),
  search: text("search"),
  filters: text("filters"),
  sorters: text("sorters"),
  columns: text("columns"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("qiy_saved_views_resource_idx").on(table.resource, table.ownerId)]);

export const qiyExportJobs = pgTable("qiy_export_jobs", {
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
  leaseUntil: timestamp("leaseUntil", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("qiy_export_jobs_resource_idx").on(table.resource, table.createdAt)]);\n`;
}
