import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import { client } from "./db";

export const DIALECT: string = "sqlite";
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
    const config = getTableConfig(table as never) as unknown as { name: string; columns: Array<{ name: string; notNull: boolean; primary: boolean; dataType: string; columnType: string }> };
    return {
      name: config.name,
      columns: config.columns.map((column) => ({ name: column.name, nullable: !column.notNull, type: canonicalFromDrizzle(column.columnType ?? "", column.dataType ?? ""), primary: Boolean(column.primary) })),
    };
  });
}

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

