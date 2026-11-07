/**
 * Generated SQLite runtime test for DB views: the readers in `views-routes.ts`
 * select the view's columns from the source table under its row rules.
 */
import { sqliteComputedColumnDdl } from "../computed-columns";
import { ruleSample } from "../field-rules";
import { viewSourceAccess, type AccessDatabase } from "../generate-view-routes";
import { dataflowFixtureValue } from "./dataflows";
import { restrictionFixture } from "./permissions";
import { sqliteColumnType, sqliteTestDefault } from "./sqlite-tests";

const recordId = (index: number) => `00000000-0000-4000-8000-00000000000${index}`;

/**
 * One visible and one hidden source row show that each reader applies the
 * source's soft delete, data scope and row policy, keeps to the view's columns
 * and pages in primary-key order. Views over tree scopes or policies a static
 * fixture cannot satisfy are skipped.
 */
export function renderSqliteViewTest(database: AccessDatabase, adminRole: string): string | undefined {
  if (database.dialect !== "sqlite") return undefined;
  const tests = (database.views ?? []).flatMap((view) => {
    const access = viewSourceAccess(database, view);
    const source = access.source;
    const fixture = restrictionFixture(database, database.restrictions ?? [], [source.name]);
    if (access.scope?.tree || !fixture) return [];
    const policyValues = fixture.values.get(source.name) ?? new Map<string, string>();
    const scopeField = source.fields.find((field) => field.name === access.scope?.field);
    const scopeValue = scopeField?.type === "UUID" ? "00000000-0000-4000-8000-0000000000a1" : "qiy-scope";
    const claimField = (database.restrictions ?? []).find((restriction) => restriction.resource === source.name)?.rows
      ?.find((row) => row.source === "claim" && row.operator === "==")?.field;
    const hiddenBy = access.softDeleteField ? "softDelete" : scopeField ? "scope" : claimField ? "policy" : undefined;
    const key = source.fields.find((field) => field.primaryKey)!;
    const row = (index: 1 | 2) => source.fields.filter((field) => field.computed === undefined).map((field) => {
      let value: string;
      if (field.primaryKey) value = JSON.stringify(recordId(index));
      else if (field.name === access.scope?.field) value = JSON.stringify(index === 2 && hiddenBy === "scope" ? `${scopeValue}-other` : scopeValue);
      else if (field.name === access.softDeleteField) value = index === 2 ? "new Date()" : "null";
      else if (index === 2 && hiddenBy === "policy" && field.name === claimField) value = JSON.stringify(field.type === "UUID" ? "00000000-0000-4000-8000-0000000000bb" : "qiy-other-claim");
      else if (policyValues.has(field.name)) value = policyValues.get(field.name)!;
      else if (field.nullable) value = "null";
      else {
        const sample = ruleSample(field);
        value = sample !== undefined ? JSON.stringify(sample) : dataflowFixtureValue(field, [], database.enums);
        if (field.unique && index === 2) value = field.type === "UUID" ? JSON.stringify("00000000-0000-4000-8000-0000000000c2") : field.type === "Integer" ? `${value} + 1` : `${value} + "-2"`;
      }
      return `${JSON.stringify(field.name)}: ${value}`;
    }).join(", ");
    const columns = source.fields.map((field) => field.computed !== undefined
      ? sqliteComputedColumnDdl(field, source)
      : `"${field.columnName ?? field.name}" ${sqliteColumnType(field)}${sqliteTestDefault(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
    const claims = { ...(access.scope ? { [access.scope.claim]: scopeValue } : {}), ...fixture.claims };
    const visibleIds = hiddenBy ? [recordId(1)] : [recordId(1), recordId(2)];
    const lines = [
      `  Bun.env.DATABASE_URL = ":memory:";`,
      `  const { client, db } = await import("../src/db");`,
      `  const { ${source.name} } = await import("../src/schema");`,
      `  const { viewReaders } = await import("../src/views-routes");`,
      `  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${source.tableName}"; CREATE TABLE "${source.tableName}" (${columns});`)});`,
      `  await db.insert(${source.name}).values([{ ${row(1)} }, { ${row(2)} }] as any);`,
      `  const principal = { id: "00000000-0000-4000-8000-000000000010", name: "View Test", role: ${JSON.stringify(adminRole)}, claims: ${JSON.stringify(claims)} } as any;`,
      `  const page = await viewReaders.${view.name}.list(principal, 1, 20);`,
      `  expect(page.total).toBe(${visibleIds.length});`,
      `  const columns = ${JSON.stringify(view.columns)};`,
      `  for (const record of page.data) expect(Object.keys(record).every((column) => columns.includes(column))).toBe(true);`,
      ...(view.columns.includes(key.name) ? [
        `  expect(page.data.map((record) => record.${key.name})).toEqual(${JSON.stringify(visibleIds)});`,
        `  expect(await viewReaders.${view.name}.one(principal, ${JSON.stringify(recordId(1))})).toBeDefined();`,
        `  expect(await viewReaders.${view.name}.one(principal, ${JSON.stringify(recordId(2))}))${hiddenBy ? ".toBeUndefined()" : ".toBeDefined()"};`,
      ] : [`  expect(page.data).toHaveLength(${visibleIds.length});`]),
      ...(access.scope ? [`  await expect(viewReaders.${view.name}.list({ ...principal, claims: {} }, 1, 20)).rejects.toMatchObject({ status: 403 });`] : []),
    ];
    return [`test(${JSON.stringify(`view ${view.name} reads ${source.tableName} under its row rules`)}, async () => {\n${lines.join("\n")}\n});`];
  });
  return tests.length ? `import { expect, test } from "bun:test";\n\n${tests.join("\n\n")}\n` : undefined;
}
