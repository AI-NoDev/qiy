import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const model = (dialect: string) => `qiy v0; application array-demo {
  database ${dialect} {}
  entity items {
    field id UUID @id;
    field tags Text[];
    field scores Integer[] @nullable;
  }
}`;

test("Array fields parse and generate dialect-correct JSON columns", () => {
  const project = parseQiyProject(model("postgresql"));
  expect(project.database.entities[0]!.fields[1]).toMatchObject({ type: "Array", itemType: "Text" });
  const postgres = generateProject(project.database, "array-demo");
  expect(postgres["apps/server/src/schema.ts"]).toContain('jsonb("tags").$type<unknown[]>()');
  const sqlite = generateProject(parseQiyProject(model("sqlite")).database, "array-demo");
  expect(sqlite["apps/server/src/schema.ts"]).toContain('text("tags", { mode: "json" }).$type<unknown[]>()');
  const mysql = generateProject(parseQiyProject(model("mysql")).database, "array-demo");
  expect(mysql["apps/server/src/schema.ts"]).toContain('json("tags").$type<unknown[]>()');
});

test("Array fields generate REST/GraphQL types and tag inputs", () => {
  const project = parseQiyProject(model("sqlite"));
  const files = generateProject(project.database, "array-demo", project);
  const all = Object.values(files).filter((value): value is string => typeof value === "string").join("\n");
  expect(all).toContain("t.Array(t.String({ minLength: 1 }))");
  expect(all).toContain("t.Array(t.Integer())");
  expect(files["apps/server/src/graphql.ts"]).toContain("tags: [String!]!");
  expect(files["apps/server/src/graphql.ts"]).toContain("scores: [Int!]");
  expect(files["apps/web/app/resources.ts"]).toContain('"itemType": "Text"');
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("<Select mode=\"tags\"");
});

test("Array validation rejects non-scalar items", () => {
  expect(() => parseQiyProject(model("sqlite").replace("tags Text[]", "tags Decimal[]"))).toThrow("Array item type");
});
