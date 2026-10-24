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
/**
 * Built-in chrome dictionary. Every value is keyed by the suffix of a
 * `qiy.<key>` message, so `t(locale, key)` and `translate("qiy.<key>")` both
 * resolve it, and a project `messages` block can override any entry with the
 * same qiy.* key. Values using {{name}} placeholders are interpolated by i18next.
 */
export const localeMessages = {
  "zh-CN": {
    new: "新建", edit: "编辑", view: "查看", back: "返回列表", delete: "删除", batchDelete: "批量删除", actions: "操作",
    visibleColumns: "显示列", confirmDelete: "确认删除选中记录？", deleted: "删除成功", unknownResource: "未知资源", detail: "详情",
    createResource: "新建{{resource}}", editResource: "编辑{{resource}}", openDetail: "打开详情", searchRelation: "搜索…",
    language: "语言", save: "保存", cancel: "取消", deleteSuccess: "删除成功", quickAccess: "快速访问", upload: "上传文件",
    overview: "概览", overviewDescription: "从数据资源快速进入业务管理。", profile: "个人中心", filters: "筛选", search: "搜索",
    matchAll: "全部匹配", matchAny: "任一匹配", commaSeparated: "（逗号分隔）", forbidden: "没有访问该页面的权限",
    noData: "暂无数据", vectorData: "向量数据",
    import: "导入 CSV", export: "导出 CSV", exportSelected: "导出选中", views: "已存视图", viewName: "视图名称",
    saveView: "保存视图", saveToServer: "保存到服务器", shareView: "共享给所有人", publishView: "发布视图",
    saved: "视图已保存", viewShared: "视图已共享给所有人", viewPublished: "视图已保存到服务器", deleteView: "删除视图",
    viewDeleted: "视图已删除", viewDeleteFailed: "删除视图失败", confirmDeleteView: "删除该视图？",
    viewMine: "个人", viewPublishedTag: "发布", viewSharedTag: "共享",
    treeView: "树视图", shared: "（共享）", importProgress: "正在导入：{{processed}}/{{total}}",
    importedRows: "已导入 {{rows}} 行", importFailed: "导入失败", publishFailed: "发布视图失败",
    paginationTotal: "第 {{start}}-{{end}} 条，共 {{total}} 条", perPage: "条/页", page: "页",
    treeNodesCount: "{{nodes}} 个节点", treeOrphans: "{{nodes}} 个节点的父级缺失或成环",
    relatedUnknown: "未知关联资源：{{resource}}",
    auditTitle: "操作审计", auditAction: "操作", auditAuthor: "操作人", auditSystem: "系统", auditTime: "时间",
    aggSum: "求和", aggAvg: "平均", aggMin: "最小值", aggMax: "最大值",
    uploadFailed: "上传失败：{{status}}", createForbidden: "没有创建该资源的权限。", editForbidden: "没有编辑该资源的权限。",
    themeColor: "主题色", themeBlue: "蓝色", themePurple: "紫色", themeGreen: "绿色", themeOrange: "橙色", themeRed: "红色",
    colorMode: "颜色模式", colorLight: "亮色", colorDark: "暗色", colorSystem: "跟随系统",
    profileTitle: "个人中心", account: "账号", signOut: "退出登录", username: "用户名", email: "邮箱", name: "姓名",
    role: "角色", password: "密码", passwordSet: "已设置", passwordNotSet: "未设置", linkedMethods: "已关联登录方式",
    noProviders: "未配置 OAuth 提供方", linked: "已关联", notLinked: "尚未关联", bind: "关联", unbind: "解除关联",
    unlinkTitle: "解除关联 {{provider}}？", unlinkKeep: "之后可以重新关联。", unlinkLast: "这是最后一个登录方式。",
    linkedToast: "已关联 {{provider}}", unlinkedToast: "已解除关联 {{provider}}",
    onboardingInvalid: "此账号开通链接无效或已过期。", backToSignIn: "返回登录", finishAccount: "完成账号创建",
    signedInWith: "已通过 {{provider}} 登录。", confirmAccount: "请确认账号信息并设置密码。", fieldRequired: "此项为必填项",
    invalidEmail: "请输入有效的邮箱地址", confirmPassword: "确认密码",
    passwordMin: "至少 8 个字符", passwordMismatch: "两次输入的密码不一致", createAccount: "创建账号并登录",
    alreadyHaveAccount: "已有密码账号？", signInAction: "登录", linkProviderHint: "登录后可在个人中心关联此登录方式。",
    loginNotConfigured: "此应用未配置认证。",
    completingSignIn: "正在完成登录…", completingProviderSignIn: "正在完成 {{provider}} 登录…", providerLoginFailed: "{{provider}} 登录失败",
    multiProviderHint: "请选择身份提供方登录。", noProviderConfigured: "服务器未配置身份提供方",
    otpTitle: "Qiy Admin 登录", otpHint: "输入邮箱、手机号或模型配置的唯一登录标识，获取一次性验证码。",
    otpIdentifier: "登录标识", otpCode: "一次性验证码", otpSend: "发送验证码", otpVerify: "验证并登录",
    otpResend: "重新发送", otpSendFailed: "验证码发送失败",
    oidcTitle: "Qiy Admin 登录", oidcHint: "使用 {{provider}} Authorization Code + PKCE 登录；浏览器不保存 client secret，会话过期时先尝试静默续期。",
    oidcSignIn: "使用 {{provider}} 登录", oidcRenewing: "正在尝试静默续期…",
  },
  "en-US": {
    new: "New", edit: "Edit", view: "View", back: "Back to list", delete: "Delete", batchDelete: "Batch delete", actions: "Actions",
    visibleColumns: "Columns", confirmDelete: "Delete selected records?", deleted: "Deleted", unknownResource: "Unknown resource", detail: "Detail",
    createResource: "Create {{resource}}", editResource: "Edit {{resource}}", openDetail: "Open details", searchRelation: "Search…",
    language: "Language", save: "Save", cancel: "Cancel", deleteSuccess: "Deleted", quickAccess: "Quick access", upload: "Upload file",
    overview: "Overview", overviewDescription: "Jump into your data resources from one place.", profile: "Profile", filters: "Filters", search: "Search",
    matchAll: "Match all", matchAny: "Match any", commaSeparated: " (comma separated)", forbidden: "You are not allowed to open this page",
    noData: "No data", vectorData: "Vector data",
    import: "Import CSV", export: "Export CSV", exportSelected: "Export selected", views: "Saved views", viewName: "View name",
    saveView: "Save view", saveToServer: "Save to server", shareView: "Share with everyone", publishView: "Publish view",
    saved: "View saved", viewShared: "View shared with everyone", viewPublished: "View saved to server", deleteView: "Delete view",
    viewDeleted: "View deleted", viewDeleteFailed: "Deleting the view failed", confirmDeleteView: "Delete this view?",
    viewMine: "Personal", viewPublishedTag: "Published", viewSharedTag: "Shared",
    treeView: "Tree view", shared: " (shared)", importProgress: "Importing: {{processed}}/{{total}}",
    importedRows: "{{rows}} row(s) imported", importFailed: "Import failed", publishFailed: "Publishing the view failed",
    paginationTotal: "{{start}}-{{end}} of {{total}}", perPage: "/ page", page: "page",
    treeNodesCount: "{{nodes}} node(s)", treeOrphans: "{{nodes}} node(s) have a missing or cyclic parent",
    relatedUnknown: "Unknown related resource: {{resource}}",
    auditTitle: "Audit history", auditAction: "Action", auditAuthor: "Author", auditSystem: "System", auditTime: "Time",
    aggSum: "sum", aggAvg: "avg", aggMin: "min", aggMax: "max",
    uploadFailed: "Upload failed: {{status}}", createForbidden: "You do not have permission to create this resource.", editForbidden: "You do not have permission to edit this resource.",
    themeColor: "Theme color", themeBlue: "Blue", themePurple: "Purple", themeGreen: "Green", themeOrange: "Orange", themeRed: "Red",
    colorMode: "Color mode", colorLight: "Light", colorDark: "Dark", colorSystem: "System",
    profileTitle: "Profile", account: "Account", signOut: "Sign out", username: "Username", email: "Email", name: "Name",
    role: "Role", password: "Password", passwordSet: "Set", passwordNotSet: "Not set", linkedMethods: "Linked sign-in methods",
    noProviders: "No OAuth providers configured", linked: "Linked", notLinked: "Not linked yet", bind: "Bind", unbind: "Unbind",
    unlinkTitle: "Unlink {{provider}}?", unlinkKeep: "You can link it again later.", unlinkLast: "This is your last sign-in method.",
    linkedToast: "Linked {{provider}}", unlinkedToast: "Unlinked {{provider}}",
    onboardingInvalid: "This onboarding link is invalid or has expired.", backToSignIn: "Back to sign in", finishAccount: "Finish creating your account",
    signedInWith: "Signed in with {{provider}}.", confirmAccount: "Confirm the account details and choose a password.", fieldRequired: "This field is required",
    invalidEmail: "Enter a valid email address", confirmPassword: "Confirm password",
    passwordMin: "Use at least 8 characters", passwordMismatch: "Passwords do not match", createAccount: "Create account and sign in",
    alreadyHaveAccount: "Already have an account with a password?", signInAction: "Sign in", linkProviderHint: "Sign in and link this provider from your profile.",
    loginNotConfigured: "Authentication is not configured for this application.",
    completingSignIn: "Completing sign-in…", completingProviderSignIn: "Completing {{provider}} sign-in…", providerLoginFailed: "{{provider}} sign-in failed",
    multiProviderHint: "Choose an identity provider to sign in.", noProviderConfigured: "No identity provider is configured on the server",
    otpTitle: "Qiy Admin sign in", otpHint: "Enter the email, phone or model identifier configured for this account to receive a one-time password.",
    otpIdentifier: "Sign-in identifier", otpCode: "One-time password", otpSend: "Send code", otpVerify: "Verify and sign in",
    otpResend: "Send again", otpSendFailed: "Could not send the one-time password",
    oidcTitle: "Qiy Admin sign in", oidcHint: "Sign in with {{provider}} using Authorization Code + PKCE. No client secret is stored in the browser; expired sessions try silent renewal first.",
    oidcSignIn: "Sign in with {{provider}}", oidcRenewing: "Trying silent renewal…",
  },
} as const;
/** Localized filter operator names; project messages can override every entry with qiy.filters.mode.<mode>. */
export const filterModeMessages: Record<QiyLocale, Record<string, string>> = {
  "zh-CN": { eq: "等于", contains: "包含", startsWith: "开头是", endsWith: "结尾是", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于", between: "介于", in: "属于" },
  "en-US": { eq: "Equals", contains: "Contains", startsWith: "Starts with", endsWith: "Ends with", gt: "Greater than", gte: "Greater than or equal", lt: "Less than", lte: "Less than or equal", between: "Between", in: "In" },
};
export function filterModeLabel(locale: QiyLocale, mode: string): string { return projectMessage(locale, "qiy.filters.mode." + mode) ?? filterModeMessages[locale === "zh-CN" ? "zh-CN" : "en-US"][mode] ?? mode; }
/** Language choice survives reloads; an unknown stored value falls back to the generated default. */
export const localeStorageKey = "qiy.locale";
type LocaleStorage = Pick<Storage, "getItem" | "setItem">;
function localeStorage(): LocaleStorage | undefined { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } }
export function readStoredLocale(fallback: QiyLocale = defaultMessageLocale, storage: Pick<Storage, "getItem"> | undefined = localeStorage()): QiyLocale { try { return resolveLocale(storage?.getItem(localeStorageKey) ?? fallback); } catch { return resolveLocale(fallback); } }
export function storeLocale(locale: QiyLocale, storage: LocaleStorage | undefined = localeStorage()): void { try { storage?.setItem(localeStorageKey, locale); } catch { /* quota or private mode */ } }
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
  "pages.login.rememberMe": "Remember me", "pages.login.forgotPassword": "Forgot password?", "pages.login.noAccount": "Don't have an account?", "pages.login.signup": "Sign up", "pages.login.providers": "Or continue with",
  "pages.error.info": "You may have forgotten to add the {{action}} component to {{resource}} resource.", "pages.error.404": "Sorry, the page you visited does not exist.", "pages.error.resource404": "Are you sure you have created the {{resource}} resource.", "pages.error.backHome": "Back Home",
  "autoSave.success": "saved", "autoSave.error": "auto save failure", "autoSave.loading": "saving...", "autoSave.idle": "waiting for changes",
});
Object.assign(refineMessages["zh-CN"]!, {
  "actions.list": "列表", "actions.create": "新建", "actions.edit": "编辑", "actions.show": "详情", "table.actions": "操作", "dashboard.title": "工作台", "loading": "加载中",
  "buttons.undo": "撤销", "buttons.clone": "复制", "buttons.notAccessTitle": "没有访问权限",
  "notifications.success": "操作成功", "notifications.error": "操作失败（状态码：{{statusCode}}）", "notifications.undoable": "可在 {{seconds}} 秒内撤销",
  "notifications.createSuccess": "成功创建 {{resource}}", "notifications.createError": "创建 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.deleteSuccess": "成功删除 {{resource}}", "notifications.deleteError": "删除 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.editSuccess": "成功修改 {{resource}}", "notifications.editError": "修改 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.importProgress": "导入进度：{{processed}}/{{total}}",
  "pages.login.title": "登录账户", "pages.login.signin": "登录", "pages.login.fields.email": "邮箱", "pages.login.fields.password": "密码", "pages.login.buttons.submit": "登录", "pages.login.errors.requiredEmail": "请输入邮箱", "pages.login.errors.requiredPassword": "请输入密码",
  "pages.login.rememberMe": "记住我", "pages.login.forgotPassword": "忘记密码？", "pages.login.noAccount": "还没有账号？", "pages.login.signup": "注册", "pages.login.providers": "或使用以下方式登录",
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
