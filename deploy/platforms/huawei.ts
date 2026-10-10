import { artifactName, requireDownloadUrl, resolveEnv } from "../shared";
import type { DistributionContext, DistributionResult } from "../types";

interface HuaweiTokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }

/** Publishes by URL through AppGallery Connect's server-to-server API. */
export async function publishHuawei(context: DistributionContext): Promise<DistributionResult> {
  const store = context.config.stores.huawei;
  if (!store.enabled) throw new Error("Huawei distribution is disabled in deploy/config.ts");
  const downloadUrl = requireDownloadUrl(context, "Huawei AppGallery Connect");
  if (context.dryRun) return { platform: "huawei", mode: "official-api", status: "planned", message: `Would submit ${artifactName(context.artifact)} to Huawei app ${store.appId} by HTTPS download URL.` };

  const baseUrl = store.apiBaseUrl ?? "https://connect-api.cloud.huawei.com";
  const clientId = resolveEnv(store.clientId, "Huawei client ID");
  const clientSecret = resolveEnv(store.clientSecret, "Huawei client secret");
  const tokenResponse = await fetch(`${baseUrl}/api/oauth2/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  const token = await tokenResponse.json() as HuaweiTokenResponse;
  if (!tokenResponse.ok || !token.access_token) throw new Error(`Huawei token request failed: ${token.error_description ?? token.error ?? tokenResponse.statusText}`);

  const requestId = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/publish/v2/app-submit-with-file?appid=${encodeURIComponent(store.appId)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}`, client_id: clientId, "content-type": "application/json" },
    body: JSON.stringify({ requestId, downloadUrl, downloadFileName: artifactName(context.artifact) }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Huawei app submission failed (${response.status}): ${body.slice(0, 500)}`);
  return { platform: "huawei", mode: "official-api", status: "submitted", message: "Submitted to Huawei AppGallery Connect.", reference: requestId };
}
