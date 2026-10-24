import { qiyLiveProvider } from "./providers/live-provider";
import { auditLogProvider } from "./providers/audit-log-provider";
import "antd/dist/reset.css";
import "./styles.css";
import { Button, Select, Space, Typography, theme } from "antd";
import { Refine, useTranslation, type I18nProvider } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import routerProvider from "@refinedev/react-router";
import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { qiyIcons } from "./icons";
import { dataProvider } from "./data-provider";
import { qiyAccessControlProvider, qiyAuthProvider } from "./auth";
import { Authenticated } from "@refinedev/core";
import { Navigate, useLocation } from "react-router";
import { resources, menuGroups } from "./resources";
import { getAntdLocale, languageOptions, createI18nProvider, readStoredLocale, resolveLocale, storeLocale, t, type QiyLocale } from "./i18n";
import { QiyThemeControls, QiyThemedLayout, QiyThemedTitle, QiyUiProvider, useQiyNotificationProvider } from "./ui";

function resolveResourceIcon(name: string) { const Icon = qiyIcons[name as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined; return <Icon />; }

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body></html>;
}

export default function Root() {
  const [locale, setLocale] = useState<QiyLocale>(() => readStoredLocale());
  const direction = ["ar", "fa", "he", "ur"].includes(locale.split("-")[0]!) ? "rtl" : "ltr";
  // Persist the choice so a reload keeps the language the user picked; the stored
  // value wins over the model default and unknown values fall back to it.
  const applyLocale = useCallback((next: QiyLocale) => { setLocale(next); storeLocale(next); }, []);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = direction; }, [locale, direction]);
  const i18nProvider = useMemo(() => createI18nProvider(locale, applyLocale), [locale, applyLocale]);
  return <QiyUiProvider direction={direction} locale={getAntdLocale(locale)}><RefineApplication i18nProvider={i18nProvider} /></QiyUiProvider>;
}

function RefineApplication({ i18nProvider }: { i18nProvider: I18nProvider }) {
  const location = useLocation(); // legacy login check: location.pathname === "/auth/login"
  const notificationProvider = useQiyNotificationProvider();
  const locale = resolveLocale(i18nProvider.getLocale());
  // Model labels are looked up through their stable keys at render time, so
  // switching the language re-renders the menu, titles and breadcrumbs.
  const modelLabel = (labelKey: string | undefined, fallback: string): string => labelKey ? i18nProvider.translate(labelKey, {}, fallback) : fallback;
  return <RefineKbarProvider><Refine
    dataProvider={dataProvider} liveProvider={qiyLiveProvider}
    auditLogProvider={auditLogProvider} authProvider={qiyAuthProvider} accessControlProvider={qiyAccessControlProvider}
    routerProvider={routerProvider}
    notificationProvider={notificationProvider}
    i18nProvider={i18nProvider}
    resources={[{
      name: "qiy-overview",
      list: "/",
      meta: { label: t(locale, "overview"), icon: resolveResourceIcon("DashboardOutlined") },
    }, ...menuGroups.map((group) => ({
      name: group.name,
      meta: { label: modelLabel(group.labelKey, group.label), icon: resolveResourceIcon(group.icon), ...("parent" in group ? { parent: group.parent } : {}) },
    })), ...resources.map((resource) => ({
      name: resource.name,
      meta: { audit: [], label: modelLabel(resource.labelKey, resource.label), icon: resolveResourceIcon(resource.icon), ...(resource.menuParent && { parent: resource.menuParent }) },
      list: `/${resource.name}`,
      create: `/${resource.name}/new`,
      show: `/${resource.name}/:id`,
      edit: `/${resource.name}/:id/edit`,
    }))]}
    options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, mutationMode: "pessimistic" }}
  >{location.pathname.startsWith("/auth/") || location.pathname.startsWith("/oauth/") ? <Outlet /> : <Authenticated key="protected" fallback={<Navigate to="/auth/login" replace />}> <QiyThemedLayout
    Title={({ collapsed }: { collapsed?: boolean }) => <QiyThemedTitle collapsed={collapsed ?? false} text="Qiy Admin" />}
    Header={() => <AdminHeader />}
  ><Outlet /></QiyThemedLayout></Authenticated>}<RefineKbar /></Refine></RefineKbarProvider>;
}

function AdminHeader() {
  const { getLocale, changeLocale, translate } = useTranslation();
  const { token } = theme.useToken();
  return <header className="qiy-header" style={{ background: token.colorBgElevated, color: token.colorText, borderBottom: `1px solid ${token.colorBorderSecondary}` }}><Space wrap style={{ width: "100%", justifyContent: "flex-end" }}>
    <Typography.Text type="secondary">Qiy Admin</Typography.Text>
    <Link to="/profile"><Button type="link">{translate("qiy.profile", {}, "Profile")}</Button></Link>
    <QiyThemeControls />
    <Select aria-label={translate("qiy.language", {}, "Language")} value={getLocale()} onChange={(value) => void changeLocale(value)} options={languageOptions} />
  </Space></header>;
}
