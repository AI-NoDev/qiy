import { afterEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { Principal } from "../src/auth/guard";
import { publishRealtimeEvent } from "../src/realtime-bus";
import { createRealtimeRoutes, realtimeCapabilities, realtimeChannelIterator, realtimeCleanupCutoff } from "../src/realtime";

afterEach(() => { Bun.env.QIY_REALTIME_DISABLED = "1"; });

const subscription = {"resource":"inventory","events":["created","updated","deleted"],"roles":["admin","operator"]} as { resource: string; roles: string[]; claim?: { field: string; claim: string } };
const principal = { id: "user-1", name: "User", role: subscription.roles[0], claims: subscription.claim ? { [subscription.claim.claim]: "eu" } : {} } as unknown as Principal;
const stream = (app: { handle: (request: Request) => Promise<Response> }) => app.handle(new Request("http://localhost/api/v1/realtime/stream"));

test("rejects anonymous callers, roles without channels and a disabled transport", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  expect((await stream(new Elysia().use(createRealtimeRoutes(async () => null)))).status).toBe(401);
  const denied = (["admin", "operator", "viewer"] as const).find((role) => Object.keys(realtimeCapabilities({ id: "u", name: "U", role } as Principal)).length === 0);
  if (denied) {
    const response = await stream(new Elysia().use(createRealtimeRoutes(async () => ({ id: "u", name: "U", role: denied } as Principal))));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Realtime subscription is not permitted" });
  }
  Bun.env.QIY_REALTIME_DISABLED = "1";
  expect((await stream(new Elysia().use(createRealtimeRoutes(async () => principal)))).status).toBe(503);
});

test("streams only the channels granted to the caller", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const channel = Object.keys(realtimeCapabilities(principal))[0]!;
  const response = await stream(new Elysia().use(createRealtimeRoutes(async () => principal)));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const read = async () => decoder.decode((await reader.read()).value);
  expect(await read()).toContain("event: ready");
  publishRealtimeEvent({ id: "event-1", channel: "qiy:not-granted", event: "created", record: { id: "x" } });
  publishRealtimeEvent({ id: "event-2", channel, event: "updated", record: { id: "record-1" } });
  const frame = await read();
  expect(frame).toContain('"id":"event-2"');
  expect(frame).not.toContain("qiy:not-granted");
  await reader.cancel();
});

test("iterates events per channel and stops after close", async () => {
  const iterator = realtimeChannelIterator("qiy:" + subscription.resource);
  publishRealtimeEvent({ id: "event-3", channel: "qiy:other", event: "created", record: {} });
  publishRealtimeEvent({ id: "event-4", channel: "qiy:" + subscription.resource, event: "created", record: { id: "record-4" } });
  expect((await iterator.next()).value?.id).toBe("event-4");
  iterator.close();
  expect((await iterator.next()).done).toBe(true);
});

test("computes the outbox cleanup cutoff from the retention window", () => {
  expect(realtimeCleanupCutoff(7, new Date("2026-10-12T12:00:00.000Z"))).toEqual(new Date("2026-10-05T12:00:00.000Z"));
  expect(() => realtimeCleanupCutoff(0)).toThrow("retention days");
});
