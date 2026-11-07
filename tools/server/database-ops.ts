/**
 * Server renderers for database operations: schema drift checks, logical
 * backup/restore and the migrate/rollback scripts.
 */
import { concurrentIndexStatements } from "../drizzle-pg";
import type { DatabaseIR } from "../database-ir";

export function renderDatabaseOperationFiles(database: DatabaseIR): Record<string, string> {
  return {
    "api/src/schema-drift.ts": `import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/${database.dialect === "postgresql" ? "pg-core" : database.dialect === "mysql" ? "mysql-core" : "sqlite-core"}";
import * as schema from "./schema";
import { client } from "./db";

export const DIALECT: string = ${JSON.stringify(database.dialect)};
export { client };

export interface DriftColumn { name: string; nullable: boolean; type: string; primary: boolean }
export interface DriftTable { name: string; columns: DriftColumn[] }
export interface DriftReport { ok: boolean; errors: string[]; warnings: string[]; unverified: string[] }

/** Maps a Drizzle column type onto a portable category. Unknown stays unknown, never a guess. */
export function canonicalFromDrizzle(columnType: string, dataType: string): string {
  const type = (columnType || "").toLowerCase();
  if (type.includes("uuid")) return "uuid";
  if (type.includes("vector")) return "vector";
  if (type.includes("json")) return "json";
  if (type.includes("bytea") || type.includes("blob") || type.includes("binary") || type.includes("buffer")) return "binary";
  if (type.includes("bool")) return "boolean";
  if (type.includes("timestamp") || type.includes("datetime")) return "timestamp";
  if (type.includes("date")) return "date";
  if (type.includes("time")) return "time";
  if (type.includes("bigint") || type.includes("bigserial")) return "bigint";
  if (type.includes("int") || type.includes("serial")) return "integer";
  if (type.includes("numeric") || type.includes("decimal") || type.includes("money") || type.includes("real") || type.includes("double") || type.includes("float")) return "decimal";
  if (type.includes("char") || type.includes("text") || type.includes("clob")) return "text";
  if (dataType === "string") return "text";
  if (dataType === "number") return "decimal";
  if (dataType === "boolean") return "boolean";
  if (dataType === "date") return "timestamp";
  if (dataType === "json") return "json";
  if (dataType === "bigint") return "bigint";
  return "unknown";
}

/** Maps a live database type onto the same categories. Second argument carries the full column type when available. */
export function canonicalFromLive(dataType: string, columnType?: string): string {
  const type = (dataType || "").toLowerCase();
  const full = (columnType || "").toLowerCase();
  if (DIALECT === "postgresql") {
    if (type === "uuid") return "uuid";
    if (type === "vector") return "vector";
    if (type === "json" || type === "jsonb") return "json";
    if (type === "bytea") return "binary";
    if (type === "bool") return "boolean";
    if (type === "timestamptz" || type === "timestamp") return "timestamp";
    if (type === "date") return "date";
    if (type === "timetz" || type === "time") return "time";
    if (type === "int8" || type === "bigserial" || type === "serial8") return "bigint";
    if (type === "int2" || type === "int4" || type === "serial" || type === "serial4") return "integer";
    if (type === "numeric" || type === "money" || type === "float4" || type === "float8") return "decimal";
    if (type === "text" || type === "varchar" || type === "bpchar" || type === "char" || type === "citext" || type === "name") return "text";
    if (type.startsWith("_")) return "array";
    return "unknown";
  }
  if (DIALECT === "mysql") {
    if (type === "char" || type === "varchar" || type === "text" || type === "tinytext" || type === "mediumtext" || type === "longtext" || type === "enum" || type === "set") return "text";
    if (type === "tinyint" && full.startsWith("tinyint(1)")) return "boolean";
    if (type === "tinyint" || type === "smallint" || type === "mediumint" || type === "int" || type === "integer") return "integer";
    if (type === "bigint") return "bigint";
    if (type === "decimal" || type === "numeric" || type === "float" || type === "double" || type === "real") return "decimal";
    if (type === "datetime" || type === "timestamp") return "timestamp";
    if (type === "date") return "date";
    if (type === "time") return "time";
    if (type === "json") return "json";
    if (type === "binary" || type === "varbinary" || type === "blob" || type === "tinyblob" || type === "mediumblob" || type === "longblob") return "binary";
    return "unknown";
  }
  if (type === "") return "unknown";
  if (type.includes("int")) return "integer";
  if (type.includes("char") || type.includes("clob") || type.includes("text")) return "text";
  if (type.includes("blob")) return "binary";
  if (type.includes("bool")) return "boolean";
  if (type.includes("real") || type.includes("floa") || type.includes("doub") || type.includes("dec") || type.includes("num")) return "decimal";
  if (type.includes("date") || type.includes("time")) return "timestamp";
  return "unknown";
}

/** Only documented storage equivalences are tolerated; everything else is reported. */
function compatible(expected: string, found: string): boolean {
  if (expected === found) return true;
  if (DIALECT === "sqlite") {
    const affinity = (type: string) => type === "boolean" || type === "bigint" || type === "timestamp" || type === "date" || type === "time" ? "integer" : type === "json" ? "text" : type === "vector" ? "binary" : type;
    return affinity(expected) === affinity(found);
  }
  if (DIALECT === "mysql") return (expected === "boolean" && found === "integer") || (expected === "integer" && found === "boolean");
  return false;
}

export function compareSchema(expected: DriftTable[], live: DriftTable[]): DriftReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unverified: string[] = [];
  const liveByName = new Map(live.map((table) => [table.name, table]));
  for (const table of expected) {
    const actual = liveByName.get(table.name);
    if (!actual) { errors.push("missing table " + table.name); continue; }
    const actualColumns = new Map(actual.columns.map((column) => [column.name, column]));
    for (const column of table.columns) {
      const found = actualColumns.get(column.name);
      if (!found) { errors.push(table.name + "." + column.name + ": missing column"); continue; }
      actualColumns.delete(column.name);
      if (found.nullable !== column.nullable) errors.push(table.name + "." + column.name + ": expected " + (column.nullable ? "NULL" : "NOT NULL") + " but the database has " + (found.nullable ? "NULL" : "NOT NULL"));
      if (found.primary !== column.primary) errors.push(table.name + "." + column.name + ": " + (column.primary ? "expected a primary key column" : "column is not expected to be a primary key"));
      if (column.type === "unknown" || found.type === "unknown") unverified.push(table.name + "." + column.name + ": type not compared (" + column.type + " / " + found.type + ")");
      else if (!compatible(column.type, found.type)) errors.push(table.name + "." + column.name + ": expected " + column.type + " but the database has " + found.type);
    }
    for (const extra of actualColumns.values()) warnings.push(table.name + "." + extra.name + ": column exists in the database but not in the schema");
  }
  for (const table of live) if (!expected.some((item) => item.name === table.name)) warnings.push("unexpected table " + table.name);
  return { ok: errors.length === 0, errors, warnings, unverified };
}

export function expectedTables(): DriftTable[] {
  return (Object.values(schema) as unknown[]).filter(isTable).map((table) => {
    const config = getTableConfig(table as never) as unknown as {
      name: string;
      columns: Array<{ name: string; notNull: boolean; primary: boolean; dataType: string; columnType: string }>;
      primaryKeys?: Array<{ columns: Array<{ name: string }> }>;
    };
    // Composite primary keys (the generated code sequence table) are declared on
    // the table, not on each column, but every database reports all of their
    // columns as primary keys.
    const primaryColumns = new Set((config.primaryKeys ?? []).flatMap((key) => key.columns.map((column) => column.name)));
    return {
      name: config.name,
      columns: config.columns.map((column) => ({ name: column.name, nullable: !column.notNull, type: canonicalFromDrizzle(column.columnType ?? "", column.dataType ?? ""), primary: Boolean(column.primary) || primaryColumns.has(column.name) })),
    };
  });
}
${database.dialect === "postgresql" ? `
export async function introspect(): Promise<DriftTable[]> {
  const columns = await client.unsafe("select table_name, column_name, is_nullable, coalesce(udt_name, data_type) as type from information_schema.columns where table_schema = current_schema() and table_name <> '__drizzle_migrations' and table_name in (select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE')") as Array<{ table_name: string; column_name: string; is_nullable: string; type: string }>;
  const keys = await client.unsafe("select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = current_schema()") as Array<{ table_name: string; column_name: string }>;
  const primary = new Set(keys.map((row) => row.table_name + "." + row.column_name));
  const tables = new Map<string, DriftTable>();
  for (const row of columns) {
    const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [] };
    table.columns.push({ name: row.column_name, nullable: row.is_nullable === "YES", type: canonicalFromLive(row.type), primary: primary.has(row.table_name + "." + row.column_name) });
    tables.set(row.table_name, table);
  }
  return [...tables.values()];
}

export async function appliedMigrations(): Promise<number | null> {
  try {
    const rows = await client.unsafe("select count(*)::int as count from drizzle.__drizzle_migrations") as Array<{ count: number }>;
    return Number(rows[0]?.count ?? 0);
  } catch { return 0; }
}
` : database.dialect === "mysql" ? `
export async function introspect(): Promise<DriftTable[]> {
  // MySQL returns information_schema column names in uppercase, so every field is
  // aliased to an explicit lowercase name instead of relying on the driver keys.
  const [rows] = await client.query("select table_name as tbl, column_name as col, is_nullable as nullable, data_type as dtype, column_type as ctype, column_key as ckey from information_schema.columns where table_schema = database() and table_name <> '__drizzle_migrations' and table_name in (select table_name from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE')") as unknown as [Array<{ tbl: string; col: string; nullable: string; dtype: string; ctype: string; ckey: string }>, unknown];
  const tables = new Map<string, DriftTable>();
  for (const row of rows) {
    const table = tables.get(row.tbl) ?? { name: row.tbl, columns: [] };
    table.columns.push({ name: row.col, nullable: row.nullable === "YES", type: canonicalFromLive(row.dtype, row.ctype), primary: row.ckey === "PRI" });
    tables.set(row.tbl, table);
  }
  return [...tables.values()];
}

export async function appliedMigrations(): Promise<number | null> {
  try {
    const [rows] = await client.query("select count(*) as count from __drizzle_migrations") as unknown as [Array<{ count: number | string }>, unknown];
    return Number(rows[0]?.count ?? 0);
  } catch { return 0; }
}
` : `
export async function introspect(): Promise<DriftTable[]> {
  const names = client.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations'").all() as Array<{ name: string }>;
  const tables: DriftTable[] = [];
  for (const { name } of names) {
    const info = client.query("pragma table_info(" + JSON.stringify(name) + ")").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
    tables.push({ name, columns: info.map((column) => ({ name: column.name, nullable: column.notnull === 0, type: canonicalFromLive(column.type), primary: column.pk > 0 })) });
  }
  return tables;
}

export function appliedMigrations(): Promise<number | null> {
  try {
    const rows = client.query("select count(*) as count from __drizzle_migrations").all() as Array<{ count: number }>;
    return Promise.resolve(Number(rows[0]?.count ?? 0));
  } catch { return Promise.resolve(0); }
}
`}
`,
    "api/src/db-check.ts": `import { appliedMigrations, client, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

const expected = expectedTables();
const report = compareSchema(expected, await introspect());
const journalFile = Bun.file(new URL("../drizzle/meta/_journal.json", import.meta.url));
const journal = await journalFile.exists() ? (await journalFile.json() as { entries?: unknown[] }).entries?.length ?? 0 : 0;
const applied = await appliedMigrations();
if (applied !== null && applied < journal) report.errors.push("pending migrations: " + (journal - applied) + " of " + journal + " not applied");
if (applied !== null && applied > journal) report.warnings.push("database has " + applied + " applied migrations but this checkout only declares " + journal);
for (const error of report.errors) console.error("drift: " + error);
for (const warning of report.warnings) console.warn("warning: " + warning);
for (const item of report.unverified) console.log("unverified: " + item);
console.log("qiy db:check (" + DIALECT + ") checked " + expected.length + " tables, migrations applied " + (applied ?? "unknown") + "/" + journal + ", " + report.errors.length + " error(s), " + report.warnings.length + " warning(s)");
${database.dialect === "mysql" ? "await client.end();" : database.dialect === "sqlite" ? "client.close();" : ""}
process.exit(report.errors.length ? 1 : 0);
`,
    "api/tests/schema-drift.test.ts": `import { expect, test } from "bun:test";
import { canonicalFromDrizzle, canonicalFromLive, compareSchema, expectedTables, type DriftTable } from "../src/schema-drift";

test("treats the generated schema as its own expectation", () => {
  const expected = expectedTables();
  expect(expected.length).toBeGreaterThan(0);
  const live: DriftTable[] = expected.map((table) => ({ name: table.name, columns: table.columns.map((column) => ({ ...column })) }));
  expect(compareSchema(expected, live).errors).toEqual([]);
});

test("reports missing tables, missing columns, nullability, primary key and type drift", () => {
  const expected: DriftTable[] = [{ name: "orders", columns: [{ name: "id", nullable: false, type: "text", primary: true }, { name: "amount", nullable: true, type: "decimal", primary: false }] }];
  const live: DriftTable[] = [{ name: "orders", columns: [{ name: "id", nullable: true, type: "integer", primary: false }, { name: "extra", nullable: true, type: "text", primary: false }] }];
  const report = compareSchema(expected, live);
  expect(report.ok).toBe(false);
  expect(report.errors).toContain("orders.amount: missing column");
  expect(report.errors).toContain("orders.id: expected NOT NULL but the database has NULL");
  expect(report.errors).toContain("orders.id: expected a primary key column");
  expect(report.warnings).toContain("orders.extra: column exists in the database but not in the schema");
  expect(compareSchema(expected, []).errors).toContain("missing table orders");
  expect(compareSchema([], live).warnings).toContain("unexpected table orders");
});

test("does not report drift for documented storage equivalences or unknown types", () => {
  const equivalentPairs: Array<[string, string]> = ${JSON.stringify(database.dialect === "sqlite" ? [["boolean", "integer"], ["bigint", "integer"], ["timestamp", "integer"], ["date", "integer"], ["json", "text"], ["vector", "binary"]] : database.dialect === "mysql" ? [["boolean", "integer"], ["integer", "boolean"]] : [])};
  for (const [expectedType, foundType] of equivalentPairs) {
    const report = compareSchema([{ name: "t", columns: [{ name: "a", nullable: true, type: expectedType, primary: false }] }], [{ name: "t", columns: [{ name: "a", nullable: true, type: foundType, primary: false }] }]);
    expect(report.errors).toEqual([]);
  }
  const unknown = compareSchema([{ name: "t", columns: [{ name: "a", nullable: true, type: "unknown", primary: false }] }], [{ name: "t", columns: [{ name: "a", nullable: true, type: "text", primary: false }] }]);
  expect(unknown.errors).toEqual([]);
  expect(unknown.unverified).toHaveLength(1);
  expect(canonicalFromDrizzle("PgUUID", "string")).toBe("uuid");
  expect(canonicalFromDrizzle("SQLiteTimestamp", "date")).toBe("timestamp");
  expect(canonicalFromDrizzle("MySqlDecimal", "string")).toBe("decimal");
  expect(canonicalFromLive("nonsense")).toBe("unknown");
});
`,
    "api/src/backup-codec.ts": `/** Portable logical backup document written by db:backup and read by db:restore. */
export interface QiyBackupDocument {
  version: 1;
  dialect: string;
  createdAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/** Values that JSON cannot carry faithfully are tagged so restore can rebuild them. */
export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { $qiy: "date", value: value.toISOString() };
  if (value instanceof Uint8Array) return { $qiy: "bytes", value: Buffer.from(value).toString("base64") };
  if (typeof value === "bigint") return { $qiy: "bigint", value: value.toString() };
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeValue(item)]));
  return value;
}

export function decodeValue(value: unknown, dataType: string): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "$qiy" in (value as Record<string, unknown>)) {
    const tagged = value as { $qiy: string; value: string };
    if (tagged.$qiy === "date") return new Date(tagged.value);
    if (tagged.$qiy === "bytes") return Buffer.from(tagged.value, "base64");
    if (tagged.$qiy === "bigint") return BigInt(tagged.value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, dataType));
  // A driver that returns timestamps as strings still has to satisfy a date column.
  if (dataType === "date" && typeof value === "string") { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed; }
  return value;
}

export function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeValue(value)]));
}

export function decodeRow(row: Record<string, unknown>, columnTypes: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value, columnTypes[key] ?? "unknown")]));
}
`,
    "api/src/schema-tables.ts": `import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/${database.dialect === "postgresql" ? "pg-core" : database.dialect === "mysql" ? "mysql-core" : "sqlite-core"}";
import * as schema from "./schema";

export interface QiySchemaTable {
  name: string;
  table: unknown;
  columns: Array<{ name: string; dataType: string }>;
  /** The table objects this table references, used to order writes safely. */
  references: unknown[];
}

export function qiySchemaTables(): QiySchemaTable[] {
  return (Object.values(schema) as unknown[]).filter(isTable).map((table) => {
    const config = getTableConfig(table as never) as unknown as {
      name: string;
      columns: Array<{ name: string; dataType: string }>;
      foreignKeys: Array<{ reference: () => { foreignTable: unknown } }>;
    };
    // Foreign keys are matched by table identity, not by name: a dialect may
    // qualify or wrap names, and an identity match cannot silently miss.
    const references = config.foreignKeys.map((key) => key.reference().foreignTable).filter((referenced) => referenced !== table);
    return { name: config.name, table, columns: config.columns.map((column) => ({ name: column.name, dataType: column.dataType ?? "unknown" })), references };
  });
}

/**
 * Tables ordered so that a referenced table is written before the table that
 * references it. Cyclic references are reported instead of guessed.
 */
export function qiyWriteOrder(tables: QiySchemaTable[] = qiySchemaTables()): string[] {
  const ordered: string[] = [];
  const visiting = new Set<unknown>();
  const done = new Set<unknown>();
  const visit = (entry: QiySchemaTable, path: string[]): void => {
    if (done.has(entry.table)) return;
    if (visiting.has(entry.table)) throw new Error("Cyclic foreign keys are not supported by db:backup/db:restore: " + [...path, entry.name].join(" -> "));
    visiting.add(entry.table);
    for (const reference of entry.references) {
      const target = tables.find((candidate) => candidate.table === reference);
      if (target) visit(target, [...path, entry.name]);
    }
    visiting.delete(entry.table);
    done.add(entry.table);
    ordered.push(entry.name);
  };
  for (const table of tables) visit(table, []);
  return ordered;
}
`,
    "api/src/db-backup.ts": `import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { db${database.dialect === "postgresql" ? "" : ", client"} } from "./db";
import { encodeRow, type QiyBackupDocument } from "./backup-codec";
import { qiySchemaTables, qiyWriteOrder } from "./schema-tables";
import { DIALECT } from "./schema-drift";

const argument = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};
const retention = (() => {
  const raw = Bun.env.QIY_BACKUP_RETENTION;
  if (raw === undefined || raw === "") return 7;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error("QIY_BACKUP_RETENTION must be a non-negative integer");
  return value;
})();

const directory = resolve(import.meta.dir, "..", argument("--out-dir") ?? "backups");
await mkdir(directory, { recursive: true });
const tables = qiySchemaTables();
const order = qiyWriteOrder(tables);
const document: QiyBackupDocument = { version: 1, dialect: DIALECT, createdAt: new Date().toISOString(), tables: {} };
let total = 0;
for (const name of order) {
  const table = tables.find((candidate) => candidate.name === name)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await db.select().from(table.table as never) as Array<Record<string, unknown>>;
  document.tables[name] = rows.map((row) => encodeRow(row));
  total += rows.length;
  console.log("qiy db:backup: " + name + " " + rows.length + " row(s)");
}
const stamp = document.createdAt.replace(/[:.]/g, "-");
const file = resolve(directory, argument("--out") ?? ("qiy-" + stamp + ".json"));
await Bun.write(file, JSON.stringify(document));
console.log("qiy db:backup (" + DIALECT + "): wrote " + total + " row(s) from " + order.length + " table(s) to " + file);

let removed = 0;
if (retention > 0) {
  const entries = (await readdir(directory)).filter((name) => name.startsWith("qiy-") && name.endsWith(".json"));
  const sorted: Array<{ name: string; modified: number }> = [];
  for (const name of entries) sorted.push({ name, modified: (await stat(resolve(directory, name))).mtimeMs });
  sorted.sort((first, second) => second.modified - first.modified || second.name.localeCompare(first.name));
  for (const stale of sorted.slice(retention)) { await rm(resolve(directory, stale.name)); removed++; }
  if (removed) console.log("qiy db:backup: retention " + retention + " removed " + removed + " older backup(s)");
}
${database.dialect === "sqlite" ? "client.close();" : database.dialect === "mysql" ? "await client.end();" : ""}
process.exit(0);
`,
    "api/src/db-restore.ts": `import { resolve } from "node:path";
import { db${database.dialect === "postgresql" ? "" : ", client"} } from "./db";
import { decodeRow, type QiyBackupDocument } from "./backup-codec";
import { qiySchemaTables, qiyWriteOrder } from "./schema-tables";
import { DIALECT } from "./schema-drift";

const argument = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};
if (!Bun.argv.includes("--confirm")) {
  console.error("qiy db:restore replaces every row in this database. Re-run with --confirm to proceed.");
  process.exit(1);
}
const target = argument("--file");
if (!target) { console.error("qiy db:restore: --file <backup.json> is required"); process.exit(1); }
const source = Bun.file(resolve(target));
if (!await source.exists()) { console.error("qiy db:restore: backup file not found: " + resolve(target)); process.exit(1); }
const document = JSON.parse(await source.text()) as QiyBackupDocument;
if (document.version !== 1) { console.error("qiy db:restore: unsupported backup version " + String(document.version)); process.exit(1); }
if (document.dialect !== DIALECT) { console.error("qiy db:restore: backup was written for " + document.dialect + " but this project targets " + DIALECT); process.exit(1); }

const tables = qiySchemaTables();
const order = qiyWriteOrder(tables);
const known = new Set(order);
const missing = order.filter((name) => !(name in document.tables));
const unexpected = Object.keys(document.tables).filter((name) => !known.has(name));
if (missing.length || unexpected.length) {
  console.error("qiy db:restore: the backup does not match src/schema.ts" + (missing.length ? " (missing: " + missing.join(", ") + ")" : "") + (unexpected.length ? " (unknown: " + unexpected.join(", ") + ")" : ""));
  process.exit(1);
}

const rowsFor = (name: string): Array<Record<string, unknown>> => {
  const table = tables.find((candidate) => candidate.name === name)!;
  const types = Object.fromEntries(table.columns.map((column) => [column.name, column.dataType]));
  return (document.tables[name] ?? []).map((row) => decodeRow(row, types));
};

let total = 0;
${database.dialect === "sqlite" ? `db.transaction((tx) => {
  for (const name of [...order].reverse()) (tx.delete(tables.find((candidate) => candidate.name === name)!.table as never) as any).run();
  for (const name of order) {
    const rows = rowsFor(name);
    for (const values of rows) (tx.insert(tables.find((candidate) => candidate.name === name)!.table as never).values(values as never) as any).run();
    total += rows.length;
  }
});
` : `await db.transaction(async (tx) => {
  for (const name of [...order].reverse()) await (tx.delete(tables.find((candidate) => candidate.name === name)!.table as never) as any);
  for (const name of order) {
    const rows = rowsFor(name);
    for (const values of rows) await (tx.insert(tables.find((candidate) => candidate.name === name)!.table as never).values(values as never) as any);
    total += rows.length;
  }
});
`}console.log("qiy db:restore (" + DIALECT + "): restored " + total + " row(s) into " + order.length + " table(s) from " + resolve(target));
${database.dialect === "sqlite" ? "client.close();" : database.dialect === "mysql" ? "await client.end();" : ""}
process.exit(0);
`,
    "api/tests/backup-codec.test.ts": `import { expect, test } from "bun:test";
import { decodeRow, decodeValue, encodeRow, encodeValue } from "../src/backup-codec";

test("round-trips values that JSON cannot carry faithfully", () => {
  const when = new Date("2026-02-03T04:05:06.789Z");
  const bytes = new Uint8Array([0, 1, 250, 255]);
  expect(encodeValue(when)).toEqual({ $qiy: "date", value: "2026-02-03T04:05:06.789Z" });
  expect(decodeValue(encodeValue(when), "date")).toEqual(when);
  expect(encodeValue(bytes)).toEqual({ $qiy: "bytes", value: Buffer.from(bytes).toString("base64") });
  expect(Array.from(decodeValue(encodeValue(bytes), "buffer") as Uint8Array)).toEqual([0, 1, 250, 255]);
  expect(encodeValue(9007199254740993n)).toEqual({ $qiy: "bigint", value: "9007199254740993" });
  expect(decodeValue(encodeValue(9007199254740993n), "bigint")).toBe(9007199254740993n);
  expect(encodeValue(null)).toBeNull();
  expect(encodeValue(undefined)).toBeNull();
  expect(encodeValue("text")).toBe("text");
  expect(encodeValue(12.5)).toBe(12.5);
  expect(encodeValue({ nested: when })).toEqual({ nested: { $qiy: "date", value: "2026-02-03T04:05:06.789Z" } });
  for (const value of [when, bytes, 9007199254740993n, { nested: when }]) expect(() => JSON.stringify(encodeValue(value))).not.toThrow();
});

test("decodes rows using the declared column types", () => {
  const row = { id: "one", placedAt: { $qiy: "date", value: "2026-02-03T04:05:06.789Z" }, amount: "10.50", note: null };
  const decoded = decodeRow(row, { id: "string", placedAt: "date", amount: "string", note: "string" });
  expect(decoded.id).toBe("one");
  expect(decoded.placedAt).toEqual(new Date("2026-02-03T04:05:06.789Z"));
  expect(decoded.amount).toBe("10.50");
  expect(decoded.note).toBeNull();
  // A string timestamp for a date column is coerced, an unparsable one is kept as-is.
  expect(decodeValue("2026-02-03T04:05:06.789Z", "date")).toEqual(new Date("2026-02-03T04:05:06.789Z"));
  expect(decodeValue("not-a-date", "date")).toBe("not-a-date");
  expect(decodeRow(encodeRow({ when: new Date("2026-02-03T04:05:06.789Z") }), { when: "date" }).when).toEqual(new Date("2026-02-03T04:05:06.789Z"));
});
`,
    "api/src/db-migrate.ts": `import { migrate } from "drizzle-orm/${database.dialect === "postgresql" ? "bun-sql" : database.dialect === "mysql" ? "mysql2" : "bun-sqlite"}/migrator";
import { resolve } from "node:path";
import { db${database.dialect === "postgresql" ? "" : ", client"} } from "./db";
import { appliedMigrations, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");
${database.dialect === "postgresql" ? `// A dedicated single-connection session holds the advisory lock for the whole run.
const { SQL } = await import("bun");
const session = new SQL(Bun.env.DATABASE_URL!, { max: 1 });
const lockKey = 4815162342;
await session.unsafe("select pg_advisory_lock(" + lockKey + ")");
console.log("qiy db:migrate: acquired advisory lock " + lockKey);
${database.extensions.map((extension) => `// drizzle-kit migrations never create extensions, so declared ones are ensured before the first migration.
await session.unsafe(${JSON.stringify(`create extension if not exists "${extension === "pgvector" ? "vector" : extension}"`)});
`).join("")}` : database.dialect === "mysql" ? `// GET_LOCK is per session, so use one dedicated pooled connection.
const session = await client.getConnection();
const [lockRows] = await session.query("select get_lock('qiy_migrate', 60) as acquired") as unknown as [Array<{ acquired: number | null }>, unknown];
if (Number(lockRows[0]?.acquired ?? 0) !== 1) throw new Error("Could not acquire the qiy_migrate lock within 60s");
console.log("qiy db:migrate: acquired the qiy_migrate lock");
` : `// SQLite is a single-writer file database; concurrent migrations are documented as unsupported.
console.log("qiy db:migrate: SQLite has no cross-process lock; run migrations from one process");
`}const before = await appliedMigrations();
try {
  await migrate(db, { migrationsFolder });${database.dialect === "postgresql" && concurrentIndexStatements(database).length ? `
  // CONCURRENTLY cannot run in a transaction, so these indexes are built on the autocommit session. An interrupted
  // build leaves an INVALID index that IF NOT EXISTS would keep skipping, so it is dropped and rebuilt first.
  for (const index of ${JSON.stringify(concurrentIndexStatements(database), null, 2).replace(/\n/g, "\n  ")}) {
    const invalid = await session.unsafe("select 1 from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1 and not i.indisvalid", [index.name]) as unknown[];
    if (invalid.length) await session.unsafe("drop index concurrently if exists \\"" + index.name + "\\"");
    await session.unsafe(index.sql);
  }` : ""}
} finally {
${database.dialect === "postgresql" ? `  await session.unsafe("select pg_advisory_unlock(" + lockKey + ")");
  await session.close();
` : database.dialect === "mysql" ? `  await session.query("select release_lock('qiy_migrate')");
  session.release();
` : ""}}
const after = await appliedMigrations();
console.log("qiy db:migrate (" + DIALECT + "): applied " + (after === null ? "unknown" : after) + " migration(s), previously " + (before ?? "unknown"));

// Migrating is not the same as matching the code: verify the live structure now.
const report = compareSchema(expectedTables(), await introspect());
for (const error of report.errors) console.error("drift: " + error);
for (const warning of report.warnings) console.warn("warning: " + warning);
${database.dialect === "sqlite" ? "client.close();" : database.dialect === "mysql" ? "await client.end();" : ""}
if (report.errors.length) {
  console.error("qiy db:migrate (" + DIALECT + "): migrations ran but the database still does not match src/schema.ts");
  process.exit(1);
}
console.log("qiy db:migrate (" + DIALECT + "): database matches src/schema.ts");
process.exit(0);
`,
    "api/src/db-rollback.ts": `import { resolve } from "node:path";
import { appliedMigrations, client } from "./schema-drift";

// Rolling back is a reviewed operation: Qiy applies a reverse migration that a
// human wrote for a specific migration tag, then removes its bookkeeping row.
if (!Bun.argv.includes("--confirm")) {
  console.error("qiy db:rollback reverts the most recent applied migration. Re-run with --confirm to proceed.");
  process.exit(1);
}
const journalFile = Bun.file(new URL("../drizzle/meta/_journal.json", import.meta.url));
if (!await journalFile.exists()) { console.error("qiy db:rollback: drizzle/meta/_journal.json is missing; run db:generate first"); process.exit(1); }
const entries = (await journalFile.json() as { entries?: Array<{ tag?: string }> }).entries ?? [];
const applied = (await appliedMigrations()) ?? 0;
if (applied < 1) { console.error("qiy db:rollback: this database has no applied migration to revert"); process.exit(1); }
const last = entries[applied - 1];
if (!last?.tag) { console.error("qiy db:rollback: could not resolve the tag of applied migration " + applied + "; the journal and the database are out of sync"); process.exit(1); }
const reverseFile = resolve(import.meta.dir, "../drizzle/down/" + last.tag + ".sql");
const reverse = Bun.file(reverseFile);
if (!await reverse.exists()) {
  console.error("qiy db:rollback: no reviewed reverse migration for " + last.tag);
  console.error("Author " + reverseFile + " with the statements that undo that migration, review them, and run this command again.");
  process.exit(1);
}
const statements = (await reverse.text()).split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
if (!statements.length) { console.error("qiy db:rollback: " + reverseFile + " contains no statements"); process.exit(1); }
${database.dialect === "postgresql" ? `const { SQL } = await import("bun");
const session = new SQL(Bun.env.DATABASE_URL!, { max: 1 });
const run = (statement: string) => session.unsafe(statement);
const close = async () => { await session.close(); };
` : database.dialect === "mysql" ? `const session = await client.getConnection();
const run = (statement: string) => session.query(statement);
const close = async () => { session.release(); await client.end(); };
` : `const run = (statement: string) => { client.exec(statement); return Promise.resolve(); };
const close = async () => { client.close(); };
`}try {
  await run("BEGIN");
  for (const statement of statements) await run(statement);
  await run(${database.dialect === "postgresql" ? '"delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)"' : database.dialect === "mysql" ? '"delete from __drizzle_migrations order by id desc limit 1"' : '"delete from __drizzle_migrations where rowid = (select max(rowid) from __drizzle_migrations)"'});
  await run("COMMIT");
  console.log("qiy db:rollback: reverted " + last.tag + " and removed its migration record");
  console.log("qiy db:rollback: revert the matching change in src/schema.ts and any generated code, then re-run db:check");
} catch (error) {
  await run("ROLLBACK").catch(() => undefined);
  console.error("qiy db:rollback: rolled back the reverse migration because it failed");
  throw error;
} finally {
  await close();
}
`,
  };
}
