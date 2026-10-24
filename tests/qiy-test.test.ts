import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";
import { loadQiyTestSuite, parseQiyTestSuite, validateQiyTestSuite } from "../tools/qiy-test";

const projectSource = readFileSync(new URL("../examples/dataflow/call.qiy", import.meta.url), "utf8");
const suiteSource = readFileSync(new URL("../examples/dataflow/call.test.qiy", import.meta.url), "utf8");

test("side-effect assertions validate fixtures, declared events and contradictions", () => {
  const source = readFileSync(new URL("../examples/dataflow/side-effects.test.qiy", import.meta.url), "utf8");
  const model = readFileSync(new URL("../examples/dataflow/side-effects.qiy", import.meta.url), "utf8");
  for (const dialect of ["sqlite", "postgresql", "mysql"]) {
    const project = parseQiyProject(model.replace("database sqlite", `database ${dialect}`));
    const suite = parseQiyTestSuite(source);
    validateQiyTestSuite(suite, project);
    const generated = generateProject(project.database, project.name, { dataflows: project.dataflows, testSuite: suite })["apps/server/tests/qiy-scenarios.test.ts"]!;
    expect(generated).toContain(dialect === "sqlite" ? "COUNT(*) AS total" : "total: count()");
    expect(generated).toContain("toBe(false)");
    expect(generated).toContain("toBe(0)");
  }
  const project = parseQiyProject(model);
  for (const [before, after, error] of [
    ["exists review == false", "exists missing == false", "unknown expected fixture"],
    ['outbox "review.deleted" count == 1', 'outbox "missing" count == 1', "unknown outbox event"],
    ['count == 1', 'count == -1', "nonnegative integer"],
    ['count == 1', 'count == 1.5', "nonnegative integer"],
    ['expect exists review == false;', 'expect exists review == false; expect review.status == "pending";', "cannot have field expectations"],
    ['expect exists review == false;', 'expect exists review == false; expect exists review == true;', "duplicate existence"],
    ['expect outbox "review.deleted" count == 1;', 'expect outbox "review.deleted" count == 1; expect outbox "review.deleted" count == 0;', "duplicate outbox"],
  ]) expect(() => validateQiyTestSuite(parseQiyTestSuite(source.replace(before!, after!)), project)).toThrow(error!);
  expect(() => parseQiyTestSuite(source.replace("exists review == false", "exists review == 0"))).toThrow("must be boolean");
});

test("parses and generates executable given/when/expect qiy scenarios", () => {
  const project = parseQiyProject(projectSource);
  const suite = parseQiyTestSuite(suiteSource);
  validateQiyTestSuite(suite, project);
  expect(loadQiyTestSuite(fileURLToPath(new URL("../examples/dataflow/call.qiy", import.meta.url)), project)).toEqual(suite);
  expect(suite.scenarios[0]).toMatchObject({
    name: "approve-review",
    dataflow: "approveReview",
    expectedStatus: 200,
  });
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows, testSuite: suite });
  const generated = files["apps/server/tests/qiy-scenarios.test.ts"]!;
  expect(generated).toContain('describe("declarative qiy scenarios"');
  expect(generated).toContain('"Approved by operator"');
  expect(generated).toContain('expect(response.status).toBe(200)');
  expect(generated).toContain('AS value FROM \\\"reviews\\\"');
  expect(generated).toContain('dataflowCallHandlers["reviewPolicy"] = () => ({ ok: true })');
});

test("qiy scenarios reject unknown, incomplete and type-invalid fixtures", () => {
  const project = parseQiyProject(projectSource);
  const parsed = parseQiyTestSuite(suiteSource);
  expect(() => validateQiyTestSuite({ ...parsed, application: "other" }, project)).toThrow("does not match");
  expect(() => validateQiyTestSuite({ ...parsed, scenarios: [{ ...parsed.scenarios[0]!, dataflow: "missing" }] }, project)).toThrow("unknown dataflow");
  expect(() => validateQiyTestSuite({ ...parsed, scenarios: [{ ...parsed.scenarios[0]!, given: [{ ...parsed.scenarios[0]!.given[0]!, values: { id: "00000000-0000-4000-8000-000000000001", status: "pending" } }] }] }, project)).toThrow("requires reviews.note");
  expect(() => validateQiyTestSuite({ ...parsed, scenarios: [{ ...parsed.scenarios[0]!, input: { ...parsed.scenarios[0]!.input, reason: { kind: "literal", value: 1 } } }] }, project)).toThrow("invalid input");
});

test.each(["postgresql", "mysql"])("qiy scenarios generate a guarded Drizzle runner for %s", (dialect) => {
  const project = parseQiyProject(projectSource.replace("database sqlite", `database ${dialect}`));
  const suite = parseQiyTestSuite(suiteSource);
  validateQiyTestSuite(suite, project);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows, testSuite: suite });
  expect(files["apps/server/tests/qiy-scenarios.test.ts"]).toContain("QIY_TEST_DATABASE_URL");
  expect(files["apps/server/tests/qiy-scenarios.test.ts"]).toContain("await db.insert(schema.reviews)");
  expect(files["apps/server/tests/qiy-scenarios.test.ts"]).toContain("pointing to a dedicated qiy_test_* database");
});

test("release create/delete example ships executable declarative scenarios", () => {
  const project = parseQiyProject(readFileSync(new URL("../examples/dataflow/create-delete.qiy", import.meta.url), "utf8"));
  const suite = loadQiyTestSuite(fileURLToPath(new URL("../examples/dataflow/create-delete.qiy", import.meta.url)), project);
  expect(suite?.scenarios.map((scenario) => scenario.name)).toEqual(["create-user-command", "create-review-command"]);
  const generated = generateProject(project.database, project.name, { dataflows: project.dataflows, testSuite: suite });
  expect(generated["apps/server/tests/qiy-scenarios.test.ts"]).toContain("Created by declarative test");
});

test("server scenario cleanup follows foreign keys rather than declaration order", () => {
  const project = parseQiyProject(projectSource.replace("database sqlite", "database postgresql"));
  project.database.entities.push({ name: "owners", tableName: "owners", fields: [{ name: "id", type: "UUID", primaryKey: true }, { name: "name", type: "Text" }] });
  project.database.entities[0]!.fields.push({ name: "ownerId", type: "UUID", nullable: true });
  project.database.relations = [{ name: "reviewOwner", fromEntity: "reviews", fromField: "ownerId", toEntity: "owners", toField: "id", cardinality: "one" }];
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows, testSuite: parseQiyTestSuite(suiteSource) });
  const generated = files["apps/server/tests/qiy-scenarios.test.ts"]!;
  expect(generated.indexOf("await db.delete(schema.reviews)")).toBeLessThan(generated.indexOf("await db.delete(schema.owners)"));
});

test("identity scenarios generate anonymous, role and tenant decisions for every supported database", () => {
  const source = readFileSync(new URL("../examples/dataflow/identity.qiy", import.meta.url), "utf8");
  const suite = parseQiyTestSuite(readFileSync(new URL("../examples/dataflow/identity.test.qiy", import.meta.url), "utf8"));
  expect(suite.scenarios).toHaveLength(5);
  expect(suite.scenarios[1]?.identity).toEqual({ kind: "anonymous" });
  for (const dialect of ["sqlite", "postgresql", "mysql"]) {
    const project = parseQiyProject(source.replace("database sqlite", `database ${dialect}`));
    validateQiyTestSuite(suite, project);
    const generated = generateProject(project.database, project.name, { dataflows: project.dataflows, scopes: project.scopes, testSuite: suite })["apps/server/tests/qiy-scenarios.test.ts"]!;
    expect(generated).toContain('createDataflowRoutes(async () => (null))');
    expect(generated).toContain('"role":"viewer"');
    expect(generated).toContain('"claims":{"tenant.id":"tenant-a"}');
    expect(generated).toContain('expect(response.status).toBe(404)');
  }
});

test("identity fixtures reject invalid roles, references, duplicates and claim types", () => {
  const project = parseQiyProject(readFileSync(new URL("../examples/dataflow/identity.qiy", import.meta.url), "utf8"));
  const source = readFileSync(new URL("../examples/dataflow/identity.test.qiy", import.meta.url), "utf8");
  expect(() => parseQiyTestSuite(source.replace('role = "operator"', 'role = "owner"'))).toThrow("unknown identity role");
  expect(() => parseQiyTestSuite(source.replace('id = "operator-a";', 'id = "operator-a"; id = "duplicate";'))).toThrow("duplicate identity id");
  expect(() => parseQiyTestSuite(source.replace('"tenant.id" = review.tenantId;', '"tenant.id" = review.tenantId; "tenant.id" = "duplicate";'))).toThrow("duplicate identity claim");
  expect(() => parseQiyTestSuite(source.replace('"tenant.id" = review.tenantId;', '"__proto__" = "unsafe";'))).toThrow("invalid identity claim");
  expect(() => validateQiyTestSuite(parseQiyTestSuite(source.replace('id = "operator-a";', 'id = missing.id;')), project)).toThrow("unresolved reference");
  expect(() => validateQiyTestSuite(parseQiyTestSuite(source.replace('id = "operator-a";', 'id = "";')), project)).toThrow("identity id must be nonempty text");
  expect(() => validateQiyTestSuite(parseQiyTestSuite(source.replace('"tenant.id" = review.tenantId;', '"tenant.id" = 123;')), project)).toThrow("invalid value for scope claim");
  expect(() => parseQiyTestSuite(source.replace('role = "operator";', ''))).toThrow("identity requires id and role");
});

test("scenario fixtures validate Date and Time text contracts", () => {
  const model = projectSource.replace("field note Text;", "field note Text;\n    field dueDate Date;\n    field shiftStart Time;");
  const project = parseQiyProject(model);
  const valid = parseQiyTestSuite(suiteSource.replace('note = "Requires policy approval";', 'note = "Requires policy approval";\n    dueDate = "2026-11-30";\n    shiftStart = "08:30:00";'));
  validateQiyTestSuite(valid, project);
  const generated = generateProject(project.database, project.name, { dataflows: project.dataflows, testSuite: valid })["apps/server/tests/qiy-scenarios.test.ts"]!;
  expect(generated).toContain('"2026-11-30","08:30:00"');
  expect(() => validateQiyTestSuite(parseQiyTestSuite(suiteSource.replace('note = "Requires policy approval";', 'note = "Requires policy approval";\n    dueDate = "30-11-2026";')), project)).toThrow("invalid value for reviews.dueDate");
  expect(() => validateQiyTestSuite(parseQiyTestSuite(suiteSource.replace('note = "Requires policy approval";', 'note = "Requires policy approval";\n    dueDate = "2026-11-30";\n    shiftStart = "25:00";')), project)).toThrow("invalid value for reviews.shiftStart");
  expect(() => validateQiyTestSuite(parseQiyTestSuite(suiteSource.replace('note = "Requires policy approval";', 'note = "Requires policy approval";\n    dueDate = "2026-11-30";')), project)).toThrow("requires reviews.shiftStart");
});
