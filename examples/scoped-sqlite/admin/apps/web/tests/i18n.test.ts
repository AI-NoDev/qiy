import { expect, test } from "bun:test";
import { createI18nProvider } from "../app/i18n";

test("translates Refine layout and Qiy resource actions", () => {
  const zh = createI18nProvider("zh-CN");
  const en = createI18nProvider("en-US");
  expect(zh.translate("buttons.logout")).toBe("退出登录");
  expect(en.translate("buttons.logout")).toBe("Log out");
  expect(zh.translate("qiy.batchDelete")).toBe("批量删除");
});
