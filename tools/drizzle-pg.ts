import type { DatabaseIR, EntityIR, FieldIR, IndexIR, RelationIR } from "./database-ir";
import { generatedFieldsOf, validateDatabaseIR } from "./database-ir";
import { generatedDocumentation } from "./generated-documentation";

function column(field: FieldIR, relation?: RelationIR): string {
  const name = JSON.stringify(field.columnName ?? field.name);
  let declaration: string;
  switch (field.type) {
    case "UUID": declaration = `uuid(${name})`; break;
    case "Text": declaration = `text(${name})`; break;
    case "Email":
    case "URL": declaration = `text(${name})`; break;
    case "File": declaration = `text(${name})`; break;
    case "Files": declaration = `jsonb(${name}).$type<string[]>()`; break;
    case "Integer": declaration = `integer(${name})`; break;
    case "Boolean": declaration = `boolean(${name})`; break;
    // Date and Time are stored as ISO text (`YYYY-MM-DD`, `HH:mm:ss`) so the REST,
    // GraphQL and CSV contracts stay the same across dialects.
    case "Date": declaration = `date(${name}, { mode: "string" })`; break;
    case "Time": declaration = `time(${name})`; break;
    case "DateTime": declaration = `timestamp(${name}, { withTimezone: true })`; break;
    case "Decimal":
    case "Money": declaration = `numeric(${name}, { precision: ${field.precision}, scale: ${field.scale ?? 0} })`; break;
    case "Vector": declaration = `vector(${name}, { dimensions: ${field.dimension} })`; break;
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
    ? `.references((): AnyPgColumn => ${target}${options})`
    : `.references(() => ${target}${options})`;
}

/** True when any entity renders a business code, so the sequence table is required. */
export function usesCodeSequences(database: DatabaseIR): boolean {
  return database.entities.some((entity) => generatedFieldsOf(entity).some((generated) => generated.kind === "code"));
}

function codeSequenceTable(): string {
  return `\nexport const qiyCodeSequences = pgTable("qiy_code_sequences", {
  entity: text("entity").notNull(),
  field: text("field").notNull(),
  bucket: text("bucket").notNull(),
  value: integer("value").notNull(),
}, (table) => [primaryKey({ columns: [table.entity, table.field, table.bucket] })]);\n`;
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
      imports.add(({ UUID: "uuid", Text: "text", Email: "text", URL: "text", Integer: "integer", Boolean: "boolean", Decimal: "numeric", Money: "numeric", Date: "date", Time: "time", DateTime: "timestamp", File: "text", Files: "jsonb", Vector: "vector" } as const)[field.type]);
    }
    for (const index of entity.indexes ?? []) imports.add(index.unique ? "uniqueIndex" : "index");
  }
  const sequences = usesCodeSequences(database);
  if (sequences) imports.add("primaryKey");
  const selfRelations = (database.relations ?? []).some((relation) => relation.fromEntity === relation.toEntity);
  const typeImport = selfRelations ? `import type { AnyPgColumn } from "drizzle-orm/pg-core";\n` : "";
  return `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";\n${typeImport}\n${database.entities.map((entity) => renderEntity(entity, database.relations ?? [])).join("\n\n")}\n${sequences ? codeSequenceTable() : ""}\nexport const auditEvents = pgTable("audit_events", {\n  id: uuid("id").primaryKey(),\n  actorId: uuid("actorId"),\n  action: text("action").notNull(),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  metadata: jsonb("metadata"),\n  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),\n}, (table) => [index("audit_events_resource_idx").on(table.resource, table.resourceId), index("audit_events_created_at_idx").on(table.createdAt)]);\n\nexport const attachments = pgTable("attachments", {\n  id: uuid("id").primaryKey(),\n  storageKey: text("storageKey").notNull().unique(),\n  fileName: text("fileName"),\n  contentType: text("contentType").notNull(),\n  size: integer("size").notNull(),\n  ownerId: uuid("ownerId"),\n  resource: text("resource").notNull(),\n  resourceId: text("resourceId"),\n  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),\n}, (table) => [index("attachments_resource_idx").on(table.resource, table.resourceId), index("attachments_owner_idx").on(table.ownerId)]);

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
