import { expect, test } from "bun:test";
import { createI18nProvider, filterModeLabel } from "../app/i18n";

/**
 * UI chrome (toolbars, theme controls, auth pages, pagination) ships with a
 * built-in zh-CN/en-US dictionary and follows the same language selector as the
 * model labels. This test keeps every key present in both locales so a missing
 * translation shows up as a failing fallback instead of an English literal.
 */
const chromeKeys = [
  "qiy.import", "qiy.export", "qiy.exportSelected", "qiy.visibleColumns", "qiy.views", "qiy.viewName",
  "qiy.save", "qiy.saveView", "qiy.saveToServer", "qiy.shareView", "qiy.publishView", "qiy.saved",
  "qiy.viewShared", "qiy.viewPublished", "qiy.deleteView", "qiy.shared", "qiy.importFailed", "qiy.importedRows",
  "qiy.viewDeleted", "qiy.viewDeleteFailed", "qiy.confirmDeleteView", "qiy.viewMine", "qiy.viewPublishedTag", "qiy.viewSharedTag",
  "qiy.treeView", "qiy.auditTitle", "qiy.auditAction", "qiy.auditAuthor", "qiy.auditSystem", "qiy.auditTime",
  "qiy.new", "qiy.edit", "qiy.delete", "qiy.batchDelete", "qiy.confirmDelete", "qiy.detail",
  "qiy.createResource", "qiy.editResource", "qiy.openDetail", "qiy.searchRelation",
  "qiy.drawerBreadcrumb", "qiy.recordDetails", "qiy.recordSummary", "qiy.close",
  "qiy.search", "qiy.filters", "qiy.matchAll", "qiy.matchAny", "qiy.commaSeparated", "qiy.forbidden", "qiy.noData",
  "qiy.themeColor", "qiy.themeBlue", "qiy.themePurple", "qiy.themeGreen", "qiy.themeOrange", "qiy.themeRed",
  "qiy.colorMode", "qiy.colorLight", "qiy.colorDark", "qiy.colorSystem",
  "qiy.profileTitle", "qiy.account", "qiy.signOut", "qiy.username", "qiy.email", "qiy.name", "qiy.role",
  "qiy.password", "qiy.passwordSet", "qiy.passwordNotSet", "qiy.linkedMethods", "qiy.noProviders", "qiy.linked",
  "qiy.notLinked", "qiy.bind", "qiy.unbind", "qiy.unlinkKeep", "qiy.unlinkLast",
  "qiy.onboardingInvalid", "qiy.backToSignIn", "qiy.finishAccount", "qiy.confirmAccount", "qiy.fieldRequired",
  "qiy.passwordMin", "qiy.passwordMismatch", "qiy.createAccount", "qiy.alreadyHaveAccount", "qiy.signInAction",
  "qiy.linkProviderHint", "qiy.loginNotConfigured", "qiy.completingSignIn", "qiy.multiProviderHint",
  "qiy.noProviderConfigured", "qiy.otpHint", "qiy.otpIdentifier", "qiy.otpCode", "qiy.otpSend", "qiy.otpVerify",
  "qiy.otpResend", "qiy.oidcHint", "qiy.oidcSignIn", "qiy.oidcRenewing",
  "qiy.createForbidden", "qiy.editForbidden", "qiy.relatedUnknown", "qiy.treeNodesCount", "qiy.treeOrphans",
  "qiy.pickDate", "qiy.pickTime", "qiy.pickDateTime",
] as const;

test("every chrome key resolves in zh-CN and en-US instead of falling back to English", () => {
  const zh = createI18nProvider("zh-CN");
  const en = createI18nProvider("en-US");
  for (const key of chromeKeys) {
    const fallback = "i18n-fallback-" + key;
    expect(zh.translate(key, {}, fallback)).not.toBe(fallback);
    expect(en.translate(key, {}, fallback)).not.toBe(fallback);
    const zhValue = zh.translate(key, {}, fallback);
    const enValue = en.translate(key, {}, fallback);
    expect(typeof zhValue).toBe("string");
    expect(typeof enValue).toBe("string");
  }
  // The chrome really is translated, not just present: a few stable pairs.
  expect(zh.translate("qiy.import")).toBe("导入 CSV");
  expect(en.translate("qiy.import")).toBe("Import CSV");
  expect(zh.translate("qiy.export")).toBe("导出 CSV");
  expect(zh.translate("qiy.visibleColumns")).toBe("显示列");
  expect(zh.translate("qiy.views")).toBe("已存视图");
  expect(zh.translate("qiy.saveView")).toBe("保存视图");
  expect(zh.translate("qiy.viewDeleted")).toBe("视图已删除");
  expect(en.translate("qiy.viewDeleted")).toBe("View deleted");
  expect(zh.translate("qiy.viewDeleteFailed")).toBe("删除视图失败");
  expect(zh.translate("qiy.viewMine")).toBe("个人");
  expect(zh.translate("qiy.viewPublishedTag")).toBe("发布");
  expect(zh.translate("qiy.viewSharedTag")).toBe("共享");
  expect(zh.translate("qiy.search")).toBe("搜索");
  expect(zh.translate("qiy.matchAll")).toBe("全部匹配");
  expect(zh.translate("qiy.themeBlue")).toBe("蓝色");
  expect(zh.translate("qiy.themePurple")).toBe("紫色");
  expect(zh.translate("qiy.themeGreen")).toBe("绿色");
  expect(zh.translate("qiy.themeOrange")).toBe("橙色");
  expect(zh.translate("qiy.themeRed")).toBe("红色");
  expect(zh.translate("qiy.colorLight")).toBe("亮色");
  expect(zh.translate("qiy.colorDark")).toBe("暗色");
  expect(zh.translate("qiy.colorSystem")).toBe("跟随系统");
  expect(en.translate("qiy.colorLight")).toBe("Light");
  expect(zh.translate("qiy.profileTitle")).toBe("个人中心");
  expect(en.translate("qiy.profileTitle")).toBe("Profile");
  // The FK drawer/breadcrumb chrome follows the same dictionary as the rest of the UI.
  expect(zh.translate("qiy.drawerBreadcrumb")).toBe("关联记录路径");
  expect(en.translate("qiy.drawerBreadcrumb")).toBe("Related record path");
  expect(zh.translate("qiy.recordDetails")).toBe("字段详情");
  expect(en.translate("qiy.recordDetails")).toBe("Field details");
  expect(zh.translate("qiy.recordSummary")).toBe("关联摘要");
  expect(zh.translate("qiy.close")).toBe("关闭");
  expect(en.translate("qiy.close")).toBe("Close");
  expect(zh.translate("qiy.signOut")).toBe("退出登录");
  expect(zh.translate("qiy.bind")).toBe("关联");
  expect(zh.translate("qiy.unbind")).toBe("解除关联");
  expect(zh.translate("qiy.createAccount")).toBe("创建账号并登录");
  // Interpolated chrome (pagination/saved-view/link copy) keeps its parameters.
  expect(zh.translate("qiy.paginationTotal", { start: 1, end: 10, total: 42 })).toBe("第 1-10 条，共 42 条");
  expect(en.translate("qiy.paginationTotal", { start: 1, end: 10, total: 42 })).toBe("1-10 of 42");
  expect(zh.translate("qiy.importedRows", { rows: 3 })).toBe("已导入 3 行");
  expect(zh.translate("qiy.unlinkTitle", { provider: "Okta" })).toBe("解除关联 Okta？");
  expect(zh.translate("filterModeLabelPlaceholder", {}, "fallback")).toBe("fallback");
});

test("filter operators and unknown keys still fall back safely", () => {
  expect(filterModeLabel("zh-CN", "contains")).toBe("包含");
  expect(filterModeLabel("en-US", "between")).toBe("Between");
  expect(createI18nProvider("en-US").translate("qiy.notARealChromeKey", {}, "Fallback")).toBe("Fallback");
});
