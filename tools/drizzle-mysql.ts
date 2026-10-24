import type { DatabaseIR, EntityIR, FieldIR, RelationIR } from "./database-ir";
import { validateDatabaseIR } from "./database-ir";
import { generatedDocumentation } from "./generated-documentation";

function column(field: FieldIR, relation?: RelationIR, indexed = false): string {
  const name = JSON.stringify(field.columnName ?? field.name);
  let declaration: string;
  switch (field.type) {
    case "UUID": declaration = `varchar(${name}, { length: 36 })`; break;
    case "Text":
    case "File": declaration = field.unique || indexed ? `varchar(${name}, { length: 255 })` : `text(${name})`; break;
    case "Files": declaration = `json(${name}).$type<string[]>()`; break;
    case "Integer": declaration = `int(${name})`; break;
    // Date and Time keep the wire contract verbatim: `YYYY-MM-DD` and `HH:mm:ss` text.
    case "Date": declaration = `date(${name}, { mode: "string" })`; break;
    case "Time": declaration = `time(${name})`; break;
    case "DateTime": declaration = `datetime(${name}, { mode: "date", fsp: 3 })`; break;
    case "Decimal":
    case "Money": declaration = `decimal(${name}, { precision: ${field.precision}, scale: ${field.scale ?? 0} })`; break;
    case "Vector": declaration = `json(${name})`; break;
  }
  if (field.primaryKey) declaration += ".primaryKey()";
  if (relation) declaration += `.references(() => ${relation.toEntity}[${JSON.stringify(relation.toField)}]${relation.onDelete ? `, { onDelete: ${JSON.stringify(relation.onDelete === "setNull" ? "set null" : relation.onDelete)} }` : ""})`;
  if (!field.nullable && !field.primaryKey) declaration += ".notNull()";
  if (field.unique && !field.primaryKey) declaration += ".unique()";
  return declaration;
}

function renderEntity(entity: EntityIR, relations: RelationIR[]): string {
  const indexedFields = new Set((entity.indexes ?? []).flatMap((index) => index.columns.map((column) => column.fieldName)));
  const fields = entity.fields.map((field) => {
    const relation = relations.find((item) => item.fromEntity === entity.name && item.fromField === field.name);
    return `${generatedDocumentation(relation, "  ")}${generatedDocumentation(field, "  ")}  ${JSON.stringify(field.name)}: ${column(field, relation, indexedFields.has(field.name))},`;
  });
  const indexes = (entity.indexes ?? []).map((index) => {
    const factory = index.unique ? "uniqueIndex" : "index";
    return `${generatedDocumentation(index, "  ")}  ${factory}(${JSON.stringify(index.name)}).on(${index.columns.map((item) => `table[${JSON.stringify(item.fieldName)}]`).join(", ")}),`;
  });
  return `${generatedDocumentation(entity)}export const ${entity.name} = mysqlTable(${JSON.stringify(entity.tableName)}, {\n${fields.join("\n")}\n}${indexes.length ? `, (table) => [\n${indexes.join("\n")}\n]` : ""});`;
}

export function generateDrizzleMysql(database: DatabaseIR): string {
  const errors = validateDatabaseIR(database);
  if (database.dialect !== "mysql") errors.unshift("This Drizzle adapter only supports MySQL");
  if (database.extensions.length > 0) errors.push("MySQL adapter does not support PostgreSQL extensions");
  if (errors.length) throw new Error(errors.join("\n"));
  const imports = new Set(["bigint", "datetime", "decimal", "index", "int", "json", "mediumtext", "mysqlTable", "text", "uniqueIndex", "varchar"]);
  for (const entity of database.entities) for (const field of entity.fields) if (field.type === "Date") imports.add("date");
  for (const entity of database.entities) for (const field of entity.fields) if (field.type === "Time") imports.add("time");
  return `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/mysql-core";\n\n${database.entities.map((item) => renderEntity(item, database.relations ?? [])).join("\n\n")}\n\nexport const auditEvents = mysqlTable("audit_events", {\n  id: varchar("id", { length: 36 }).primaryKey(),\n  actorId: varchar("actorId", { length: 36 }),\n  action: varchar("action", { length: 160 }).notNull(),\n  resource: varchar("resource", { length: 160 }).notNull(),\n  resourceId: varchar("resourceId", { length: 160 }),\n  metadata: json("metadata"),\n  createdAt: bigint("createdAt", { mode: "number" }).notNull(),\n}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);\n\nexport const attachments = mysqlTable("attachments", {\n  id: varchar("id", { length: 36 }).primaryKey(),\n  storageKey: varchar("storageKey", { length: 240 }).notNull().unique(),\n  fileName: text("fileName"),\n  contentType: varchar("contentType", { length: 255 }).notNull(),\n  size: int("size").notNull(),\n  ownerId: varchar("ownerId", { length: 36 }),\n  resource: varchar("resource", { length: 160 }).notNull(),\n  resourceId: varchar("resourceId", { length: 160 }),\n  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),\n}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);

export const qiyImportJobs = mysqlTable("qiy_import_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  resource: varchar("resource", { length: 160 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  total: int("total").notNull(),
  processed: int("processed").notNull(),
  failed: int("failed").notNull(),
  errors: text("errors"),
  actorId: varchar("actorId", { length: 36 }),
  payload: mediumtext("payload"),
  leaseOwner: varchar("leaseOwner", { length: 80 }),
  leaseUntil: datetime("leaseUntil", { mode: "date", fsp: 3 }),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 }).notNull().$defaultFn(() => new Date()),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("qiy_import_jobs_resource_idx").on(table.resource, table.createdAt)]);

export const qiySavedViews = mysqlTable("qiy_saved_views", {
  id: varchar("id", { length: 36 }).primaryKey(),
  resource: varchar("resource", { length: 160 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  ownerId: varchar("ownerId", { length: 36 }).notNull(),
  shared: int("shared").notNull(),
  search: text("search"),
  filters: text("filters"),
  sorters: text("sorters"),
  columns: text("columns"),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 }).notNull().$defaultFn(() => new Date()),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("qiy_saved_views_resource_idx").on(table.resource, table.ownerId)]);

export const qiyExportJobs = mysqlTable("qiy_export_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  resource: varchar("resource", { length: 160 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  total: int("total").notNull(),
  processed: int("processed").notNull(),
  payload: mediumtext("payload"),
  result: mediumtext("result"),
  errors: text("errors"),
  actorId: varchar("actorId", { length: 36 }),
  leaseOwner: varchar("leaseOwner", { length: 80 }),
  leaseUntil: datetime("leaseUntil", { mode: "date", fsp: 3 }),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 }).notNull().$defaultFn(() => new Date()),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("qiy_export_jobs_resource_idx").on(table.resource, table.createdAt)]);\n`;
}
