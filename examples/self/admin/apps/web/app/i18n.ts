import type { I18nProvider } from "@refinedev/core";
import { createInstance, type TOptions } from "i18next";
import { defaultMessageLocale, projectMessage, projectMessages } from "./messages";
import type { Locale } from "antd/es/locale";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";

export type QiyLocale = string;
export const supportedLocales: string[] = ["zh-CN","en-US"];
export const languageOptions = supportedLocales.map((value) => ({ value, label: new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value }));
export function resolveLocale(value: string | undefined): QiyLocale { return value && supportedLocales.includes(value) ? value : defaultMessageLocale; }
export const localeMessages = { "zh-CN": { new: "新建", edit: "编辑", view: "查看", back: "返回列表", delete: "删除", batchDelete: "批量删除", actions: "操作", visibleColumns: "显示列", confirmDelete: "确认删除选中记录？", deleted: "删除成功", unknownResource: "未知资源", detail: "详情", language: "语言", save: "保存", cancel: "取消", deleteSuccess: "删除成功", quickAccess: "快速访问", upload: "上传文件" }, "en-US": { new: "New", edit: "Edit", view: "View", back: "Back to list", delete: "Delete", batchDelete: "Batch delete", actions: "Actions", visibleColumns: "Columns", confirmDelete: "Delete selected records?", deleted: "Deleted", unknownResource: "Unknown resource", detail: "Detail", language: "Language", save: "Save", cancel: "Cancel", deleteSuccess: "Deleted", quickAccess: "Quick access", upload: "Upload file" } } as const;
export const refineMessages: Record<QiyLocale, Record<string, string>> = {
  "zh-CN": { "buttons.logout": "退出登录", "buttons.create": "新建", "buttons.save": "保存", "buttons.delete": "删除", "buttons.edit": "编辑", "buttons.show": "查看", "buttons.cancel": "取消", "buttons.confirm": "确认", "buttons.refresh": "刷新", "buttons.search": "搜索", "buttons.filter": "筛选", "buttons.clear": "清除", "buttons.export": "导出", "buttons.import": "导入", "warnWhenUnsavedChanges": "更改尚未保存，确定离开吗？" },
  "en-US": { "buttons.logout": "Log out", "buttons.create": "Create", "buttons.save": "Save", "buttons.delete": "Delete", "buttons.edit": "Edit", "buttons.show": "View", "buttons.cancel": "Cancel", "buttons.confirm": "Confirm", "buttons.refresh": "Refresh", "buttons.search": "Search", "buttons.filter": "Filter", "buttons.clear": "Clear", "buttons.export": "Export", "buttons.import": "Import", "warnWhenUnsavedChanges": "You have unsaved changes. Leave this page?" },
};
export const antdLocales: Record<QiyLocale, Locale> = { "zh-CN": zhCN, "en-US": enUS };
Object.assign(refineMessages["en-US"]!, {
  "actions.list": "List", "actions.create": "Create", "actions.edit": "Edit", "actions.show": "Show", "table.actions": "Actions", "dashboard.title": "Dashboard", "loading": "Loading",
  "buttons.undo": "Undo", "buttons.clone": "Clone", "buttons.notAccessTitle": "You don't have permission to access",
  "notifications.success": "Successful", "notifications.error": "Error (status code: {{statusCode}})", "notifications.undoable": "You have {{seconds}} seconds to undo",
  "notifications.createSuccess": "Successfully created {{resource}}", "notifications.createError": "There was an error creating {{resource}} (status code: {{statusCode}})", "notifications.deleteSuccess": "Successfully deleted {{resource}}", "notifications.deleteError": "Error when deleting {{resource}} (status code: {{statusCode}})", "notifications.editSuccess": "Successfully edited {{resource}}", "notifications.editError": "Error when editing {{resource}} (status code: {{statusCode}})", "notifications.importProgress": "Importing: {{processed}}/{{total}}",
  "pages.login.title": "Sign in to your account", "pages.login.signin": "Sign in", "pages.login.fields.email": "Email", "pages.login.fields.password": "Password", "pages.login.buttons.submit": "Login", "pages.login.errors.requiredEmail": "Email is required", "pages.login.errors.requiredPassword": "Password is required",
  "pages.error.info": "You may have forgotten to add the {{action}} component to {{resource}} resource.", "pages.error.404": "Sorry, the page you visited does not exist.", "pages.error.resource404": "Are you sure you have created the {{resource}} resource.", "pages.error.backHome": "Back Home",
  "autoSave.success": "saved", "autoSave.error": "auto save failure", "autoSave.loading": "saving...", "autoSave.idle": "waiting for changes",
});
Object.assign(refineMessages["zh-CN"]!, {
  "actions.list": "列表", "actions.create": "新建", "actions.edit": "编辑", "actions.show": "详情", "table.actions": "操作", "dashboard.title": "工作台", "loading": "加载中",
  "buttons.undo": "撤销", "buttons.clone": "复制", "buttons.notAccessTitle": "没有访问权限",
  "notifications.success": "操作成功", "notifications.error": "操作失败（状态码：{{statusCode}}）", "notifications.undoable": "可在 {{seconds}} 秒内撤销",
  "notifications.createSuccess": "成功创建 {{resource}}", "notifications.createError": "创建 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.deleteSuccess": "成功删除 {{resource}}", "notifications.deleteError": "删除 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.editSuccess": "成功修改 {{resource}}", "notifications.editError": "修改 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.importProgress": "导入进度：{{processed}}/{{total}}",
  "pages.login.title": "登录账户", "pages.login.signin": "登录", "pages.login.fields.email": "邮箱", "pages.login.fields.password": "密码", "pages.login.buttons.submit": "登录", "pages.login.errors.requiredEmail": "请输入邮箱", "pages.login.errors.requiredPassword": "请输入密码",
  "pages.error.info": "可能未为 {{resource}} 资源配置 {{action}} 组件。", "pages.error.404": "页面不存在。", "pages.error.resource404": "请确认已创建 {{resource}} 资源。", "pages.error.backHome": "返回首页",
  "autoSave.success": "已保存", "autoSave.error": "自动保存失败", "autoSave.loading": "保存中", "autoSave.idle": "等待修改",
});
export function getAntdLocale(locale: QiyLocale): Locale { return Object.hasOwn(antdLocales, locale) ? antdLocales[locale]! : enUS; }
export function t(locale: QiyLocale, key: keyof typeof localeMessages["zh-CN"]): string { return projectMessage(locale, "qiy." + key) ?? localeMessages[locale === "zh-CN" ? "zh-CN" : "en-US"][key]; }
export function createI18nProvider(locale: QiyLocale, setLocale?: (next: QiyLocale) => void | Promise<void>): I18nProvider {
  const engine = createInstance();
  const resources = Object.fromEntries(supportedLocales.map((language) => {
    const fallback = language === "zh-CN" ? "zh-CN" : "en-US";
    return [language, { translation: { ...refineMessages[fallback], ...Object.fromEntries(Object.entries(localeMessages[fallback]).map(([key, value]) => ["qiy." + key, value])), ...projectMessages[defaultMessageLocale], ...(Object.hasOwn(projectMessages, language) ? projectMessages[language] : {}) } }];
  }));
  void engine.init({ lng: resolveLocale(locale), fallbackLng: defaultMessageLocale, resources, initAsync: false, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false } });
  return {
    getLocale: () => engine.language,
    changeLocale: async (next) => {
      if (!supportedLocales.includes(next)) throw new Error("Unsupported interface locale: " + next);
      await engine.changeLanguage(next);
      await setLocale?.(next);
      return next;
    },
    translate: (key, options, defaultMessage) => {
      const parameters: TOptions = options && typeof options === "object" ? options : {};
      const fallback = typeof options === "string" ? options : defaultMessage ?? parameters.defaultValue ?? key;
      if (key.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) return String(fallback);
      return String(engine.t(key, { ...parameters, defaultValue: fallback, returnObjects: false, returnDetails: false }));
    },
  };
}
