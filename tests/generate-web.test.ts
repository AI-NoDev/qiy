import { describe, expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { generateWeb } from "../tools/generate-web";

const fixture = await Bun.file(new URL("../examples/catalog.ir.json", import.meta.url)).json() as DatabaseIR;

describe("Refine SPA generation", () => {
  test("emits Ant Design CRUD, Refine layout, list controls, and i18n", () => {
    const files = generateWeb(fixture);
    expect(files["web/react-router.config.ts"]).toContain("ssr: false");
    expect(files["web/app/routes.ts"]).toContain('route(\":resource/:id/edit\"');
    expect(files["web/app/root.tsx"]).toContain("ThemedLayout");
    expect(files["web/app/root.tsx"]).toContain("QiyUiProvider");
    expect(files["web/app/ui/index.tsx"]).toContain("ConfigProvider");
    expect(files["web/app/ui/index.tsx"]).toContain("QiyThemeControls");
    expect(files["web/app/root.tsx"]).toContain("meta: { label: resource.label, icon: resolveResourceIcon(resource.icon)");
    expect(files["web/app/data-provider.ts"]).toContain('const api = \"/api/v1\"');
    expect(files["web/package.json"]).toContain("@refinedev/antd");
    expect(files["web/package.json"]).toContain("antd");
    expect(files["web/package.json"]).not.toContain("@mantine/core");
    expect(files["web/app/resources.ts"]).toContain("visible");
    expect(files["web/app/routes/list.tsx"]).toContain("field.icon ? qiyIcons[field.icon");
    expect(files["web/app/resources.ts"]).toContain("TableOutlined");
    expect(files["web/app/routes/list.tsx"]).toContain("selectedRowKeys");
    expect(files["web/app/routes/list.tsx"]).toContain("batchDelete");
    expect(files["web/app/routes/list.tsx"]).toContain('pageSizeOptions: ["10", "20", "50", "100"]');
    expect(files["web/app/routes/list.tsx"]).toContain("visibleColumns");
    expect(files["web/app/routes/list.tsx"]).toContain('<CreateButton resource={resource.name}>');
    expect(files["web/app/routes/list.tsx"]).toContain('<DeleteButton resource={resource.name}');
    expect(files["web/app/routes/list.tsx"]).toContain('useCan({ resource: name ?? "", action: "delete"');
    expect(files["web/app/routes/create.tsx"]).toContain('action="create"');
    expect(files["web/app/routes/edit.tsx"]).toContain('action="edit"');
    expect(files["web/app/routes/show.tsx"]).toContain('CanAccess resource={resource.name} action="edit"');
    expect(files["web/app/i18n.ts"]).toContain("zh-CN");
    expect(files["web/vite.config.ts"]).toContain('"/graphql": "http://localhost:3000"');
    expect(files["web/app/routes/show.tsx"]).not.toContain("OrderWorkflowActions");
    expect(files["web/tests/workflow.test.ts"]).toBeUndefined();
  });

  test("rejects required vector fields the form cannot edit", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields[3]!.nullable = false;
    expect(() => generateWeb(database)).toThrow("cannot edit a required Vector field");
  });

  test("rejects required fields hidden from the create form", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields[1]!.formVisible = false;
    expect(() => generateWeb(database)).toThrow("required field cannot be hidden from the create form");
  });

  test("renders File fields with authenticated downloads", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields.push({ name: "attachment", type: "File", nullable: true });
    const files = generateWeb(database);
    expect(files["web/app/resources.ts"]).toContain('"type": "File"');
    expect(files["web/app/routes/list.tsx"]).toContain('field.type === "File"');
    expect(files["web/app/hooks/download-file.ts"]).toContain('Authorization: "Bearer " + token');
  });

  test("applies hidden fields to list, detail, and form views", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.fields[1]!.visible = false;
    database.entities[0]!.fields[1]!.formVisible = true;
    const files = generateWeb(database);
    expect(files["web/app/routes/list.tsx"]).toContain("visibleKeys");
    expect(files["web/app/routes/show.tsx"]).toContain("resource.fields.filter((field) => field.showVisible)");
    expect(files["web/app/components/resource-form.tsx"]).toContain("field.formVisible && !field.primaryKey");
  });

  test("imports configured resource icons instead of silently using a fallback", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.icon = "SafetyOutlined";
    const files = generateWeb(database);
    expect(files["web/app/icons.tsx"]).toContain("DatabaseOutlined, SafetyOutlined, ShoppingOutlined");
    expect(files["web/app/root.tsx"]).toContain("qiyIcons");
    expect(files["web/app/routes/home.tsx"]).toContain("qiyIcons");
    database.entities[0]!.icon = "../../Unsafe";
    expect(() => generateWeb(database)).toThrow("Invalid Ant Design icon");
  });

  test("generates scoped reverse-relation tables on resource details", () => {
    const database = structuredClone(fixture);
    database.entities.push({ name: "inventoryItems", tableName: "inventory_items", fields: [
      { name: "id", type: "UUID", primaryKey: true },
      { name: "productId", type: "UUID" },
      { name: "sku", type: "Text" },
    ] });
    database.relations = [{ name: "inventoryProduct", fromEntity: "inventoryItems", fromField: "productId", toEntity: "products", toField: "id", cardinality: "one" }];
    const files = generateWeb(database);
    expect(files["web/app/resources.ts"]).toContain('"relatedResources": [');
    expect(files["web/app/routes/show.tsx"]).toContain("resource.relatedResources ?? []");
    expect(files["web/app/components/related-records.tsx"]).toContain('field: relation.field, operator: "eq", value: recordId');
    expect(files["web/app/components/related-records.tsx"]).toContain('pagination: { currentPage: 1, pageSize: 10 }');
  });
});
