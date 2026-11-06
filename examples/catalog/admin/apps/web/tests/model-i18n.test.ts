import { expect, test } from "bun:test";
import { createI18nProvider, filterModeLabel, readStoredLocale, resolveLocale, storeLocale, supportedLocales, t } from "../app/i18n";
import { defaultMessageLocale, projectMessages } from "../app/messages";
import { enumerations, menuGroups, resources } from "../app/resources";
import { chartPanels, charts } from "../app/charts";

interface LabelEntry { key: string; fallback: string }
const labels: LabelEntry[] = [
  ...resources.map((resource) => ({ key: resource.labelKey ?? "", fallback: resource.label })),
  ...resources.map((resource) => ({ key: resource.singularKey ?? "", fallback: resource.singular })),
  ...resources.map((resource) => ({ key: resource.pluralKey ?? "", fallback: resource.plural })),
  ...resources.flatMap((resource) => resource.fields.map((field) => ({ key: field.labelKey ?? "", fallback: field.label }))),
  ...resources.flatMap((resource) => (resource.relatedResources ?? []).map((relation) => ({ key: relation.labelKey ?? "", fallback: relation.label }))),
  ...menuGroups.map((group) => ({ key: group.labelKey, fallback: group.label })),
  ...charts.map((chart) => ({ key: chart.labelKey, fallback: chart.title })),
  ...chartPanels.map((panel) => ({ key: panel.labelKey, fallback: panel.title })),
  ...charts.flatMap((chart) => chart.views.flatMap((view) => [
    { key: view.labelKey, fallback: view.label },
    ...(view.labels?.values ?? []).map((entry) => ({ key: entry.labelKey, fallback: entry.label })),
  ])),
];

test("every model-derived label has a stable key and resolves through project messages", () => {
  const providers = Object.fromEntries(supportedLocales.map((locale) => [locale, createI18nProvider(locale)]));
  for (const { key, fallback } of labels) {
    expect(key).toMatch(/^qiy\.(resources|enums|menu|charts|actions)\./);
    for (const locale of supportedLocales) {
      const expected = projectMessages[locale]?.[key] ?? projectMessages[defaultMessageLocale]?.[key] ?? fallback;
      expect(providers[locale]!.translate(key, {}, fallback)).toBe(expected);
    }
  }
  // The old raw label stays the default when a translation is missing.
  expect(createI18nProvider(defaultMessageLocale).translate("qiy.resources.__missing__.label", {}, "Fallback label")).toBe("Fallback label");
});

test("enum values, menu groups and charts carry translation keys", () => {
  for (const enumeration of enumerations) {
    expect(enumeration.labelKey).toBe("qiy.enums." + enumeration.name + ".label");
    for (const value of enumeration.values) expect(value.labelKey).toBe("qiy.enums." + enumeration.name + ".values." + value.name);
  }
  for (const resource of resources) {
    expect(resource.labelKey).toBe("qiy.resources." + resource.name + ".label");
    expect(resource.singularKey).toBe("qiy.resources." + resource.name + ".singular");
    expect(resource.pluralKey).toBe("qiy.resources." + resource.name + ".plural");
    for (const field of resource.fields) expect(field.labelKey).toBe("qiy.resources." + resource.name + ".fields." + field.name + ".label");
  }
  for (const chart of charts) {
    expect(chart.labelKey).toBe("qiy.charts." + chart.name + ".label");
    expect(chart.views.length).toBeGreaterThan(0);
    for (const view of chart.views) {
      expect(view.labelKey).toBe("qiy.charts." + chart.name + ".views." + view.kind + ".label");
      for (const entry of view.labels?.values ?? []) expect(entry.labelKey).toBe("qiy.charts." + chart.name + ".labels." + entry.value);
    }
  }
  for (const panel of chartPanels) expect(panel.labelKey).toBe("qiy.charts." + panel.name + ".label");
  for (const mode of ["eq", "contains", "between"]) expect(filterModeLabel("zh-CN", mode).length).toBeGreaterThan(0);
});

test("locale switching stores the choice and survives a reload", async () => {
  const storage = new Map<string, string>();
  const fake = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
  expect(readStoredLocale(defaultMessageLocale, fake)).toBe(defaultMessageLocale);
  const target = supportedLocales.find((locale) => locale !== defaultMessageLocale) ?? defaultMessageLocale;
  let current = defaultMessageLocale;
  const provider = createI18nProvider(defaultMessageLocale, (next) => { current = next; storeLocale(next, fake); });
  await provider.changeLocale(target);
  expect(current).toBe(target);
  expect(readStoredLocale(defaultMessageLocale, fake)).toBe(target);
  expect(resolveLocale(readStoredLocale(defaultMessageLocale, fake))).toBe(target);
  storeLocale("not-a-declared-locale", fake);
  expect(readStoredLocale(defaultMessageLocale, fake)).toBe(defaultMessageLocale);
  expect(t(defaultMessageLocale, "new").length).toBeGreaterThan(0);
});
