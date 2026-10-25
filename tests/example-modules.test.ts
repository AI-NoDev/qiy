import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateProject } from "../tools/generate-project";
import { qiyModelKeys } from "../tools/generate-web";
import { loadQiyProjectSource } from "../tools/qiy-include";
import { parseQiyProject } from "../tools/qiy-project";

const selfRoot = join(import.meta.dir, "..", "examples", "self");
const moduleText = (path: string) => readFileSync(join(selfRoot, "modules", path), "utf8");
const moduleEntities = (text: string) => [...text.matchAll(/^entity\s+([a-zA-Z_][a-zA-Z_0-9]*)/gm)].map((match) => match[1]!);

async function modularProject() {
  const expanded = await loadQiyProjectSource(join(selfRoot, "app.qiy"));
  return { expanded, project: parseQiyProject(expanded) };
}

describe("modular demo model", () => {
  test("expands the include graph into one model with no unresolved includes", async () => {
    const { expanded, project } = await modularProject();
    expect(expanded).not.toMatch(/^\s*include\s+"/m);
    expect(project.name).toBe("qiy-supply-chain-erp-wms");
    expect(project.database.dialect).toBe("sqlite");
    expect(project.database.entities).toHaveLength(17);
    expect(project.database.entities.reduce((sum, entity) => sum + entity.fields.length, 0)).toBe(108);
    expect(project.database.enums).toHaveLength(8);
    expect(project.database.enums!.reduce((sum, enumeration) => sum + enumeration.values.length, 0)).toBe(36);
    expect(project.database.relations).toHaveLength(23);
    expect(project.pages).toHaveLength(4);
    expect(project.menuGroups).toHaveLength(6);
    expect(project.dashboardMetrics).toBeUndefined();
    expect(project.charts).toHaveLength(4);
    expect(project.charts?.reduce((sum, chart) => sum + chart.views.length, 0)).toBe(5);
    expect(project.chartPanels).toHaveLength(2);
    expect(project.dataflows).toHaveLength(8);
    expect(project.actions).toHaveLength(8);
    expect(project.auth?.providers).toEqual(["okta", "keycloak", "google", "kinde", "azure-ad-b2c"]);
    expect(project.auth?.local).toBe(true);
  });

  test("migrates commands to permission/verification rules while keeping one legacy role rule", async () => {
    const { project } = await modularProject();
    const permissions = project.permissions!;
    expect(permissions.fields).toHaveLength(12);
    expect(permissions.groups.map((group) => group.name)).toEqual([
      "UserApiPermissionGroup", "ManagerRole", "SuperAdminManager", "admin", "operator", "viewer",
    ]);
    // `&` is a union: SuperAdminManager holds both groups' permissions.
    expect(permissions.groups.find((group) => group.name === "SuperAdminManager")?.members).toEqual(["UserApiPermissionGroup", "ManagerRole"]);
    expect(permissions.database).toEqual({ entity: "users", field: "permissions" });
    expect(permissions.claims).toEqual([
      { provider: "azure-ad-b2c", claim: "roles" },
      { provider: "google", claim: "groups" },
      { provider: "keycloak", claim: "roles" },
    ]);
    expect(permissions.verifications.map((verification) => verification.name)).toEqual(["CanAccessUserApi", "CanManageUsers", "CanShipOrders", "CanAdjustStock"]);
    const byName = new Map(project.dataflows!.map((flow) => [flow.name, flow]));
    expect(byName.get("shipSalesOrder")?.verification).toBe("CanShipOrders");
    expect(byName.get("receiveInventory")?.permission).toEqual(["InventoryReceivePermission"]);
    expect(byName.get("approvePurchaseOrder")?.permission).toEqual(["PurchaseApprovePermission"]);
    // Backward compatibility: the legacy role form stays supported and generated.
    expect(byName.get("reserveStock")?.roles).toEqual(["admin", "operator"]);
    expect(byName.get("reserveStock")?.permission).toBeUndefined();
  });

  test("splits entities across platform, SCM, ERP and WMS modules", () => {
    expect(moduleEntities(moduleText("platform.qiy"))).toEqual(["users"]);
    expect(moduleEntities(moduleText("scm/entities.qiy"))).toEqual(["orgs", "suppliers", "customers", "products", "boms"]);
    expect(moduleEntities(moduleText("erp/entities.qiy"))).toEqual(["purchase_orders", "purchase_order_lines", "receipts", "sales_orders", "sales_order_lines", "shipments"]);
    expect(moduleEntities(moduleText("wms/entities.qiy"))).toEqual(["warehouses", "bins", "inventory", "stock_movements", "work_orders"]);
    // Enums come from the platform module, everything else stays domain-specific.
    for (const path of ["scm/entities.qiy", "erp/entities.qiy", "wms/entities.qiy"]) {
      expect(moduleText(path)).not.toMatch(/^\s*(enum|relation|scope|restrict|pages|menu|dashboard|dataflow|action)\s/m);
    }
    expect(moduleText("relations.qiy").match(/^relation\s/gm)).toHaveLength(23);
    expect(moduleText("platform.qiy").match(/^enum\s/gm)).toHaveLength(8);
  });

  test("keeps scope, restrict and UI configuration at the parser-required positions", async () => {
    const { project } = await modularProject();
    expect(project.scopes).toEqual([{ resource: "warehouses", field: "orgId", claim: "org.id" }]);
    expect(project.restrictions?.[0]?.resource).toBe("products");
    expect(project.restrictions?.[0]?.masks).toEqual([{ field: "unitCost", roles: ["operator", "viewer"], mode: "redact", replacement: "***" }]);
    expect(project.pages?.map((page) => page.resource)).toEqual(["inventory", "stock_movements", "purchase_orders", "sales_orders"]);
  });

  test("groups every resource into one sidebar menu group in a readable order", async () => {
    const { project } = await modularProject();
    const groups = project.menuGroups!;
    // Group order is the sidebar order; every group has an icon and a label.
    expect(groups.map((group) => group.name)).toEqual(["masterData", "purchasing", "sales", "inventory", "production", "system"]);
    expect(groups.every((group) => Boolean(group.icon && group.label))).toBe(true);
    expect(groups.find((group) => group.name === "masterData")?.resources).toEqual(["suppliers", "customers", "products", "boms"]);
    expect(groups.find((group) => group.name === "purchasing")?.resources).toEqual(["purchase_orders", "purchase_order_lines", "receipts"]);
    expect(groups.find((group) => group.name === "inventory")?.resources).toEqual(["warehouses", "bins", "inventory", "stock_movements"]);
    // All 17 resources are grouped exactly once, so nothing is flattened or missing.
    const groupedResources = groups.flatMap((group) => group.resources);
    expect(groupedResources).toHaveLength(17);
    expect(new Set(groupedResources).size).toBe(17);
    expect([...groupedResources].sort()).toEqual(project.database.entities.map((entity) => entity.tableName).sort());
  });

  test("ships a complete zh-CN / en-US dictionary for every model-derived label", async () => {
    const { project } = await modularProject();
    expect(project.messages?.defaultLocale).toBe("zh-CN");
    const locales = project.messages!.locales;
    expect(Object.keys(locales)).toEqual(["zh-CN", "en-US"]);

    const expected = new Set<string>();
    const add = (key: string) => expected.add(key);
    for (const entity of project.database.entities) {
      add(qiyModelKeys.resourceLabel(entity.tableName));
      add(qiyModelKeys.resourceSingular(entity.tableName));
      add(qiyModelKeys.resourcePlural(entity.tableName));
      for (const field of entity.fields) add(qiyModelKeys.fieldLabel(entity.tableName, field.name));
    }
    for (const enumeration of project.database.enums ?? []) {
      add(qiyModelKeys.enumLabel(enumeration.name));
      for (const value of enumeration.values) add(qiyModelKeys.enumValueLabel(enumeration.name, value.name));
    }
    for (const group of project.menuGroups ?? []) add(qiyModelKeys.menuLabel(group.name));
    for (const metric of project.dashboardMetrics ?? []) add(qiyModelKeys.dashboardLabel(metric.name));
    for (const chart of project.charts ?? []) {
      add(qiyModelKeys.chartLabel(chart.name));
      for (const view of chart.views) {
        add(qiyModelKeys.chartViewLabel(chart.name, view.kind));
        // Distribution label overrides are model-derived too (`qiy.charts.<chart>.labels.<value>`).
        if (view.labels?.values?.length) {
          for (const entry of view.labels.values) add(qiyModelKeys.chartLabelValue(chart.name, entry.value));
          continue;
        }
        const fieldName = view.labels?.field ?? view.data.groupBy;
        const entity = project.database.entities.find((candidate) => candidate.tableName === view.data.entity);
        const enumName = fieldName ? entity?.fields.find((candidate) => candidate.name === fieldName)?.enumName : undefined;
        const enumeration = enumName ? project.database.enums?.find((candidate) => candidate.name === enumName) : undefined;
        for (const value of enumeration?.values ?? []) add(qiyModelKeys.chartLabelValue(chart.name, value.name));
      }
    }
    for (const panel of project.chartPanels ?? []) add(qiyModelKeys.chartLabel(panel.name));
    const dataflows = new Map((project.dataflows ?? []).map((flow) => [flow.name, flow]));
    for (const action of project.actions ?? []) {
      add(qiyModelKeys.actionLabel(action.name));
      if (action.target.kind !== "dataflow") continue;
      if (action.target.confirm !== undefined) add(qiyModelKeys.actionConfirm(action.name));
      const flow = dataflows.get(action.target.dataflow)!;
      for (const input of flow.input) add(qiyModelKeys.actionInputLabel(action.name, input.name));
    }
    // Business rule failures are localized through the same dictionary.
    for (const flow of project.dataflows ?? []) {
      for (const step of flow.steps) {
        for (const rule of step.actions) if (rule.kind === "require" && rule.errorKey) add(rule.errorKey);
      }
    }
    // A few static page-chrome keys the generated pages look up through the same dictionary.
    for (const key of ["qiy.overview", "qiy.overviewDescription", "qiy.profile", "qiy.language", "qiy.filters", "qiy.search", "qiy.matchAll", "qiy.matchAny", "qiy.commaSeparated", "qiy.forbidden"]) add(key);

    expect(expected.size).toBeGreaterThan(200);
    for (const locale of ["zh-CN", "en-US"]) {
      const dictionary = locales[locale]!;
      const missing = [...expected].filter((key) => typeof dictionary[key] !== "string" || dictionary[key]!.trim() === "");
      expect(missing).toEqual([]);
    }
    // Chinese and English really differ for model labels.
    expect(locales["zh-CN"]!["qiy.resources.products.label"]).toBe("产品");
    expect(locales["en-US"]!["qiy.resources.products.label"]).toBe("Products");
    expect(locales["zh-CN"]!["qiy.resources.stock_movements.fields.type.label"]).toBe("类型");
    expect(locales["en-US"]!["qiy.actions.completeWorkOrder.label"]).toBe("Complete work order");
    expect(locales["zh-CN"]!["errors.inventory.quantityPositive"]).toBe("数量必须大于 0");
    expect(locales["en-US"]!["errors.inventory.quantityPositive"]).toBe("Quantity must be greater than zero");
    // Menu groups are translated through the same dictionary.
    expect(locales["zh-CN"]!["qiy.menu.masterData.label"]).toBe("基础资料");
    expect(locales["zh-CN"]!["qiy.menu.inventory.label"]).toBe("库存与仓储");
    expect(locales["en-US"]!["qiy.menu.masterData.label"]).toBe("Master data");
    expect(locales["en-US"]!["qiy.menu.inventory.label"]).toBe("Inventory & warehouse");
    // Chart titles, view labels, distribution overrides and panel titles are translated too.
    expect(locales["zh-CN"]!["qiy.charts.Overview.label"]).toBe("概览");
    expect(locales["en-US"]!["qiy.charts.Overview.label"]).toBe("Overview");
    expect(locales["zh-CN"]!["qiy.charts.UserStatusCount.views.pie.label"]).toBe("用户状态分布");
    expect(locales["en-US"]!["qiy.charts.UserStatusCount.labels.admin"]).toBe("Administrators");
    expect(locales["zh-CN"]!["qiy.charts.UserStatusCount.labels.admin"]).toBe("管理员账号");
  });

  test("declares a realistic multi-view chart dashboard", async () => {
    const { project } = await modularProject();
    const charts = project.charts!;
    const panels = project.chartPanels!;
    expect(charts.map((chart) => chart.name)).toEqual(["UserCount", "UserStatusCount", "MovementTrend", "InventoryTable"]);
    expect(charts.every((chart) => chart.title && chart.views.length > 0)).toBe(true);
    const kinds = charts.flatMap((chart) => chart.views.map((view) => view.kind));
    // The dashboard covers every supported view kind.
    for (const kind of ["const", "pie", "bar", "line", "table"] as const) expect(kinds).toContain(kind);
    // One chart is declared twice with different kinds -> multi-view card with pie + bar.
    const multiView = charts.find((chart) => chart.name === "UserStatusCount")!;
    expect(multiView.views.map((view) => view.kind)).toEqual(["pie", "bar"]);
    expect(multiView.views[0]?.data).toEqual({ operation: "count", entity: "users", groupBy: "role" });
    expect(multiView.views[0]?.labels).toEqual({ field: "role" });
    expect(multiView.views[1]?.labels).toEqual({ values: [{ value: "admin", label: "管理员" }, { value: "operator", label: "运营" }, { value: "viewer", label: "只读" }] });
    // Stat / line / table data declarations map onto the documented operations.
    expect(charts.find((chart) => chart.name === "UserCount")?.views[0]?.data).toEqual({ operation: "count", entity: "users" });
    expect(charts.find((chart) => chart.name === "MovementTrend")?.views[0]?.data).toEqual({ operation: "trend", entity: "stock_movements", field: "occurredAt", days: 30 });
    expect(charts.find((chart) => chart.name === "InventoryTable")?.views[0]?.data).toEqual({ operation: "list", entity: "inventory", columns: ["inventoryKey", "warehouseId", "quantity", "reserved"] });
    // Two panels exercise the page-level view selector; both use a 24x24 grid.
    expect(panels.map((panel) => panel.name)).toEqual(["Overview", "Operations"]);
    expect(panels.every((panel) => panel.grid.columns === 24 && panel.grid.rows === 24)).toBe(true);
    expect(panels[0]?.charts.map((chart) => chart.name)).toEqual(["UserCount", "UserStatusCount", "MovementTrend", "InventoryTable"]);
    // Every chart has the three responsive variants and stays inside the grid.
    for (const panel of panels) {
      for (const entry of panel.charts) {
        expect(entry.placements.map((placement) => placement.variant)).toEqual(["larger", "medium", "small"]);
        for (const placement of entry.placements) {
          expect(placement.x + placement.w).toBeLessThanOrEqual(panel.grid.columns);
          expect(placement.y + placement.h).toBeLessThanOrEqual(panel.grid.rows);
        }
      }
    }
    const chartNames = new Set(charts.map((chart) => chart.name));
    for (const panel of panels) for (const entry of panel.charts) expect(chartNames.has(entry.name)).toBe(true);
  });

  test("generates the same resources and fields from the modular source", async () => {
    const { project } = await modularProject();
    const files = generateProject(project.database, project.name, project);
    const resources = files["apps/web/app/resources.ts"]!;
    for (const entity of project.database.entities) {
      expect(resources).toContain(`"labelKey": "${qiyModelKeys.resourceLabel(entity.tableName)}"`);
      for (const field of entity.fields) expect(resources).toContain(`"labelKey": "${qiyModelKeys.fieldLabel(entity.tableName, field.name)}"`);
    }
    // All 17 resources and 108 fields survive generation (column choices use the same list).
    expect(resources.match(/"apiName":/g)).toHaveLength(17);
    expect(resources.match(/"filterModes":/g)).toHaveLength(108);
    // The dictionary is merged into the generated app and exercised by generated tests.
    const messages = files["apps/web/app/messages.ts"]!;
    expect(messages).toContain('"qiy.resources.products.label": "产品"');
    expect(messages).toContain('"qiy.resources.customers.singular": "客户"');
    expect(messages).toContain('"qiy.resources.customers.plural": "Customers"');
    expect(messages).toContain('"qiy.charts.UserStatusCount.views.pie.label": "用户状态分布"');
    expect(messages).toContain('"qiy.charts.UserStatusCount.labels.admin": "管理员账号"');
    expect(messages).toContain('"qiy.charts.Overview.label": "概览"');
    // Chart dashboard metadata (views + responsive grid) reaches the generated web app and tests.
    expect(files["apps/web/app/charts.ts"]).toContain('"name": "UserStatusCount"');
    expect(files["apps/web/app/charts.ts"]).toContain('"labelKey": "qiy.charts.UserStatusCount.views.bar.label"');
    expect(files["apps/web/app/charts.ts"]).toContain('"variant": "larger"');
    expect(files["apps/web/app/charts.ts"]).toContain('"grid": {');
    expect(files["apps/web/app/components/charts.tsx"]).toContain("export function ChartCard");
    expect(files["apps/web/app/components/charts.tsx"]).toContain("selectChartPlacement");
    expect(files["apps/web/app/components/charts.tsx"]).toContain("matchMedia");
    expect(files["apps/web/app/routes/home.tsx"]).toContain("ChartDashboard");
    expect(files["apps/web/app/routes/home.tsx"]).toContain("charts.length > 0");
    expect(files["apps/web/app/dashboard.ts"]).toContain("export const dashboardMetrics: DashboardMetric[] = []");
    expect(files["apps/web/tests/charts.test.ts"]).toContain("variant selection shrinks larger -> medium -> small");
    expect(files["apps/web/tests/charts-render.test.tsx"]).toContain("renders every chart kind with grid placements and selectors");
    // Grouped sidebar metadata: resource -> group parent, and the group keeps its menu order.
    expect(resources).toContain('"menuParent": "menu-masterData"');
    expect(resources).toContain('"menuParent": "menu-purchasing"');
    expect(resources).toContain('"menuParent": "menu-system"');
    expect(resources).toContain("export const menuGroups: MenuGroupDefinition[]");
    expect(resources).toContain('"resources": [');
    expect(files["apps/web/app/components/menu.tsx"]).toContain("export function buildMenuTree");
    expect(files["apps/web/app/components/menu.tsx"]).toContain("export function QiySider");
    expect(files["apps/web/app/ui/index.tsx"]).toContain("Sider={Sider ?? QiySider}");
    expect(files["apps/web/tests/menu-tree.test.ts"]).toContain("groups resources into nested items in declared order");
    expect(files["apps/web/tests/project-messages.test.ts"]).toContain("qiy.resources.stock_movements.label");
    expect(files["apps/web/tests/model-i18n.test.ts"]).toContain("model labels switch between the declared Chinese and English dictionaries");
  });

  test("annotates every entity with display metadata and every foreign-key target with a drawer body", async () => {
    const { project } = await modularProject();
    for (const entity of project.database.entities) {
      // Django-style metadata is complete for every entity, not just the demo highlights.
      expect(entity.singular, entity.name).toBeTruthy();
      expect(entity.plural, entity.name).toBeTruthy();
      expect(entity.display, entity.name).toBeTruthy();
      expect(entity.tableDisplay, entity.name).toBeTruthy();
      expect(entity.relationDetail, entity.name).toBeTruthy();
    }
    const targets = new Set((project.database.relations ?? []).map((relation) => relation.toEntity));
    expect(targets.size).toBeGreaterThan(0);
    for (const target of targets) {
      const entity = project.database.entities.find((candidate) => candidate.name === target)!;
      expect(entity.relationDetail, `${target} FK drawer body`).toBeTruthy();
      expect(entity.tableDisplay, `${target} FK column text`).toBeTruthy();
      expect(entity.display, `${target} display text`).toBeTruthy();
    }
    const { generateWeb } = await import("../tools/generate-web");
    const web = generateWeb(project.database, project);
    expect(web["web/app/routes/list.tsx"]).toContain("RelationCell");
    expect(web["web/app/routes/show.tsx"]).toContain("<RecordDetails");
    expect(web["web/app/components/record-details.tsx"]).toContain("RelationCell");
    expect(web["web/app/components/relation-field.tsx"]).toContain("RelatedRecordBody");
    expect(web["web/app/components/relation-field.tsx"]).toContain("RelationSelect");
  });
});
