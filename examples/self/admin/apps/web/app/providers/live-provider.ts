import type { LiveEvent, LiveProvider } from "@refinedev/core";

type QiyStreamEvent = { id: string; channel: string; event: string; record: Record<string, unknown> };
type QiySubscription = { resource: string; prefix: string; types: string[]; ids: string[]; callback: (event: LiveEvent) => void; meta?: unknown };

export interface QiyLiveProviderOptions {
  fetcher?: typeof fetch;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/**
 * One authenticated text/event-stream connection to /api/v1/realtime/stream
 * carries every channel the caller is granted. Claim-scoped resources arrive on
 * segmented channels (qiy:orders:eu), so events match by resource prefix.
 */
export function createQiyLiveProvider(options: QiyLiveProviderOptions = {}): LiveProvider | undefined {
  if (typeof window === "undefined" && !options.fetcher) return undefined;
  const fetcher = options.fetcher ?? fetch;
  const subscriptions = new Set<QiySubscription>();
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const dispatch = (event: QiyStreamEvent) => {
    for (const subscription of subscriptions) {
      if (event.channel !== subscription.prefix && !event.channel.startsWith(subscription.prefix + ":")) continue;
      if (!subscription.types.includes("*") && !subscription.types.includes(event.event)) continue;
      if (subscription.ids.length) {
        const nested = event.record.data && typeof event.record.data === "object" ? event.record.data as Record<string, unknown> : undefined;
        const recordId = event.record.id ?? nested?.id;
        if (recordId === undefined || !subscription.ids.includes(String(recordId))) continue;
      }
      subscription.callback({ channel: subscription.resource, type: event.event, payload: event.record, date: new Date(), meta: subscription.meta } as LiveEvent);
    }
  };

  const stop = () => {
    controller?.abort();
    controller = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const connect = async (): Promise<void> => {
    const current = new AbortController();
    controller = current;
    try {
      const token = typeof window === "undefined" ? null : window.localStorage.getItem("qiy.access_token");
      const response = await fetcher("/api/v1/realtime/stream", { headers: token ? { Authorization: "Bearer " + token } : {}, signal: current.signal });
      // Without a grant there is nothing to stream; the next subscribe tries again.
      if (response.status === 401 || response.status === 403) { if (controller === current) controller = undefined; return; }
      if (!response.ok || !response.body) throw new Error("Realtime stream failed: " + response.status);
      const reader = response.body.getReader();
      current.signal.addEventListener("abort", () => { void reader.cancel().catch(() => undefined); });
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || current.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").find((line) => line.startsWith("data: "));
          if (data) {
            attempt = 0;
            try {
              const event = JSON.parse(data.slice(6)) as Partial<QiyStreamEvent>;
              if (typeof event.channel === "string" && typeof event.event === "string") dispatch({ id: String(event.id), channel: event.channel, event: event.event, record: event.record ?? {} });
            } catch { /* ignore a malformed frame */ }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (current.signal.aborted) return;
      console.warn("Realtime stream interrupted", error);
    }
    if (current.signal.aborted || controller !== current || !subscriptions.size) return;
    const delay = Math.min((options.reconnectDelayMs ?? 1000) * 2 ** Math.min(attempt, 5), options.maxReconnectDelayMs ?? 30000);
    attempt += 1;
    timer = setTimeout(() => { void connect(); }, delay);
  };

  return {
    subscribe: ({ channel, types, callback, params, meta }) => {
      // Show and many pages only care about specific records, so they share the
      // stream but are scoped to their ids instead of every event for the resource.
      const ids = [params?.id, ...(Array.isArray(params?.ids) ? params.ids : [])]
        .filter((value) => value !== undefined && value !== null && value !== "")
        .map((value) => String(value));
      const resource = channel.replace(/^resources\//, "");
      const subscription: QiySubscription = { resource: channel, prefix: "qiy:" + resource, types, ids, callback, meta };
      subscriptions.add(subscription);
      if (!controller) void connect();
      return subscription;
    },
    unsubscribe: (subscription: QiySubscription) => {
      subscriptions.delete(subscription);
      if (!subscriptions.size) stop();
    },
  };
}

export const qiyLiveProvider = createQiyLiveProvider();
