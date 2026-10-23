import * as Ably from "ably";
import type { LiveEvent, LiveProvider } from "@refinedev/core";

type QiySubscription = {
  channel?: Ably.RealtimeChannel;
  types: string[];
  listener: (message: Ably.InboundMessage) => void;
};

type QiyCapabilityMap = Record<string, string[]>;

/**
 * Claim-scoped resources publish to a segmented channel (qiy:orders:eu), so the
 * client resolves the channel it was actually granted from the token capability
 * instead of assuming the base resource name.
 */
function grantedChannel(capabilities: QiyCapabilityMap, resource: string): string {
  const base = "qiy:" + resource;
  if (Array.isArray(capabilities[base])) return base;
  return Object.keys(capabilities).find((channel) => channel.startsWith(base + ":")) ?? base;
}

export function createQiyLiveProvider(fetcher: typeof fetch = fetch, injected?: Ably.Realtime): LiveProvider | undefined {
  if (typeof window === "undefined" && !injected) return undefined;
  const client = injected ?? new Ably.Realtime({
    authCallback: async (_params, callback) => {
      try {
        const token = window.localStorage.getItem("qiy.access_token");
        const response = await fetcher("/api/v1/realtime/token", { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {} });
        const body = await response.json() as any;
        if (!response.ok) throw new Error(body.error ?? "Realtime authorization failed");
        callback(null, body);
      } catch (error) { callback(error as any, null); }
    },
  });
  let capabilityPromise: Promise<QiyCapabilityMap> | undefined;
  const capabilities = () => capabilityPromise ??= (async (): Promise<QiyCapabilityMap> => {
    try {
      const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
      const response = await fetcher("/api/v1/realtime/token", { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {} });
      if (!response.ok) return {};
      const body = await response.json() as { capability?: unknown };
      const parsed = typeof body.capability === "string" ? JSON.parse(body.capability) as QiyCapabilityMap : body.capability as QiyCapabilityMap;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
  })();
  return {
    subscribe: ({ channel, types, callback, params, meta }) => {
      // Show and many pages only care about specific records, so they get the same
      // channel but are scoped to their ids instead of every event for the resource.
      const scopedIds = [params?.id, ...(Array.isArray(params?.ids) ? params.ids : [])]
        .filter((value) => value !== undefined && value !== null && value !== "")
        .map((value) => String(value));
      const listener = (message: Ably.InboundMessage) => {
        const payload = message.data && typeof message.data === "object" && !Array.isArray(message.data) ? message.data : { data: message.data };
        if (scopedIds.length) {
          const record = payload as Record<string, unknown>;
          const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
          const recordId = record.id ?? nested?.id;
          if (recordId === undefined || !scopedIds.includes(String(recordId))) return;
        }
        callback({ channel, type: message.name ?? "*", payload, date: new Date(message.timestamp ?? Date.now()), meta } satisfies LiveEvent);
      };
      const subscription: QiySubscription = { types, listener };
      void (async () => {
        const target = grantedChannel(await capabilities(), channel);
        const ablyChannel = client.channels.get(target);
        subscription.channel = ablyChannel;
        await ablyChannel.subscribe(types, listener).catch((error) => console.error("Realtime subscription failed", { channel: target, error }));
      })();
      return subscription;
    },
    unsubscribe: (subscription: QiySubscription) => subscription.channel?.unsubscribe(subscription.types, subscription.listener),
  };
}

export const qiyLiveProvider = createQiyLiveProvider();
