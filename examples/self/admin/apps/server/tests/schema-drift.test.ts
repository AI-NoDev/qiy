import { expect, test } from "bun:test";
import { canonicalFromDrizzle, canonicalFromLive, compareSchema, expectedTables, type DriftTable } from "../src/schema-drift";

test("treats the generated schema as its own expectation", () => {
  const expected = expectedTables();
  expect(expected.length).toBeGreaterThan(0);
  const live: DriftTable[] = expected.map((table) => ({ name: table.name, columns: table.columns.map((column) => ({ ...column })) }));
  expect(compareSchema(expected, live).errors).toEqual([]);
});

test("reports missing tables, missing columns, nullability, primary key and type drift", () => {
  const expected: DriftTable[] = [{ name: "orders", columns: [{ name: "id", nullable: false, type: "text", primary: true }, { name: "amount", nullable: true, type: "decimal", primary: false }] }];
  const live: DriftTable[] = [{ name: "orders", columns: [{ name: "id", nullable: true, type: "integer", primary: false }, { name: "extra", nullable: true, type: "text", primary: false }] }];
  const report = compareSchema(expected, live);
  expect(report.ok).toBe(false);
  expect(report.errors).toContain("orders.amount: missing column");
  expect(report.errors).toContain("orders.id: expected NOT NULL but the database has NULL");
  expect(report.errors).toContain("orders.id: expected a primary key column");
  expect(report.warnings).toContain("orders.extra: column exists in the database but not in the schema");
  expect(compareSchema(expected, []).errors).toContain("missing table orders");
  expect(compareSchema([], live).warnings).toContain("unexpected table orders");
});

test("does not report drift for documented storage equivalences or unknown types", () => {
  const equivalentPairs: Array<[string, string]> = [["boolean","integer"],["bigint","integer"],["timestamp","integer"],["date","integer"],["json","text"],["vector","binary"]];
  for (const [expectedType, foundType] of equivalentPairs) {
    const report = compareSchema([{ name: "t", columns: [{ name: "a", nullable: true, type: expectedType, primary: false }] }], [{ name: "t", columns: [{ name: "a", nullable: true, type: foundType, primary: false }] }]);
    expect(report.errors).toEqual([]);
  }
  const unknown = compareSchema([{ name: "t", columns: [{ name: "a", nullable: true, type: "unknown", primary: false }] }], [{ name: "t", columns: [{ name: "a", nullable: true, type: "text", primary: false }] }]);
  expect(unknown.errors).toEqual([]);
  expect(unknown.unverified).toHaveLength(1);
  expect(canonicalFromDrizzle("PgUUID", "string")).toBe("uuid");
  expect(canonicalFromDrizzle("SQLiteTimestamp", "date")).toBe("timestamp");
  expect(canonicalFromDrizzle("MySqlDecimal", "string")).toBe("decimal");
  expect(canonicalFromLive("nonsense")).toBe("unknown");
});
