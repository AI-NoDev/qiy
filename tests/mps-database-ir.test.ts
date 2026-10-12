import { describe, expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { validateDatabaseIR } from "../tools/database-ir";
import { generateDrizzlePostgres } from "../tools/drizzle-pg";
import { parseMpsDatabaseModel, parseMpsProjectModel } from "../tools/mps-database-ir";
import { exportMpsProjectAsQiy } from "../tools/mps-qiy";
import { parseQiyProject } from "../tools/qiy-project";
import { generateProject } from "../tools/generate-project";

const catalogXml = await Bun.file(new URL("../languages/qiy.sandbox/models/qiy.catalog.mps", import.meta.url)).text();
const relationsXml = await Bun.file(new URL("../languages/qiy.sandbox/models/qiy.relations.mps", import.meta.url)).text();
const erpWorkflowXml = await Bun.file(new URL("../languages/qiy.sandbox/models/qiy.erpworkflow.mps", import.meta.url)).text();
const structureXml = await Bun.file(new URL("../languages/qiy/models/qiy.structure.mps", import.meta.url)).text();
const textGenXml = await Bun.file(new URL("../languages/qiy/models/qiy.textGen.mps", import.meta.url)).text();
const expected = await Bun.file(new URL("../examples/catalog.ir.json", import.meta.url)).json() as DatabaseIR;

describe("MPS to Database IR", () => {
  test("independent bridge and text options produce identical workspace files", () => {
    const bridged = parseMpsProjectModel(erpWorkflowXml, structureXml);
    const projected = parseQiyProject(exportMpsProjectAsQiy(erpWorkflowXml, structureXml));
    const name = projected.name;
    const nativeFiles = generateProject(projected.database, name, projected);
    expect(generateProject(bridged.database, name, bridged)).toEqual(nativeFiles);
    const changed = structuredClone(bridged);
    changed.dashboardMetrics![0]!.label = "Changed metric";
    expect(generateProject(changed.database, name, changed)).not.toEqual(nativeFiles);
    const changedMenu = structuredClone(bridged);
    changedMenu.menuGroups![0]!.label = "Changed menu";
    expect(generateProject(changedMenu.database, name, changedMenu)).not.toEqual(nativeFiles);
  });

  test("rejects application and connection settings that the output cannot represent", () => {
    for (const [concept, id, name, value] of [
      ["qa", "720000000000000101", "description", "Application description"],
      ["qa", "720000000000000102", "basePath", "/backoffice"],
      ["qf", "720000000000000203", "provider", "custom-driver"],
      ["qf", "720000000000000204", "url", "postgres://example.invalid/database"],
    ]) {
      const registryPattern = new RegExp(`(<concept[^>]*index="${concept}">)`);
      const nodePattern = new RegExp(`(<node concept="${concept}"[^>]*>)`);
      const model = catalogXml.replace(registryPattern, `$1<property id="${id}" name="${name}" index="unsupportedSetting" />`)
        .replace(nodePattern, `$1<property role="unsupportedSetting" value="${value}" />`);
      const expected = `unsupported ${concept === "qa" ? "Application" : "DatabaseConfig"}.${name}`;
      expect(() => parseMpsProjectModel(model, structureXml)).toThrow(expected);
      expect(() => exportMpsProjectAsQiy(model, structureXml)).toThrow(expected);
      try {
        parseMpsProjectModel(model, structureXml);
      } catch (error) {
        expect(String(error)).not.toContain(value!);
      }
    }
  });

  test("rejects registry feature collisions instead of overwriting field semantics", () => {
    const property = '<property id="720000000000000602" name="columnName" index="qr" />';
    const child = '<child id="72000000000000102" name="entities" index="qe" />';
    for (const model of [
      catalogXml.replace(property, property.replace('index="qr"', 'index="qq"')),
      catalogXml.replace(property, `${property}${property.replace('index="qr"', 'index="alias"')}`),
    ]) {
      expect(() => parseMpsProjectModel(model, structureXml)).toThrow("duplicate property registry entry");
    }
    for (const model of [
      catalogXml.replace(child, child.replace('index="qe"', 'index="qd"')),
      catalogXml.replace(child, `${child}${child.replace('index="qe"', 'index="alias"')}`),
    ]) {
      expect(() => parseMpsProjectModel(model, structureXml)).toThrow("duplicate child registry entry");
    }
  });

  test("rejects ambiguous node identities before exporting or generating a project", () => {
    const nodeIds = [...catalogXml.matchAll(/<node\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]!);
    expect(nodeIds.length).toBeGreaterThan(2);
    const duplicate = catalogXml.replace(`id="${nodeIds[1]}"`, `id="${nodeIds[0]}"`);
    expect(() => parseMpsProjectModel(duplicate, structureXml)).toThrow("duplicate node ID");
    expect(() => exportMpsProjectAsQiy(duplicate, structureXml)).toThrow("duplicate node ID");
    const empty = catalogXml.replace(`id="${nodeIds[1]}"`, 'id=""');
    expect(() => parseMpsProjectModel(empty, structureXml)).toThrow("empty node ID");
  });

  test("rejects unimplemented references instead of silently dropping their semantics", () => {
    for (const reference of ['<ref role="customRelation" node="missing" />', '<ref role="customRelation" to="external:missing" />']) {
      const model = catalogXml.replace(/(<node concept="qa"[^>]*>)/, `$1${reference}`);
      expect(() => parseMpsProjectModel(model, structureXml)).toThrow("unsupported node references");
      expect(() => exportMpsProjectAsQiy(model, structureXml)).toThrow("unsupported node references");
    }
  });

  test("generates an ERP order workflow from a native MPS model", () => {
    const project = parseMpsProjectModel(erpWorkflowXml, structureXml);
    expect(project.workflows).toEqual(["orderInventory"]);
    expect(project.database.dialect).toBe("postgresql");
    expect(project.database.entities.map((entity) => entity.name)).toEqual(["users", "orders", "orderItems", "inventoryItems"]);
    expect(project.auth).toEqual({ provider: "oidc", userEntity: "users", subjectField: "externalSubject", roleField: "role" });
    expect(project.database.enums?.find((item) => item.name === "userRole")?.values.map((item) => item.name)).toEqual(["admin", "operator", "viewer"]);
    expect(project.database.enums?.find((item) => item.name === "orderStatus")).toMatchObject({ comment: "订单生命周期" });
    expect(project.database.enums?.find((item) => item.name === "orderStatus")?.values[1]).toMatchObject({ name: "submitted", label: "已提交", color: "blue", icon: "SendOutlined", comment: "等待审批" });
    expect(project.database.entities.find((item) => item.name === "users")?.fields.find((item) => item.name === "externalSubject")).toMatchObject({ listVisible: false, showVisible: false });
    expect(project.database.entities.find((item) => item.name === "orders")?.fields.find((item) => item.name === "status")?.listVisible).toBe(false);
    expect(project.database.entities.find((item) => item.name === "orders")).toMatchObject({ comment: "销售订单" });
    expect(project.database.entities.find((item) => item.name === "orders")?.fields.find((item) => item.name === "status")).toMatchObject({ label: "订单状态", icon: "TagsOutlined", sortable: false, filterable: true, comment: "订单当前状态" });
    expect(project.database.entities.find((item) => item.name === "orders")?.fields.find((item) => item.name === "approvedBy")).toMatchObject({ listVisible: false, formVisible: false, filterable: false });
    expect(project.menuGroups).toEqual([
      { name: "operations", label: "业务运营", icon: "ShopOutlined", comment: "订单与库存业务入口", resources: [] },
      { name: "sales", label: "销售管理", icon: "ShoppingOutlined", parent: "operations", resources: ["orders", "order_items"] },
      { name: "inventory", label: "库存管理", icon: "InboxOutlined", parent: "operations", resources: ["inventory_items"] },
      { name: "administration", label: "系统管理", icon: "SettingOutlined", resources: ["users"] },
    ]);
    expect(project.dashboardMetrics).toEqual([
      { name: "orderCount", resource: "orders", label: "订单总数", icon: "ShoppingOutlined", comment: "当前订单记录", span: 8 },
      { name: "orderStatus", resource: "orders", label: "订单状态分布", span: 12, type: "distribution", groupBy: "status" },
      { name: "orderTrend", resource: "orders", label: "近 30 天订单趋势", span: 24, type: "trend", groupBy: "createdAt", days: 30 },
    ]);
    const files = generateProject(project.database, "qiy-erp-workflow", { workflows: project.workflows, auth: project.auth, menuGroups: project.menuGroups, dashboardMetrics: project.dashboardMetrics });
    expect(files["apps/server/src/workflows/order.ts"]).toContain('prefix: "/api/v1/orders"');
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("order_reservations"');
    expect(files["apps/web/app/features/orders/order-actions.tsx"]).toContain('type Command = "submit" | "approve" | "ship" | "cancel"');
    expect(files["apps/server/src/auth/oidc.ts"]).toContain('roleField: "role"');
    expect(files["apps/web/app/dashboard.ts"]).toContain('"orderStatus"');
    expect(files["apps/web/app/routes/home.tsx"]).toContain("dashboardMetrics.map");
    expect(files["apps/web/app/resources.ts"]).toContain('"SettingOutlined"');
    expect(files["apps/web/app/resources.ts"]).toContain('"listVisible": false');
    expect(files["apps/web/app/resources.ts"]).toContain('"showVisible": false');
    expect(files["apps/web/app/resources.ts"]).toContain('"formVisible": false');
    expect(files["apps/web/app/resources.ts"]).toContain('"sortable": false');
    expect(files["apps/web/app/resources.ts"]).toContain('"filterable": true');
  });

  test("exports a two-entity relation into Drizzle and Refine metadata", () => {
    const withWorkflow = relationsXml.replace(
      '<node concept="qk" id="120000000000003"',
      '<node concept="qworkflowConfig" id="120000000000045" role="qworkflows"><property role="TrG5h" value="orderInventory" /></node>\n    <node concept="qk" id="120000000000003"',
    );
    const project = parseMpsProjectModel(withWorkflow, structureXml);
    expect(project.name).toBe("Relations");
    expect(project.apiClient).toBe("graphql");
    expect(project.workflows).toEqual(["orderInventory"]);
    const projected = parseQiyProject(exportMpsProjectAsQiy(withWorkflow, structureXml));
    expect(projected.workflows).toEqual(project.workflows);
    expect(project.elysiaPlugins).toEqual({ bearer: true, serverTiming: true, graphqlAdapter: "native", cron: [{ name: "cleanup", pattern: "0 * * * *", task: "cleanupMissingAttachments" }] });
    expect(project.storageProvider).toBe("s3");
    expect(project.scopes).toEqual([{ resource: "products", field: "categoryId", claim: "tenant.categoryId" }]);
    expect(project.menuGroups).toEqual([
      { name: "catalog", label: "Catalog", icon: "AppstoreOutlined", comment: "Catalog master data", resources: ["categories"] },
      { name: "operations", label: "Operations", parent: "catalog", resources: ["products"] },
    ]);
    expect(project.dashboardMetrics).toEqual([
      { name: "productCount", resource: "products", label: "Products", span: 8, icon: "ShoppingOutlined", comment: "Current product records" },
      { name: "productsByCategory", resource: "products", label: "Products by category", span: 12, type: "distribution", groupBy: "status" },
      { name: "productTrend", resource: "products", label: "Product trend", span: 24, type: "trend", groupBy: "createdAt", days: 7 },
    ]);
    const scopedFiles = generateProject(project.database, "mps-relations", { scopes: project.scopes });
    expect(scopedFiles["apps/server/tests/sqlite-scope.test.ts"]).toContain('"createdAt": new Date("2026-01-01T00:00:00.000Z")');
    expect(scopedFiles["apps/server/tests/distribution.test.ts"]).toContain('claims: {"tenant.categoryId":"00000000-0000-4000-8000-000000000002"}');
    const generated = generateProject(project.database, "mps-relations", { apiClient: project.apiClient, elysiaPlugins: project.elysiaPlugins });
    const dependencies = JSON.parse(generated["apps/server/package.json"]!) as { dependencies: Record<string, string> };
    expect(dependencies.dependencies["@elysia/bearer"]).toBeDefined();
    expect(dependencies.dependencies["@elysia/server-timing"]).toBeDefined();
    expect(dependencies.dependencies["@elysia/cron"]).toBeDefined();
    expect(generated["apps/web/app/data-provider.ts"]).toContain('?? "graphql"');
    const s3Package = generateProject(project.database, "mps-relations", { storageProvider: project.storageProvider });
    expect(s3Package["apps/server/src/storage/index.ts"]).toContain('QIY_STORAGE_PROVIDER ?? "s3"');
    expect(s3Package["apps/server/tests/storage-config.test.ts"]).toContain('S3 bucket is required');
    expect(s3Package["apps/server/tests/setup.ts"]).toContain('QIY_STORAGE_PROVIDER = "local"');
    expect(validateDatabaseIR(project.database)).toEqual([]);
    expect(project.database.relations).toEqual([{
      name: "productCategory", fromEntity: "products", fromField: "categoryId",
      toEntity: "categories", toField: "id", cardinality: "one", onDelete: "setNull", comment: "Product belongs to an optional category",
    }]);
    expect(project.database.entities[1]?.indexes).toEqual([
      { name: "products_category_title_key", method: "btree", unique: true, comment: "One title per category",
        columns: [{ fieldName: "categoryId" }, { fieldName: "title" }] },
      { name: "products_title_idx", method: "btree", unique: false, concurrently: false,
        columns: [{ fieldName: "title" }] },
    ]);
    expect(project.database.entities[0]?.fields.find((field) => field.name === "name")?.unique).toBe(true);
    expect(project.database.entities[0]?.comment).toBe("Product categories");
    expect(project.database.entities[0]?.fields.find((field) => field.name === "name")?.comment).toBe("Human-readable category name");
    expect(project.database.enums?.[0]?.comment).toBe("Product lifecycle");
    expect(project.database.enums?.[0]?.values.find((value) => value.name === "active")?.comment).toBe("Available for ordering");
    expect(project.database.entities[0]?.fields.find((field) => field.name === "name")?.primaryKey).toBe(false);
    expect(project.database.entities[1]?.fields.find((field) => field.name === "title")?.columnName).toBe("product_title");
    expect(project.database.entities[1]?.fields.find((field) => field.name === "title")?.nullable).toBe(false);
    expect(project.database.entities[1]?.fields.find((field) => field.name === "title")?.unique).toBe(false);
    expect(project.database.entities[1]?.fields.find((field) => field.name === "unitPrice")?.scale).toBe(0);
    const files = generateProject(project.database, "mps-relations");
    expect(files["apps/server/src/schema.ts"]).toContain('references(() => categories["id"], { onDelete: "set null" })');
    expect(files["apps/server/src/schema.ts"]).toContain('uniqueIndex("products_category_title_key")');
    expect(files["apps/server/src/schema.ts"]).toContain('"title": text("product_title")');
    expect(files["apps/web/app/resources.ts"]).toContain('"resource": "categories"');
    expect(files["apps/web/app/resources.ts"]).toContain('"labelField": "name"');
    const exportedSource = exportMpsProjectAsQiy(relationsXml, structureXml);
    expect(exportedSource).toContain('@comment("Product lifecycle")');
    expect(exportedSource).toContain('@comment("Available for ordering")');
    expect(exportedSource).toContain('@comment("Catalog master data")');
    expect(exportedSource).toContain('@comment("Current product records")');
    const exportedProject = parseQiyProject(exportedSource);
    expect(exportedProject.database).toEqual(project.database);
    expect(exportedProject.apiClient).toBe("graphql");
    expect(exportedProject.elysiaPlugins).toEqual(project.elysiaPlugins);
    expect(exportedProject.storageProvider).toBe("s3");
    expect(exportedProject.scopes).toEqual(project.scopes);
    expect(exportedProject.menuGroups).toEqual(project.menuGroups);
    expect(exportedProject.dashboardMetrics).toEqual(project.dashboardMetrics);
  });

  test("keeps TextGen registry feature IDs unique and aligned with MPS interfaces", () => {
    const ids = [...textGenXml.matchAll(/<(?:concept|property|child|reference) id="([^"]+)"/g)].map((match) => match[1]!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(textGenXml).toContain('<reference id="1068499141037" name="baseMethodDeclaration" index="37wK5l" />');
    expect(textGenXml).toContain('<child id="1068499141038" name="actualArgument" index="37wK5m" />');
  });

  test("bridges opt-in Elysia plugins already present in the MPS structure and TextGen", () => {
    const model = relationsXml.replace('<property role="qgraphqlAdapter" value="native" />', `<property role="qgraphqlAdapter" value="native" />
      <property role="qjwt" value="true" />
      <property role="qstatic" value="true" />
      <property role="qhtml" value="true" />
      <property role="qdrizzle" value="true" />`);
    const project = parseMpsProjectModel(model, structureXml);
    expect(project.elysiaPlugins).toMatchObject({ jwt: { name: "jwt", secretEnv: "QIY_JWT_SECRET" }, static: { assets: "public", prefix: "/public" }, html: true, drizzle: true });
    expect(parseQiyProject(exportMpsProjectAsQiy(model, structureXml)).elysiaPlugins).toEqual(project.elysiaPlugins);
    const files = generateProject(project.database, project.name, { elysiaPlugins: project.elysiaPlugins });
    const dependencies = JSON.parse(files["apps/server/package.json"]!).dependencies as Record<string, string>;
    for (const dependency of ["@elysia/jwt", "@elysia/static", "@elysia/html", "drizzle-typebox"]) expect(dependencies[dependency]).toBeDefined();
    expect(files["apps/server/public/.gitkeep"]).toBe("");
    for (const property of ["jwt", "static", "html", "drizzle"]) {
      const invalid = model.replace(`role="q${property}" value="true"`, `role="q${property}" value="maybe"`);
      expect(() => parseMpsProjectModel(invalid, structureXml)).toThrow(`${property} must be true or false`);
    }
  });

  test("exports a real Qiy model, validates IR and renders Drizzle", () => {
    const project = parseMpsProjectModel(catalogXml, structureXml);
    expect(project.name).toBe("Catalog");
    const database = project.database;
    expect(database).toEqual(expected);
    expect(validateDatabaseIR(database)).toEqual([]);
    const source = generateDrizzlePostgres(database);
    expect(source).toContain('pgTable("products"');
    expect(source).toContain('using("hnsw", table["embedding"].op("vector_cosine_ops"))');
    const app = generateProject(database, "mps-catalog");
    expect(app["apps/server/src/schema.ts"]).toContain('pgTable("products"');
    expect(app["apps/server/src/modules/products/products.routes.ts"]).toContain('prefix: "/products"');
    expect(app["apps/web/app/resources.ts"]).toContain('"name": "products"');
    expect(app["apps/web/app/routes/list.tsx"]).toContain("useTable");
    expect(app["package.json"]).toContain("turbo");
    const projected = parseQiyProject(exportMpsProjectAsQiy(catalogXml, structureXml));
    expect(projected.name).toBe("catalog");
    expect(projected.database).toEqual(database);
    expect(generateProject(projected.database, projected.name)["apps/server/src/schema.ts"]).toContain('pgTable("products"');
  });

  test("rejects unsupported semantics rather than dropping them", () => {
    const model = catalogXml.replace('<property role="qq" value="Text" />', '<property role="qq" value="Text" />\n        <property role="qgenerated" value="true" />');
    expect(() => parseMpsDatabaseModel(model, structureXml)).toThrow("unknown property role qgenerated");
  });

  test("rejects unknown or duplicate MPS workflows", () => {
    const withWorkflow = relationsXml.replace(
      '<node concept="qk" id="120000000000003"',
      '<node concept="qworkflowConfig" id="120000000000045" role="qworkflows"><property role="TrG5h" value="orderInventory" /></node>\n    <node concept="qk" id="120000000000003"',
    );
    const unknown = withWorkflow.replace('role="TrG5h" value="orderInventory"', 'role="TrG5h" value="customWorkflow"');
    expect(() => parseMpsProjectModel(unknown, structureXml)).toThrow("unsupported workflow customWorkflow");
    const duplicate = withWorkflow.replace(
      '</node>\n    <node concept="qelysiaConfig"',
      '</node>\n    <node concept="qworkflowConfig" id="duplicate-workflow" role="qworkflows"><property role="TrG5h" value="orderInventory" /></node>\n    <node concept="qelysiaConfig"',
    );
    expect(() => parseMpsProjectModel(duplicate, structureXml)).toThrow("duplicate workflow configuration");
  });

  test("rejects unknown MPS frontend transport", () => {
    const invalid = relationsXml.replace('role="qapiClient" value="graphql"', 'role="qapiClient" value="both"');
    expect(() => parseMpsProjectModel(invalid, structureXml)).toThrow("apiClient must be rest or graphql");
  });

  test("rejects invalid or duplicate MPS Elysia configuration", () => {
    const invalid = relationsXml.replace('role="qbearer" value="true"', 'role="qbearer" value="maybe"');
    expect(() => parseMpsProjectModel(invalid, structureXml)).toThrow("bearer must be true or false");
    const duplicate = relationsXml.replace('</node>\n    <node concept="qk" id="120000000000003"', '</node>\n    <node concept="qelysiaConfig" id="duplicate" role="qelysia" />\n    <node concept="qk" id="120000000000003"');
    expect(() => parseMpsProjectModel(duplicate, structureXml)).toThrow("expected at most one ElysiaConfig");
    const invalidTask = relationsXml.replace('role="qtask" value="cleanupMissingAttachments"', 'role="qtask" value="arbitraryCode"');
    expect(() => parseMpsProjectModel(invalidTask, structureXml)).toThrow("unsupported Cron task arbitraryCode");
    const invalidPattern = relationsXml.replace('role="qpattern" value="0 * * * *"', 'role="qpattern" value="0 * * * *&quot; injection"');
    expect(() => parseMpsProjectModel(invalidPattern, structureXml)).toThrow("invalid Cron pattern");
    const missingJobs = relationsXml.replace(/<node concept="qcronJob"[\s\S]*?<\/node>/, "");
    expect(() => parseMpsProjectModel(missingJobs, structureXml)).toThrow("CronConfig requires at least one job");
    const invalidAdapter = relationsXml.replace('role="qgraphqlAdapter" value="native"', 'role="qgraphqlAdapter" value="custom"');
    expect(() => parseMpsProjectModel(invalidAdapter, structureXml)).toThrow("GraphQL adapter must be native, yoga or apollo");
  });

  test("rejects invalid MPS storage backends", () => {
    const invalid = relationsXml.replace('role="qstorageProvider" value="s3"', 'role="qstorageProvider" value="ftp"');
    expect(() => parseMpsProjectModel(invalid, structureXml)).toThrow("storage provider must be local or s3");
  });
  test("rejects malformed native MPS scope claims and unknown scope resources", () => {
    const invalid = relationsXml.replace('role="qscopeClaim" value="tenant.categoryId"', 'role="qscopeClaim" value="tenant..categoryId"');
    expect(() => parseMpsProjectModel(invalid, structureXml)).toThrow("invalid scope identifier");
    const project = parseMpsProjectModel(relationsXml.replace('role="qscopeResource" value="products"', 'role="qscopeResource" value="unknown"'), structureXml);
    expect(() => generateProject(project.database, "bad-scope", { scopes: project.scopes })).toThrow("Scope: unknown resource unknown");
  });
  test("bridges native MPS authentication configuration without bypassing server validation", () => {
    const withAuth = relationsXml.replace(
      '<node concept="qstorageConfig" id="120000000000021" role="qstorage">',
      '<node concept="qauthConfig" id="120000000000022" role="qauth"><property role="qauthProvider" value="oidc" /><property role="qauthUser" value="users" /><property role="qauthSubject" value="externalSubject" /><property role="qauthRole" value="role" /></node>\n    <node concept="qstorageConfig" id="120000000000021" role="qstorage">',
    );
    const project = parseMpsProjectModel(withAuth, structureXml);
    expect(project.auth).toEqual({ provider: "oidc", userEntity: "users", subjectField: "externalSubject", roleField: "role" });
    expect(parseQiyProject(exportMpsProjectAsQiy(withAuth, structureXml)).auth).toEqual(project.auth);
    expect(() => generateProject(project.database, "invalid-auth", { auth: project.auth })).toThrow("Auth: unknown user entity users");
    expect(() => parseMpsProjectModel(withAuth.replace('role="qauthProvider" value="oidc"', 'role="qauthProvider" value="local"'), structureXml)).toThrow("auth provider must be oidc, oauth2 or sso");
  });

  test("rejects stale registry IDs and malformed integer values", () => {
    const stale = catalogXml.replace('id="720000000000000601" name="type"', 'id="720000000000000699" name="type"');
    expect(() => parseMpsDatabaseModel(stale, structureXml)).toThrow("does not match Qiy structure");
    const invalid = catalogXml.replace('role="ra" value="1536"', 'role="ra" value="infinity"');
    expect(() => parseMpsDatabaseModel(invalid, structureXml)).toThrow("dimension must be a safe integer");
    const invalidName = catalogXml.replace('id="1169194664001" name="name"', 'id="1169194664002" name="name"');
    expect(() => parseMpsDatabaseModel(invalidName, structureXml)).toThrow("invalid INamedConcept.name property");
  });

  test("rejects a vector model without the declared database extension", () => {
    const missing = catalogXml.replace(/<node concept="qextension"[\s\S]*?<\/node>/, "");
    const database = parseMpsDatabaseModel(missing, structureXml);
    expect(validateDatabaseIR(database).join("\n")).toContain("declared pgvector extension");
    expect(() => generateDrizzlePostgres(database)).toThrow("declared pgvector extension");
  });

  test("rejects an MPS model with multiple application roots", () => {
    const duplicate = catalogXml.replace("</model>", '<node concept="qa" id="other" />\n</model>');
    expect(() => parseMpsDatabaseModel(duplicate, structureXml)).toThrow("expected one Application root");
  });

  test("rejects unsupported declared field semantics and invalid booleans", () => {
    const declared = catalogXml.replace('<property id="720000000000000608" name="extension" index="qx" />', '<property id="720000000000000607" name="generated" index="qgenerated" />\n        <property id="720000000000000608" name="extension" index="qx" />');
    const model = declared.replace('<property role="qq" value="Text" />', '<property role="qq" value="Text" />\n        <property role="qgenerated" value="true" />');
    expect(() => parseMpsDatabaseModel(model, structureXml)).toThrow("unsupported Field.generated");
    const invalid = catalogXml.replace('role="qt" value="true"', 'role="qt" value="maybe"');
    expect(() => parseMpsDatabaseModel(invalid, structureXml)).toThrow("primaryKey must be true or false");
    const invalidNullable = relationsXml.replace('role="qs" value="false"', 'role="qs" value="maybe"');
    expect(() => parseMpsDatabaseModel(invalidNullable, structureXml)).toThrow("nullable must be true or false");
    const invalidVisibility = erpWorkflowXml.replace('role="qlistVisible" value="false"', 'role="qlistVisible" value="maybe"');
    expect(() => parseMpsProjectModel(invalidVisibility, structureXml)).toThrow("listVisible must be true or false");
    const invalidSortable = erpWorkflowXml.replace('role="qsortable" value="false"', 'role="qsortable" value="sometimes"');
    expect(() => parseMpsProjectModel(invalidSortable, structureXml)).toThrow("sortable must be true or false");
    const invalidIndex = relationsXml.replace('role="qconcurrently" value="false"', 'role="qconcurrently" value="maybe"');
    expect(() => parseMpsDatabaseModel(invalidIndex, structureXml)).toThrow("concurrently must be true or false");
    const invalidScale = relationsXml.replace('role="qscale" value="0"', 'role="qscale" value="0.5"');
    expect(() => parseMpsDatabaseModel(invalidScale, structureXml)).toThrow("scale must be a safe integer");
  });

  test("parses explicit relations and rejects invalid relation semantics", () => {
    const relation = `<node concept="qrelation" id="110000000000020" role="qrelations">
      <property role="TrG5h" value="productParent" />
      <property role="qfromEntity" value="products" />
      <property role="qfromField" value="id" />
      <property role="qtoEntity" value="products" />
      <property role="qtoField" value="id" />
      <property role="qcardinality" value="one" />
      <property role="qonDelete" value="restrict" />
    </node>`;
    const model = catalogXml.replace('<node concept="qk" id="110000000000004" role="qe">', `${relation}\n    <node concept="qk" id="110000000000004" role="qe">`);
    const database = parseMpsDatabaseModel(model, structureXml);
    expect(database.relations).toEqual([{
      name: "productParent",
      fromEntity: "products",
      fromField: "id",
      toEntity: "products",
      toField: "id",
      cardinality: "one",
      onDelete: "restrict",
    }]);
    expect(validateDatabaseIR(database)).toEqual([]);
    const projected = parseQiyProject(exportMpsProjectAsQiy(model, structureXml));
    expect(projected.database).toEqual(database);
    const generated = generateProject(database, "mps-relation");
    expect(generated["apps/server/src/schema.ts"]).toContain('references(() => products["id"], { onDelete: "restrict" })');

    const invalidCardinality = model.replace('role="qcardinality" value="one"', 'role="qcardinality" value="many"');
    expect(validateDatabaseIR(parseMpsDatabaseModel(invalidCardinality, structureXml)).join("\n")).toContain("only one-to-one/many-to-one foreign keys are supported");
    const invalidDelete = model.replace('role="qonDelete" value="restrict"', 'role="qonDelete" value="truncate"');
    expect(() => parseMpsDatabaseModel(invalidDelete, structureXml)).toThrow("onDelete must be restrict, cascade or setNull");
  });
});

