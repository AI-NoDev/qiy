/** Generated feature flags and extra sidebar page links. Do not edit by hand. */
export const qiyFeatureFlags = { apiDocs: true, apiKeys: true } as const;
export const docsEnabled = qiyFeatureFlags.apiDocs || qiyFeatureFlags.apiKeys;

export interface QiyMenuLink {
  name: string;
  path: string;
  label: string;
  labelKey: string;
  icon?: string;
  group?: string;
}

/** Extra sidebar page entries (not Refine resources), appended into their menu group. */
export const qiyMenuLinks: QiyMenuLink[] = docsEnabled ? [{ name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" }] : [];
