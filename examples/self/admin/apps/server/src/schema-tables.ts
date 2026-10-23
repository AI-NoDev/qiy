import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
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
