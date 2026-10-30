import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const model = (dialect: string) => `qiy v0; application json-demo {
  database ${dialect} {}
  entity documents {
    field id UUID @id;
    field title Text;
    field payload JSON;
    field metadata JSON @nullable;
  }
}`;

test("JSON fields parse and generate dialect-correct columns", () => {
  const project = parseQiyProject(model("postgresql"));
  expect(project.database.entities[0]!.fields.map((field) => field.type)).toEqual(["UUID", "Text", "JSON", "JSON"]);
  const postgres = generateProject(project.database, "json-demo");
  expect(postgres["apps/server/src/schema.ts"]).toContain('jsonb("payload")');
  const sqlite = generateProject(parseQiyProject(model("sqlite")).database, "json-demo");
  expect(sqlite["apps/server/src/schema.ts"]).toContain('text("payload", { mode: "json" })');
  const mysql = generateProject(parseQiyProject(model("mysql")).database, "json-demo");
  expect(mysql["apps/server/src/schema.ts"]).toContain('json("payload")');
});

test("JSON fields generate Any validation, GraphQL JSON and a textarea form", () => {
  const project = parseQiyProject(model("sqlite"));
  const files = generateProject(project.database, "json-demo", project);
  const all = Object.values(files).filter((value): value is string => typeof value === "string").join("\n");
  expect(all).toContain("t.Any()");
  expect(files["apps/server/src/graphql.ts"]).toContain("payload: JSON!");
  expect(files["apps/server/src/graphql.ts"]).toContain("scalar JSON");
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("<Input.TextArea rows={4} />");
});
