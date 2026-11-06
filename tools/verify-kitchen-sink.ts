import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dialect = process.argv[2];
const databaseUrl = process.argv[3];
if (dialect !== "postgresql" && dialect !== "mysql" && dialect !== "sqlite") throw new Error("Usage: bun tools/verify-kitchen-sink.ts <postgresql|mysql|sqlite> [database-url]");
if (dialect !== "sqlite" && !databaseUrl) throw new Error(`${dialect} needs a disposable database URL`);

const root = resolve(import.meta.dir, "..");
const output = mkdtempSync(join(tmpdir(), `qiy-kitchen-${dialect}-`));
const server = join(output, "apps/server");
const web = join(output, "apps/web");

/**
 * Migrations run against the given database, recreated empty. The generated
 * suite creates and drops its own tables, so it runs against a fresh
 * `<name>_test` database the way QIY_TEST_DATABASE_URL is documented:
 * dedicated and disposable.
 */
async function recreateDatabase(url: string, suffix = ""): Promise<string> {
  const target = new URL(url);
  const name = `${target.pathname.slice(1)}${suffix}`;
  if (!/^\w+$/.test(name)) throw new Error(`Unsupported database name in ${url}`);
  // A session cannot drop the database it is connected to, so administer from the server default.
  const adminUrl = new URL(url);
  adminUrl.pathname = dialect === "mysql" ? "/" : "/postgres";
  if (dialect === "mysql") {
    // Bun's MySQL client cannot complete caching_sha2_password without TLS; the generated app's mysql2 can.
    const mysql = createRequire(join(server, "package.json"))("mysql2/promise") as { createConnection(url: string): Promise<{ query(sql: string): Promise<unknown>; end(): Promise<void> }> };
    const admin = await mysql.createConnection(adminUrl.toString());
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.query(`CREATE DATABASE \`${name}\``);
    } finally {
      await admin.end();
    }
  } else {
    const admin = new Bun.SQL(adminUrl.toString());
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.unsafe(`CREATE DATABASE "${name}"`);
    } finally {
      await admin.close();
    }
  }
  target.pathname = `/${name}`;
  return target.toString();
}

/** Runs against the migrated database, so it covers the generated join tables in every dialect. */
const linksAcceptanceTest = `import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { announcementLabels } from "../src/schema";
import { QiyRelationLinkError } from "../src/relation-links";
import { AnnouncementsRepository as announcements } from "../src/modules/announcements/announcements.repository";
import { LabelsRepository as labels } from "../src/modules/labels/labels.repository";

const suffix = crypto.randomUUID().slice(0, 8);
// PostgreSQL stores audit actor ids as UUIDs.
const actor = crypto.randomUUID();

test("many-to-many links are validated, replaced, filtered and removed with either side", async () => {
  const first = await labels.create({ name: "first-" + suffix }, actor);
  const second = await labels.create({ name: "second-" + suffix }, actor);
  const firstId = String(first.id);
  const secondId = String(second.id);
  const created = await announcements.create({ title: "Linked", queue: "general", labelIds: [secondId, firstId, firstId] }, actor);
  const id = String(created.id);
  expect(created.labelIds).toEqual([firstId, secondId].sort());

  const replaced = await announcements.update(id, { labelIds: [secondId] }, actor);
  expect(replaced?.labelIds).toEqual([secondId]);
  expect(replaced?.revision).toBe(2);
  const filtered = await announcements.list(1, 20, { filters: [{ field: "labelIds", operator: "in", value: secondId }] });
  expect(filtered.data.map((record) => record.id)).toContain(id);
  const unmatched = await announcements.list(1, 20, { filters: [{ field: "labelIds", operator: "eq", value: firstId }] });
  expect(unmatched.data.map((record) => record.id)).not.toContain(id);

  const unknown = crypto.randomUUID();
  await expect(announcements.update(id, { title: "Rolled back", labelIds: [unknown] }, actor)).rejects.toBeInstanceOf(QiyRelationLinkError);
  const unchanged = await announcements.one(id);
  expect(unchanged?.title).toBe("Linked");
  expect(unchanged?.labelIds).toEqual([secondId]);

  await labels.delete(secondId, actor);
  expect((await announcements.one(id))?.labelIds).toEqual([]);
  await expect(announcements.update(id, { labelIds: [secondId] }, actor)).rejects.toBeInstanceOf(QiyRelationLinkError);

  expect((await announcements.update(id, { labelIds: [firstId] }, actor))?.labelIds).toEqual([firstId]);
  expect((await announcements.update(id, { labelIds: null }, actor))?.labelIds).toEqual([]);
  await announcements.update(id, { labelIds: [firstId] }, actor);
  await announcements.delete(id, actor);
  expect(await db.select().from(announcementLabels).where(eq(announcementLabels.sourceId, id))).toEqual([]);
});
`;

async function run(command: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<void> {
  console.log(`Kitchen-sink ${dialect}: ${command.slice(1).join(" ")} (${cwd})`);
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...extraEnv }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
}

await run([process.execPath, join(root, "tools/cli.ts"), "generate", join(root, `tests/fixtures/kitchen-sink/${dialect}.qiy`), output], root);
await run([process.execPath, "install"], output);
if (databaseUrl) await recreateDatabase(databaseUrl);
const testDatabaseUrl = databaseUrl ? await recreateDatabase(databaseUrl, "_test") : undefined;
// SQLite migrates a throwaway file so its generated migrations are exercised too.
const migratedUrl = databaseUrl ?? join(output, "kitchen.sqlite");
await run([process.execPath, "run", "--bun", "drizzle-kit", "generate"], server, { DATABASE_URL: migratedUrl });
await run([process.execPath, "src/db-migrate.ts"], server, { DATABASE_URL: migratedUrl });
await run([process.execPath, "run", "typecheck"], server);
await run([process.execPath, "run", "test", "--timeout", "30000"], server, testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl, QIY_TEST_DATABASE_URL: testDatabaseUrl } : {});
writeFileSync(join(server, "tests/links.acceptance.test.ts"), linksAcceptanceTest);
await run([process.execPath, "test", "--preload", "./tests/setup.ts", "--timeout", "30000", "tests/links.acceptance.test.ts"], server, { DATABASE_URL: migratedUrl, QIY_TEST_DATABASE_URL: migratedUrl });
await run([process.execPath, "run", "typecheck"], web);
await run([process.execPath, "run", "test"], web);
console.log(`Kitchen-sink ${dialect}: generate, install, migrate, typecheck, tests and many-to-many acceptance passed in ${output}`);
