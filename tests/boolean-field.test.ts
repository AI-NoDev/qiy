import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const model = (dialect: string) => `qiy v0; application boolean-demo {
  database ${dialect} {}
  entity flags {
    field id UUID @id;
    field label Text;
    field enabled Boolean;
    field archived Boolean @nullable;
  }
}`;

test("Boolean fields parse and generate dialect-correct columns", () => {
  expect(parseQiyProject(model("sqlite")).database.entities[0]!.fields.map((field) => field.type)).toContain("Boolean");
  const sqlite = generateProject(parseQiyProject(model("sqlite")).database, "boolean-demo");
  expect(sqlite["apps/server/src/schema.ts"]).toContain('integer("enabled", { mode: "boolean" })');
  expect(Object.values(sqlite).filter((value): value is string => typeof value === "string").join("\n")).toContain("t.Boolean()");
  const postgres = generateProject(parseQiyProject(model("postgresql")).database, "boolean-demo");
  expect(postgres["apps/server/src/schema.ts"]).toContain('boolean("enabled")');
  const mysql = generateProject(parseQiyProject(model("mysql")).database, "boolean-demo");
  expect(mysql["apps/server/src/schema.ts"]).toContain('boolean("enabled")');
});

test("Boolean fields generate GraphQL types and a Switch form input", () => {
  const project = parseQiyProject(model("sqlite"));
  const files = generateProject(project.database, "boolean-demo", project);
  expect(files["apps/server/src/graphql.ts"]).toContain("enabled: Boolean!");
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("<Switch />");
  expect(files["apps/web/app/resources.ts"]).toContain('"type": "Boolean"');
});
