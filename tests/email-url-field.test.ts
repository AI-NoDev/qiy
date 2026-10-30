import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const model = (dialect: string) => `qiy v0; application contact-demo {
  database ${dialect} {}
  entity contacts {
    field id UUID @id;
    field email Email;
    field website URL @nullable;
  }
}`;

test("Email/URL fields parse and generate text-backed columns", () => {
  const project = parseQiyProject(model("postgresql"));
  expect(project.database.entities[0]!.fields.map((field) => field.type)).toEqual(["UUID", "Email", "URL"]);
  const postgres = generateProject(project.database, "contact-demo");
  expect(postgres["apps/server/src/schema.ts"]).toContain('text("email")');
  expect(postgres["apps/server/src/schema.ts"]).toContain('text("website")');
  const sqlite = generateProject(parseQiyProject(model("sqlite")).database, "contact-demo");
  expect(sqlite["apps/server/src/schema.ts"]).toContain('text("email")');
});

test("Email/URL generate validation and matching form inputs", () => {
  const project = parseQiyProject(model("sqlite"));
  const files = generateProject(project.database, "contact-demo", project);
  const all = Object.values(files).filter((value): value is string => typeof value === "string").join("\n");
  expect(all).toContain('format: "email"');
  expect(all).toContain('format: "uri"');
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain('<Input type="email" />');
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain('<Input type="url" />');
});
