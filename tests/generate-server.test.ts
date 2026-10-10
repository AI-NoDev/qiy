import { describe, expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { generateServer } from "../tools/generate-server";

const fixture = await Bun.file(new URL("../examples/catalog.ir.json", import.meta.url)).json() as DatabaseIR;

describe("V0 Elysia API generation", () => {
  test("rejects GraphQL names that collide after resource expansion", () => {
    for (const name of ["Products", "productsPage", "productsById", "productsMany", "query", "__private", "$invalid"]) {
      const database = structuredClone(fixture);
      database.entities.push({ name, tableName: "extra", fields: [{ name: "id", type: "UUID", primaryKey: true }, { name: "title", type: "Text" }] });
      expect(() => generateServer(database)).toThrow("GraphQL:");
    }
    const database = structuredClone(fixture);
    database.enums = [{ name: "products", values: [{ name: "active" }] }];
    expect(() => generateServer(database)).toThrow("duplicate type name Products");
    for (const name of ["true", "false", "null", "__internal", "$value"]) {
      database.enums = [{ name: "status", values: [{ name }] }];
      expect(() => generateServer(database)).toThrow("invalid enum value");
    }
    database.enums = [{ name: "status", values: [{ name: "ACTIVE" }] }];
    expect(generateServer(database)["api/src/graphql.ts"]).toBeDefined();
    database.entities[0]!.fields.push({ name: "__private", type: "Text" });
    expect(() => generateServer(database)).toThrow("invalid field name");
  });

  test("rejects empty GraphQL roots and inputs and emits a schema validation test", () => {
    expect(() => generateServer({ dialect: "sqlite", extensions: [], entities: [] })).toThrow("at least one entity");
    const database = structuredClone(fixture);
    database.entities[0]!.fields = [{ name: "id", type: "UUID", primaryKey: true }];
    database.entities[0]!.indexes = [];
    expect(() => generateServer(database)).toThrow("requires a non-primary field");
    expect(generateServer(fixture)["api/tests/graphql-schema.test.ts"]).toContain("validateSchema(buildSchema(graphqlTypeDefs))");
  });

  test("generates Bun SQL, Elysia CRUD, and fail-closed startup", () => {
    const files = generateServer(fixture);
    expect(files["api/src/schema.ts"]).toContain("vector_cosine_ops");
    expect(files["api/src/db.ts"]).toContain('from "drizzle-orm/bun-sql"');
    expect(files["api/src/modules/products/products.routes.ts"]).toContain('prefix: "/products"');
    expect(files["api/src/routes/products.ts"]).toContain("../modules/products/products.routes");
    expect(files["api/src/modules/products/products.repository.ts"]).toContain("from \"../../db\"");
    expect(files["api/src/modules/products/products.service.ts"]).toContain("createProductsService");
    expect(files["api/src/plugins/index.ts"]).toContain("registerPlugins");
    expect(files["api/src/modules/products/products.routes.ts"]).toContain('t.Numeric({ minimum: 1, maximum: 100 })');
    expect(files["api/src/modules/products/products.routes.ts"]).toContain("repository.deleteMany");
    expect(files["api/src/modules/products/products.routes.ts"]).not.toContain("service.deleteMany");
    expect(files["api/src/server.ts"]).toContain('QIY_DEV_MODE !== "1"');
    expect(files["api/src/server.ts"]).toContain('hostname: Bun.env.HOST ?? "127.0.0.1"');
    expect(files["api/src/graphql.ts"]).toContain("withPaginationLimit(createProductsService(repositories.products))");
    expect(files["api/src/pagination.ts"]).toContain("pageSize > 100");
    expect(files["api/tests/pagination.test.ts"]).toContain("rejects page sizes above the API limit");
    expect(files["api/src/app.ts"]).toContain('prefix: "/api/v1"');
    expect(files["api/src/app.ts"]).toContain('path: "/api/v1/openapi"');
  });

  test("generates Apollo and Yoga conformance tests for scoped queries and mutations", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields[1]!.sortable = false;
    database.entities[0]!.fields[1]!.filterable = false;
    for (const adapter of ["apollo", "yoga"] as const) {
      const files = generateServer(database, {
        elysiaPlugins: { graphqlAdapter: adapter },
        scopes: [{ resource: "products", field: "title", claim: "tenant.productTitle" }],
      });
      const adapterTest = files["api/tests/graphql-adapter.test.ts"]!;
      const plugins = files["api/src/plugins/index.ts"]!;
      if (adapter === "yoga") expect(plugins).toContain('graphiql: false, landingPage: false');
      else expect(plugins).toContain('enablePlayground: false');
      expect(adapterTest).toContain('query: "{ products { total } }"');
      expect(adapterTest).toContain('expect(browserPage.status).toBe(405)');
      expect(adapterTest).toContain("createGraphQLDataProvider");
      expect(adapterTest).toContain("const providerResult = await provider.getList");
      expect(adapterTest).toContain("provider.getOne");
      expect(adapterTest).toContain("provider.create");
      expect(adapterTest).toContain("provider.update");
      expect(adapterTest).toContain("provider.deleteOne");
      expect(adapterTest).toContain("provider.deleteMany");
      expect(adapterTest).toContain('mutation { deleteProducts(id:');
      expect(adapterTest).toContain('seenMutations.push({ operation: "delete", actorId, scope })');
      expect(adapterTest).toContain('["create", "update", "delete", "deleteMany", "delete"]');
      expect(adapterTest).toContain("pageSize: 101");
      expect(adapterTest).toContain("rejectedSort");
      expect(adapterTest).toContain("rejectedFilter");
      expect(adapterTest).toContain("expect(seenScopes).toHaveLength(3)");
      expect(adapterTest).toContain("expect(seenMutations).toHaveLength(5)");
    }
  });

  test("generates adapter analytics provider parity and data scope checks", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields.push({ name: "status", type: "Text", enumName: "productStatus" }, { name: "createdAt", type: "DateTime" });
    database.enums = [{ name: "productStatus", values: [{ name: "draft" }, { name: "approved" }] }];
    for (const adapter of ["apollo", "yoga"] as const) {
      const files = generateServer(database, { elysiaPlugins: { graphqlAdapter: adapter }, scopes: [{ resource: "products", field: "title", claim: "tenant.title" }] });
      const analytics = files["api/tests/graphql-adapter-analytics.test.ts"]!;
      expect(analytics).toContain("createGraphQLDataProvider");
      expect(analytics).toContain("distributionRest.json()");
      expect(analytics).toContain("trendRest.json()");
      expect(analytics).toContain('scope: { field: "title", value: "Example" }');
      expect(analytics).toContain("const missingClaim = await createApp");
    }
  });

  test("rejects primary keys not supported by generated CRUD", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields[0]!.primaryKey = false;
    expect(() => generateServer(database)).toThrow("requires exactly one UUID primary key named id");
  });

  test("enforces declared sortable and filterable fields on REST, GraphQL, and Drizzle", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields[1]!.sortable = false;
    database.entities[0]!.fields[1]!.filterable = false;
    const files = generateServer(database);
    const route = files["api/src/modules/products/products.routes.ts"]!;
    const routeTests = files["api/tests/products.test.ts"]!;
    const repository = files["api/src/modules/products/products.repository.ts"]!;
    const graphQL = files["api/src/graphql.ts"]!;
    expect(route).toContain("if (query.sort && !sortableFields.includes(query.sort)) return status(400");
    expect(route).toContain("if (filters && Object.keys(filters).some((field) => !filterableFields.includes(field))) return status(400");
    expect(routeTests).toContain("rejects sorting on disabled field title");
    expect(routeTests).toContain("rejects filtering on disabled field title");
    expect(repository).toContain('if (options.sort && !sortColumn) throw new Error("Unsupported sort field")');
    expect(repository).toContain('if (filters.some(([field]) => !filterColumns[field])) throw new Error("Unsupported filter field")');
    expect(repository).not.toContain('"title": products.title');
    expect(graphQL).toContain('const sortableFields = ["id","price","embedding"] as string[]');
    expect(graphQL).toContain('const filterableFields = ["id","price","embedding"] as string[]');
    expect(files["api/tests/graphql-list-options.test.ts"]).toContain("rejects disabled sort products.title");
    expect(files["api/tests/graphql-list-options.test.ts"]).toContain("rejects disabled filter products.title");
  });

  test("scopes every CRUD operation in PostgreSQL, SQLite and MySQL", () => {
    for (const dialect of ["postgresql", "sqlite", "mysql"] as const) {
      const database: DatabaseIR = {
        dialect, extensions: [], entities: [{ name: "orders", tableName: "orders", fields: [
          { name: "id", type: "UUID", primaryKey: true },
          { name: "customerId", type: "UUID" },
          { name: "title", type: "Text" },
        ] }],
      };
      const files = generateServer(database, { scopes: [{ resource: "orders", field: "customerId", claim: "tenant.customerId" }] });
      const repository = files["api/src/modules/orders/orders.repository.ts"]!;
      expect(files["api/src/graphql.ts"]).toContain('"resource":"orders","field":"customerId","claim":"tenant.customerId"');
      expect(repository).toContain('"customerId": orders.customerId');
      expect(repository).toContain("...(scope ? { [scope.field]: scope.value } : {})");
      expect(repository).toContain("where(and(eq(orders.id, id), scopeCondition))");
      expect(repository).toContain("where(and(inArray(orders.id, ids), scopeCondition))");
      expect(repository).toContain("db.transaction");
      expect(files["api/tests/data-scope.test.ts"]).toContain("data scope rejects missing claims");
    }
  });

  test("rejects duplicate or invalid data scopes", () => {
    const database: DatabaseIR = { dialect: "sqlite", extensions: [], entities: [{ name: "orders", tableName: "orders", fields: [
      { name: "id", type: "UUID", primaryKey: true }, { name: "customerId", type: "UUID" },
    ] }] };
    expect(() => generateServer(database, { scopes: [
      { resource: "orders", field: "customerId", claim: "tenant.id" },
      { resource: "orders", field: "customerId", claim: "tenant.other" },
    ] })).toThrow("duplicate resource");
    expect(() => generateServer(database, { scopes: [{ resource: "orders", field: "missing", claim: "tenant.id" }] })).toThrow("unknown field");
  });

  test("generates UTC-aware daily trends and scoped repository aggregation", () => {
    for (const dialect of ["postgresql", "sqlite", "mysql"] as const) {
      const database: DatabaseIR = { dialect, extensions: [], entities: [{ name: "orders", tableName: "orders", fields: [
        { name: "id", type: "UUID", primaryKey: true },
        { name: "tenantId", type: "Text" },
        { name: "createdAt", type: "DateTime", nullable: true },
      ] }] };
      const files = generateServer(database, { scopes: [{ resource: "orders", field: "tenantId", claim: "tenant.id" }] });
      const repository = files["api/src/modules/orders/orders.repository.ts"]!;
      expect(repository).toContain("gte(column, start), lt(column, end), scopeCondition");
      expect(repository).toContain("groupBy(day).orderBy(day)");
      expect(repository).toContain(dialect === "postgresql" ? "AT TIME ZONE 'UTC'" : dialect === "sqlite" ? "'unixepoch'" : "date_format");
      expect(files["api/src/graphql.ts"]).toContain("ordersTrend(field: String!, days: Int!)");
      expect(files["api/tests/trend.test.ts"]).toContain("status).toBe(403)");
      if (dialect === "mysql") {
        expect(files["api/src/schema.ts"]).toContain("import { bigint, datetime,");
        expect(files["api/src/schema.ts"]).toContain('datetime("createdAt", { mode: "date" })');
        expect(files["api/src/db.ts"]).toContain('timezone: "Z"');
      }
    }
  });
});
