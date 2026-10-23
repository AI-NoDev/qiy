import { resolve } from "node:path";
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
const run = (statement: string) => { client.exec(statement); return Promise.resolve(); };
const close = async () => { client.close(); };
try {
  await run("BEGIN");
  for (const statement of statements) await run(statement);
  await run("delete from __drizzle_migrations where rowid = (select max(rowid) from __drizzle_migrations)");
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
