/**
 * Web renderers for realtime: the Refine live provider over SSE or GraphQL
 * subscriptions, and its tests.
 */


export function addRealtimeFiles(generated: Record<string, string>, usesGraphqlSubscriptions: boolean): void {
  generated["web/app/providers/live-provider.ts"] = `import type { LiveEvent, LiveProvider } from "@refinedev/core";

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
        let boundary = buffer.indexOf("\\n\\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split("\\n").find((line) => line.startsWith("data: "));
          if (data) {
            attempt = 0;
            try {
              const event = JSON.parse(data.slice(6)) as Partial<QiyStreamEvent>;
              if (typeof event.channel === "string" && typeof event.event === "string") dispatch({ id: String(event.id), channel: event.channel, event: event.event, record: event.record ?? {} });
            } catch { /* ignore a malformed frame */ }
          }
          boundary = buffer.indexOf("\\n\\n");
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
      const resource = channel.replace(/^resources\\//, "");
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
`;
  generated["web/app/root.tsx"] = 'import { qiyLiveProvider } from "./providers/live-provider";\n' + generated["web/app/root.tsx"]!.replace("dataProvider={dataProvider}", "dataProvider={dataProvider} liveProvider={qiyLiveProvider}");
  generated["web/tests/live-provider.test.ts"] = `import { expect, test } from "bun:test";
import { createQiyLiveProvider } from "../app/providers/live-provider";

function streamingFetcher() {
  const encoder = new TextEncoder();
  let push: (frame: string) => void = () => {};
  const requests: string[] = [];
  let aborted = 0;
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(url));
    init?.signal?.addEventListener("abort", () => { aborted += 1; });
    return new Response(new ReadableStream({ start(controller) { push = (frame) => controller.enqueue(encoder.encode(frame)); } }), { headers: { "Content-Type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  const send = (channel: string, event: string, record: Record<string, unknown>) => push("event: " + event + "\\ndata: " + JSON.stringify({ id: crypto.randomUUID(), channel, event, record }) + "\\n\\n");
  return { fetcher, send, push: (frame: string) => push(frame), requests, aborted: () => aborted };
}

test("realtime provider stays browser-only during SSR", () => {
  expect(createQiyLiveProvider()).toBeUndefined();
});

test("shares one stream and scopes record subscriptions to the requested ids", async () => {
  const stream = streamingFetcher();
  const provider = createQiyLiveProvider({ fetcher: stream.fetcher })!;
  const one: Array<Record<string, unknown>> = [];
  const many: Array<Record<string, unknown>> = [];
  const list: Array<Record<string, unknown>> = [];
  const wrapped: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => one.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useOne", id: "one" } });
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => many.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useMany", ids: ["a", "b"] } });
  provider.subscribe({ channel: "resources/orders", types: ["*"], callback: (live) => list.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useList" } });
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => wrapped.push(live.payload as Record<string, unknown>), params: { id: "nested" } });
  await Bun.sleep(10);
  expect(stream.requests).toEqual(["/api/v1/realtime/stream"]);
  stream.push("event: ready\\ndata: {\\"channels\\":[\\"qiy:orders\\"]}\\n\\n");
  stream.send("qiy:orders", "updated", { id: "two" });
  stream.send("qiy:orders", "updated", { id: "one" });
  stream.send("qiy:orders", "updated", { id: "b" });
  stream.send("qiy:orders", "updated", { title: "no id" });
  stream.send("qiy:orders", "updated", { data: { id: "nested" } });
  stream.send("qiy:customers", "updated", { id: "one" });
  await Bun.sleep(10);
  expect(one.map((payload) => payload.id)).toEqual(["one"]);
  expect(many.map((payload) => payload.id)).toEqual(["b"]);
  expect(list).toHaveLength(5);
  expect(wrapped).toHaveLength(1);
});

test("matches claim-scoped channels and filters event types", async () => {
  const stream = streamingFetcher();
  const provider = createQiyLiveProvider({ fetcher: stream.fetcher })!;
  const received: string[] = [];
  provider.subscribe({ channel: "orders", types: ["created"], callback: (live) => received.push(live.type) });
  await Bun.sleep(10);
  stream.send("qiy:orders:eu", "created", { id: "1" });
  stream.send("qiy:orders:eu", "deleted", { id: "1" });
  stream.send("qiy:orders-archive", "created", { id: "2" });
  await Bun.sleep(10);
  expect(received).toEqual(["created"]);
});

test("closes the stream after the last unsubscribe", async () => {
  const stream = streamingFetcher();
  const provider = createQiyLiveProvider({ fetcher: stream.fetcher })!;
  const first = provider.subscribe({ channel: "orders", types: ["*"], callback: () => {} });
  const second = provider.subscribe({ channel: "orders", types: ["*"], callback: () => {} });
  await Bun.sleep(10);
  provider.unsubscribe(first);
  expect(stream.aborted()).toBe(0);
  provider.unsubscribe(second);
  expect(stream.aborted()).toBe(1);
});

test("stays idle without a realtime grant", async () => {
  let calls = 0;
  const fetcher = (async () => { calls += 1; return Response.json({ error: "Realtime subscription is not permitted" }, { status: 403 }); }) as unknown as typeof fetch;
  const provider = createQiyLiveProvider({ fetcher, reconnectDelayMs: 1 })!;
  provider.subscribe({ channel: "orders", types: ["*"], callback: () => {} });
  await Bun.sleep(20);
  expect(calls).toBe(1);
});
`;
  if (usesGraphqlSubscriptions) {
    generated["web/app/subscriptions.ts"] = `export interface QiySubscriptionOptions {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  onData: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  fetcher?: typeof fetch;
  /** Reconnect after the stream ends or fails; defaults to true. */
  reconnect?: boolean;
  /** Called before each reconnect attempt; backoff doubles up to maxReconnectDelayMs. */
  onReconnect?: (info: { attempt: number; delayMs: number }) => void;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/**
 * Client half of the generated GraphQL subscription transport. Streams
 * text/event-stream frames from /api/v1/graphql/subscribe and invokes onData per
 * result; the returned function aborts the request and closes the stream.
 */
export function subscribeGraphql(options: QiySubscriptionOptions): () => void {
  const controller = new AbortController();
  const params = new URLSearchParams({ query: options.query });
  if (options.variables) params.set("variables", JSON.stringify(options.variables));
  if (options.operationName) params.set("operationName", options.operationName);
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  const fetcher = options.fetcher ?? fetch;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Opens one SSE connection and streams it until the server ends or the caller stops. */
  const connect = async (): Promise<void> => {
    if (controller.signal.aborted) return;
    try {
      const response = await fetcher("/api/v1/graphql/subscribe?" + params.toString(), { headers: token ? { Authorization: "Bearer " + token } : {}, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Subscription failed: " + response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Subscription stream is not readable");
      controller.signal.addEventListener("abort", () => { void reader.cancel().catch(() => undefined); });
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || controller.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\\n\\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = frame.split("\\n").find((line) => line.startsWith("data: "));
          if (dataLine && !controller.signal.aborted) {
            attempt = 0;
            const payload = JSON.parse(dataLine.slice(6)) as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
            if (payload.errors?.length) options.onError?.(new Error(payload.errors[0]!.message));
            else if (payload.data) options.onData(payload.data);
          }
          boundary = buffer.indexOf("\\n\\n");
        }
      }
      scheduleReconnect();
    } catch (error) {
      if (controller.signal.aborted) return;
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      scheduleReconnect();
    }
  };
  const scheduleReconnect = () => {
    if (controller.signal.aborted) return;
    if (options.reconnect === false) return;
    const delay = Math.min(options.reconnectDelayMs ?? 1000, options.maxReconnectDelayMs ?? 30000) * Math.pow(2, Math.min(attempt, 5));
    attempt += 1;
    options.onReconnect?.({ attempt, delayMs: delay });
    timer = setTimeout(() => { void connect(); }, delay);
  };
  void connect();
  return () => {
    controller.abort();
    if (timer) clearTimeout(timer);
  };
}


`;
    generated["web/tests/subscriptions.test.ts"] = `import { expect, test } from "bun:test";
import { subscribeGraphql } from "../app/subscriptions";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("parses SSE frames split across chunks", async () => {
  const received: Array<Record<string, unknown>> = [];
  let requested = "";
  const fetcher = (async (url: RequestInfo | URL) => { requested = String(url); return streamResponse(["data: {\\"data\\":{\\"a\\":1}}\\n", "\\ndata: {\\"data\\":{\\"b\\":2}}\\n\\n"]); }) as typeof fetch;
  const stop = subscribeGraphql({ query: "subscription { a }", variables: { id: "x" }, onData: (data) => received.push(data), fetcher });
  await Bun.sleep(10);
  stop();
  expect(received).toEqual([{ a: 1 }, { b: 2 }]);
  const url = new URL(requested, "http://localhost");
  expect(url.pathname).toBe("/api/v1/graphql/subscribe");
  expect(url.searchParams.get("query")).toBe("subscription { a }");
  expect(url.searchParams.get("variables")).toBe(JSON.stringify({ id: "x" }));
});

test("reports GraphQL errors and HTTP refusals", async () => {
  const errors: string[] = [];
  subscribeGraphql({ query: "subscription { a }", onData: () => {}, onError: (error) => errors.push(error.message), fetcher: (async (_url: RequestInfo | URL, _init?: RequestInit) => streamResponse(["data: {\\"errors\\":[{\\"message\\":\\"not permitted\\"}]}\\n\\n"])) as typeof fetch });
  subscribeGraphql({ query: "subscription { a }", onData: () => {}, onError: (error) => errors.push(error.message), fetcher: (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: "Authentication required" }, { status: 401 })) as typeof fetch });
  await Bun.sleep(10);
  expect(errors).toEqual(["not permitted", "Authentication required"]);
});

test("aborting stops further callbacks", async () => {
  const received: Array<Record<string, unknown>> = [];
  let push: ((chunk: string) => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      push = (chunk: string) => controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() {},
  });
  const stop = subscribeGraphql({ query: "subscription { a }", onData: (data) => received.push(data), fetcher: (async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(stream)) as typeof fetch });
  await Bun.sleep(10);
  push?.("data: {\\"data\\":{\\"a\\":1}}\\n\\n");
  await Bun.sleep(10);
  stop();
  // Aborting cancels the reader, so the producer may already be closed.
  try { push?.("data: {\\"data\\":{\\"a\\":2}}\\n\\n"); } catch { /* stream cancelled by abort */ }
  await Bun.sleep(10);
  expect(received).toEqual([{ a: 1 }]);
});
test("SSE subscription reconnects after the stream ends", async () => {
  let calls = 0;
  const received: Array<Record<string, unknown>> = [];
  const reconnects: number[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls += 1;
    // The caller aborts through the signal; a plain resolve is enough for the fake.
    expect(init?.signal).toBeDefined();
    if (calls === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"data":{"ordersChanged":{"event":"created"}}}\\n\\n'));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response(new ReadableStream({ start(controller) { controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const stop = subscribeGraphql({
    query: "subscription { ordersChanged { event } }",
    fetcher: fetcher as unknown as typeof fetch,
    reconnectDelayMs: 5,
    onReconnect: (info) => reconnects.push(info.delayMs),
    onData: (data) => received.push(data),
  });
  await Bun.sleep(30);
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ ordersChanged: { event: "created" } });
  expect(calls).toBeGreaterThanOrEqual(2);
  expect(reconnects[0]).toBe(5);
  stop();
});

`;
  }
}
