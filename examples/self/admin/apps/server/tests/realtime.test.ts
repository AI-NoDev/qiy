import { afterEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";
import { client, db } from "../src/db";
import { auditEvents, realtimeOutbox } from "../src/schema";
import { cleanupRealtimeOutbox, createRealtimeRoutes, dispatchRealtimeOutbox, publishRealtime, realtimeCapabilities, type RealtimeOutboxRecord, type RealtimeOutboxStore } from "../src/realtime";

afterEach(() => { Bun.env.QIY_REALTIME_DISABLED = "1"; });

test("isolates and rotates read-only metrics credentials without granting administrator access", async () => {
  const previousToken = Bun.env.QIY_REALTIME_METRICS_TOKEN;
  let reads = 0;
  const store = { metrics: async () => { reads++; return { pending: 2, leased: 0, deadLettered: 0, delivered: 3, oldestPendingAt: null }; } } as unknown as RealtimeOutboxStore;
  const app = new Elysia().use(createRealtimeRoutes(async () => null, undefined, store));
  const request = (path: string, token?: string, method = "GET", body?: string) => app.handle(new Request("http://localhost/api/v1/realtime" + path, {
    method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body,
  }));
  try {
    delete Bun.env.QIY_REALTIME_METRICS_TOKEN;
    expect((await request("/outbox/metrics/prometheus", "scrape-token-a")).status).toBe(401);
    Bun.env.QIY_REALTIME_METRICS_TOKEN = "scrape-token-a";
    expect((await request("/outbox/metrics/prometheus")).status).toBe(401);
    expect((await request("/outbox/metrics/prometheus", "wrong")).status).toBe(401);
    expect((await request("/outbox/metrics/prometheus", "scrape-token-b")).status).toBe(401);
    expect(reads).toBe(0);
    const accepted = await request("/outbox/metrics/prometheus", "scrape-token-a");
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("qiy_realtime_outbox_pending 2");
    for (const path of ["/outbox/metrics", "/outbox/health", "/outbox/dead"]) expect((await request(path, "scrape-token-a")).status).toBe(401);
    expect((await request("/token", "scrape-token-a", "POST")).status).toBe(401);
    expect((await request("/outbox/replay", "scrape-token-a", "POST", JSON.stringify({ ids: ["11111111-1111-4111-8111-111111111111"] }))).status).toBe(401);
    expect((await request("/outbox/delivered", "scrape-token-a", "DELETE")).status).toBe(401);
    Bun.env.QIY_REALTIME_METRICS_TOKEN = "scrape-token-b";
    expect((await request("/outbox/metrics/prometheus", "scrape-token-a")).status).toBe(401);
    expect((await request("/outbox/metrics/prometheus", "scrape-token-b")).status).toBe(200);
    expect(reads).toBe(2);
  } finally {
    if (previousToken === undefined) delete Bun.env.QIY_REALTIME_METRICS_TOKEN;
    else Bun.env.QIY_REALTIME_METRICS_TOKEN = previousToken;
  }
});

test("issues role-scoped subscribe-only Ably token requests", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = { auth: { createTokenRequest: async (request: Record<string, unknown>) => { requests.push(request); return { keyName: "test", nonce: "nonce", mac: "mac", timestamp: 1, capability: request.capability, clientId: request.clientId }; } }, channels: { get: () => ({ publish: async () => {} }) } } as any;
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const app = new Elysia().use(createRealtimeRoutes(async () => ({ id: "operator-1", name: "Operator", role: "operator" }), () => client));
  const response = await app.handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0]!.capability))).toEqual(realtimeCapabilities({ id: "operator-1", name: "Operator", role: "operator" }));
  const operations = Object.values(JSON.parse(String(requests[0]!.capability)) as Record<string, string[]>).flat();
  expect(operations.length).toBeGreaterThan(0);
  expect(operations.every((operation) => operation === "subscribe")).toBe(true);
});

test("rejects anonymous principals and roles without subscribed channels", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const client = { auth: { createTokenRequest: async () => { throw new Error("token request must not be issued"); } }, channels: { get: () => ({ publish: async () => {} }) } } as any;
  const anonymous = new Elysia().use(createRealtimeRoutes(async () => null, () => client));
  const anonymousResponse = await anonymous.handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(anonymousResponse.status).toBe(401);
  expect(await anonymousResponse.json()).toEqual({ error: "Authentication required" });

  const unauthorized = new Elysia().use(createRealtimeRoutes(async () => ({ id: "viewer-1", name: "Viewer", role: "viewer" }), () => client));
  const unauthorizedResponse = await unauthorized.handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(unauthorizedResponse.status).toBe(403);
  expect(await unauthorizedResponse.json()).toEqual({ error: "Realtime subscription is not permitted" });
});

test("publishes only declared resource events after callers commit", async () => {
  const published: unknown[] = [];
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const client = { auth: { createTokenRequest: async () => ({}) }, channels: { get: (channel: string) => ({ publish: async (type: string, payload: unknown) => published.push({ channel, type, payload }) }) } } as any;
  const subscription = {"resource":"inventory","events":["created","updated","deleted"],"roles":["admin","operator"]};
  await publishRealtime(subscription.resource, subscription.events[0] as "created" | "updated" | "deleted", { id: "record-1" }, () => client);
  await publishRealtime("unknown", "created", { id: "record-2" }, () => client);
  expect(published).toEqual([{ channel: "qiy:" + subscription.resource, type: subscription.events[0], payload: { id: "record-1" } }]);
});

test("keeps failed outbox records pending and retries them", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const record: RealtimeOutboxRecord = { id: "event-1", channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "order-1" }), attempts: 0 };
  const delivered: string[] = [];
  const failures: Array<{ id: string; attempts: number; error: string; availableAt: Date }> = [];
  const store: RealtimeOutboxStore = {
    claim: async () => [record],
    delivered: async (id) => { delivered.push(id); },
    failed: async (id, _leaseOwner, attempts, error, availableAt) => { failures.push({ id, attempts, error, availableAt }); record.attempts = attempts; },
    dead: async () => {},
    deadLetters: async () => [],
    replay: async () => false,
    replayMany: async () => [],
    cleanupDelivered: async () => 0,
    metrics: async () => ({ pending: 0, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: null }),
  };
  const failedClient = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { throw new Error("provider unavailable"); } }) } } as any;
  expect(await dispatchRealtimeOutbox(10, () => failedClient, store)).toEqual({ delivered: 0, failed: 1, deadLettered: 0 });
  expect(failures[0]?.id).toBe("event-1");
  expect(failures[0]?.attempts).toBe(1);
  expect(failures[0]?.availableAt.getTime()).toBeGreaterThan(Date.now());
  const workingClient = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => {} }) } } as any;
  expect(await dispatchRealtimeOutbox(10, () => workingClient, store)).toEqual({ delivered: 1, failed: 0, deadLettered: 0 });
  expect(delivered).toEqual(["event-1"]);
});

test("claims an outbox record only once across concurrent workers", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  Bun.env.QIY_REALTIME_LEASE_MS = "30000";
  const record: RealtimeOutboxRecord = { id: "event-1", channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "order-1" }), attempts: 0 };
  let claimed = false;
  const delivered: string[] = [];
  const store: RealtimeOutboxStore = {
    claim: async () => claimed ? [] : (claimed = true, [record]),
    delivered: async (id, leaseOwner) => { delivered.push(leaseOwner + ":" + id); },
    failed: async () => {},
    dead: async () => {},
    deadLetters: async () => [],
    replay: async () => false,
    replayMany: async () => [],
    cleanupDelivered: async () => 0,
    metrics: async () => ({ pending: 0, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: null }),
  };
  const published: string[] = [];
  const client = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { published.push("event-1"); } }) } } as any;
  expect(await Promise.all([
    dispatchRealtimeOutbox(10, () => client, store, "worker-a"),
    dispatchRealtimeOutbox(10, () => client, store, "worker-b"),
  ])).toEqual(expect.arrayContaining([{ delivered: 1, failed: 0, deadLettered: 0 }, { delivered: 0, failed: 0, deadLettered: 0 }]));
  expect(published).toEqual(["event-1"]);
  expect(delivered).toHaveLength(1);
});

test("dead-letters exhausted events and restricts replay and cleanup to admins", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  Bun.env.QIY_REALTIME_MAX_ATTEMPTS = "1";
  const eventId = "00000000-0000-4000-8000-000000000099";
  const missingId = "00000000-0000-4000-8000-000000000100";
  const record: RealtimeOutboxRecord = { id: eventId, channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "order-1" }), attempts: 0 };
  const dead: RealtimeOutboxRecord[] = [];
  const replayed: string[] = [];
  const store: RealtimeOutboxStore = {
    claim: async () => dead.length ? [] : [record],
    delivered: async () => {},
    failed: async () => {},
    dead: async (_id, _leaseOwner, attempts, lastError) => { record.attempts = attempts; Object.assign(record, { lastError }); dead.push(record); },
    deadLetters: async () => dead,
    replay: async (id) => { if (id !== eventId) return false; replayed.push(id); return true; },
    replayMany: async (ids) => { const found = ids.filter((id) => id === eventId); replayed.push(...found); return found; },
    cleanupDelivered: async () => 2,
    metrics: async () => ({ pending: 4, leased: 1, deadLettered: dead.length, delivered: 9, oldestPendingAt: new Date("2026-10-01T00:00:00.000Z") }),
  };
  const unavailable = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { throw new Error("provider unavailable"); } }) } } as any;
  expect(await dispatchRealtimeOutbox(10, () => unavailable, store, "worker-a")).toEqual({ delivered: 0, failed: 0, deadLettered: 1 });
  expect(dead).toHaveLength(1);
  const authenticate = async (request: Request) => ({ id: "user-1", name: "User", role: request.headers.get("x-role") === "admin" ? "admin" as const : "operator" as const });
  const app = new Elysia().use(createRealtimeRoutes(authenticate, () => unavailable, store));
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/dead", { headers: { "x-role": "operator" } }))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics", { headers: { "x-role": "operator" } }))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics/prometheus", { headers: { "x-role": "operator" } }))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/health", { headers: { "x-role": "operator" } }))).status).toBe(403);
  Bun.env.QIY_REALTIME_METRICS_TOKEN = "metrics-only-token";
  const scrape = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics/prometheus", { headers: { authorization: "Bearer metrics-only-token" } }));
  expect(scrape.status).toBe(200);
  expect(await scrape.text()).toContain("qiy_realtime_outbox_pending 4");
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/dead", { headers: { authorization: "Bearer metrics-only-token" } }))).status).toBe(403);
  delete Bun.env.QIY_REALTIME_METRICS_TOKEN;
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json", "x-role": "operator" }, body: JSON.stringify({ ids: [eventId] }) }))).status).toBe(403);
  const listed = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/dead", { headers: { "x-role": "admin" } }));
  expect(listed.status).toBe(200);
  expect((await listed.json() as { data: unknown[] }).data).toHaveLength(1);
  const metrics = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics", { headers: { "x-role": "admin" } }));
  expect(metrics.status).toBe(200);
  expect(await metrics.json()).toEqual({ pending: 4, leased: 1, deadLettered: 1, delivered: 9, oldestPendingAt: "2026-10-01T00:00:00.000Z" });
  Bun.env.QIY_REALTIME_ALERT_MAX_PENDING = "3";
  Bun.env.QIY_REALTIME_ALERT_MAX_DEAD_LETTERED = "0";
  Bun.env.QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS = "1000";
  const health = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/health", { headers: { "x-role": "admin" } }));
  expect(health.status).toBe(503);
  const healthPayload = await health.json() as { status: string; alerts: string[]; metrics: { oldestPendingAgeMs: number } };
  expect(healthPayload.status).toBe("degraded");
  expect(healthPayload.alerts).toEqual(["pending", "deadLettered", "oldestPendingAgeMs"]);
  expect(healthPayload.metrics.oldestPendingAgeMs).toBeGreaterThan(1000);
  const prometheus = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics/prometheus", { headers: { "x-role": "admin" } }));
  expect(prometheus.status).toBe(200);
  expect(prometheus.headers.get("content-type")).toContain("text/plain");
  const prometheusText = await prometheus.text();
  expect(prometheusText).toContain("qiy_realtime_outbox_pending 4");
  expect(prometheusText).toContain("qiy_realtime_outbox_dead_lettered 1");
  expect(prometheusText).toContain("qiy_realtime_outbox_health 0");
  delete Bun.env.QIY_REALTIME_ALERT_MAX_PENDING;
  delete Bun.env.QIY_REALTIME_ALERT_MAX_DEAD_LETTERED;
  delete Bun.env.QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS;
  const duplicateReplay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json", "x-role": "admin" }, body: JSON.stringify({ ids: [eventId, eventId] }) }));
  expect(duplicateReplay.status).toBe(400);
  const bulkReplay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json", "x-role": "admin" }, body: JSON.stringify({ ids: [eventId, missingId] }) }));
  expect(bulkReplay.status).toBe(200);
  expect(await bulkReplay.json()).toEqual({ replayed: [eventId], notFound: [missingId] });
  const replay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/" + eventId + "/replay", { method: "POST", headers: { "x-role": "admin" } }));
  expect(replay.status).toBe(200);
  expect(replayed).toEqual([eventId, eventId]);
  const cleanup = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/delivered?retentionDays=30", { method: "DELETE", headers: { "x-role": "admin" } }));
  expect(cleanup.status).toBe(200);
  expect(await cleanup.json()).toEqual({ deleted: 2, retentionDays: 30 });
});

test("audits bulk replay and cleanup in the same SQLite transactions", async () => {
  const actorId = "00000000-0000-4000-8000-000000000201";
  const firstId = "00000000-0000-4000-8000-000000000202";
  const secondId = "00000000-0000-4000-8000-000000000203";
  const deliveredId = "00000000-0000-4000-8000-000000000204";
  const eventIds = [firstId, secondId, deliveredId];
  const actions = ["realtime.outbox.bulk_replayed", "realtime.outbox.cleaned"];
  client.exec("CREATE TABLE IF NOT EXISTS qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, attempts integer not null, availableAt integer not null, deliveredAt integer, deadLetteredAt integer, lastError text, leaseOwner text, leaseUntil integer, createdAt integer not null)");
  db.insert(realtimeOutbox).values([
    { id: firstId, channel: "qiy:event:test", type: "test.failed", payload: "{}", attempts: 1, availableAt: new Date(0), deadLetteredAt: new Date(0), createdAt: new Date(0) },
    { id: secondId, channel: "qiy:event:test", type: "test.failed", payload: "{}", attempts: 1, availableAt: new Date(0), deadLetteredAt: new Date(0), createdAt: new Date(0) },
    { id: deliveredId, channel: "qiy:event:test", type: "test.delivered", payload: "{}", attempts: 0, availableAt: new Date(0), deliveredAt: new Date(0), createdAt: new Date(0) },
  ]).run();
  const app = new Elysia().use(createRealtimeRoutes(async () => ({ id: actorId, name: "Admin", role: "admin" })));
  try {
    const replay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [firstId, secondId] }) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ replayed: [firstId, secondId], notFound: [] });
    const cleanup = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/delivered?retentionDays=1", { method: "DELETE" }));
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ deleted: 1, retentionDays: 1 });
    const audits = db.select().from(auditEvents).where(inArray(auditEvents.action, actions)).all();
    expect(audits.map((audit) => audit.action).sort()).toEqual([...actions].sort());
    expect(audits.every((audit) => audit.actorId === actorId)).toBe(true);
  } finally {
    db.delete(realtimeOutbox).where(inArray(realtimeOutbox.id, eventIds)).run();
    db.delete(auditEvents).where(inArray(auditEvents.action, actions)).run();
    client.exec("DROP TABLE qiy_realtime_outbox");
  }
});

test("calculates automatic cleanup cutoff from an explicit maintenance time", async () => {
  const cutoffs: Date[] = [];
  const store: RealtimeOutboxStore = {
    claim: async () => [],
    delivered: async () => {},
    failed: async () => {},
    dead: async () => {},
    deadLetters: async () => [],
    replay: async () => false,
    replayMany: async () => [],
    cleanupDelivered: async (before) => { cutoffs.push(before); return 3; },
    metrics: async () => ({ pending: 0, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: null }),
  };
  const now = new Date("2026-10-12T12:00:00.000Z");
  expect(await cleanupRealtimeOutbox(7, store, now)).toBe(3);
  expect(cutoffs).toEqual([new Date("2026-10-05T12:00:00.000Z")]);
});
