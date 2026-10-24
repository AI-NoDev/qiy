import { describe, expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject } from "../tools/qiy-project";

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
    expect(files["web/app/root.tsx"]).toContain("meta: { label: modelLabel(resource.pluralKey, modelLabel(resource.labelKey, resource.label)), icon: resolveResourceIcon(resource.icon)");
    expect(files["web/app/data-provider.ts"]).toContain('const api = \"/api/v1\"');
    expect(files["web/package.json"]).toContain("@refinedev/antd");
    expect(files["web/package.json"]).toContain("antd");
    expect(files["web/package.json"]).not.toContain("@mantine/core");
    expect(files["web/app/resources.ts"]).toContain("visible");
    expect(files["web/app/resources.ts"]).toContain('"labelKey": "qiy.resources.');
    expect(files["web/app/resources.ts"]).toContain(".fields.");
    expect(files["web/app/routes/list.tsx"]).toContain("translate(field.labelKey");
    expect(files["web/app/routes/show.tsx"]).toContain("translate(field.labelKey");
    expect(files["web/app/routes/home.tsx"]).toContain("translate(metric.labelKey");
    expect(files["web/app/root.tsx"]).toContain("readStoredLocale()");
    expect(files["web/app/i18n.ts"]).toContain("localeStorageKey");
    expect(files["web/app/i18n.ts"]).toContain("storeLocale");
    expect(files["web/app/i18n.ts"]).toContain('themeBlue: "蓝色"');
    expect(files["web/app/routes/list.tsx"]).toContain('translate("qiy.import", {}, "Import CSV")');
    expect(files["web/app/routes/list.tsx"]).toContain('translate("qiy.paginationTotal"');
    expect(files["web/tests/chrome-i18n.test.ts"]).toContain("every chrome key resolves in zh-CN and en-US");
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
    expect(files["web/vite.config.ts"]).toContain('process.env.QIY_API_PROXY ?? "http://localhost:3000"');
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
    expect(files["web/app/routes/show.tsx"]).toContain("resource.fields.filter((field) => field.showVisible && canSeeField(field, identity?.role))");
    expect(files["web/app/components/resource-form.tsx"]).toContain("const fields = (id ? editFormFields(resource) : createFormFields(resource)).filter((field) => canSeeField(field, identity?.role))");
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

  test("renders foreign keys with display templates instead of raw ids", () => {
    const project = parseQiyProject(`qiy v0; application display-demo {
      database sqlite {}
      entity customers @label("Customers") @singular("Customer") @plural("Customers") @display("{$.code} · {$.name}") @tableDisplay("客户 {$.name}") @relationDetail("<b>{$.name}</b></br>编码：{$.code}") {
        field id UUID @id;
        field code Text @unique;
        field name Text;
      }
      entity orders @label("Orders") @singular("Order") @plural("Orders") @display("{$.number}") {
        field id UUID @id;
        field number Text @unique;
        field customerId UUID;
      }
      relation orderCustomer orders customerId customers id one @onDelete(restrict);
    }`);
    const files = generateWeb(project.database, project);
    const resources = files["web/app/resources.ts"]!;
    // Entity-level Django-like metadata reaches the generated resource definitions.
    expect(resources).toContain('"singular": "Customer"');
    expect(resources).toContain('"singularKey": "qiy.resources.customers.singular"');
    expect(resources).toContain('"pluralKey": "qiy.resources.orders.plural"');
    expect(resources).toContain('"displayTemplate": "{$.code} · {$.name}"');
    expect(resources).toContain('"tableDisplayTemplate": "客户 {$.name}"');
    expect(resources).toContain('"relationDetailTemplate": "<b>{$.name}</b></br>编码：{$.code}"');
    expect(resources).toContain('"relation": {');
    expect(resources).toContain('"labelField": "name"');
    // FK cells, detail fields, related tables and select inputs all delegate to the shared renderer.
    expect(files["web/app/routes/list.tsx"]).toContain("if (field.relation) return <RelationCell field={field} value={value} />");
    expect(files["web/app/routes/list.tsx"]).toContain('translate("qiy.createResource", { resource: singular }, singular)');
    expect(files["web/app/routes/show.tsx"]).toContain("<RelationCell field={field} value={result[field.name]} />");
    expect(files["web/app/components/related-records.tsx"]).toContain("<RelationCell field={field} value={value} />");
    expect(files["web/app/components/resource-form.tsx"]).toContain("<RelationSelect relation={field.relation} fieldName={field.name} />");
    // The display renderer and the drawer component ship with the app.
    expect(files["web/app/display-template.ts"]).toContain("export function renderTemplate");
    expect(files["web/app/display-template.ts"]).toContain("export function plainTextTemplate");
    expect(files["web/app/display-template.ts"]).toContain("export function escapeHtml");
    expect(files["web/app/components/relation-field.tsx"]).toContain("Drawer");
    expect(files["web/app/components/relation-field.tsx"]).toContain("dangerouslySetInnerHTML");
    expect(files["web/app/components/relation-field.tsx"]).toContain("useOne<Record<string, unknown>>");
    expect(files["web/tests/display-template.test.ts"]).toContain("escapes every interpolated value and literal text");
    expect(files["web/tests/display-template.test.ts"]).toContain("only whitelisted tags survive at render time");
    // Chrome keys for the FK drawer and singular/plural titles follow the i18n dictionary.
    expect(files["web/app/i18n.ts"]).toContain('createResource: "新建{{resource}}"');
    expect(files["web/app/i18n.ts"]).toContain('editResource: "编辑{{resource}}"');
    expect(files["web/app/i18n.ts"]).toContain('openDetail: "打开详情"');
  });

  test("rejects display templates that interpolate a foreign key raw id", () => {
    const project = parseQiyProject(`qiy v0; application display-demo {
      database sqlite {}
      entity customers @display("{$.name}") { field id UUID @id; field name Text; }
      entity orders @display("{$.customerId}") { field id UUID @id; field customerId UUID; }
      relation orderCustomer orders customerId customers id one @onDelete(restrict);
    }`);
    expect(() => generateWeb(project.database, project)).toThrow("cannot interpolate foreign key field customerId");
  });

  test("rejects malformed display templates while parsing the model", () => {
    const base = (annotation: string) => `qiy v0; application display-demo { database sqlite {} entity customers ${annotation} { field id UUID @id; field name Text; } }`;
    expect(() => parseQiyProject(base('@display("{$.missing}")'))).toThrow("references unknown field missing");
    expect(() => parseQiyProject(base('@display("<script>{$.name}</script>")'))).toThrow("unsupported tag <script>");
    expect(() => parseQiyProject(base('@display("<b>{$.name}")'))).toThrow("unclosed <b> tag");
    expect(() => parseQiyProject(base('@display("{name}")'))).toThrow("malformed placeholder");
    expect(() => parseQiyProject(base('@tableDisplay("<b class=\\"x\\">{$.name}</b>")'))).toThrow("unterminated tag");
  });
});

test("generates the tree management page for scope tree entities", () => {
  const model = (scope: string) => `qiy v0; application tree-ui {
    database sqlite {}
    entity organizations {
      field id UUID @id;
      field name Text;
      field parentId UUID @nullable;
    }
    entity orders {
      field id UUID @id;
      field title Text;
      field orgId UUID;
    }
    ${scope}
  }`;
  const project = parseQiyProject(model("scope orders orgId claim org tree organizations parentId;"));
  const web = generateWeb(project.database, project);
  expect(web["web/app/tree.ts"]).toContain("export function buildTree");
  expect(web["web/app/tree.ts"]).toContain('"organizations"');
  expect(web["web/app/components/tree-view.tsx"]).toContain("onSelect");
  expect(web["web/app/routes/tree.tsx"]).toContain("TreeView");
  expect(web["web/app/routes.ts"]).toContain('route(":resource/tree", "./routes/tree.tsx")');
  expect(web["web/app/tests/tree.test.ts"]).toBeUndefined();
  expect(web["web/tests/tree.test.ts"]).toContain("buildTree");
  // Without a tree scope the extra page and route do not exist.
  const plain = parseQiyProject(model(""));
  const plainWeb = generateWeb(plain.database, plain);
  expect(plainWeb["web/app/routes/tree.tsx"]).toBeUndefined();
  expect(plainWeb["web/app/routes.ts"]).not.toContain(":resource/tree");
});

