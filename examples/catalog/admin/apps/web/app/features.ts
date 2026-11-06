/** Generated feature flags and extra sidebar page links. Do not edit by hand. */
export const qiyFeatureFlags = { overview: false, apiDocs: false, apiKeys: false } as const;
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



];
