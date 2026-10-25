/** Generated feature flags and extra sidebar page links. Do not edit by hand. */
export const qiyFeatureFlags = { overview: true, apiDocs: true, apiKeys: true } as const;
export const docsEnabled = qiyFeatureFlags.apiDocs || qiyFeatureFlags.apiKeys;
export const overviewEnabled = qiyFeatureFlags.overview;

export interface QiyMenuLink {
  name: string;
  path: string;
  label: string;
  labelKey: string;
  icon?: string;
  group?: string;
}

/** Developer pages under 系统管理; each entry is only present when its feature is enabled. */
export const qiyMenuLinks: QiyMenuLink[] = [
  { name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" },
  { name: "qiy-api-docs", path: "/system/api-docs", label: "API 文档", labelKey: "qiy.apiDocs.title", icon: "FileTextOutlined", group: "system" },
  { name: "qiy-api-keys", path: "/system/api-keys", label: "访问密钥", labelKey: "qiy.apiKey.title", icon: "KeyOutlined", group: "system" },
];
