import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeployment } from "../deploy";
import type { DistributionConfig } from "../deploy/types";

function config(): DistributionConfig {
  const relay = { endpoint: "https://distribution.example.invalid/submit", token: "env:QIY_TEST_RELAY_TOKEN" as const };
  return {
    app: { packageName: "com.example.qiy", name: "Qiy", assets: { privacyPolicyUrl: "https://example.com/privacy" } },
    stores: {
      huawei: { enabled: true, appId: "123", clientId: "env:QIY_HUAWEI_CLIENT_ID", clientSecret: "env:QIY_HUAWEI_CLIENT_SECRET", portalUrl: "https://example.com/huawei" },
      xiaomi: { enabled: true, username: "env:QIY_XIAOMI_USERNAME", credential: "env:QIY_XIAOMI_CREDENTIAL", encryptionPublicKey: "env:QIY_XIAOMI_PUBLIC_KEY", portalUrl: "https://example.com/xiaomi" },
      oppo: { enabled: true, appId: "oppo", appKey: "env:QIY_OPPO_APP_KEY", appSecret: "env:QIY_OPPO_APP_SECRET", portalUrl: "https://example.com/oppo", relay },
      vivo: { enabled: false, appId: "vivo", appKey: "env:QIY_VIVO_APP_KEY", appSecret: "env:QIY_VIVO_APP_SECRET", portalUrl: "https://example.com/vivo" },
      tencent: { enabled: false, appId: "tencent", appKey: "env:QIY_TENCENT_APP_KEY", appSecret: "env:QIY_TENCENT_APP_SECRET", portalUrl: "https://example.com/tencent" },
      honor: { enabled: false, appId: "honor", clientId: "env:QIY_HONOR_CLIENT_ID", clientSecret: "env:QIY_HONOR_CLIENT_SECRET", portalUrl: "https://example.com/honor" },
    },
  };
}

test("plans multiple selected Android store releases without reading secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-deploy-"));
  try {
    const artifact = join(root, "app.apk");
    writeFileSync(artifact, "apk");
    const results = await runDeployment({ config: config(), artifact: { path: artifact, downloadUrl: "https://downloads.example.com/app.apk" }, platforms: ["huawei", "xiaomi", "oppo"], dryRun: true });
    expect(results.map((result) => result.platform)).toEqual(["huawei", "xiaomi", "oppo"]);
    expect(results.map((result) => result.status)).toEqual(["planned", "planned", "planned"]);
    expect(results[2]?.mode).toBe("relay");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed for disabled platforms and invalid artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-deploy-"));
  try {
    const artifact = join(root, "app.txt");
    writeFileSync(artifact, "not an apk");
    await expect(runDeployment({ config: config(), artifact: { path: artifact }, platforms: ["huawei"], dryRun: true })).rejects.toThrow(".apk or .aab");
    const apk = join(root, "app.apk");
    writeFileSync(apk, "apk");
    await expect(runDeployment({ config: config(), artifact: { path: apk }, platforms: ["vivo"], dryRun: true })).rejects.toThrow("disabled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
