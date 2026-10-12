import "antd/dist/reset.css";
import "./styles.css";
import { Select, Space, Typography } from "antd";
import { Refine, useTranslation, type I18nProvider } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import routerProvider from "@refinedev/react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { qiyIcons } from "./icons";
import { dataProvider } from "./data-provider";
__QIY_AUTH_IMPORT__
import { resources, menuGroups } from "./resources";
import { getAntdLocale, languageOptions, createI18nProvider, type QiyLocale } from "./i18n";
import { QiyThemeControls, QiyThemedLayout, QiyThemedTitle, QiyUiProvider, useQiyNotificationProvider } from "./ui";

function resolveResourceIcon(name: string) { const Icon = qiyIcons[name as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined; return <Icon />; }

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body></html>;
}

export default function Root() {
  const [locale, setLocale] = useState<QiyLocale>("zh-CN");
  const direction = ["ar", "fa", "he", "ur"].includes(locale.split("-")[0]!) ? "rtl" : "ltr";
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = direction; }, [locale, direction]);
  const i18nProvider = useMemo(() => createI18nProvider(locale, setLocale), [locale]);
  return <QiyUiProvider direction={direction} locale={getAntdLocale(locale)}><RefineApplication i18nProvider={i18nProvider} /></QiyUiProvider>;
}

function RefineApplication({ i18nProvider }: { i18nProvider: I18nProvider }) {
  __QIY_AUTH_LOCATION__
  const notificationProvider = useQiyNotificationProvider();
  return <RefineKbarProvider><Refine
    dataProvider={dataProvider}
    __QIY_AUTH_PROPS__
    routerProvider={routerProvider}
    notificationProvider={notificationProvider}
    i18nProvider={i18nProvider}
    resources={[...menuGroups.map((group) => ({
      name: group.name,
      meta: { label: group.label, icon: resolveResourceIcon(group.icon), ...("parent" in group ? { parent: group.parent } : {}) },
    })), ...resources.map((resource) => ({
      name: resource.name,
      meta: { label: resource.label, icon: resolveResourceIcon(resource.icon), ...(resource.menuParent && { parent: resource.menuParent }) },
      list: `/${resource.name}`,
      create: `/${resource.name}/new`,
      show: `/${resource.name}/:id`,
      edit: `/${resource.name}/:id/edit`,
    }))]}
    options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, mutationMode: "pessimistic" }}
  >__QIY_LAYOUT_START__<QiyThemedLayout
    Title={({ collapsed }: { collapsed?: boolean }) => <QiyThemedTitle collapsed={collapsed ?? false} text="Qiy Admin" />}
    Header={() => <AdminHeader />}
  ><Outlet /></QiyThemedLayout>__QIY_LAYOUT_END__<RefineKbar /></Refine></RefineKbarProvider>;
}

function AdminHeader() {
  const { getLocale, changeLocale } = useTranslation();
  return <div className="qiy-header"><Space style={{ width: "100%", justifyContent: "flex-end", paddingRight: 16 }}>
    <Typography.Text type="secondary">Qiy Admin</Typography.Text>
    <QiyThemeControls />
    <Select aria-label="Language" value={getLocale()} onChange={(value) => void changeLocale(value)} options={languageOptions} />
  </Space></div>;
}
