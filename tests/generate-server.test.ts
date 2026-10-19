import { describe, expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { generateServer } from "../tools/generate-server";
import { parseQiyProject } from "../tools/qiy-project";

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

  test("exposes dataflow commands through native and adapter GraphQL without duplicating transaction logic", async () => {
    const project = parseQiyProject(await Bun.file(new URL("../examples/dataflow/create-delete.qiy", import.meta.url)).text());
    const files = generateServer(project.database, { dataflows: project.dataflows, elysiaPlugins: { graphqlAdapter: "yoga" } });
    const graphQL = files["api/src/graphql.ts"]!;
    const adapter = files["api/src/graphql-adapter.ts"]!;
    expect(graphQL).toContain("input CreateReviewCommandInput");
    expect(graphQL).toContain("userId: ID!");
    expect(graphQL).toContain("note: String!");
    expect(graphQL).toContain("runCreateReview(input: CreateReviewCommandInput!, idempotencyKey: String!): Reviews!");
    expect(graphQL).toContain("runCreateUser(idempotencyKey: String!): Users!");
    expect(graphQL).not.toContain("input CreateUserCommandInput");
    expect(graphQL).toContain('createDataflowRoutes(authenticate)');
    expect(graphQL).toContain('"http://qiy.internal/api/v1/commands/"');
    expect(graphQL).toContain('extensions: { status: response.status');
    expect(graphQL).toContain('executeDataflowCommand<{ id?: string; userId?: string; note?: string; status?: string }>');
    expect(adapter).toContain("runCreateReview:");
    expect(adapter).toContain("args: any");
    expect(files["api/src/app.ts"]).toContain('"mutations":["runCreateReview","runDeleteReview","runCreateUser","runTransientUser"]');
    expect(files["api/src/auth/guard.ts"]).toContain("resource.mutations ?? []");
    expect(files["api/src/plugins/index.ts"]).toContain("createGraphQLAdapterResolvers(context.repositories, context.authenticate)");
  });

  test("maps typed dataflow inputs and rejects normalized GraphQL command collisions", () => {
    const project = parseQiyProject(`qiy v0; application graphql-dataflow {
      database sqlite {}
      enum reviewState { value pending; value approved; }
      entity reviews { field id UUID @id; field state reviewState; field quantity Integer; field amount Decimal(12,2); }
      dataflow review_order {
        input { field id UUID @required; field state reviewState @required; field quantity Integer; field approved Boolean; field amount Decimal; }
        context { review = entity reviews by id input.id @required; }
        step update { update review { state = input.state; } }
        result { return review; }
      }
    }`);
    const graphQL = generateServer(project.database, { dataflows: project.dataflows })["api/src/graphql.ts"]!;
    expect(graphQL).toContain("id: ID!");
    expect(graphQL).toContain("state: ReviewState!");
    expect(graphQL).toContain("quantity: Int");
    expect(graphQL).toContain("approved: Boolean");
    expect(graphQL).toContain("amount: String");

    const duplicate = structuredClone(project.dataflows!);
    duplicate.push({ ...structuredClone(duplicate[0]!), name: "reviewOrder" });
    expect(() => generateServer(project.database, { dataflows: duplicate })).toThrow("duplicate type name ReviewOrderCommandInput");
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
    expect(route).toContain("if (query.sort && !sortableFields.includes(query.sort)) return { status: 400, error: \"Unsupported sort field\" }");
    expect(route).toContain("if (clauses.some((filter) => !filterableFields.includes(filter.field))) return { status: 400");
    expect(route).toContain("Unsupported filter operator");
    expect(routeTests).toContain("rejects sorting on disabled field title");
    expect(routeTests).toContain("rejects filtering on disabled field title");
    expect(repository).toContain('if (options.sort && !sortColumn) throw new Error("Unsupported sort field")');
    expect(repository).toContain('if (filterClauses(filters as FilterExpression[]).some(({ field }) => !filterColumns[field])) throw new Error("Unsupported filter field")');
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
        expect(files["api/src/schema.ts"]).toContain('datetime("createdAt", { mode: "date", fsp: 3 })');
        expect(files["api/src/db.ts"]).toContain('timezone: "Z"');
      }
    }
  });

  test("generates the database operations toolchain", () => {
    const project = parseQiyProject(`qiy v0; application db-ops { database sqlite {} api { client rest; } entity products { field id UUID @id; field title Text; } }`);
    const files = generateServer(project.database);
    // Drift detection compares the live catalog with the Drizzle schema.
    expect(files["api/src/schema-drift.ts"]).toContain("export");
    expect(files["api/src/db-check.ts"]).toContain("schema-drift");
    expect(files["api/tests/schema-drift.test.ts"]).toContain("drift");
    // Rollback and migration guards.
    expect(files["api/src/db-migrate.ts"]).toContain("qiy db:migrate");
    expect(files["api/src/db-rollback.ts"]).toContain("qiy db:rollback");
    // Logical backups round-trip values JSON cannot carry and record a schema fingerprint.
    expect(files["api/src/backup-codec.ts"]).toContain("export function encodeValue");
    expect(files["api/src/backup-codec.ts"]).toContain("export function decodeRow");
    expect(files["api/src/schema-tables.ts"]).toContain("export");
    expect(files["api/src/db-backup.ts"]).toContain("db:backup");
    expect(files["api/src/db-backup.ts"]).toContain("schema");
    expect(files["api/src/db-restore.ts"]).toContain("db:restore");
    expect(files["api/tests/backup-codec.test.ts"]).toContain("round-trips values that JSON cannot carry faithfully");
  });

  test("generates the server-side saved views store and routes", () => {
    const project = parseQiyProject(`qiy v0; application views { database sqlite {} entity items { field id UUID @id; field title Text; } }`);
    const files = generateServer(project.database, {});
    const module = files["api/src/saved-views.ts"]!;
    // Per-user rows with an explicit shared flag, plus ownership rules.
    expect(module).toContain("export async function listSavedViews");
    expect(module).toContain("export async function createSavedView");
    expect(module).toContain("export async function deleteSavedView");
    expect(module).toContain('eq(qiySavedViews.shared, 1)');
    expect(module).toContain("if (row.ownerId !== principal.id) return \"forbidden\";");
    expect(module).toContain("MAX_VIEWS_PER_RESOURCE = 100");
    expect(module).toContain("createSavedViewsRoutes(authenticate: Authenticator)");
    expect(files["api/src/app.ts"]).toContain("createSavedViewsRoutes(authenticate)");
    // The table ships in every dialect schema.
    for (const dialect of ["sqlite", "postgresql", "mysql"] as const) {
      const scoped = parseQiyProject(`qiy v0; application views { database ${dialect} {} entity items { field id UUID @id; field title Text; } }`);
      expect(generateServer(scoped.database, {})["api/src/schema.ts"]).toContain('"qiy_saved_views"');
    }
  });

  test("imports CSV through the same policy path as create", () => {
    const project = parseQiyProject(`qiy v0; application import-contract {
      database sqlite {}
      entity products { field id UUID @id; field code Text @unique; field region Text; field salary Integer; }
      restrict products { allow roles admin, operator; when region claim region; mask salary roles operator mode omit; }
    }`);
    const files = generateServer(project.database, { restrictions: project.restrictions });
    const route = files["api/src/modules/products/products.routes.ts"]!;
    const repository = files["api/src/modules/products/products.repository.ts"]!;
    const contract = files["api/src/modules/products/products.contract.ts"]!;
    expect(route).toContain('.post("/import"');
    // RFC 4180 parsing, typed coercion and bounded input.
    expect(route).toContain("const parseCsv = (input: string): string[][] =>");
    expect(route).toContain("const importValue = (field: string, value: string)");
    expect(route).toContain("QIY_IMPORT_MAX_ROWS");
    // Unknown, duplicated and masked columns are refused before any write.
    expect(route).toContain('errorKey: "import.unknownField"');
    expect(route).toContain('errorKey: "import.duplicateColumn"');
    expect(route).toContain('errorKey: "import.maskedField"');
    expect(route).toContain('errorKey: "import.rowLength"');
    expect(route).toContain('errorKey: "import.tooLarge"');
    // A failed row compensates by deleting what the request already created.
    expect(route).toContain("await repository.deleteMany(created, principal.id, scope, policy).catch(() => undefined)");
    expect(route).toContain('if (error instanceof QiyPolicyError) return status(403');
    expect(contract).toContain("recordImportAudit?(input: { rows: number; principalId?: string }): Promise<void>;");
    expect(repository).toContain('action: "products.imported"');
    // Background imports use a durable job row and a status endpoint.
    expect(route).toContain('from "../../import-jobs";');
    expect(route).toContain("claimImportJob");
    expect(route).toContain("claimAndProcessImportJob");
    expect(route).toContain('.post("/import/jobs/:id/run"');
    expect(route).toContain('payload: JSON.stringify({ header, rows: rows.slice(1), principal:');
    expect(route).toContain('if (Bun.env.QIY_IMPORT_INLINE !== "off") void claimAndProcessImportJob(jobId);');
    expect(route).toContain("const claimAndProcessImportJob = async (jobId?: string)");
    expect(files["api/src/import-jobs.ts"]).toContain("export async function claimImportJob");
    expect(files["api/src/import-jobs.ts"]).toContain("leaseOwner");
    expect(route).toContain('.get("/import/jobs"');
    expect(route).toContain('if (query?.async === "1")');
    expect(route).toContain('.get("/import/jobs/:id"');
    expect(route).toContain('.post("/import/jobs/:id/cancel"');
    expect(route).toContain('await updateImportJob(claimed.id, { status: "cancelled", processed, errors: ["Cancelled"], releaseLease: true })');
    expect(route).toContain("await releaseStaleImportJobs();");
    expect(route).toContain('await updateImportJob(claimed.id, { status: "completed", processed, errors: [], releaseLease: true })');
    expect(route).toContain('await updateImportJob(claimed.id, { status: "failed", processed, failed: jobErrors.length, errors: jobErrors, releaseLease: true })');
    const jobs = files["api/src/import-jobs.ts"]!;
    expect(jobs).toContain("export async function createImportJob");
    expect(jobs).toContain("export async function readImportJob");
    expect(jobs).toContain("export async function updateImportJob");
    expect(jobs).toContain("qiyImportJobs");
    // The job table ships in every dialect schema.
    for (const dialect of ["sqlite", "postgresql", "mysql"] as const) {
      const scoped = parseQiyProject(`qiy v0; application import-contract { database ${dialect} {} entity products { field id UUID @id; field code Text; } }`);
      expect(generateServer(scoped.database, {})["api/src/schema.ts"]).toContain('"qiy_import_jobs"');
    }
  });

  test("exports CSV through the same policy path as the list endpoint", () => {
    const project = parseQiyProject(`qiy v0; application export-contract {
      database sqlite {}
      entity products { field id UUID @id; field title Text; field region Text; field salary Integer; }
      restrict products { allow roles admin, operator; when region claim region; mask salary roles operator mode omit; }
    }`);
    const database = project.database;
    const files = generateServer(database, { restrictions: project.restrictions });
    const route = files["api/src/modules/products/products.routes.ts"]!;
    const repository = files["api/src/modules/products/products.repository.ts"]!;
    const contract = files["api/src/modules/products/products.contract.ts"]!;
    // One shared query path keeps export aligned with list validation, scope and policy.
    expect(route).toContain("const runListQuery = async");
    expect(route).toContain('.get("/export"');
    expect(route).toContain("const firstPage = await runListQuery({ ...query, page: 1, pageSize: selectedIds.length ? limit : pageSize }, request)");
    // Rows are streamed in bounded pages instead of materializing the whole result set.
    expect(route).toContain("const EXPORT_PAGE_SIZE = Math.min(250, exportMaxRows())");
    expect(route).toContain("new ReadableStream<Uint8Array>");
    expect(route).toContain("for (let page = 2; page <= totalPages; page++)");
    expect(route).toContain('errorKey: "export.tooLarge"');
    expect(route).toContain("Object.hasOwn(row, column)");
    expect(route).toContain("await repository.recordExportAudit?.(");
    // Background exports materialize the CSV on a durable job and serve it later.
    expect(route).toContain('if (query.async === "1")');
    expect(route).toContain("const jobId = await createExportJob({");
    expect(route).toContain("QIY_EXPORT_INLINE");
    expect(route).toContain("claimAndProcessExportJob");
    expect(route).toContain('.post("/export/jobs/:id/run"');
    expect(route).toContain('.get("/export/jobs"');
    expect(route).toContain('.get("/export/jobs/:id"');
    expect(route).toContain('.get("/export/jobs/:id/download"');
    expect(route).toContain('errorKey: "export.notReady"');
    expect(files["api/src/export-jobs.ts"]).toContain("export async function createExportJob");
    expect(files["api/src/export-jobs.ts"]).toContain("export async function readExportJob");
    for (const dialect of ["sqlite", "postgresql", "mysql"] as const) {
      const scoped = parseQiyProject(`qiy v0; application export-contract { database ${dialect} {} entity products { field id UUID @id; field title Text; } }`);
      expect(generateServer(scoped.database, {})["api/src/schema.ts"]).toContain('"qiy_export_jobs"');
    }
    expect(route).toContain("QIY_EXPORT_MAX_ROWS");
    // The audit hook is optional so hand-written repositories keep compiling.
    expect(contract).toContain("recordExportAudit?(input: { rows: number; filters: number; principalId?: string }): Promise<void>;");
    expect(repository).toContain('action: "products.exported"');
    // A write outside the caller's own row policy is a policy refusal, not a 500.
    expect(repository).toContain('new QiyPolicyError("Write is outside the record policy", 403, "policy.outsideScope")');
  });
});
