/**
 * Generated SQLite tests that create their own in-memory tables: optimistic
 * locking, data scopes and the realtime outbox.
 */
import type { DatabaseIR, FieldIR } from "../database-ir";
import { sqliteComputedColumnDdl } from "../computed-columns";
import { sqliteLinkTestTables } from "../generate-relation-links";
import type { QiyProject } from "../qiy-project";
import { ruleSample } from "../field-rules";
import { modelName } from "./shared";

export function renderSqliteVersionTest(database: DatabaseIR): string | undefined {
  if (database.dialect !== "sqlite") return undefined;
  const entity = database.entities.find((item) => item.fields.some((field) => field.version));
  if (!entity) return undefined;
  const version = entity.fields.find((field) => field.version)!.name;
  const values = entity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable && !field.version && field.tenantClaim === undefined).map((field) => {
    const value = ruleSample(field) ?? (field.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : field.type === "Integer" ? 1 : field.type === "Boolean" ? true : field.type === "Decimal" || field.type === "Money" ? "1.00" : field.type === "Date" ? "2026-11-30" : field.type === "Time" ? "08:30:00" : field.enumName ? database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name : "Example");
    return `${JSON.stringify(field.name)}: ${field.type === "DateTime" ? 'new Date("2026-01-01T00:00:00.000Z")' : JSON.stringify(value)}`;
  }).join(", ");
  const columns = entity.fields.map((field) => field.computed !== undefined ? sqliteComputedColumnDdl(field, entity) : `"${field.columnName ?? field.name}" ${field.type === "Integer" || field.type === "DateTime" || field.type === "Boolean" ? "integer" : "text"}${field.primaryKey ? " primary key" : ""}${!field.nullable && !field.primaryKey ? " not null" : ""}`).join(", ");
  return `import { expect, test } from "bun:test";

test("SQLite rejects updates carrying a stale @version", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { QiyVersionConflict } = await import("../src/concurrency");
  const { ${modelName(entity)}Repository: repository } = await import("../src/modules/${entity.name}/${entity.name}.repository");
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS "audit_events"; DROP TABLE IF EXISTS "qiy_realtime_outbox"; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE "audit_events" ("id" text primary key, "actorId" text, "action" text not null, "resource" text not null, "resourceId" text, "metadata" text, "createdAt" integer not null); CREATE TABLE "qiy_realtime_outbox" ("id" text primary key, "channel" text not null, "type" text not null, "payload" text not null, "createdAt" integer not null);${sqliteLinkTestTables(entity, database)}`)});
  const created = await repository.create({ ${values} }, "actor");
  const id = String(created.id);
  expect(created.${version}).toBe(1);
  expect((await repository.update(id, { ${version}: 1 }, "actor"))?.${version}).toBe(2);
  await expect(repository.update(id, { ${version}: 1 }, "actor")).rejects.toBeInstanceOf(QiyVersionConflict);
  expect((await repository.one(id))?.${version}).toBe(2);
  expect((await repository.update(id, {}, "actor"))?.${version}).toBe(3);
  expect(await repository.update(crypto.randomUUID(), { ${version}: 3 }, "actor")).toBeUndefined();
});
`;
}

export function renderSqliteScopeTest(database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]>): string | undefined {
  if (database.dialect !== "sqlite" || !scopes.length) return undefined;
  const configured = scopes[0]!;
  const entity = database.entities.find((item) => item.name === configured.resource || item.tableName === configured.resource)!;
  // A @softDelete marker hides the row once written, so it cannot carry the date round-trip check.
  const dateField = entity.fields.find((field) => field.type === "DateTime" && !field.softDelete && field.computed === undefined)?.name;
  const fields = entity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable);
  const values = fields.map((field) => {
    const value = ruleSample(field) ?? (field.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : field.type === "Integer" ? 1 : field.type === "Decimal" || field.type === "Money" ? "1.00" : field.type === "Date" ? "2026-11-30" : field.type === "Time" ? "08:30:00" : field.enumName ? database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name : "Example");
    return `${JSON.stringify(field.name)}: ${field.type === "DateTime" ? 'new Date("2026-01-01T00:00:00.000Z")' : JSON.stringify(value)}`;
  }).join(", ");
  const columns = entity.fields.map((field) => field.computed !== undefined ? sqliteComputedColumnDdl(field, entity) : `"${field.columnName ?? field.name}" ${field.type === "Integer" || field.type === "DateTime" ? "integer" : "text"}${field.primaryKey ? " primary key" : ""}${!field.nullable && !field.primaryKey ? " not null" : ""}`).join(", ");
  const treeEntity = configured.tree ? database.entities.find((item) => item.name === configured.tree!.entity || item.tableName === configured.tree!.entity) : undefined;
  const treeColumn = (name: string) => treeEntity!.fields.find((field) => field.name === name)?.columnName ?? name;
  const treePrimaryKey = treeEntity?.fields.find((field) => field.primaryKey)?.name ?? "id";
  // Two unrelated roots keep each subtree equal to its own claim value.
  const treeSchema = treeEntity ? ` DROP TABLE IF EXISTS "${treeEntity.tableName}"; CREATE TABLE "${treeEntity.tableName}" ("${treeColumn(treePrimaryKey)}" text primary key, "${treeColumn(configured.tree!.parentField)}" text); INSERT INTO "${treeEntity.tableName}" ("${treeColumn(treePrimaryKey)}") VALUES ('tenant-a'), ('tenant-b');` : "";
  return `import { expect, test } from "bun:test";

test("SQLite enforces tenant scope on reads and writes", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { ${modelName(entity)}Repository: repository } = await import("../src/modules/${entity.name}/${entity.name}.repository");
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS "audit_events"; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE "audit_events" ("id" text primary key, "actorId" text, "action" text not null, "resource" text not null, "resourceId" text, "metadata" text, "createdAt" integer not null);${treeSchema}`)});
  const first = { field: ${JSON.stringify(configured.field)}, value: "tenant-a" };
  const second = { field: ${JSON.stringify(configured.field)}, value: "tenant-b" };
  const values = { ${values} };
  const owned = await repository.create({ ...values, ${JSON.stringify(configured.field)}: second.value }, "actor", first);
  const foreign = await repository.create(values, "actor", second);
  expect(owned[${JSON.stringify(configured.field)}]).toBe(first.value);
  expect((await repository.list(1, 20, { scope: first })).total).toBe(1);
  expect((await repository.list(1, 20, { scope: second })).total).toBe(1);
  expect(await repository.one(String(foreign.id), first)).toBeUndefined();
  expect(await repository.update(String(foreign.id), { ${JSON.stringify(configured.field)}: first.value }, "actor", first)).toBeUndefined();
  expect(await repository.delete(String(foreign.id), "actor", first)).toBeUndefined();
  expect(await repository.deleteMany([String(owned.id), String(foreign.id)], "actor", first)).toHaveLength(1);
  expect(await repository.one(String(foreign.id), second)).toBeDefined();
  const updated = await repository.update(String(foreign.id), { ${JSON.stringify(configured.field)}: first.value }, "actor", second);
  expect(updated?.[${JSON.stringify(configured.field)}]).toBe(second.value);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(4);
${dateField ? `  const { create${modelName(entity)}Service } = await import("../src/modules/${entity.name}/${entity.name}.service");
  const service = create${modelName(entity)}Service(repository);
  const dated = await service.create({ ...values, ${dateField}: "2026-01-01T00:00:00.000Z" }, "actor", first);
  expect(dated.${dateField}).toBeInstanceOf(Date);
  expect((dated.${dateField} as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  const changed = await service.update(String(dated.id), { ${dateField}: "2026-01-02T00:00:00.000Z" }, "actor", first);
  expect((changed?.${dateField} as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  expect((await repository.one(String(dated.id), first))?.${dateField}).toBeInstanceOf(Date);
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const onDay = (offset: number) => new Date(midnight + offset * 86400000 + 12 * 3600000);
  for (const [offset, tenant] of [[-1, first], [0, first], [0, first], [0, second], [-2, first], [1, first]] as const) {
    await repository.create({ ...values, ${dateField}: onDay(offset) }, "actor", tenant);
  }
  expect(await repository.trend("${dateField}", 2, first)).toEqual([
    { day: onDay(-1).toISOString().slice(0, 10), count: 1 },
    { day: onDay(0).toISOString().slice(0, 10), count: 2 },
  ]);
  expect(await repository.trend("${dateField}", 2, second)).toEqual([{ day: onDay(0).toISOString().slice(0, 10), count: 1 }]);
  await expect(repository.trend("${dateField}", 366, first)).rejects.toThrow("Invalid trend query");
` : ""}
});
`;
}

export function sqliteColumnType(field: FieldIR): string {
  switch (field.type) {
    case "Integer": return "integer";
    case "Decimal":
    case "Money": return "real";
    case "DateTime": return "integer";
    case "Vector": return "blob";
    default: return "text";
  }
}

/** Mirrors the Drizzle column default so test tables accept inserts that omit the column. */
export function sqliteTestDefault(field: FieldIR): string {
  if (field.version) return " default 1";
  const value = field.defaultValue;
  if (value?.kind !== "literal") return "";
  if (typeof value.value === "boolean") return value.value ? " default 1" : " default 0";
  return typeof value.value === "number" ? ` default ${value.value}` : ` default '${String(value.value).replaceAll("'", "''")}'`;
}

export function renderSqliteRealtimeOutboxTest(database: DatabaseIR, realtime: NonNullable<QiyProject["realtime"]>): string | undefined {
  if (database.dialect !== "sqlite") return undefined;
  const subscription = realtime.resources[0];
  const entity = database.entities.find((candidate) => candidate.name === subscription?.resource || candidate.tableName === subscription?.resource);
  if (!entity) return undefined;
  const columns = entity.fields.map((field) => field.computed !== undefined ? sqliteComputedColumnDdl(field, entity) : `${JSON.stringify(field.columnName ?? field.name)} ${sqliteColumnType(field)}${sqliteTestDefault(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
  const fixture = (variant: 1 | 2) => entity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable).map((field) => {
    const enumeration = database.enums?.find((item) => item.name === field.enumName);
    const value = enumeration ? JSON.stringify(enumeration.values[Math.min(variant - 1, enumeration.values.length - 1)]!.name)
      : field.type === "UUID" ? JSON.stringify(`00000000-0000-4000-8000-00000000000${variant}`)
        : field.type === "Integer" ? String(variant)
          : field.type === "Decimal" || field.type === "Money" ? String(variant)
            : field.type === "DateTime" ? `new Date(${variant})`
              : field.type === "Date" ? JSON.stringify(`2026-11-${String(27 + variant).padStart(2, "0")}`)
                : field.type === "Time" ? JSON.stringify(`0${variant}:30:00`)
                  : JSON.stringify(`Realtime fixture ${variant}`);
    return `${JSON.stringify(field.name)}: ${value}`;
  }).join(", ");
  const repositoryName = `${modelName(entity)}Repository`;
  return `import { expect, test } from "bun:test";
import { client } from "../src/db";
import { ${repositoryName} } from "../src/modules/${entity.name}/${entity.name}.repository";

test("commits CRUD records and realtime outbox rows atomically", async () => {
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS audit_events; DROP TABLE IF EXISTS qiy_realtime_outbox; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null); CREATE TABLE qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, createdAt integer not null);${sqliteLinkTestTables(entity, database)}`)});
  const first = await ${repositoryName}.create({ ${fixture(1)} }, "actor-1");
  expect(first.id).toBeTruthy();
  expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
  expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox").get()).toEqual({ channel: ${subscription?.claim ? `${JSON.stringify(`qiy:${entity.tableName}:`)} + String((first as Record<string, unknown>)[${JSON.stringify(subscription.claim.field)}])` : JSON.stringify(`qiy:${entity.tableName}`)}, type: "created" });
  client.exec("DROP TABLE qiy_realtime_outbox");
  await expect(${repositoryName}.create({ ${fixture(2)} }, "actor-2")).rejects.toThrow();
  expect(client.query<{ total: number }, []>(${JSON.stringify(`select count(*) as total from "${entity.tableName}"`)}).get()?.total).toBe(1);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(1);
});
`;
}
