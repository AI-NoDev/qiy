import { describe, expect, test } from "bun:test";
import { parseQiyProject } from "../tools/qiy-project";
import { generateProject, projectGenerationOptions } from "../tools/generate-project";

const source = await Bun.file(new URL("../examples/erpadmin/app.qiy", import.meta.url)).text();

describe("ERP Admin project", () => {
  test("parses the multi-module ERP model", () => {
    const project = parseQiyProject(source);
    expect(project.name).toBe("qiy-erp-admin");
    expect(project.database.entities).toHaveLength(7);
    expect(project.database.entities.map((entity) => entity.tableName)).toEqual([
      "users", "customers", "warehouses", "products", "inventory_items", "orders", "order_items",
    ]);
    expect(project.database.entities.find((entity) => entity.name === "orders")?.indexes).toHaveLength(2);
    expect(project.stateMachines?.map((machine) => [machine.name, machine.transitions.map((transition) => transition.name)])).toEqual([["orderLifecycle", ["submit", "approve", "ship", "cancel"]]]);
    expect(project.charts).toHaveLength(6);
    expect(project.charts?.find((chart) => chart.name === "OrderTrend")?.views[0]).toMatchObject({ kind: "line", data: { operation: "trend", entity: "orders", field: "createdAt", days: 30 } });
  });

  test("generates independent modules for ERP resources", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, projectGenerationOptions(project));
    for (const resource of ["users", "customers", "inventoryItems", "orders", "orderItems"]) {
      expect(files[`apps/server/src/modules/${resource}/${resource}.contract.ts`]).toBeTruthy();
      expect(files[`apps/server/src/modules/${resource}/${resource}.repository.ts`]).toBeTruthy();
      expect(files[`apps/server/src/modules/${resource}/${resource}.service.ts`]).toBeTruthy();
      expect(files[`apps/server/src/modules/${resource}/${resource}.routes.ts`]).toBeTruthy();
    }
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("order_items"');
    expect(files["apps/server/package.json"]).toContain('"@elysia/openapi": "1.4.16"');
    expect(files["apps/server/src/app.ts"]).toContain('from "@elysia/openapi"');
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("attachments"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain('get("/metadata"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain("cleanupMissingAttachmentObjects");
    expect(files["apps/server/src/storage/cleanup.ts"]).toContain("--apply");
    expect(files["apps/server/package.json"]).toContain('"attachments:cleanup"');
    expect(files["deploy/kubernetes/deployment.yaml"]).toContain("persistentVolumeClaim:");
    expect(files["deploy/kubernetes/persistent-volume-claim.yaml"]).toContain("ReadWriteOnce");
    expect(files["docker-compose.yml"]).toContain("./apps/server/.env.production");
    expect(files["apps/server/.env.production"]).toContain("QIY_STORAGE_METADATA=database");
    expect(files["apps/server/package.json"]).toContain('"attachments:cleanup"');
    const dataflows = files["apps/server/src/dataflows/index.ts"] ?? "";
    for (const command of ["orderLifecycleSubmit", "orderLifecycleApprove", "orderLifecycleShip", "orderLifecycleCancel"]) expect(dataflows).toContain(`"/${command}"`);
    expect(dataflows).toContain('principal?.claims?.["tenant.customerId"]');
    expect(dataflows).toContain('for("update")');
    expect(files["apps/server/src/modules/orders/orders.routes.ts"]).not.toMatch(/"status": t\./);
    expect(files["apps/web/app/actions.ts"]).toContain('"operator": "in"');
    expect(files["apps/server/src/workflows/order.ts"]).toBeUndefined();
    const ordersRepository = files["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(ordersRepository).toContain("db.transaction(async (tx) =>");
    expect(ordersRepository).toContain('action: "orders.created"');
    expect(ordersRepository).toContain('action: "orders.updated"');
    expect(ordersRepository).toContain('action: "orders.deleted"');
    expect(ordersRepository).toContain("actorId: actorId ?? null");
    expect(files["apps/server/src/graphql.ts"]).toContain("contextValue: { request, principal, actorId:");
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("audit_events"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain('"products.datasheet"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain('"maxBytes": 10485760');
    expect(files["apps/server/src/storage/routes.ts"]).toContain('"application/pdf"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain('.post("/base64"');
    expect(files["apps/server/src/preview.ts"]).toContain('role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }), true);');
    expect(files["apps/server/src/schema.ts"]).toContain('"datasheet": text("datasheet")');
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain('<FileInput field={field} resource={resource.name} resourceId={id} />');
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain('resourceId={id}');
    expect(files["apps/web/app/resources.ts"]).toContain('"orders"');
    expect(files["apps/web/app/dashboard.ts"]).toBeUndefined();
    expect(files["apps/web/app/charts.ts"]).toContain('"name": "OrderCount"');
    expect(files["apps/server/src/modules/orders/orders.repository.ts"]).toContain("groupBy(column)");
    expect(files["apps/server/src/modules/orders/orders.routes.ts"]).toContain('"claim":"tenant.customerId"');
    expect(files["apps/server/src/modules/orders/orders.repository.ts"]).toContain('"customerId": orders.customerId');
    expect(files["apps/server/src/modules/orders/orders.repository.ts"]).toContain("scopeCondition");
    expect(files["apps/server/src/graphql.ts"]).toContain('"resource":"orders","field":"customerId","claim":"tenant.customerId"');
    expect(files["apps/server/src/graphql.ts"]).toContain('context.scopeFor("orders")');
    expect(files["apps/server/src/modules/orders/orders.routes.ts"]).toContain("service.create(body, (await authenticate(request))?.id, await resolveScope(request))");
    expect(files["apps/web/app/icons.tsx"]).toContain("SafetyOutlined");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("enumValue.icon");
  });

  test("points the removed workflow declaration at the statemachine migration", () => {
    expect(() => parseQiyProject(source.replace("  storage { provider local; }", "  storage { provider local; }\n  workflow orderInventory;"))).toThrow("near token");
  });

  test("uses Bun's SQLite migrator for SQLite packages", () => {
    const project = parseQiyProject(source.replace("database postgresql {", "database sqlite {"));
    const files = generateProject(project.database, project.name, projectGenerationOptions(project));
    const serverPackage = JSON.parse(files["apps/server/package.json"]!) as { scripts: Record<string, string> };
    expect(serverPackage.scripts["db:migrate"]).toBe("bun --env-file=.env.development src/db-migrate.ts");
    expect(files["apps/server/src/db-migrate.ts"]).toContain('from "drizzle-orm/bun-sqlite/migrator"');
    expect(files["apps/server/src/db-migrate.ts"]).toContain('migrationsFolder = resolve(import.meta.dir, "../drizzle")');
    expect(files["apps/server/src/db-migrate.ts"]).toContain("compareSchema(expectedTables(), await introspect())");
    expect(serverPackage.scripts["db:rollback"]).toBe("bun --env-file=.env.production src/db-rollback.ts");
    expect(files["apps/server/src/db-rollback.ts"]).toContain("drizzle/down/");
    expect(files["apps/server/src/db-rollback.ts"]).toContain('if (!Bun.argv.includes("--confirm"))');
    expect(serverPackage.scripts["db:backup"]).toBe("bun --env-file=.env.production src/db-backup.ts");
    expect(serverPackage.scripts["db:restore"]).toBe("bun --env-file=.env.production src/db-restore.ts");
    expect(files[".gitignore"]).toContain("apps/server/backups/");
  });
});
