import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = `qiy v0;
application advanced-filters {
  database sqlite {}
  entity products {
    field id UUID @id;
    field name Text @filter(contains,startsWith,eq);
    field amount Integer @filter(gte,lte,between,in);
  }
}`;

describe("advanced list filters", () => {
  test("round-trips field operators and generates the full filter chain", () => {
    const project = parseQiyProject(source);
    expect(project.database.entities[0]?.fields[1]?.filterModes).toEqual(["contains", "startsWith", "eq"]);
    expect(project.database.entities[0]?.fields[2]?.filterModes).toEqual(["gte", "lte", "between", "in"]);
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);

    const files = generateProject(project.database, project.name);
    expect(files["apps/web/app/resources.ts"]).toContain('"filterModes": [');
    expect(files["apps/web/app/routes/list.tsx"]).toContain("Space.Compact");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("condition.operator");
    expect(files["apps/web/app/routes/list.tsx"]).toContain('className="qiy-list-filters"');
    expect(files["apps/web/app/routes/list.tsx"]).toContain("headerButtons={() => <Space");
    // The list page exports the current filter/sort state through the policy-aware endpoint.
    expect(files["apps/web/app/routes/list.tsx"]).toContain('downloadExport(exportUrl(resource.name, { filters, sorters, columns: visibleKeys, ids: selectedRowKeys.map(String) }))');
    expect(files["apps/web/app/export.ts"]).toContain("encodeExportFilters");
    expect(files["apps/web/app/export.ts"]).toContain('"/api/v1/" + resource + "/export"');
    expect(files["apps/web/tests/export.test.ts"]).toContain("surfaces the server refusal instead of downloading a partial file");
    // Saved views persist filter/sort/column state per resource in the browser.
    expect(files["apps/web/app/views.ts"]).toContain("export function saveView");
    expect(files["apps/web/app/views.ts"]).toContain("export function listSavedViews");
    expect(files["apps/web/app/views.ts"]).toContain("export function deleteSavedView");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("listSavedViews(name ?? \"\")");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("applySavedView");
    expect(files["apps/web/tests/views.test.ts"]).toContain("saves, updates and lists views per resource");
    expect(files["apps/web/app/data-provider.ts"]).toContain("encodedFilters");
    expect(files["apps/server/src/graphql.ts"]).toContain('operator: String = \\"eq\\"');
    expect(files["apps/server/src/graphql.ts"]).toContain("Unsupported filter operator");
    expect(files["apps/server/src/modules/products/products.routes.ts"]).toContain("Unsupported filter operator");
    expect(files["apps/server/src/modules/products/products.repository.ts"]).toContain('operator === "between"');
    expect(files["apps/server/src/modules/products/products.repository.ts"]).toContain("inArray(column, values)");
    expect(files["apps/server/src/modules/products/products.repository.ts"]).toContain('filter.operator === "and" ? and');
    expect(files["apps/server/src/modules/products/products.routes.ts"]).toContain("depth > 8");
    expect(files["apps/web/app/data-provider.ts"]).toContain("const encodeFilters");
  });

  test("rejects unknown and duplicate filter modes", () => {
    expect(() => parseQiyProject(source.replace("contains,startsWith,eq", "contains,unknown"))).toThrow("Unsupported filter mode unknown");
    expect(() => parseQiyProject(source.replace("contains,startsWith,eq", "contains,contains"))).toThrow("Duplicate filter mode contains");
  });
});
