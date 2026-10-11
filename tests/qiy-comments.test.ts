import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = await Bun.file(new URL("../examples/dataflow/documented-inputs.qiy", import.meta.url)).text();

test("localized model and dataflow descriptions roundtrip without losing translation references", () => {
  const project = parseQiyProject(source);
  expect(project.database.entities[0]?.comment).toBe("Review requests");
  expect(project.database.entities[0]?.fields[1]?.commentKey).toBe("entity.reviews.note");
  expect(project.dataflows?.[0]?.input[1]?.comment).toBe("Explain the review decision");
  expect(project.actions?.[1]?.target).toMatchObject({ commentKey: "entity.reviews.note", comment: "Explain the review decision" });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/server/src/modules/reviews/reviews.routes.ts"]).toContain('description: "Explain the review decision"');
  expect(files["apps/server/src/modules/reviews/reviews.routes.ts"]).toContain('description: "Review requests"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('description: "Explain the review decision"');
  expect(files["apps/web/app/resources.ts"]).toContain('"commentKey": "entity.reviews.note"');
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("tooltip={field.commentKey ? translate(");
  expect(files["apps/web/app/components/business-actions.tsx"]).toContain("translate(field.commentKey");
  expect(files["apps/web/app/messages.ts"]).toContain("请说明审核决定");
  expect(files["apps/server/src/graphql.ts"]).toContain('Review requests');
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
  expect(files["apps/web/app/root.tsx"]).toContain('useState<QiyLocale>("fr-FR")');
  expect(files["apps/web/app/root.tsx"]).toContain("options={languageOptions}");
  expect(files["apps/web/app/root.tsx"]).toContain("document.documentElement.dir");
  expect(files["apps/web/app/i18n.ts"]).toContain('antd/locale/fr_FR');
  expect(files["apps/web/app/i18n.ts"]).toContain('antd/locale/ja_JP');
  expect(files["apps/web/app/components/resource-form.tsx"]).toContain("resolveLocale(getLocale())");
  for (const tag of ["fr_fr", "FR-fr", "constructor", "__proto__", "", "en US"]) {
    expect(() => parseQiyProject(source.replace('default "en-US";', `default "${tag}";`))).toThrow("Invalid message locale");
  }
});
