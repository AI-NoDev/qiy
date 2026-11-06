import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { resolve } from "node:path";
import { db, client } from "./db";
import { appliedMigrations, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");
// SQLite is a single-writer file database; concurrent migrations are documented as unsupported.
console.log("qiy db:migrate: SQLite has no cross-process lock; run migrations from one process");
const before = await appliedMigrations();
try {
  await migrate(db, { migrationsFolder });
} finally {
}
const after = await appliedMigrations();
console.log("qiy db:migrate (" + DIALECT + "): applied " + (after === null ? "unknown" : after) + " migration(s), previously " + (before ?? "unknown"));

// Migrating is not the same as matching the code: verify the live structure now.
const report = compareSchema(expectedTables(), await introspect());
for (const error of report.errors) console.error("drift: " + error);
for (const warning of report.warnings) console.warn("warning: " + warning);
client.close();
if (report.errors.length) {
  console.error("qiy db:migrate (" + DIALECT + "): migrations ran but the database still does not match src/schema.ts");
  process.exit(1);
}
console.log("qiy db:migrate (" + DIALECT + "): database matches src/schema.ts");
process.exit(0);
