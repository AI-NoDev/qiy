import { resolve } from "node:path";
import { db, client } from "./db";
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
db.transaction((tx) => {
  for (const name of [...order].reverse()) (tx.delete(tables.find((candidate) => candidate.name === name)!.table as never) as any).run();
  for (const name of order) {
    const rows = rowsFor(name);
    for (const values of rows) (tx.insert(tables.find((candidate) => candidate.name === name)!.table as never).values(values as never) as any).run();
    total += rows.length;
  }
});
console.log("qiy db:restore (" + DIALECT + "): restored " + total + " row(s) into " + order.length + " table(s) from " + resolve(target));
client.close();
process.exit(0);
