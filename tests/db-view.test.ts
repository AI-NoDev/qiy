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
  expect(sqlite["apps/web/app/resources.ts"]).toContain('"product_names"');
  expect(sqlite["apps/web/app/resources.ts"]).toContain('"readOnly": true');
  expect(sqlite["apps/web/app/resources.ts"]).toContain('"hasDetail": true');
  expect(sqlite["apps/web/app/root.tsx"]).toContain("resource.hasDetail");
  const postgres = generateProject(parseQiyProject(source("postgresql")).database, "view-demo");
  expect(postgres["apps/server/src/schema.ts"]).toContain('pgView("product_names")');
  expect(postgres["apps/server/src/schema-drift.ts"]).toContain("table_type = 'BASE TABLE'");
  const mysql = generateProject(parseQiyProject(source("mysql")).database, "view-demo");
  expect(mysql["apps/server/src/schema.ts"]).toContain('mysqlView("product_names")');
  expect(mysql["apps/server/src/schema-drift.ts"]).toContain("table_type = 'BASE TABLE'");
});

const guardedSource = `qiy v0; application view-demo {
  database sqlite {}
  auth {
    provider local;
    user users;
    roleField role;
    usernameField email;
    passwordField password;
  }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field password Text @nullable;
    field role userRole;
    field tenantId UUID;
  }
  entity products {
    field id UUID @id;
    field name Text;
    field secret Text @nullable;
    field tenantId UUID @tenant;
    field deletedAt DateTime @nullable @softDelete;
  }
  view product_names from products {
    columns id, name, secret;
  }
  restrict products {
    mask secret roles viewer mode omit;
  }
}`;

test("DB views inherit the source soft delete, tenant scope and row policy in REST and GraphQL", () => {
  const project = parseQiyProject(guardedSource);
  const files = generateProject(project.database, "view-demo", project);
  const routes = files["apps/server/src/views-routes.ts"]!;
  expect(routes).toContain("inArray(product_names.id, db.select({ id: products.id }).from(products).where(and(isNull(products.deletedAt)");
  expect(routes).toContain('principal?.claims?.["tenantId"]');
  expect(routes).toContain('resolvePolicy("products", principal');
  expect(routes).toContain("policy.usesScope ? [] : [eq(products.tenantId, scope.value)]");
  expect(routes).toContain("data.map(access.mask)");
  expect(routes).toContain("and(eq(product_names.id, params.id), access.condition)");
  const graphql = files["apps/server/src/graphql.ts"]!;
  expect(graphql).toContain('import { viewAccess } from "./views-routes"');
  expect(graphql).toContain("await viewAccess.product_names(viewContext?.principal ?? null)");
  expect(graphql).toContain("contextValue: { request, principal,");
});

test("DB views without row rules keep an unfiltered query", () => {
  const routes = generateProject(parseQiyProject(source()).database, "view-demo")["apps/server/src/views-routes.ts"]!;
  expect(routes).toContain("product_names: async (_principal: Principal | null) => ({ condition: undefined");
  expect(routes).not.toContain("resolvePolicy");
});

test("DB views over guarded sources must select id", () => {
  const project = parseQiyProject(guardedSource.replace("columns id, name, secret;", "columns name;"));
  expect(() => generateProject(project.database, "view-demo", project)).toThrow("view product_names: source products has @softDelete, data scope, row policy, so the view must select the id column");
});

test("DB views reject unknown tables, columns and computed fields", () => {
  expect(() => parseQiyProject(source().replace("from products", "from missing"))).toThrow("unknown source entity");
  expect(() => parseQiyProject(source().replace("columns id, name", "columns id, missing"))).toThrow("unknown column");
  expect(() => parseQiyProject(source().replace("field name Text", "field name Text @computed(\"{price}\")"))).toThrow("computed column name cannot be selected");
});
