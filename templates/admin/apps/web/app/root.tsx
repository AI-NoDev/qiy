import "antd/dist/reset.css";
import "./styles.css";
import { ConfigProvider, Select, Space, Typography } from "antd";
import { Refine, useTranslation } from "@refinedev/core";
import { ThemedLayout, ThemedTitle, useNotificationProvider } from "@refinedev/antd";
import routerProvider from "@refinedev/react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useMemo, useState } from "react";
import { qiyIcons } from "./icons";
import { dataProvider } from "./data-provider";
__QIY_AUTH_IMPORT__
import { resources, menuGroups } from "./resources";
import { antdLocales, createI18nProvider, type QiyLocale } from "./i18n";

function resolveResourceIcon(name: string) { const Icon = qiyIcons[name as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined; return <Icon />; }

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body></html>;
}

export default function Root() {
  __QIY_AUTH_LOCATION__
  const [locale, setLocale] = useState<QiyLocale>("zh-CN");
  const notificationProvider = useNotificationProvider();
  const i18nProvider = useMemo(() => createI18nProvider(locale, setLocale), [locale]);
  return <ConfigProvider locale={antdLocales[locale]} theme={{ token: { colorPrimary: "#1677ff", borderRadius: 6 } }}><Refine
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
  >__QIY_LAYOUT_START__<ThemedLayout
    Title={({ collapsed }: { collapsed?: boolean }) => <ThemedTitle collapsed={collapsed ?? false} text="Qiy Admin" />}
    Header={() => <AdminHeader />}
  ><Outlet /></ThemedLayout>__QIY_LAYOUT_END__</Refine></ConfigProvider>;
}

function AdminHeader() {
  const { getLocale, changeLocale } = useTranslation();
  return <div className="qiy-header"><Space style={{ width: "100%", justifyContent: "flex-end", paddingRight: 16 }}>
    <Typography.Text type="secondary">Qiy Admin</Typography.Text>
    <Select aria-label="Language" value={getLocale()} onChange={(value) => void changeLocale(value)} options={[{ value: "zh-CN", label: "中文" }, { value: "en-US", label: "English" }]} />
  </Space></div>;
}
