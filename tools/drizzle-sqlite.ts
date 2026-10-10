import type { DatabaseIR, EntityIR, FieldIR, RelationIR } from "./database-ir";
import { validateDatabaseIR } from "./database-ir";

function column(field: FieldIR, relation?: RelationIR): string {
  const name = JSON.stringify(field.columnName ?? field.name);
  let declaration: string;
  switch (field.type) {
    case "UUID":
    case "Text":
    case "File": declaration = `text(${name})`; break;
    case "Integer": declaration = `integer(${name})`; break;
    case "DateTime": declaration = `integer(${name}, { mode: "timestamp_ms" })`; break;
    case "Decimal":
    case "Money": declaration = `real(${name})`; break;
    case "Vector": declaration = `blob(${name}, { mode: "buffer" })`; break;
  }
  if (field.primaryKey) declaration += ".primaryKey()";
  if (relation) declaration += `.references(() => ${relation.toEntity}[${JSON.stringify(relation.toField)}]${relation.onDelete ? `, { onDelete: ${JSON.stringify(relation.onDelete === "setNull" ? "set null" : relation.onDelete)} }` : ""})`;
  if (!field.nullable && !field.primaryKey) declaration += ".notNull()";
  if (field.unique && !field.primaryKey) declaration += ".unique()";
  return declaration;
}

function renderEntity(entity: EntityIR, relations: RelationIR[]): string {
  const fields = entity.fields.map((field) => `  ${JSON.stringify(field.name)}: ${column(field, relations.find((relation) => relation.fromEntity === entity.name && relation.fromField === field.name))},`);
  const indexes = (entity.indexes ?? []).map((index) => {
    const factory = index.unique ? "uniqueIndex" : "index";
    return `  ${factory}(${JSON.stringify(index.name)}).on(${index.columns.map((item) => `table[${JSON.stringify(item.fieldName)}]`).join(", ")}),`;
  });
  return `export const ${entity.name} = sqliteTable(${JSON.stringify(entity.tableName)}, {\n${fields.join("\n")}\n}${indexes.length ? `, (table) => [\n${indexes.join("\n")}\n]` : ""});`;
}

export function generateDrizzleSqlite(database: DatabaseIR): string {
  const errors = validateDatabaseIR(database);
  if (database.dialect !== "sqlite") errors.unshift("This Drizzle adapter only supports SQLite");
  if (database.entities.some((entity) => entity.fields.some((field) => field.type === "Vector"))) errors.push("SQLite adapter does not support Vector fields; use PostgreSQL with pgvector");
  if (errors.length) throw new Error(errors.join("\n"));
  return `import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";\n\n${database.entities.map((item) => renderEntity(item, database.relations ?? [])).join("\n\n")}\n\nexport const auditEvents = sqliteTable("audit_events", {\n  id: text("id").primaryKey(),\n  actorId: text("actorId"),\n  action: text("action").notNull(),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  metadata: text("metadata"),\n  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),\n}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);\n\nexport const attachments = sqliteTable("attachments", {\n  id: text("id").primaryKey(),\n  storageKey: text("storageKey").notNull().unique(),\n  fileName: text("fileName"),\n  contentType: text("contentType").notNull(),\n  size: integer("size").notNull(),\n  ownerId: text("ownerId"),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),\n}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);\n`;
}
