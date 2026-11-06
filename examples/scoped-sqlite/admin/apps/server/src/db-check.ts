import { appliedMigrations, client, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

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
client.close();
process.exit(report.errors.length ? 1 : 0);
