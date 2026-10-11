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
    expect(files["apps/web/app/data-provider.ts"]).toContain("advancedFilters");
    expect(files["apps/server/src/graphql.ts"]).toContain('operator: String = \\"eq\\"');
    expect(files["apps/server/src/graphql.ts"]).toContain("Unsupported filter operator");
    expect(files["apps/server/src/modules/products/products.routes.ts"]).toContain("Unsupported filter operator");
    expect(files["apps/server/src/modules/products/products.repository.ts"]).toContain('operator === "between"');
    expect(files["apps/server/src/modules/products/products.repository.ts"]).toContain("inArray(column, values)");
  });

  test("rejects unknown and duplicate filter modes", () => {
    expect(() => parseQiyProject(source.replace("contains,startsWith,eq", "contains,unknown"))).toThrow("Unsupported filter mode unknown");
    expect(() => parseQiyProject(source.replace("contains,startsWith,eq", "contains,contains"))).toThrow("Duplicate filter mode contains");
  });
});
