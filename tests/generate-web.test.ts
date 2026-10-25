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
    expect(files["web/app/components/record-details.tsx"]).toContain("translate(field.labelKey");
    expect(files["web/app/routes/show.tsx"]).toContain("RecordDetails");
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
    expect(files["web/app/components/record-details.tsx"]).toContain("visibleDetailFields(resource, identity?.role)");
    expect(files["web/app/components/record-details.tsx"]).toContain("resource.fields.filter((field) => field.showVisible && canSeeField(field, role))");
    expect(files["web/app/routes/show.tsx"]).toContain("RecordDetails");
    expect(files["web/app/components/resource-form.tsx"]).toContain("const fields = (id ? editFormFields(resource) : createFormFields(resource)).filter((field) => canSeeField(field, identity?.role))");
  });

  test("imports configured resource icons instead of silently using a fallback", () => {
    const database = structuredClone(fixture);
    database.entities[0]!.icon = "SafetyOutlined";
    const files = generateWeb(database);
    const icons = files["web/app/icons.tsx"]!;
    expect(icons).toContain("SafetyOutlined");
    expect(icons).toContain("FileTextOutlined");
    expect(icons).toContain("KeyOutlined");
    expect(icons).toContain('from "@ant-design/icons"');
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
    expect(files["web/app/routes/show.tsx"]).toContain("<RecordDetails resource={resource} record={result} />");
    expect(files["web/app/components/related-records.tsx"]).toContain("<RelationCell field={field} value={value} />");
    expect(files["web/app/components/resource-form.tsx"]).toContain("<RelationSelect relation={field.relation} fieldName={field.name} />");
    // The display renderer and the drawer component ship with the app.
    expect(files["web/app/display-template.ts"]).toContain("export function renderTemplate");
    expect(files["web/app/display-template.ts"]).toContain("export function plainTextTemplate");
    expect(files["web/app/display-template.ts"]).toContain("export function escapeHtml");
    expect(files["web/app/components/relation-field.tsx"]).toContain("Drawer");
    expect(files["web/app/components/relation-field.tsx"]).toContain("dangerouslySetInnerHTML");
    expect(files["web/app/components/relation-field.tsx"]).toContain("useOne<Record<string, unknown>>");
    // The drawer mirrors the detail page through the shared RecordDetails body and
    // gets its own header breadcrumb; the shared component renders every visible
    // detail field (enum tags, FK cells, dates, files, vector/null placeholders).
    expect(files["web/app/components/relation-field.tsx"]).toContain("<RecordDetails resource={target} record={record} size=\"small\" />");
    expect(files["web/app/components/relation-field.tsx"]).toContain("RelatedRecordBreadcrumb");
    expect(files["web/app/components/relation-field.tsx"]).toContain('width="min(92vw, 760px)"');
    expect(files["web/app/components/record-details.tsx"]).toContain("export function RecordDetails");
    expect(files["web/app/components/record-details.tsx"]).toContain("<RelationCell field={field} value={value} />");
    expect(files["web/tests/record-details.test.tsx"]).toContain("renders every detail-visible field");
    expect(files["web/tests/record-details.test.tsx"]).toContain("renders the @relationDetail summary above the shared field details");
    expect(files["web/tests/record-details.test.tsx"]).toContain("renders the drawer breadcrumb with list and detail links");
    expect(files["web/tests/display-template.test.ts"]).toContain("escapes every interpolated value and literal text");
    expect(files["web/tests/display-template.test.ts"]).toContain("only whitelisted tags survive at render time");
    // Chrome keys for the FK drawer and singular/plural titles follow the i18n dictionary.
    expect(files["web/app/i18n.ts"]).toContain('createResource: "新建{{resource}}"');
    expect(files["web/app/i18n.ts"]).toContain('editResource: "编辑{{resource}}"');
    expect(files["web/app/i18n.ts"]).toContain('openDetail: "打开详情"');
    expect(files["web/app/i18n.ts"]).toContain('drawerBreadcrumb: "关联记录路径"');
    expect(files["web/app/i18n.ts"]).toContain('recordDetails: "字段详情"');
    expect(files["web/app/i18n.ts"]).toContain('recordSummary: "关联摘要"');
    expect(files["web/app/i18n.ts"]).toContain('close: "关闭"');
    expect(files["web/tests/chrome-i18n.test.ts"]).toContain('"qiy.drawerBreadcrumb"');
    expect(files["web/tests/chrome-i18n.test.ts"]).toContain('"qiy.recordDetails"');
  });

  test("batches foreign-key lookups into one list request per target resource", () => {
    const files = generateWeb(fixture);
    // REST and GraphQL providers implement Refine's getMany with an id-set filter.
    expect(files["web/app/data-provider.ts"]).toContain("getMany: async ({ resource, ids })");
    expect(files["web/app/data-provider.ts"]).toContain("normalizeGetManyIds");
    expect(files["web/app/data-provider.ts"]).toContain("getManyRequestUrls");
    expect(files["web/app/data-provider.ts"]).toContain('{ field: "id", operator: "in", value: chunk.join(",") }');
    expect(files["web/app/data-provider.ts"]).toContain("page=1&pageSize=");
    expect(files["web/app/data-provider.ts"]).toContain("export const maxGetManyIds = 200");
    // The plan groups FK ids per target resource; each group loads with one useMany.
    expect(files["web/app/components/relation-batch.tsx"]).toContain("export function buildRelationBatchPlan");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("export function RelationBatchProvider");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("export function useBatchedRelation");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("useMany<Record<string, unknown>>");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("staleTime: 60_000");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("export const maxRelationBatchIds = 200");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("pending: ReadonlySet<string>");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("if (query.isPending) pending.add(entry.resource)");
    // List and show pages mount the batch provider; the cell disables its fallback query.
    expect(files["web/app/routes/list.tsx"]).toContain("const relationBatchFields = useMemo(() => (resource?.fields ?? []).filter((field) => field.relation && field.listVisible && canSeeField(field, identity?.role)), [resource, identity?.role])");
    expect(files["web/app/routes/list.tsx"]).toContain("const relationBatchPlan = useMemo(() => buildRelationBatchPlan(relationBatchFields, relationBatchRows), [relationBatchFields, relationBatchRows])");
    expect(files["web/app/components/relation-batch.tsx"]).toContain("refetchOnMount: false");
    expect(files["web/app/components/relation-field.tsx"]).toContain("Skeleton.Input");
    expect(files["web/app/routes/list.tsx"]).toContain("<RelationBatchProvider plan={relationBatchPlan}>");
    expect(files["web/app/routes/show.tsx"]).toContain("<RelationBatchProvider plan={buildRelationBatchPlan(visibleDetailFields(resource, identity?.role), [result])}>");
    expect(files["web/app/components/relation-field.tsx"]).toContain("const batched = useBatchedRelation(resource, id)");
    expect(files["web/app/components/relation-field.tsx"]).toContain("enabled: !batched.record && !batched.pending && Boolean(resource && id)");
    expect(files["web/app/components/relation-field.tsx"]).toContain("const loading = query.isLoading || batched.pending");
    // Generated tests cover the plan helper, the data-provider URL shape and the batched cell.
    expect(files["web/tests/relation-batch.test.ts"]).toContain("groups FK values by target resource");
    expect(files["web/tests/data-provider.test.ts"]).toContain("batches getMany ids into one list request");
    expect(files["web/tests/data-provider.test.ts"]).toContain("GraphQL getMany batches ids into one list query");
    expect(files["web/tests/relation-cell.test.tsx"]).toContain("renders from the batch provider without a per-cell detail request");
    expect(files["web/tests/relation-cell.test.tsx"]).toContain("keeps the per-cell query disabled while the batch is still loading");
  });

  test("renders a model menu block as nested sider submenus with persisted collapse", () => {
    const project = parseQiyProject(`qiy v0; application grouped-menu {
      database sqlite {}
      entity users { field id UUID @id; field email Text; }
      entity orders { field id UUID @id; field number Text; }
      entity products { field id UUID @id; field sku Text; }
      menu {
        group masterData @label("Master data") @icon(AppstoreOutlined) { resource products; }
        group operations @label("Operations") @icon(ShoppingOutlined) { resource orders; resource users; }
      }
    }`);
    const files = generateWeb(project.database, project);
    const resources = files["web/app/resources.ts"]!;
    // Every grouped resource points at its group; the groups keep the declared order/resources.
    expect(resources).toContain('"menuParent": "menu-masterData"');
    expect(resources).toContain('"menuParent": "menu-operations"');
    expect(resources).toContain("export interface MenuGroupDefinition");
    expect(resources).toContain("export const menuGroups: MenuGroupDefinition[]");
    expect(resources).toContain('"name": "menu-operations"');
    expect(resources).toContain('"resources": [');
    expect(resources).toContain('"orders"');
    // The sider builds real nested submenus from that metadata and keeps the route open.
    expect(files["web/app/components/menu.tsx"]).toContain("export function buildMenuTree");
    expect(files["web/app/components/menu.tsx"]).toContain("export function QiySider");
    expect(files["web/app/components/menu.tsx"]).toContain("const siderMenuItems = useMemo<NonNullable<MenuProps[\"items\"]>>");
    expect(files["web/app/components/menu.tsx"]).toContain("items={siderMenuItems}");
    expect(files["web/app/components/menu.tsx"]).not.toContain("<Menu.SubMenu");
    expect(files["web/app/components/menu.tsx"]).toContain("useThemedLayoutContext");
    expect(files["web/app/components/menu.tsx"]).toContain("export const qiySiderWidth = 248");
    expect(files["web/app/components/menu.tsx"]).toContain("inlineCollapsed={siderCollapsed}");
    expect(files["web/app/components/menu.tsx"]).toContain("openMenuKeys");
    // Collapse state is persisted through the themed layout wrapper.
    expect(files["web/app/ui/index.tsx"]).toContain("Sider={Sider ?? QiySider}");
    expect(files["web/app/ui/index.tsx"]).toContain("siderCollapsedStorageKey");
    expect(files["web/app/ui/index.tsx"]).toContain("initialSiderCollapsed={initialCollapsed}");
    expect(files["web/app/styles.css"]).toContain(".qiy-sider-mobile-trigger");
    // Generated tests cover tree nesting/order and the persisted collapse state.
    expect(files["web/tests/menu-tree.test.ts"]).toContain("groups resources into nested items in declared order");
    expect(files["web/tests/menu-tree.test.ts"]).toContain("nests @parent groups instead of flattening them");
    expect(files["web/tests/sider-state.test.ts"]).toContain("persists the collapsed state across reads");
  });

  test("keeps a flat menu when the model declares no menu block", () => {
    const files = generateWeb(fixture);
    expect(files["web/app/resources.ts"]).toContain("export const menuGroups: MenuGroupDefinition[] = []");
    expect(files["web/app/components/menu.tsx"]).toContain("buildMenuTree");
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

