import type { DatabaseIR, EntityIR, FieldIR, RelationIR } from "./database-ir";
import { generatedFieldsOf, validateDatabaseIR } from "./database-ir";
import { generatedDocumentation } from "./generated-documentation";

function column(field: FieldIR, relation?: RelationIR): string {
  const name = JSON.stringify(field.columnName ?? field.name);
  let declaration: string;
  switch (field.type) {
    case "UUID":
    case "Text":
    case "Email":
    case "URL":
    case "File": declaration = `text(${name})`; break;
    case "Files": declaration = `text(${name}, { mode: "json" }).$type<string[]>()`; break;
    case "Integer": declaration = `integer(${name})`; break;
    case "JSON": declaration = `text(${name}, { mode: "json" })`; break;
    case "Boolean": declaration = `integer(${name}, { mode: "boolean" })`; break;
    // Date and Time keep the wire contract verbatim: `YYYY-MM-DD` and `HH:mm:ss` text.
    case "Date":
    case "Time": declaration = `text(${name})`; break;
    case "DateTime": declaration = `integer(${name}, { mode: "timestamp_ms" })`; break;
    case "Decimal":
    case "Money": declaration = `real(${name})`; break;
    case "Vector": declaration = `blob(${name}, { mode: "buffer" })`; break;
  }
  if (field.primaryKey) declaration += ".primaryKey()";
  if (relation) declaration += reference(relation);
  if (!field.nullable && !field.primaryKey) declaration += ".notNull()";
  if (field.unique && !field.primaryKey) declaration += ".unique()";
  return declaration;
}

/** A self relation needs an explicit callback return type; TypeScript otherwise infers `any`. */
function reference(relation: RelationIR): string {
  const selfReference = relation.fromEntity === relation.toEntity;
  const target = `${relation.toEntity}[${JSON.stringify(relation.toField)}]`;
  const options = relation.onDelete ? `, { onDelete: ${JSON.stringify(relation.onDelete === "setNull" ? "set null" : relation.onDelete)} }` : "";
  return selfReference
    ? `.references((): AnySQLiteColumn => ${target}${options})`
    : `.references(() => ${target}${options})`;
}

/** True when any entity renders a business code, so the sequence table is required. */
export function usesCodeSequences(database: DatabaseIR): boolean {
  return database.entities.some((entity) => generatedFieldsOf(entity).some((generated) => generated.kind === "code"));
}

function codeSequenceTable(): string {
  return `\nexport const qiyCodeSequences = sqliteTable("qiy_code_sequences", {
  entity: text("entity").notNull(),
  field: text("field").notNull(),
  bucket: text("bucket").notNull(),
  value: integer("value").notNull(),
}, (table) => [primaryKey({ columns: [table.entity, table.field, table.bucket] })]);\n`;
}

function renderEntity(entity: EntityIR, relations: RelationIR[]): string {
  const fields = entity.fields.map((field) => {
    const relation = relations.find((item) => item.fromEntity === entity.name && item.fromField === field.name);
    return `${generatedDocumentation(relation, "  ")}${generatedDocumentation(field, "  ")}  ${JSON.stringify(field.name)}: ${column(field, relation)},`;
  });
  const indexes = (entity.indexes ?? []).map((index) => {
    const factory = index.unique ? "uniqueIndex" : "index";
    return `${generatedDocumentation(index, "  ")}  ${factory}(${JSON.stringify(index.name)}).on(${index.columns.map((item) => `table[${JSON.stringify(item.fieldName)}]`).join(", ")}),`;
  });
  return `${generatedDocumentation(entity)}export const ${entity.name} = sqliteTable(${JSON.stringify(entity.tableName)}, {\n${fields.join("\n")}\n}${indexes.length ? `, (table) => [\n${indexes.join("\n")}\n]` : ""});`;
}

export function generateDrizzleSqlite(database: DatabaseIR): string {
  const errors = validateDatabaseIR(database);
  if (database.dialect !== "sqlite") errors.unshift("This Drizzle adapter only supports SQLite");
  if (database.entities.some((entity) => entity.fields.some((field) => field.type === "Vector"))) errors.push("SQLite adapter does not support Vector fields; use PostgreSQL with pgvector");
  if (errors.length) throw new Error(errors.join("\n"));
  const sequences = usesCodeSequences(database);
  const selfRelations = (database.relations ?? []).some((relation) => relation.fromEntity === relation.toEntity);
  const imports = new Set(["blob", "index", "integer", "real", "sqliteTable", "text", "uniqueIndex"]);
  if (sequences) imports.add("primaryKey");
  const typeImport = selfRelations ? `import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";\n` : "";
  return `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/sqlite-core";\n${typeImport}\n${database.entities.map((item) => renderEntity(item, database.relations ?? [])).join("\n\n")}\n${sequences ? codeSequenceTable() : ""}\nexport const auditEvents = sqliteTable("audit_events", {\n  id: text("id").primaryKey(),\n  actorId: text("actorId"),\n  action: text("action").notNull(),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  metadata: text("metadata"),\n  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),\n}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);\n\nexport const attachments = sqliteTable("attachments", {\n  id: text("id").primaryKey(),\n  storageKey: text("storageKey").notNull().unique(),\n  fileName: text("fileName"),\n  contentType: text("contentType").notNull(),\n  size: integer("size").notNull(),\n  ownerId: text("ownerId"),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),\n}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);

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
}, (table) => [index("qiy_export_jobs_resource_idx").on(table.resource, table.createdAt)]);\n`;
}
