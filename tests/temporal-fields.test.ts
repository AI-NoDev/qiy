import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { generateServer } from "../tools/generate-server";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

/**
 * Date and Time are scalar field types with a text storage contract:
 *   Date -> `YYYY-MM-DD`, Time -> `HH:mm:ss`, DateTime keeps ISO/timestamp.
 * These tests pin the parser round-trip, per-dialect Drizzle mapping, server
 * validation and the Ant Design picker/form wiring.
 */
const model = `qiy v0; application temporal-admin {
  database sqlite {}
  entity work_orders @label("Work orders") @display("{$.number}") {
    field id UUID @id;
    field number Text @unique;
    field dueDate Date;
    field shiftStart Time;
    field plannedAt DateTime;
  }
}`;

describe("Date and Time scalar fields", () => {
  test("parse, validate and serialize Date/Time field types", () => {
    const project = parseQiyProject(model);
    const fields = project.database.entities[0]!.fields;
    expect(fields.map((field) => [field.name, field.type])).toEqual([
      ["id", "UUID"],
      ["number", "Text"],
      ["dueDate", "Date"],
      ["shiftStart", "Time"],
      ["plannedAt", "DateTime"],
    ]);
    expect(parseQiyProject(serializeQiyProject(project)).database).toEqual(project.database);
    const unsupported = model.replace("field dueDate Date;", "field dueDate Moment;");
    expect(() => parseQiyProject(unsupported)).toThrow("Unsupported field type Moment");
  });

  test("maps Date and Time onto every dialect's text/date/time columns", () => {
    const project = parseQiyProject(model);
    const sqlite = generateServer(project.database)["api/src/schema.ts"] as string;
    expect(sqlite).toContain('"dueDate": text("dueDate").notNull()');
    expect(sqlite).toContain('"shiftStart": text("shiftStart").notNull()');
    const postgres = { ...structuredClone(project.database), dialect: "postgresql" as const };
    const pgSchema = generateServer(postgres)["api/src/schema.ts"] as string;
    expect(pgSchema).toContain('date("dueDate", { mode: "string" })');
    expect(pgSchema).toContain('time("shiftStart")');
    const mysql = { ...structuredClone(project.database), dialect: "mysql" as const };
    const mysqlSchema = generateServer(mysql)["api/src/schema.ts"] as string;
    expect(mysqlSchema).toContain('date("dueDate", { mode: "string" })');
    expect(mysqlSchema).toContain('time("shiftStart")');
  });

  test("generates explicit server validation with documented 400 responses", () => {
    const project = parseQiyProject(model);
    const files = generateServer(project.database);
    const temporal = files["api/src/temporal.ts"]!;
    expect(temporal).toContain("export class QiyTemporalValueError");
    expect(temporal).toContain("export function isValidDateValue");
    expect(temporal).toContain("export function normalizeTimeValue");
    expect(temporal).toContain("export function normalizeTemporalValues");
    const routes = files["api/src/modules/work_orders/work_orders.routes.ts"]!;
    expect(routes).toContain('import { QiyTemporalValueError } from "../../temporal";');
    expect(routes).toContain("error instanceof QiyTemporalValueError ? status(400, { error: error.message })");
    // TypeBox has no strict calendar/local-time format, so the body accepts a string
    // and the generated validator reports the clear 400 instead.
    expect(routes).toContain('"dueDate": t.String({ minLength: 1, maxLength: 40 })');
    expect(routes).toContain('"shiftStart": t.String({ minLength: 1, maxLength: 40 })');
    expect(routes).toContain("must be a YYYY-MM-DD date");
    expect(routes).toContain("must be a HH:mm:ss time");
    const service = files["api/src/modules/work_orders/work_orders.service.ts"]!;
    expect(service).toContain('import { normalizeTemporalValues } from "../../temporal";');
    expect(service).toContain('const temporalFields = {"dueDate":"Date","shiftStart":"Time"} as Record<string, "Date" | "Time">;');
    expect(service).toContain("normalizeTemporalValues(values, temporalFields)");
  });

  test("generates CRUD tests for valid, invalid and normalized Date/Time payloads", () => {
    const project = parseQiyProject(model);
    const generated = generateServer(project.database)["api/tests/work_orders.test.ts"]!;
    expect(generated).toContain('"dueDate": "2026-11-30"');
    expect(generated).toContain('"shiftStart": "08:30:00"');
    expect(generated).toContain('test("rejects an invalid Date value for dueDate"');
    expect(generated).toContain('test("rejects an invalid Time value for shiftStart"');
    expect(generated).toContain('test("normalizes a HH:mm Time value to HH:mm:ss"');
    expect(generated).toContain("expect(invalid.status).toBe(400)");
  });

  test("keeps GraphQL String scalars and reserves trend metrics for DateTime", () => {
    const project = parseQiyProject(model);
    const graphql = generateServer(project.database)["api/src/graphql.ts"]!;
    expect(graphql).toContain("dueDate: String!");
    expect(graphql).toContain("shiftStart: String!");
    // Only the DateTime field is a valid trend group-by.
    expect(graphql).toContain('["plannedAt"]');
    expect(graphql).not.toContain('["dueDate"]');
    const trendOnDate = () => generateWeb(project.database, {
      dashboardMetrics: [{ name: "dueTrend", resource: "work_orders", label: "Due", span: 8, type: "trend", groupBy: "dueDate", days: 30 }],
    });
    expect(trendOnDate).toThrow("trend requires a DateTime groupBy field");
  });

  test("wires Date/Time pickers, formatter and generated web tests", () => {
    const project = parseQiyProject(model);
    const files = generateWeb(project.database);
    expect(files["web/app/resources.ts"]).toContain('export type FieldType = "UUID" | "Text"');
    expect(files["web/app/resources.ts"]).toContain('"type": "Date"');
    expect(files["web/app/date-fields.ts"]).toContain("export function toFormValue");
    expect(files["web/app/date-fields.ts"]).toContain("export function toPayloadValue");
    expect(files["web/app/date-fields.ts"]).toContain("export function formatFieldValue");
    expect(files["web/app/components/date-field.tsx"]).toContain("DatePicker");
    expect(files["web/app/components/date-field.tsx"]).toContain("TimePicker");
    expect(files["web/app/components/date-field.tsx"]).toContain("showTime={type === \"DateTime\"");
    expect(files["web/app/components/resource-form.tsx"]).toContain("DateFieldInput");
    expect(files["web/app/components/resource-form.tsx"]).toContain('translate("qiy.pickDate"');
    // Lists, detail pages and display templates share the same formatter.
    expect(files["web/app/routes/list.tsx"]).toContain("formatFieldValue(field.type, value, locale)");
    expect(files["web/app/routes/list.tsx"]).toContain("<DateFieldInput type={field.type as DateFieldType}");
    expect(files["web/app/components/record-details.tsx"]).toContain("formatFieldValue(field.type, value, locale)");
    expect(files["web/app/components/relation-field.tsx"]).toContain("<RecordDetails resource={target} record={record} size=\"small\" />");
    expect(files["web/app/display-template.ts"]).toContain("formatFieldValue(field.type, value, options.locale)");
    expect(files["web/app/i18n.ts"]).toContain('pickDate: "选择日期"');
    expect(files["web/app/i18n.ts"]).toContain('pickDate: "Select date"');
    expect(files["web/tests/date-fields.test.ts"]).toContain("Date/Time/DateTime form contracts");
    expect(files["web/tests/chrome-i18n.test.ts"]).toContain('"qiy.pickDateTime"');
    expect(JSON.parse(files["web/package.json"]!).dependencies.dayjs).toBeDefined();
  });

  test("project generation shares the same server and web contracts", () => {
    const project = parseQiyProject(model);
    const files = generateProject(project.database, project.name);
    expect(files["apps/server/src/temporal.ts"]).toContain("normalizeTemporalValues");
    expect(files["apps/server/tests/work_orders.test.ts"]).toContain('test("rejects an invalid Date value for dueDate"');
    expect(files["apps/web/app/date-fields.ts"]).toContain("formatFieldValue");
    expect(files["apps/web/tests/date-fields.test.ts"]).toContain("toPayloadValue");
  });
});
