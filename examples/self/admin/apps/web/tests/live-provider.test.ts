import { expect, test } from "bun:test";
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
  const send = (channel: string, event: string, record: Record<string, unknown>) => push("event: " + event + "\ndata: " + JSON.stringify({ id: crypto.randomUUID(), channel, event, record }) + "\n\n");
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
  stream.push("event: ready\ndata: {\"channels\":[\"qiy:orders\"]}\n\n");
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
