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
    expect(project.database.entities.reduce((sum, entity) => sum + entity.fields.length, 0)).toBe(104);
    expect(project.database.enums).toHaveLength(6);
    expect(project.database.enums!.reduce((sum, enumeration) => sum + enumeration.values.length, 0)).toBe(27);
    expect(project.database.relations).toHaveLength(21);
    expect(project.pages).toHaveLength(4);
    expect(project.dashboardMetrics).toHaveLength(6);
    expect(project.dataflows).toHaveLength(7);
    expect(project.actions).toHaveLength(7);
    expect(project.auth?.providers).toEqual(["okta", "keycloak", "google", "kinde", "azure-ad-b2c"]);
    expect(project.auth?.local).toBe(true);
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
    expect(moduleText("relations.qiy").match(/^relation\s/gm)).toHaveLength(21);
    expect(moduleText("platform.qiy").match(/^enum\s/gm)).toHaveLength(6);
  });

  test("keeps scope, restrict and UI configuration at the parser-required positions", async () => {
    const { project } = await modularProject();
    expect(project.scopes).toEqual([{ resource: "warehouses", field: "orgId", claim: "org.id" }]);
    expect(project.restrictions?.[0]?.resource).toBe("products");
    expect(project.restrictions?.[0]?.masks).toEqual([{ field: "unitCost", roles: ["operator", "viewer"], mode: "redact", replacement: "***" }]);
    expect(project.pages?.map((page) => page.resource)).toEqual(["inventory", "stock_movements", "purchase_orders", "sales_orders"]);
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
      for (const field of entity.fields) add(qiyModelKeys.fieldLabel(entity.tableName, field.name));
    }
    for (const enumeration of project.database.enums ?? []) {
      add(qiyModelKeys.enumLabel(enumeration.name));
      for (const value of enumeration.values) add(qiyModelKeys.enumValueLabel(enumeration.name, value.name));
    }
    for (const group of project.menuGroups ?? []) add(qiyModelKeys.menuLabel(group.name));
    for (const metric of project.dashboardMetrics ?? []) add(qiyModelKeys.dashboardLabel(metric.name));
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
  });

  test("generates the same resources and fields from the modular source", async () => {
    const { project } = await modularProject();
    const files = generateProject(project.database, project.name, project);
    const resources = files["apps/web/app/resources.ts"]!;
    for (const entity of project.database.entities) {
      expect(resources).toContain(`"labelKey": "${qiyModelKeys.resourceLabel(entity.tableName)}"`);
      for (const field of entity.fields) expect(resources).toContain(`"labelKey": "${qiyModelKeys.fieldLabel(entity.tableName, field.name)}"`);
    }
    // All 17 resources and 104 fields survive generation (column choices use the same list).
    expect(resources.match(/"apiName":/g)).toHaveLength(17);
    expect(resources.match(/"filterModes":/g)).toHaveLength(104);
    // The dictionary is merged into the generated app and exercised by generated tests.
    const messages = files["apps/web/app/messages.ts"]!;
    expect(messages).toContain('"qiy.resources.products.label": "产品"');
    expect(messages).toContain('"qiy.dashboard.movementTrend.label": "近 30 天库存流水"');
    expect(files["apps/web/tests/project-messages.test.ts"]).toContain("qiy.resources.stock_movements.label");
    expect(files["apps/web/tests/model-i18n.test.ts"]).toContain("model labels switch between the declared Chinese and English dictionaries");
  });
});
