import type { I18nProvider } from "@refinedev/core";
import type { Locale } from "antd/es/locale";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
export type QiyLocale = "zh-CN" | "en-US";
export const localeMessages = { "zh-CN": { new: "新建", edit: "编辑", view: "查看", back: "返回列表", delete: "删除", batchDelete: "批量删除", actions: "操作", visibleColumns: "显示列", confirmDelete: "确认删除选中记录？", deleted: "删除成功", unknownResource: "未知资源", detail: "详情", language: "语言", save: "保存", cancel: "取消", deleteSuccess: "删除成功", quickAccess: "快速访问" }, "en-US": { new: "New", edit: "Edit", view: "View", back: "Back to list", delete: "Delete", batchDelete: "Batch delete", actions: "Actions", visibleColumns: "Columns", confirmDelete: "Delete selected records?", deleted: "Deleted", unknownResource: "Unknown resource", detail: "Detail", language: "Language", save: "Save", cancel: "Cancel", deleteSuccess: "Deleted", quickAccess: "Quick access" } } as const;
export const refineMessages: Record<QiyLocale, Record<string, string>> = {
  "zh-CN": { "buttons.logout": "退出登录", "buttons.create": "新建", "buttons.save": "保存", "buttons.delete": "删除", "buttons.edit": "编辑", "buttons.show": "查看", "buttons.cancel": "取消", "buttons.confirm": "确认", "buttons.refresh": "刷新", "buttons.search": "搜索", "buttons.filter": "筛选", "buttons.clear": "清除", "buttons.export": "导出", "buttons.import": "导入", "warnWhenUnsavedChanges": "更改尚未保存，确定离开吗？" },
  "en-US": { "buttons.logout": "Log out", "buttons.create": "Create", "buttons.save": "Save", "buttons.delete": "Delete", "buttons.edit": "Edit", "buttons.show": "View", "buttons.cancel": "Cancel", "buttons.confirm": "Confirm", "buttons.refresh": "Refresh", "buttons.search": "Search", "buttons.filter": "Filter", "buttons.clear": "Clear", "buttons.export": "Export", "buttons.import": "Import", "warnWhenUnsavedChanges": "You have unsaved changes. Leave this page?" },
};
export const antdLocales: Record<QiyLocale, Locale> = { "zh-CN": zhCN, "en-US": enUS };
export function t(locale: QiyLocale, key: keyof typeof localeMessages["zh-CN"]): string { return localeMessages[locale][key]; }
export function createI18nProvider(locale: QiyLocale, setLocale?: (next: QiyLocale) => void): I18nProvider { return { getLocale: () => locale, changeLocale: (next) => { if (next === "zh-CN" || next === "en-US") setLocale?.(next); return next; }, translate: (key, _options, defaultMessage) => { const shortKey = key.replace(/^qiy\./, "") as keyof typeof localeMessages["zh-CN"]; return refineMessages[locale][key] ?? localeMessages[locale][shortKey] ?? defaultMessage ?? key; } }; }
