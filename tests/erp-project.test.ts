import { describe, expect, test } from "bun:test";
import { parseQiyProject } from "../tools/qiy-project";
import { generateProject } from "../tools/generate-project";

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
    expect(project.workflows).toEqual(["orderInventory"]);
    expect(project.dashboardMetrics).toHaveLength(6);
    expect(project.dashboardMetrics?.find((metric) => metric.name === "orderTrend")).toMatchObject({ type: "trend", groupBy: "createdAt", days: 30 });
  });

  test("generates independent modules for ERP resources", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, { dashboardMetrics: project.dashboardMetrics, scopes: project.scopes, workflows: project.workflows });
    for (const resource of ["users", "customers", "inventoryItems", "orders", "orderItems"]) {
      expect(files[`apps/server/src/modules/${resource}/${resource}.contract.ts`]).toBeTruthy();
      expect(files[`apps/server/src/modules/${resource}/${resource}.repository.ts`]).toBeTruthy();
      expect(files[`apps/server/src/modules/${resource}/${resource}.service.ts`]).toBeTruthy();
      expect(files[`apps/server/src/modules/${resource}/${resource}.routes.ts`]).toBeTruthy();
    }
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("order_items"');
    expect(files["apps/server/package.json"]).toContain('"@elysia/openapi": "1.4.16"');
    expect(files["apps/server/src/app.ts"]).toContain('from "@elysia/openapi"');
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("order_reservations"');
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("order_idempotency"');
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("attachments"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain('get("/metadata"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain("cleanupMissingAttachmentObjects");
    expect(files["apps/server/src/storage/cleanup.ts"]).toContain("--apply");
    expect(files["apps/server/package.json"]).toContain('"attachments:cleanup"');
    expect(files["deploy/kubernetes/deployment.yaml"]).toContain("persistentVolumeClaim:");
    expect(files["deploy/kubernetes/persistent-volume-claim.yaml"]).toContain("ReadWriteMany");
    expect(files["docker-compose.yml"]).toContain("QIY_STORAGE_METADATA");
    expect(files["apps/server/package.json"]).toContain('"attachments:cleanup"');
    expect(files["apps/server/src/workflows/allocation.ts"]).toContain("planInventoryAllocation");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("orderReservations");
    expect(files["apps/server/src/workflows/order.ts"]).toContain('for("update")');
    expect(files["apps/server/src/workflows/order.ts"]).not.toContain("GREATEST(0");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("createOrderWorkflowRoutes");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("idempotency-key");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("orderIdempotency");
    expect(files["apps/web/app/features/orders/order-actions.tsx"]).toContain("useCustomMutation");
    expect(files["apps/web/app/routes/show.tsx"]).toContain("<OrderWorkflowActions");
    expect(files["apps/web/tests/workflow.test.ts"]).toContain("idempotency-key");
    expect(files["apps/server/src/workflows/order.ts"]).not.toContain("new Map<string, Record<string, unknown>>");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("db.transaction");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("order.submitted");
    expect(files["apps/server/src/workflows/order.ts"]).toContain("order.shipped");
    expect(files["apps/server/src/workflows/order.ts"]).toContain('requiredScopeClaim = "tenant.customerId"');
    expect(files["apps/server/src/workflows/order.ts"]).toContain('eq(orders.customerId, String(value))');
    expect(files["apps/server/src/workflows/order.ts"]).toContain('eq(orders.status, "approved"), scopeCondition');
    expect(files["apps/server/tests/data-scope.test.ts"]).toContain("order workflows reject missing scope claims");
    expect(files["apps/server/tests/workflow-provider.test.ts"]).toContain("createGraphQLDataProvider");
    expect(files["apps/server/tests/workflow-provider.test.ts"]).toContain('transport === "GraphQL" ? "/graphql"');
    expect(files["apps/server/tests/workflow-provider.test.ts"]).toContain('rejects.toThrow("Idempotency key is too long")');
    const ordersRepository = files["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(ordersRepository).toContain("db.transaction(async (tx) =>");
    expect(ordersRepository).toContain('action: "orders.created"');
    expect(ordersRepository).toContain('action: "orders.updated"');
    expect(ordersRepository).toContain('action: "orders.deleted"');
    expect(ordersRepository).toContain("actorId: actorId ?? null");
    expect(files["apps/server/src/graphql.ts"]).toContain("contextValue: { actorId:");
    expect(files["apps/server/src/schema.ts"]).toContain('pgTable("audit_events"');
    expect(files["apps/server/src/storage/routes.ts"]).toContain("25 * 1024 * 1024");
    expect(files["apps/server/src/preview.ts"]).toContain('role: "admin", claims: {"tenant.customerId":"00000000-0000-4000-8000-000000000002"} }), false, true);');
    expect(files["apps/server/src/schema.ts"]).toContain('"datasheet": text("datasheet")');
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain('<FileInput name={field.name} resource={resource.name} resourceId={id} />');
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain('resourceId={id}');
    expect(files["apps/web/app/resources.ts"]).toContain('"orders"');
    expect(files["apps/web/app/dashboard.ts"]).toContain('"name": "orderCount"');
    expect(files["apps/web/app/routes/home.tsx"]).toContain("useCustom");
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

  test("uses Bun's SQLite migrator for SQLite packages", () => {
    const project = parseQiyProject(source.replace("database postgresql {", "database sqlite {").replace("  workflow orderInventory;", ""));
    const files = generateProject(project.database, project.name, { dashboardMetrics: project.dashboardMetrics, scopes: project.scopes, workflows: project.workflows });
    const serverPackage = JSON.parse(files["apps/server/package.json"]!) as { scripts: Record<string, string> };
    expect(serverPackage.scripts["db:migrate"]).toBe("bun src/migrate.ts");
    expect(files["apps/server/src/migrate.ts"]).toContain('from "drizzle-orm/bun-sqlite/migrator"');
    expect(files["apps/server/src/migrate.ts"]).toContain('migrationsFolder: resolve(import.meta.dir, "../drizzle")');
  });
});
