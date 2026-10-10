import { submitToRelay } from "../shared";
import type { DistributionContext, DistributionPlatform, DistributionResult, StoreBaseConfig } from "../types";

export async function publishPartnerStore(platform: DistributionPlatform, store: StoreBaseConfig, context: DistributionContext): Promise<DistributionResult> {
  if (!store.enabled) throw new Error(`${platform} distribution is disabled in deploy/config.ts`);
  if (context.dryRun) return { platform, mode: store.relay ? "relay" : "manual", status: "planned", message: store.relay ? `Would send ${platform} release metadata to its configured relay.` : `No verified public automation endpoint configured. Complete submission in ${store.portalUrl} or configure a release relay.` };
  if (!store.relay) throw new Error(`${platform} has no configured release relay. Use ${store.portalUrl} for manual submission, or configure stores.${platform}.relay after receiving the platform/partner API contract.`);
  const relay = await submitToRelay(platform, store.relay, context);
  return { platform, mode: "relay", status: "submitted", message: `Submitted ${platform} release to the configured relay.`, ...(relay.reference && { reference: relay.reference }) };
}
