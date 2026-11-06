import { describe, expect, test } from "bun:test";
import { renderFieldRulesModule, ruleSample, ruleViolations } from "../tools/field-rules";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = (fields: string, dialect = "sqlite") => `qiy v0; application rules {
  database ${dialect} {}
  enum stage {
    value draft label "Draft";
    value live label "Live";
  }
  entity items {
    field id UUID @id;
${fields}
  }
}`;

const declared = `    field title Text @length(3, 80);
    field note Text @nullable @length(200);
    field sku Text @pattern("^[A-Z]{3}-\\\\d{3}$", "ABC-123");
    field quantity Integer @min(0) @max(500) @default(1);
    field price Money(10, 2) @min(0.01) @default(9.90);
    field ratio Decimal(5, 3) @min(-1.5) @max(1.5);
    field contact Email @nullable @length(6, 120);
    field active Boolean @default(true);
    field stage stage @default(draft);
    field opened Date @default("2026-01-01");
    field slot Time @default("09:00:00");
    field queue Text @default("general");
    field createdAt DateTime @default(now);`;

const generate = (fields: string, dialect = "sqlite") => {
  const project = parseQiyProject(source(fields, dialect));
  return generateProject(project.database, project.name);
};

describe("field value rules and defaults", () => {
  test("parses every rule and default and round-trips through the serializer", () => {
    const project = parseQiyProject(source(declared));
    const field = (name: string) => project.database.entities[0]!.fields.find((item) => item.name === name)!;
    expect(field("title")).toMatchObject({ minLength: 3, maxLength: 80 });
    expect(field("note")).toMatchObject({ maxLength: 200 });
    expect(field("note").minLength).toBeUndefined();
    expect(field("sku").pattern).toEqual({ source: "^[A-Z]{3}-\\d{3}$", example: "ABC-123" });
    expect(field("quantity")).toMatchObject({ min: 0, max: 500, defaultValue: { kind: "literal", value: 1 } });
    expect(field("price")).toMatchObject({ min: 0.01, defaultValue: { kind: "literal", value: "9.90" } });
    expect(field("ratio")).toMatchObject({ min: -1.5, max: 1.5 });
    expect(field("active").defaultValue).toEqual({ kind: "literal", value: true });
    expect(field("stage").defaultValue).toEqual({ kind: "literal", value: "draft" });
    expect(field("createdAt").defaultValue).toEqual({ kind: "now" });
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  });

  test("renders column defaults for every dialect", () => {
    const sqlite = generate(declared)["apps/server/src/schema.ts"]!;
    expect(sqlite).toContain('"quantity": integer("quantity").notNull().default(1)');
    expect(sqlite).toContain('"price": real("price").notNull().default(9.9)');
    expect(sqlite).toContain('"active": integer("active", { mode: "boolean" }).notNull().default(true)');
    expect(sqlite).toContain('"stage": text("stage").notNull().default("draft")');
    expect(sqlite).toContain('"createdAt": integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date())');
    const postgres = generate(declared, "postgresql")["apps/server/src/schema.ts"]!;
    expect(postgres).toContain('numeric("price", { precision: 10, scale: 2 }).notNull().default("9.90")');
    expect(postgres).toContain('"createdAt": timestamp("createdAt", { withTimezone: true }).notNull().defaultNow()');
    expect(postgres).toContain('"slot": time("slot").notNull().default("09:00:00")');
    const mysql = generate(declared, "mysql")["apps/server/src/schema.ts"]!;
    // MySQL TEXT columns cannot have literal defaults, so Drizzle fills them on insert.
    expect(mysql).toContain('"queue": text("queue").notNull().$defaultFn(() => "general")');
    expect(mysql).toContain('"opened": date("opened", { mode: "string" }).notNull().default("2026-01-01")');
  });

  test("enforces rules in the service for REST, GraphQL and imports, and relaxes defaulted create inputs", () => {
    const files = generate(declared);
    const module = files["apps/server/src/field-rules.ts"];
    expect(module).toBe(renderFieldRulesModule());
    const service = files["apps/server/src/modules/items/items.service.ts"]!;
    expect(service).toContain('import { checkFieldRules, type QiyFieldRules } from "../../field-rules";');
    expect(service).toContain('"quantity":{"min":0,"max":500}');
    expect(service).toContain("qiyCheckFieldRules(values)");
    const routes = files["apps/server/src/modules/items/items.routes.ts"]!;
    expect(routes).toContain("error instanceof QiyFieldRuleError ? status(400, { error: error.message, errorKey: error.errorKey, field: error.field })");
    expect(routes).toContain('"quantity": t.Optional(t.Integer())');
    expect(routes).toContain('"title": t.String({ minLength: 1 })');
    expect(routes).toContain("importDefaulted.has(field) ? undefined : null");
    const graphql = files["apps/server/src/graphql.ts"]!;
    expect(graphql).toMatch(/input ItemsCreateInput \{[^}]*title: String!\\n[^}]*quantity: Int\\n/);
    const routeTest = files["apps/server/tests/items.test.ts"]!;
    for (const rule of ["minLength", "maxLength", "pattern", "min", "max"]) expect(routeTest).toContain(`"validation.${rule}"`);
    expect(routeTest).toContain('"sku": "ABC-123"');
  });

  test("ships the rules and defaults to the generated form", () => {
    const resources = generate(declared)["apps/web/app/resources.ts"]!;
    expect(resources).toContain('"rules": {\n          "pattern": "^[A-Z]{3}-\\\\d{3}$",\n          "example": "ABC-123"\n        }');
    expect(resources).toContain('"defaultValue": 1');
    expect(resources).toContain('"defaultValue": "draft"');
    // `now` is filled by the server, so the form does not pre-fill it but still treats it as optional on create.
    expect(resources).not.toContain('"defaultValue": "now"');
    expect(resources).toMatch(/"name": "createdAt",[^}]*"defaulted": true/);
    // A required column with a default can be hidden from the create form.
    expect(() => generate("    field queue Text @default(\"general\") @formVisible(false);")).not.toThrow();
    expect(() => generate("    field queue Text @formVisible(false);")).toThrow("required field cannot be hidden from the create form");
  });

  test("samples and violations respect every declared bound", () => {
    const project = parseQiyProject(source(declared));
    const field = (name: string) => project.database.entities[0]!.fields.find((item) => item.name === name)!;
    expect(ruleSample(field("title"))).toBe("Example");
    expect(ruleSample(field("sku"))).toBe("ABC-123");
    expect(ruleSample(field("price"))).toBe("1.00");
    expect(ruleSample(field("contact"))).toBe("user@example.com");
    expect(ruleSample(field("active"))).toBeUndefined();
    expect(ruleViolations(field("quantity"))).toEqual([{ rule: "min", value: -1 }, { rule: "max", value: 501 }]);
    expect(ruleViolations(field("price"))).toEqual([{ rule: "min", value: "0.00" }]);
    // "a@b.co" is already 6 characters, so an Email cannot be too short for @length(6, ...) without breaking its format.
    expect(ruleViolations(field("contact"))).toEqual([{ rule: "maxLength", value: "user@example.com" + "x".repeat(105) }]);
    const short = parseQiyProject(source("    field code Text @length(2, 4);")).database.entities[0]!.fields[1]!;
    expect(ruleSample(short)).toBe("Exam");
    const long = parseQiyProject(source("    field code Text @length(10, 40);")).database.entities[0]!.fields[1]!;
    expect(ruleSample(long)).toBe("Examplexxx");
  });

  test("rejects invalid rules and defaults with field-level messages", () => {
    const rejects = (fields: string, message: string) => expect(() => generate(fields)).toThrow(message);
    rejects("    field title Text @min(1);", "@min/@max require an Integer, Decimal or Money field");
    rejects("    field count Integer @min(1.5);", "@min must be an integer on Integer fields");
    rejects("    field price Money(10, 2) @min(0.001);", "more decimal places than the field scale 2");
    rejects("    field count Integer @min(5) @max(1);", "@min cannot be greater than @max");
    rejects("    field count Integer @length(5);", "@length requires a Text, Email or URL field");
    rejects("    field title Text @length(9, 3);", "@length minimum cannot be greater than the maximum");
    rejects("    field contact Email @length(4);", "@length maximum must be at least 6 for Email fields");
    rejects('    field code Text @pattern("[", "x");', "@pattern is not a valid regular expression");
    rejects('    field code Text @pattern("^[a-z]+$", "ABC");', '@pattern example "ABC" must match');
    rejects('    field code Text @pattern("^[a-z]+$", "abcdef") @length(3);', '@pattern example "abcdef" must be at most 3 characters');
    rejects("    field state stage @length(3);", "@length requires a Text, Email or URL field without an enum");
    rejects("    field count Integer @default(\"x\");", '@default "x" does not match the Integer field type');
    rejects("    field count Integer @min(1) @default(0);", "@default 0 must be at least 1");
    rejects("    field state stage @default(archived);", "@default must be one of the stage values: draft, live");
    rejects("    field opened Date @default(now);", "@default(now) requires a DateTime field");
    rejects('    field opened DateTime @default("2026-01-01T00:00:00Z");', "@default on DateTime fields only supports now");
    rejects("    field data JSON @default(\"{}\");", "@default is not supported on JSON fields");
    rejects('    field code Text @code("C-{seq}") @default("x");', "@default cannot be declared on primary keys");
    expect(() => parseQiyProject(source('    field code Text @pattern("^a$");'))).toThrow("@pattern requires an example value");
    expect(() => parseQiyProject(source("    field count Integer @min(1) @min(2);"))).toThrow("duplicate @min annotation");
  });
});
