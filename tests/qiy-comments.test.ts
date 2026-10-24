import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import ts from "typescript";
import { generatedDocumentation } from "../tools/generated-documentation";

const source = await Bun.file(new URL("../examples/dataflow/documented-inputs.qiy", import.meta.url)).text();

test("localized model and dataflow descriptions roundtrip without losing translation references", () => {
  const project = parseQiyProject(source);
  expect(project.database.entities[0]?.comment).toBe("Review requests");
  expect(project.database.entities[0]?.fields[1]?.commentKey).toBe("entity.reviews.note");
  expect(project.dataflows?.[0]?.input[1]?.comment).toBe("Explain the review decision");
  expect(project.dataflows?.[0]).toMatchObject({ label: "Explain review", labelKey: "review.action", confirm: "Apply this explanation?", confirmKey: "review.confirm", comment: "Load the requested review", commentKey: "review.context" });
  expect(project.actions?.[1]?.target).toMatchObject({ commentKey: "entity.reviews.note", comment: "Explain the review decision" });
  expect(project.actions?.[0]).toMatchObject({ label: "Explain review", labelKey: "review.action", target: { confirm: "Apply this explanation?", confirmKey: "review.confirm" } });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/server/src/modules/reviews/reviews.routes.ts"]).toContain('description: "Explain the review decision"');
  expect(files["apps/server/src/modules/reviews/reviews.routes.ts"]).toContain('description: "Review requests"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('description: "Explain the review decision"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('summary: "Explain review"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('description: "Load the requested review"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain(" * i18n: review.context");
  expect(files["apps/server/src/dataflows/index.ts"]).toContain(" * Load the requested review");
  expect(files["apps/server/src/dataflows/index.ts"]).toContain(" * i18n: review.context");
  expect(files["apps/server/src/dataflows/index.ts"]).toContain(" * Persist the decision explanation");
  expect(files["apps/server/src/dataflows/index.ts"]).toContain(" * i18n: review.step");
  const withEmptyStep = parseQiyProject(source.replace("    step explain", '    step preliminary @comment("Reserved extension stage") {}\n    step explain'));
  const emptyStepCode = generateProject(withEmptyStep.database, withEmptyStep.name, withEmptyStep)["apps/server/src/dataflows/index.ts"]!;
  expect(emptyStepCode).toContain(" * Reserved extension stage");
  expect(emptyStepCode.indexOf(" * Reserved extension stage")).toBeLessThan(emptyStepCode.indexOf(" * Persist the decision explanation"));
  expect(files["apps/server/src/schema.ts"]).toContain(" * Review requests");
  expect(files["apps/server/src/schema.ts"]).toContain(" * i18n: entity.reviews.note");
  expect(files["apps/server/src/modules/reviews/reviews.contract.ts"]).toContain(" * Review requests");
  expect(files["apps/server/src/modules/reviews/reviews.service.ts"]).toContain(" * Review requests");
  expect(files["apps/web/app/resources.ts"]).toContain('"commentKey": "entity.reviews.note"');
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("tooltip={field.commentKey ? translate(");
  expect(files["apps/web/app/components/business-actions.tsx"]).toContain("translate(field.labelKey");
  expect(files["apps/web/app/components/business-actions.tsx"]).toContain("action.labelKey ? translate(action.labelKey");
  expect(files["apps/web/app/components/business-actions.tsx"]).toContain("target.confirmKey ? translate(target.confirmKey");
  expect(files["apps/web/app/messages.ts"]).toContain("请说明审核决定");
  expect(files["apps/server/src/graphql.ts"]).toContain('Review requests');
  expect(files["apps/server/src/graphql.ts"]).toContain('Load the requested review');
  expect(files["apps/server/tests/graphql-schema.test.ts"]).toContain('reviews GraphQL descriptions match the model');
  expect(files["apps/web/app/extensions/reviewDetails.tsx"]).toContain('translate("entity.reviews.note"');
});

test("literal descriptions preserve punctuation and relation documentation", () => {
  const project = parseQiyProject(`qiy v0; application descriptions {
    database sqlite {}
    entity teams @comment("Team records") { field id UUID @id; field name Text @comment("A # or // is text here"); }
    entity members { field id UUID @id; field teamId UUID; }
    relation membership members teamId teams id one @comment("Member belongs to team") @onDelete(restrict);
  }`);
  expect(project.database.entities[0]?.fields[1]?.comment).toBe("A # or // is text here");
  expect(project.database.relations?.[0]?.comment).toBe("Member belongs to team");
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
});

test("schema documentation survives all dialects without becoming executable code", () => {
  const malicious = "Closing marker */\nexport const injected = true;\n/* open marker\u2028Unicode line";
  for (const dialect of ["sqlite", "mysql", "postgresql"] as const) {
    const project = parseQiyProject(`qiy v0; application documented-schema {
      database ${dialect} {}
      entity teams @comment(${JSON.stringify(malicious)}) {
        field id UUID @id;
        field name Text @comment("Team name");
        index teams_name_idx btree(name) @comment("Find teams by name");
      }
      entity members { field id UUID @id; field teamId UUID; }
      relation membership members teamId teams id one @comment("Member belongs to team");
    }`);
    const schema = generateProject(project.database, project.name)["apps/server/src/schema.ts"]!;
    expect(schema).toContain(" * Closing marker * /");
    expect(schema).toContain(" * Team name");
    expect(schema).toContain(" * Find teams by name");
    expect(schema).toContain(" * Member belongs to team");
    const compiled = ts.transpileModule(schema, { compilerOptions: { target: ts.ScriptTarget.ESNext, removeComments: true }, reportDiagnostics: true });
    expect(compiled.diagnostics ?? []).toHaveLength(0);
    expect(compiled.outputText).not.toContain("injected");
    expect(compiled.outputText).toContain("export const teams");
  }
  expect(generatedDocumentation(undefined)).toBe("");
  expect(generatedDocumentation({ commentKey: "missing" })).toBe("");
});

test("message dictionaries reject missing translations, duplicates and unsafe keys", () => {
  expect(() => parseQiyProject(source.replace('t("entity.reviews.note")', 't("missing.key")'))).toThrow("Missing default locale message");
  expect(() => parseQiyProject(source.replace('default "en-US";', 'default "fr-FR";'))).toThrow("Missing default message locale");
  expect(() => parseQiyProject(source.replace('locale "en-US"', 'locale "zh-CN"'))).toThrow("Duplicate message locale");
  expect(() => parseQiyProject(source.replace('"review.context" "Load the requested review";', '"entity.reviews.note" "Duplicate";'))).toThrow("Duplicate message key");
  expect(() => parseQiyProject(source.replace('"entity.reviews" "Review requests";', '"__proto__.polluted" "Unsafe";'))).toThrow("Invalid message key");
});

test("declares international locales and generates matching Refine and component configuration", () => {
  const text = source.replaceAll('"en-US"', '"fr-FR"').replaceAll('"zh-CN"', '"ja-JP"');
  const project = parseQiyProject(text);
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/web/app/root.tsx"]).toContain('lang="fr-FR"');
  expect(files["apps/web/app/root.tsx"]).toContain("readStoredLocale()");
  expect(files["apps/web/app/root.tsx"]).toContain("storeLocale(next)");
  expect(files["apps/web/app/root.tsx"]).toContain("options={languageOptions}");
  expect(files["apps/web/app/root.tsx"]).toContain("document.documentElement.dir");
  expect(files["apps/web/app/i18n.ts"]).toContain('antd/locale/fr_FR');
  expect(files["apps/web/app/i18n.ts"]).toContain('antd/locale/ja_JP');
  expect(files["apps/web/app/routes/list.tsx"]).toContain("resolveLocale(getLocale())");
  expect(files["apps/web/app/routes/show.tsx"]).toContain("resolveLocale(getLocale())");
  for (const tag of ["fr_fr", "FR-fr", "constructor", "__proto__", "", "en US"]) {
    expect(() => parseQiyProject(source.replace('default "en-US";', `default "${tag}";`))).toThrow("Invalid message locale");
  }
});

test("enum, enum value, menu group and dashboard comments roundtrip into generated metadata", () => {
  const model = `qiy v0; application documented-objects {
    database sqlite {}
    messages {
      default "en-US";
      locale "en-US" {
        "enum.status" "Lifecycle status";
        "enum.status.active" "Available for normal operations";
        "menu.operations" "Operational master data";
        "dashboard.users" "Current user records";
      }
      locale "zh-CN" {
        "enum.status" "生命周期状态";
        "enum.status.active" "可用于正常业务";
        "menu.operations" "运营主数据";
        "dashboard.users" "当前用户记录";
      }
    }
    enum status @comment(t("enum.status")) {
      value active label "Active" color "green" icon "CheckCircleOutlined" @comment(t("enum.status.active"));
      value disabled label "Disabled" @comment("Unavailable account");
    }
    entity users table users @label("Users") {
      field id UUID @id;
      field status status;
      field name Text;
    }
    menu {
      group operations @label("Operations") @comment(t("menu.operations")) {
        resource users;
      }
    }
    dashboard {
      metric userCount users @label("Users") @span(8) @comment(t("dashboard.users"));
    }
  }`;
  const project = parseQiyProject(model);
  expect(project.database.enums?.[0]).toMatchObject({ comment: "Lifecycle status", commentKey: "enum.status" });
  expect(project.database.enums?.[0]?.values[0]).toMatchObject({ comment: "Available for normal operations", commentKey: "enum.status.active" });
  expect(project.database.enums?.[0]?.values[1]?.comment).toBe("Unavailable account");
  expect(project.menuGroups?.[0]).toMatchObject({ comment: "Operational master data", commentKey: "menu.operations" });
  expect(project.dashboardMetrics?.[0]).toMatchObject({ comment: "Current user records", commentKey: "dashboard.users" });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);

  const files = generateProject(project.database, project.name, project);
  expect(files["apps/web/app/resources.ts"]).toContain('export const enumerations');
  expect(files["apps/web/app/resources.ts"]).toContain('"commentKey": "enum.status.active"');
  expect(files["apps/web/app/resources.ts"]).toContain('"commentKey": "menu.operations"');
  expect(files["apps/web/app/dashboard.ts"]).toContain('"commentKey": "dashboard.users"');
  expect(files["apps/web/app/routes/home.tsx"]).toContain("<MetricDescription metric={metric} />");
  expect(files["apps/web/app/routes/list.tsx"]).toContain("translate(enumValue.commentKey");
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("translate(item.commentKey");
});

test("application and database comments resolve after messages and generate package/schema documentation", () => {
  const model = `qiy v0;
  application operations @comment(t("application.operations")) {
    database sqlite @comment(t("database.operations")) {}
    messages {
      default "en-US";
      locale "en-US" {
        "application.operations" "Operations control plane";
        "database.operations" "Operational records database";
      }
      locale "zh-CN" {
        "application.operations" "运营控制台";
        "database.operations" "运营记录数据库";
      }
    }
    entity users { field id UUID @id; field name Text; }
  }`;
  const project = parseQiyProject(model);
  expect(project).toMatchObject({ comment: "Operations control plane", commentKey: "application.operations" });
  expect(project.database).toMatchObject({ comment: "Operational records database", commentKey: "database.operations" });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  const files = generateProject(project.database, project.name, project);
  expect(JSON.parse(files["package.json"]!).description).toBe("Operations control plane");
  expect(JSON.parse(files["apps/server/package.json"]!).description).toBe("Operations control plane");
  expect(JSON.parse(files["apps/web/package.json"]!).description).toBe("Operations control plane");
  expect(files["apps/server/src/schema.ts"]).toStartWith("/**\n * Operational records database\n * i18n: database.operations\n */");
  expect(() => parseQiyProject(model.replace('t("application.operations")', 't("missing.application")'))).toThrow("Missing default locale message for application comment");
  expect(() => parseQiyProject(model.replace('t("database.operations")', 't("missing.database")'))).toThrow("Missing default locale message for database comment");
  expect(() => parseQiyProject(model.replace('application operations @comment(t("application.operations"))', 'application operations @comment(t("application.operations")) @comment("duplicate")'))).toThrow("duplicate @comment");
  expect(() => parseQiyProject(model.replace('database sqlite @comment(t("database.operations"))', 'database sqlite @comment(t("database.operations")) @comment("duplicate")'))).toThrow("duplicate @comment");
});

test("named object comments fail closed for missing messages and duplicate annotations", () => {
  const base = `qiy v0; application invalid-comments {
    database sqlite {}
    messages { default "en-US"; locale "en-US" { "known" "Known"; } }
    enum status @comment(t("known")) { value active @comment(t("known")); }
    entity users { field id UUID @id; field status status; }
    menu { group operations @comment(t("known")) { resource users; } }
    dashboard { metric userCount users @comment(t("known")); }
  }`;
  expect(() => parseQiyProject(base.replace('enum status @comment(t("known"))', 'enum status @comment(t("missing"))'))).toThrow("Missing default locale message for enum comment");
  expect(() => parseQiyProject(base.replace('enum status @comment(t("known"))', 'enum status @comment(t("known")) @comment("duplicate")'))).toThrow("Enum status: duplicate @comment annotation");
  expect(() => parseQiyProject(base.replace('value active @comment(t("known"))', 'value active @comment(t("known")) @comment("duplicate")'))).toThrow("Enum status.active: duplicate @comment annotation");
  expect(() => parseQiyProject(base.replace('group operations @comment(t("known"))', 'group operations @comment(t("known")) @comment("duplicate")'))).toThrow("Menu group operations: duplicate @comment annotation");
  expect(() => parseQiyProject(base.replace('metric userCount users @comment(t("known"))', 'metric userCount users @comment(t("known")) @comment("duplicate")'))).toThrow("Dashboard metric userCount: duplicate @comment annotation");
});
