import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = (dialect = "sqlite") => `qiy v0; application view-demo {
  database ${dialect} {}
  entity products {
    field id UUID @id;
    field name Text;
    field price Integer;
  }
  view product_names from products {
    columns id, name;
  }
}`;

test("DB views parse, serialize and generate dialect view constructors", () => {
  const project = parseQiyProject(source());
  expect(project.database.views).toEqual([{ name: "product_names", from: "products", columns: ["id", "name"] }]);
  expect(serializeQiyProject(project)).toContain("view product_names from products");
  expect(serializeQiyProject(project)).toContain("columns id, name;");
  const sqlite = generateProject(project.database, "view-demo");
  expect(sqlite["apps/server/src/schema.ts"]).toContain('sqliteView("product_names")');
  expect(sqlite["apps/server/src/views-routes.ts"]).toContain('createViewRoutes');
  expect(sqlite["apps/server/src/views-routes.ts"]).toContain('/product_names');
  expect(sqlite["apps/server/src/graphql.ts"]).toContain("type product_names");
  expect(sqlite["apps/server/src/graphql.ts"]).toContain("product_names: async");
  const postgres = generateProject(parseQiyProject(source("postgresql")).database, "view-demo");
  expect(postgres["apps/server/src/schema.ts"]).toContain('pgView("product_names")');
  const mysql = generateProject(parseQiyProject(source("mysql")).database, "view-demo");
  expect(mysql["apps/server/src/schema.ts"]).toContain('mysqlView("product_names")');
});

test("DB views reject unknown tables, columns and computed fields", () => {
  expect(() => parseQiyProject(source().replace("from products", "from missing"))).toThrow("unknown source entity");
  expect(() => parseQiyProject(source().replace("columns id, name", "columns id, missing"))).toThrow("unknown column");
  expect(() => parseQiyProject(source().replace("field name Text", "field name Text @computed(\"{price}\")"))).toThrow("computed column name cannot be selected");
});
