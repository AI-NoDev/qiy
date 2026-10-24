import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { qiyModelKeys } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const localizedModel = `qiy v0;
application localized-catalog {
  database sqlite {}
  messages {
    default "zh-CN";
    locale "zh-CN" {
      "qiy.resources.products.label" "产品";
      "qiy.resources.products.fields.name.label" "名称";
      "qiy.enums.productStatus.label" "商品状态";
      "qiy.enums.productStatus.values.active" "上架";
      "qiy.menu.catalog.label" "商品目录";
      "qiy.dashboard.productCount.label" "商品数";
      "qiy.actions.publishProduct.label" "发布";
      "qiy.actions.publishProduct.inputs.productId.label" "商品";
    }
    locale "en-US" {
      "qiy.resources.products.label" "Products";
      "qiy.resources.products.fields.name.label" "Name";
      "qiy.enums.productStatus.label" "Product status";
      "qiy.enums.productStatus.values.active" "Active";
      "qiy.menu.catalog.label" "Catalog";
      "qiy.dashboard.productCount.label" "Product count";
      "qiy.actions.publishProduct.label" "Publish";
      "qiy.actions.publishProduct.inputs.productId.label" "Product";
    }
  }
  enum productStatus {
    value draft;
    value active;
  }
  entity products @label("Products") @icon(ShoppingOutlined) {
    field id UUID @id;
    field name Text @label("Name");
    field status productStatus;
  }
  menu {
    group catalog @label("Catalog") @icon(AppstoreOutlined) {
      resource products;
    }
  }
  dashboard {
    metric productCount products @label("Product count") @icon(ShoppingOutlined) @span(12);
  }
  dataflow publishProduct @label("Publish") {
    allow roles admin, operator;
    input {
      field productId UUID @required;
    }
    context {
      item = entity products by id input.productId @required;
    }
    step publish {
      update item {
        status = "active";
      }
    }
    result { return item; }
  }
  action publishProduct {
    resource products;
    dataflow publishProduct;
    placement list, show;
    label "Publish";
  }
}`;

const plainModel = `qiy v0;
application plain-catalog {
  database sqlite {}
  entity products @label("Products") {
    field id UUID @id;
    field name Text;
  }
}`;

describe("model-derived i18n keys", () => {
  test("round-trips the messages block through the serializer", () => {
    const project = parseQiyProject(localizedModel);
    expect(project.messages?.defaultLocale).toBe("zh-CN");
    expect(project.messages?.locales["en-US"]?.["qiy.resources.products.label"]).toBe("Products");
    const reparsed = parseQiyProject(serializeQiyProject(project));
    expect(reparsed.messages).toEqual(project.messages);
    expect(reparsed).toEqual(project);
  });

  test("emits the stable key scheme for resources, fields, enums, menus, dashboard and actions", () => {
    const project = parseQiyProject(localizedModel);
    const files = generateProject(project.database, project.name, project);
    const resources = files["apps/web/app/resources.ts"]!;
    expect(resources).toContain('"labelKey": "qiy.resources.products.label"');
    expect(resources).toContain('"labelKey": "qiy.resources.products.fields.name.label"');
    expect(resources).toContain('"labelKey": "qiy.enums.productStatus.label"');
    expect(resources).toContain('"labelKey": "qiy.enums.productStatus.values.active"');
    expect(resources).toContain('"labelKey": "qiy.menu.catalog.label"');
    expect(files["apps/web/app/dashboard.ts"]).toContain('"labelKey": "qiy.dashboard.productCount.label"');
    const actions = files["apps/web/app/actions.ts"]!;
    expect(actions).toContain('"labelKey": "qiy.actions.publishProduct.label"');
    expect(actions).toContain('"labelKey": "qiy.actions.publishProduct.inputs.productId.label"');
    // The exact same scheme is what models author in the messages dictionary.
    expect(qiyModelKeys.resourceLabel("products")).toBe("qiy.resources.products.label");
    expect(qiyModelKeys.fieldLabel("products", "name")).toBe("qiy.resources.products.fields.name.label");
    expect(qiyModelKeys.enumValueLabel("productStatus", "active")).toBe("qiy.enums.productStatus.values.active");
    expect(qiyModelKeys.menuLabel("catalog")).toBe("qiy.menu.catalog.label");
    expect(qiyModelKeys.dashboardLabel("productCount")).toBe("qiy.dashboard.productCount.label");
    expect(qiyModelKeys.actionLabel("publishProduct")).toBe("qiy.actions.publishProduct.label");
    expect(qiyModelKeys.actionInputLabel("publishProduct", "productId")).toBe("qiy.actions.publishProduct.inputs.productId.label");
  });

  test("renders model labels through translate() with the declared label as fallback", () => {
    const project = parseQiyProject(localizedModel);
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/app/routes/list.tsx"]).toContain("translate(resource.labelKey, {}, resource.label)");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("translate(field.labelKey, {}, field.label)");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("translate(enumValue.labelKey, {}, enumValue.label ?? enumValue.name)");
    expect(files["apps/web/app/routes/show.tsx"]).toContain("translate(field.labelKey, {}, field.label)");
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain("translate(field.labelKey, {}, field.label)");
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain("translate(item.labelKey, {}, item.label ?? item.name)");
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("translate(action.labelKey, {}, action.label)");
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("translate(field.labelKey, {}, field.comment ?? field.name)");
    expect(files["apps/web/app/routes/home.tsx"]).toContain("translate(metric.labelKey, {}, metric.label)");
    expect(files["apps/web/app/routes/home.tsx"]).toContain("translate(resource.labelKey, {}, resource.label)");
    expect(files["apps/web/app/root.tsx"]).toContain("i18nProvider.translate(labelKey, {}, fallback)");
    // The dictionary reaches the i18n provider and every generated page locale test.
    expect(files["apps/web/app/messages.ts"]).toContain('"qiy.resources.products.label": "产品"');
    expect(files["apps/web/app/i18n.ts"]).toContain("projectMessages[defaultMessageLocale]");
    expect(files["apps/web/tests/project-messages.test.ts"]).toContain('"qiy.resources.products.label"');
    expect(files["apps/web/tests/model-i18n.test.ts"]).toContain("every model-derived label has a stable key");
  });

  test("persists the language choice and keeps AntD, Refine and the document in sync", () => {
    const project = parseQiyProject(localizedModel);
    const files = generateProject(project.database, project.name, project);
    const i18n = files["apps/web/app/i18n.ts"]!;
    expect(i18n).toContain('export const localeStorageKey = "qiy.locale"');
    expect(i18n).toContain("export function readStoredLocale");
    expect(i18n).toContain("export function storeLocale");
    expect(i18n).toContain("export function filterModeLabel");
    const root = files["apps/web/app/root.tsx"]!;
    expect(root).toContain("useState<QiyLocale>(() => readStoredLocale())");
    expect(root).toContain("const applyLocale = useCallback((next: QiyLocale) => { setLocale(next); storeLocale(next); }, [])");
    expect(root).toContain("document.documentElement.lang = locale");
    expect(root).toContain("document.documentElement.dir = direction");
    expect(root).toContain("locale={getAntdLocale(locale)}");
    expect(root).toContain("readStoredLocale()");
    const generatedTest = files["apps/web/tests/model-i18n.test.ts"]!;
    expect(generatedTest).toContain("locale switching stores the choice and survives a reload");
    expect(generatedTest).toContain("readStoredLocale(defaultMessageLocale, fake)");
  });

  test("keeps non-i18n projects exactly on the fallback path", () => {
    const project = parseQiyProject(plainModel);
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/app/messages.ts"]).toContain('export const defaultMessageLocale = "zh-CN"');
    expect(files["apps/web/app/messages.ts"]).toContain("export const projectMessages: Record<string, Record<string, string>> = {}");
    expect(files["apps/web/app/resources.ts"]).toContain('"label": "Products"');
    expect(files["apps/web/app/resources.ts"]).toContain('"labelKey": "qiy.resources.products.label"');
    // Without a messages block every lookup falls back to the declared label text.
    expect(files["apps/web/app/routes/list.tsx"]).toContain("translate(field.labelKey, {}, field.label)");
    expect(files["apps/web/tests/project-messages.test.ts"]).toBeUndefined();
    expect(files["apps/web/tests/model-i18n.test.ts"]).toContain("Fallback label");
  });
});
