import { expect, test } from "bun:test";
import { createI18nProvider } from "../app/i18n";

test("translates Refine layout and Qiy resource actions", () => {
  const zh = createI18nProvider("zh-CN");
  const en = createI18nProvider("en-US");
  expect(zh.translate("buttons.logout")).toBe("退出登录");
  expect(en.translate("buttons.logout")).toBe("Log out");
  expect(zh.translate("qiy.batchDelete")).toBe("批量删除");
});

test("implements Refine translation overloads, interpolation and asynchronous locale changes", async () => {
  const provider = createI18nProvider("en-US");
  expect(provider.translate("missing.title", "Fallback title")).toBe("Fallback title");
  expect(provider.translate("missing.title", {}, "Fallback title")).toBe("Fallback title");
  expect(provider.translate("missing.welcome", { name: "<Admin>" }, "Hello {{name}}")).toBe("Hello <Admin>");
  expect(provider.translate("missing.count", { count: 0 }, "{{count}} items")).toBe("0 items");
  expect(provider.translate("missing.empty", {}, "")).toBe("");
  expect(provider.translate("notifications.createSuccess", { resource: "Products" })).toBe("Successfully created Products");
  expect(provider.translate("notifications.error", { statusCode: 403 })).toBe("Error (status code: 403)");
  expect(provider.translate("unknown.key")).toBe("unknown.key");
  const changed = provider.changeLocale("zh-CN");
  expect(changed).toBeInstanceOf(Promise);
  await changed;
  expect(provider.getLocale()).toBe("zh-CN");
  expect(provider.translate("buttons.logout")).toBe("退出登录");
  expect(provider.translate("notifications.undoable", { seconds: 5 })).toBe("可在 5 秒内撤销");
  await expect(provider.changeLocale("unsupported")).rejects.toThrow("Unsupported interface locale");
  expect(provider.getLocale()).toBe("zh-CN");
  expect(createI18nProvider("en-US").getLocale()).toBe("en-US");
});
