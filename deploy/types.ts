export const platformNames = ["huawei", "xiaomi", "oppo", "vivo", "tencent", "honor"] as const;

export type DistributionPlatform = typeof platformNames[number];
export type EnvReference = `env:${string}`;

export interface AndroidReleaseAssets {
  iconPath?: string;
  screenshots?: string[];
  privacyPolicyUrl: string;
  testAccount?: {
    accounts?: Array<{ type: "password" | "sms"; account?: string; passwordOrCode?: string; accessCode?: string }>;
    auditNotes?: string;
  };
}

export interface AndroidAppMetadata {
  packageName: string;
  name: string;
  publisherName?: string;
  versionName?: string;
  versionCode?: number;
  category?: string | number;
  keywords?: string[];
  description?: string;
  brief?: string;
  updateDescription?: string;
  website?: string;
  assets: AndroidReleaseAssets;
}

export interface ReleaseArtifact {
  path: string;
  downloadUrl?: string;
  secondApkPath?: string;
}

export interface RelayDistributionConfig {
  endpoint: string;
  token: EnvReference;
  headers?: Record<string, string>;
}

export interface StoreBaseConfig {
  enabled: boolean;
  appId?: string;
  portalUrl: string;
  relay?: RelayDistributionConfig;
}

export interface HuaweiStoreConfig extends StoreBaseConfig {
  appId: string;
  clientId: EnvReference;
  clientSecret: EnvReference;
  apiBaseUrl?: string;
}

export interface XiaomiStoreConfig extends StoreBaseConfig {
  username: EnvReference;
  credential: EnvReference;
  encryptionPublicKey: EnvReference;
  apiBaseUrl?: string;
  releaseMode?: "create" | "update-package" | "update-info";
}

export interface OppoStoreConfig extends StoreBaseConfig {
  appId: string;
  appKey: EnvReference;
  appSecret: EnvReference;
}

export interface VivoStoreConfig extends StoreBaseConfig {
  appId: string;
  appKey: EnvReference;
  appSecret: EnvReference;
}

export interface TencentStoreConfig extends StoreBaseConfig {
  appId: string;
  appKey: EnvReference;
  appSecret: EnvReference;
}

export interface HonorStoreConfig extends StoreBaseConfig {
  appId: string;
  clientId: EnvReference;
  clientSecret: EnvReference;
}

export interface DistributionConfig {
  app: AndroidAppMetadata;
  stores: {
    huawei: HuaweiStoreConfig;
    xiaomi: XiaomiStoreConfig;
    oppo: OppoStoreConfig;
    vivo: VivoStoreConfig;
    tencent: TencentStoreConfig;
    honor: HonorStoreConfig;
  };
}

export interface DistributionContext {
  config: DistributionConfig;
  artifact: ReleaseArtifact;
  dryRun: boolean;
}

export interface DistributionResult {
  platform: DistributionPlatform;
  mode: "official-api" | "relay" | "manual";
  status: "planned" | "submitted";
  message: string;
  reference?: string;
}

export type StoreAdapter = (context: DistributionContext) => Promise<DistributionResult>;
