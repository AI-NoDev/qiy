import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { db, client } from "./db";
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
client.close();
process.exit(0);
