import { expect, test } from "bun:test";
import { createQiyLiveProvider } from "../app/providers/live-provider";

function fakeClient() {
  const listeners: Array<(message: unknown) => void> = [];
  const channels: string[] = [];
  const unsubscribed: number[] = [];
  const client = {
    channels: {
      get: (name: string) => {
        channels.push(name);
        return {
          subscribe: (types: string[], listener: (message: unknown) => void) => { listeners.push(listener); return Promise.resolve(); },
          unsubscribe: () => { unsubscribed.push(1); },
        };
      },
    },
  };
  return { client, listeners, channels, unsubscribed };
}

function event(id: string | undefined, name = "updated") {
  return { name, data: id === undefined ? { title: "no id" } : { id, title: "row " + id }, timestamp: 1 };
}

test("realtime provider stays browser-only during SSR", () => {
  expect(createQiyLiveProvider()).toBeUndefined();
});

test("scopes record subscriptions to the requested ids", async () => {
  const { client, listeners, channels } = fakeClient();
  const tokenFetcher = (async () => Response.json({ capability: JSON.stringify({ "qiy:orders": ["subscribe"] }) })) as unknown as typeof fetch;
  const provider = createQiyLiveProvider(tokenFetcher, client as never)!;
  const received: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => received.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useOne", id: "one" } });
  const many: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => many.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useMany", ids: ["a", "b"] } });
  const list: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["created"], callback: (live) => list.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useList" } });
  const wrapped: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => wrapped.push(live.payload as Record<string, unknown>), params: { id: "nested" } });
  await Bun.sleep(20);

  expect(channels[0]).toBe("qiy:orders");
  listeners[0]!(event("two"));
  expect(received).toHaveLength(0);
  listeners[0]!(event("one"));
  expect(received).toHaveLength(1);
  expect(received[0]?.id).toBe("one");

  // useMany pages scope to a list of ids, and events without an id never match.
  listeners[1]!(event("c"));
  listeners[1]!(event(undefined));
  listeners[1]!(event("b"));
  expect(many.map((payload) => payload.id)).toEqual(["b"]);

  // List pages stay unscoped and receive every event.
  listeners[2]!(event("anyone"));
  expect(list).toHaveLength(1);
  // A payload wrapped in data.id is still matched when scoped.
  listeners[3]!({ name: "updated", data: { data: { id: "nested" } }, timestamp: 1 });
  expect(wrapped).toHaveLength(1);
});

test("resolves a claim-scoped channel from the token capability", async () => {
  const { client, channels } = fakeClient();
  const tokenFetcher = (async () => Response.json({ capability: JSON.stringify({ "qiy:orders:eu": ["subscribe"] }) })) as unknown as typeof fetch;
  const provider = createQiyLiveProvider(tokenFetcher, client as never)!;
  provider.subscribe({ channel: "orders", types: ["updated"], callback: () => {} });
  await Bun.sleep(20);
  expect(channels[0]).toBe("qiy:orders:eu");
});

test("unsubscribes through the Ably channel", async () => {
  const { client, unsubscribed } = fakeClient();
  const provider = createQiyLiveProvider(fetch, client as never)!;
  const subscription = provider.subscribe({ channel: "orders", types: ["updated"], callback: () => {} });
  await Bun.sleep(10);
  provider.unsubscribe(subscription);
  expect(unsubscribed).toHaveLength(1);
});
