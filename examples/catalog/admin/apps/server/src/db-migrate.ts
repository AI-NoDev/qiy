import { migrate } from "drizzle-orm/bun-sql/migrator";
import { resolve } from "node:path";
import { db } from "./db";
import { appliedMigrations, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");
// A dedicated single-connection session holds the advisory lock for the whole run.
const { SQL } = await import("bun");
const session = new SQL(Bun.env.DATABASE_URL!, { max: 1 });
const lockKey = 4815162342;
await session.unsafe("select pg_advisory_lock(" + lockKey + ")");
console.log("qiy db:migrate: acquired advisory lock " + lockKey);
// drizzle-kit migrations never create extensions, so declared ones are ensured before the first migration.
await session.unsafe("create extension if not exists \"vector\"");
const before = await appliedMigrations();
try {
  await migrate(db, { migrationsFolder });
} finally {
  await session.unsafe("select pg_advisory_unlock(" + lockKey + ")");
  await session.close();
}
const after = await appliedMigrations();
console.log("qiy db:migrate (" + DIALECT + "): applied " + (after === null ? "unknown" : after) + " migration(s), previously " + (before ?? "unknown"));

// Migrating is not the same as matching the code: verify the live structure now.
const report = compareSchema(expectedTables(), await introspect());
for (const error of report.errors) console.error("drift: " + error);
for (const warning of report.warnings) console.warn("warning: " + warning);

if (report.errors.length) {
  console.error("qiy db:migrate (" + DIALECT + "): migrations ran but the database still does not match src/schema.ts");
  process.exit(1);
}
console.log("qiy db:migrate (" + DIALECT + "): database matches src/schema.ts");
process.exit(0);
