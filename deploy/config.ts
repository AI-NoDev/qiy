import type { DistributionConfig } from "./types";

/**
 * Safe checked-in release manifest. Keep all credentials in the environment;
 * set enabled to true only after completing each store's developer onboarding.
 */
export default {
  app: {
    packageName: "com.example.qiyapp",
    name: "Qiy App",
    publisherName: "Your Company",
    category: "效率办公",
    keywords: ["qiy", "dashboard"],
    description: "Replace with the store-facing application description.",
    brief: "Replace with a concise store-facing summary.",
    updateDescription: "Replace with release notes.",
    website: "https://example.com",
    assets: {
      privacyPolicyUrl: "https://example.com/privacy",
      iconPath: "deploy/assets/icon.png",
      screenshots: ["deploy/assets/screenshot-1.png", "deploy/assets/screenshot-2.png", "deploy/assets/screenshot-3.png"],
      testAccount: { auditNotes: "Replace with reviewer instructions and credentials from secure CI variables." },
    },
  },
  stores: {
    huawei: {
      enabled: false,
      appId: "replace-huawei-app-id",
      clientId: "env:QIY_HUAWEI_CLIENT_ID",
      clientSecret: "env:QIY_HUAWEI_CLIENT_SECRET",
      portalUrl: "https://developer.huawei.com/consumer/cn/service/josp/agc/index.html",
    },
    xiaomi: {
      enabled: false,
      username: "env:QIY_XIAOMI_USERNAME",
      credential: "env:QIY_XIAOMI_CREDENTIAL",
      encryptionPublicKey: "env:QIY_XIAOMI_PUBLIC_KEY",
      releaseMode: "update-package",
      portalUrl: "https://dev.mi.com/console/",
    },
    oppo: {
      enabled: false,
      appId: "replace-oppo-app-id",
      appKey: "env:QIY_OPPO_APP_KEY",
      appSecret: "env:QIY_OPPO_APP_SECRET",
      portalUrl: "https://open.oppomobile.com/",
    },
    vivo: {
      enabled: false,
      appId: "replace-vivo-app-id",
      appKey: "env:QIY_VIVO_APP_KEY",
      appSecret: "env:QIY_VIVO_APP_SECRET",
      portalUrl: "https://dev.vivo.com.cn/",
    },
    tencent: {
      enabled: false,
      appId: "replace-tencent-myapp-id",
      appKey: "env:QIY_TENCENT_APP_KEY",
      appSecret: "env:QIY_TENCENT_APP_SECRET",
      portalUrl: "https://open.tencent.com/",
    },
    honor: {
      enabled: false,
      appId: "replace-honor-app-id",
      clientId: "env:QIY_HONOR_CLIENT_ID",
      clientSecret: "env:QIY_HONOR_CLIENT_SECRET",
      portalUrl: "https://developer.hihonor.com/",
    },
  },
} satisfies DistributionConfig;
