import { Rest } from "ably";
import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "./db";
import { auditEvents, realtimeOutbox } from "./schema";
import { publishRealtimeEvent, subscribeRealtimeEvents, type QiyRealtimeRecordEvent } from "./realtime-bus";
import type { Authenticator, Principal } from "./auth/guard";

export type QiyRealtimeEvent = "created" | "updated" | "deleted";
export interface QiyRealtimeSubscription { resource: string; events: string[]; roles: string[]; claim?: { field: string; claim: string } }
export interface QiyRealtimeEventSubscription { event: string; roles: string[] }
// Declared element types: an empty capability list must still be typed, otherwise
// an empty const array becomes readonly never[] and the generated server fails tsc.
export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] = [{"resource":"inventory","events":["created","updated","deleted"],"roles":["admin","operator"]},{"resource":"stock_movements","events":["created"],"roles":["admin","operator"]},{"resource":"shipments","events":["created","updated"],"roles":["admin","operator"]}];
export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] = [{"event":"inventory.received","roles":["admin","operator"]},{"event":"inventory.moved","roles":["admin","operator"]},{"event":"sales.allocated","roles":["admin","operator"]},{"event":"inventory.adjusted","roles":["admin","operator"]},{"event":"sales.shipped","roles":["admin","operator"]},{"event":"inventory.transferred","roles":["admin","operator"]},{"event":"production.completed","roles":["admin","operator"]}];

type AblyClient = Pick<Rest, "auth" | "channels">;
type AblyClientFactory = () => AblyClient;
export interface RealtimeOutboxRecord { id: string; channel: string; type: string; payload: string; attempts: number; }
export interface RealtimeOutboxMetrics { pending: number; leased: number; deadLettered: number; delivered: number; oldestPendingAt: Date | null; }
export interface RealtimeOutboxStore {
  claim(limit: number, now: Date, leaseOwner: string, leaseUntil: Date): Promise<RealtimeOutboxRecord[]>;
  delivered(id: string, leaseOwner: string, deliveredAt: Date): Promise<void>;
  failed(id: string, leaseOwner: string, attempts: number, lastError: string, availableAt: Date): Promise<void>;
  dead(id: string, leaseOwner: string, attempts: number, lastError: string, deadLetteredAt: Date): Promise<void>;
  deadLetters(limit: number): Promise<RealtimeOutboxRecord[]>;
  replay(id: string, now: Date, actorId?: string): Promise<boolean>;
  replayMany(ids: string[], now: Date, actorId?: string): Promise<string[]>;
  cleanupDelivered(before: Date, audit?: { actorId: string; retentionDays: number }): Promise<number>;
  metrics(now: Date): Promise<RealtimeOutboxMetrics>;
}

const realtimeWorkerId: string = crypto.randomUUID();

function realtimeLeaseMs(): number {
  const leaseMs = Number(Bun.env.QIY_REALTIME_LEASE_MS ?? 30000);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000) throw new Error("QIY_REALTIME_LEASE_MS must be an integer of at least 1000ms");
  return leaseMs;
}

function realtimeMaxAttempts(): number {
  const attempts = Number(Bun.env.QIY_REALTIME_MAX_ATTEMPTS ?? 10);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 1000) throw new Error("QIY_REALTIME_MAX_ATTEMPTS must be an integer from 1 to 1000");
  return attempts;
}

function realtimeRetentionDays(): number {
  const days = Number(Bun.env.QIY_REALTIME_RETENTION_DAYS ?? 7);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error("QIY_REALTIME_RETENTION_DAYS must be an integer from 1 to 3650");
  return days;
}

function realtimeCleanupMs(): number {
  const cleanupMs = Number(Bun.env.QIY_REALTIME_CLEANUP_MS ?? 86400000);
  if (!Number.isSafeInteger(cleanupMs) || cleanupMs < 60000) throw new Error("QIY_REALTIME_CLEANUP_MS must be an integer of at least 60000ms");
  return cleanupMs;
}

function realtimeAlertInteger(name: "QIY_REALTIME_ALERT_MAX_PENDING" | "QIY_REALTIME_ALERT_MAX_DEAD_LETTERED" | "QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS", fallback: number): number {
  const value = Number(Bun.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(name + " must be a non-negative integer");
  return value;
}

export interface RealtimeOutboxAlertThresholds {
  maxPending: number;
  maxDeadLettered: number;
  maxOldestPendingMs: number;
}

export interface RealtimeOutboxHealth {
  status: "ok" | "degraded";
  alerts: string[];
  metrics: Omit<RealtimeOutboxMetrics, "oldestPendingAt"> & { oldestPendingAt: string | null; oldestPendingAgeMs: number };
  thresholds: RealtimeOutboxAlertThresholds;
}

export function realtimeAlertThresholds(): RealtimeOutboxAlertThresholds {
  return {
    maxPending: realtimeAlertInteger("QIY_REALTIME_ALERT_MAX_PENDING", 1000),
    maxDeadLettered: realtimeAlertInteger("QIY_REALTIME_ALERT_MAX_DEAD_LETTERED", 0),
    maxOldestPendingMs: realtimeAlertInteger("QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS", 300000),
  };
}

export function evaluateRealtimeOutboxHealth(metrics: RealtimeOutboxMetrics, now = new Date(), thresholds = realtimeAlertThresholds()): RealtimeOutboxHealth {
  const oldestPendingAt = metrics.oldestPendingAt ? new Date(metrics.oldestPendingAt) : null;
  const oldestPendingAgeMs = oldestPendingAt ? Math.max(0, now.getTime() - oldestPendingAt.getTime()) : 0;
  const alerts: string[] = [];
  if (metrics.pending > thresholds.maxPending) alerts.push("pending");
  if (metrics.deadLettered > thresholds.maxDeadLettered) alerts.push("deadLettered");
  if (oldestPendingAgeMs > thresholds.maxOldestPendingMs) alerts.push("oldestPendingAgeMs");
  return {
    status: alerts.length ? "degraded" : "ok",
    alerts,
    metrics: { ...metrics, oldestPendingAt: oldestPendingAt?.toISOString() ?? null, oldestPendingAgeMs },
    thresholds,
  };
}

export function renderRealtimePrometheus(metrics: RealtimeOutboxMetrics, now = new Date()): string {
  const health = evaluateRealtimeOutboxHealth(metrics, now);
  const lines = [
    "# HELP qiy_realtime_outbox_pending Pending outbox events awaiting delivery.",
    "# TYPE qiy_realtime_outbox_pending gauge",
    "qiy_realtime_outbox_pending " + metrics.pending,
    "# HELP qiy_realtime_outbox_leased Pending events currently leased by workers.",
    "# TYPE qiy_realtime_outbox_leased gauge",
    "qiy_realtime_outbox_leased " + metrics.leased,
    "# HELP qiy_realtime_outbox_dead_lettered Events that exhausted delivery attempts.",
    "# TYPE qiy_realtime_outbox_dead_lettered gauge",
    "qiy_realtime_outbox_dead_lettered " + metrics.deadLettered,
    "# HELP qiy_realtime_outbox_delivered Delivered events retained for operations.",
    "# TYPE qiy_realtime_outbox_delivered gauge",
    "qiy_realtime_outbox_delivered " + metrics.delivered,
    "# HELP qiy_realtime_outbox_oldest_pending_age_seconds Age of the oldest pending event.",
    "# TYPE qiy_realtime_outbox_oldest_pending_age_seconds gauge",
    "qiy_realtime_outbox_oldest_pending_age_seconds " + (health.metrics.oldestPendingAgeMs / 1000),
    "# HELP qiy_realtime_outbox_health Whether configured outbox alert thresholds are healthy.",
    "# TYPE qiy_realtime_outbox_health gauge",
    "qiy_realtime_outbox_health " + (health.status === "ok" ? 1 : 0),
  ];
  return lines.join("\n") + "\n";
}

function hasRealtimeMetricsToken(request: Request): boolean {
  const expected = Bun.env.QIY_REALTIME_METRICS_TOKEN?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const actual = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function createAblyClient(): AblyClient {
  const key = Bun.env.QIY_ABLY_API_KEY;
  if (!key) throw new Error("QIY_ABLY_API_KEY is required when realtime is enabled");
  return new Rest({ key });
}

/** Row-scoped channels append the subscriber's claim value: qiy:orders:eu. */
export function realtimeChannel(resource: string, claimValue?: string | number | null): string {
  return claimValue === undefined || claimValue === null || claimValue === "" ? "qiy:" + resource : "qiy:" + resource + ":" + String(claimValue);
}

export function realtimeCapabilities(principal: Principal): Record<string, string[]> {
  return Object.fromEntries([
    ...qiyRealtimeSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      // A claim-scoped resource grants only the caller's own segment; a missing claim grants nothing.
      .flatMap((subscription): Array<[string, string[]]> => {
        if (!subscription.claim) return [["qiy:" + subscription.resource, ["subscribe"]]];
        const value = principal.claims?.[subscription.claim.claim];
        if (value === undefined || value === null || value === "") return [];
        return [[realtimeChannel(subscription.resource, value as string | number), ["subscribe"]]];
      }),
    ...qiyRealtimeEventSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      .map((subscription): [string, string[]] => ["qiy:event:" + subscription.event, ["subscribe"]]),
  ]);
}

export async function publishRealtime(resource: string, type: QiyRealtimeEvent, payload: Record<string, unknown>, clientFactory: AblyClientFactory = createAblyClient): Promise<void> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return;
  const subscription = qiyRealtimeSubscriptions.find((candidate) => candidate.resource === resource);
  if (!subscription || !(subscription.events as readonly string[]).includes(type)) return;
  const claimValue = subscription.claim ? payload[subscription.claim.field] as string | number | null | undefined : undefined;
  // Without the claim value there is no channel to publish to, so the event stays undelivered by design.
  if (subscription.claim && (claimValue === undefined || claimValue === null || claimValue === "")) return;
  await clientFactory().channels.get(realtimeChannel(resource, claimValue)).publish(type, payload);
}

export const databaseOutboxStore: RealtimeOutboxStore = {
  async claim(limit, now, leaseOwner, leaseUntil) {
    const records = db.select().from(realtimeOutbox).where(and(isNull(realtimeOutbox.deliveredAt), isNull(realtimeOutbox.deadLetteredAt), lte(realtimeOutbox.availableAt, now), or(isNull(realtimeOutbox.leaseUntil), lte(realtimeOutbox.leaseUntil, now)))).orderBy(asc(realtimeOutbox.createdAt)).limit(limit).all(); if (records.length) db.update(realtimeOutbox).set({ leaseOwner, leaseUntil }).where(inArray(realtimeOutbox.id, records.map((record) => record.id))).run(); return records;
  },
  async delivered(id, leaseOwner, deliveredAt) {
    db.update(realtimeOutbox).set({ deliveredAt, lastError: null, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner))).run();
  },
  async failed(id, leaseOwner, attempts, lastError, availableAt) {
    db.update(realtimeOutbox).set({ attempts, lastError, availableAt, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner))).run();
  },
  async dead(id, leaseOwner, attempts, lastError, deadLetteredAt) {
    db.update(realtimeOutbox).set({ attempts, lastError, deadLetteredAt, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner))).run();
  },
  async deadLetters(limit) {
    return db.select().from(realtimeOutbox).where(isNotNull(realtimeOutbox.deadLetteredAt)).orderBy(desc(realtimeOutbox.deadLetteredAt)).limit(limit).all();
  },
  async replay(id, now, actorId) {
    return db.transaction((tx) => { const record = tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(eq(realtimeOutbox.id, id), isNotNull(realtimeOutbox.deadLetteredAt))).get(); if (!record) return false; tx.update(realtimeOutbox).set({ attempts: 0, availableAt: now, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null }).where(eq(realtimeOutbox.id, id)).run(); if (actorId) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId, action: "realtime.outbox.replayed", resource: "qiy_realtime_outbox", resourceId: id, metadata: JSON.stringify({ operation: "single" }), createdAt: new Date() }).run(); return true; });
  },
  async replayMany(ids, now, actorId) {
    return db.transaction((tx) => { const records = tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(inArray(realtimeOutbox.id, ids), isNotNull(realtimeOutbox.deadLetteredAt))).all(); const replayed = records.map((record) => record.id); if (replayed.length) tx.update(realtimeOutbox).set({ attempts: 0, availableAt: now, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null }).where(inArray(realtimeOutbox.id, replayed)).run(); if (actorId) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId, action: "realtime.outbox.bulk_replayed", resource: "qiy_realtime_outbox", resourceId: null, metadata: JSON.stringify({ requested: ids.length, replayed: replayed.length }), createdAt: new Date() }).run(); return replayed; });
  },
  async cleanupDelivered(before, audit) {
    return db.transaction((tx) => { const records = tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(isNotNull(realtimeOutbox.deliveredAt), lt(realtimeOutbox.deliveredAt, before))).all(); if (records.length) tx.delete(realtimeOutbox).where(inArray(realtimeOutbox.id, records.map((record) => record.id))).run(); if (audit) { const actorId = audit.actorId; tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId, action: "realtime.outbox.cleaned", resource: "qiy_realtime_outbox", resourceId: null, metadata: JSON.stringify({ retentionDays: audit.retentionDays, deleted: records.length }), createdAt: new Date() }).run(); } return records.length; });
  },
  async metrics(now) {
    const pendingCondition = and(isNull(realtimeOutbox.deliveredAt), isNull(realtimeOutbox.deadLetteredAt));
    const pending = db.select({ value: count() }).from(realtimeOutbox).where(pendingCondition).get()?.value ?? 0;
    const leased = db.select({ value: count() }).from(realtimeOutbox).where(and(pendingCondition, isNotNull(realtimeOutbox.leaseUntil), gt(realtimeOutbox.leaseUntil, now))).get()?.value ?? 0;
    const deadLettered = db.select({ value: count() }).from(realtimeOutbox).where(isNotNull(realtimeOutbox.deadLetteredAt)).get()?.value ?? 0;
    const delivered = db.select({ value: count() }).from(realtimeOutbox).where(isNotNull(realtimeOutbox.deliveredAt)).get()?.value ?? 0;
    const oldestPendingAt = db.select({ createdAt: realtimeOutbox.createdAt }).from(realtimeOutbox).where(pendingCondition).orderBy(asc(realtimeOutbox.createdAt)).limit(1).get()?.createdAt ?? null;
    return { pending, leased, deadLettered, delivered, oldestPendingAt };
  },
};

export async function dispatchRealtimeOutbox(limit = 100, clientFactory: AblyClientFactory = createAblyClient, store: RealtimeOutboxStore = databaseOutboxStore, leaseOwner: string = realtimeWorkerId): Promise<{ delivered: number; failed: number; deadLettered: number }> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return { delivered: 0, failed: 0, deadLettered: 0 };
  const now = new Date();
  const records = await store.claim(limit, now, leaseOwner, new Date(now.getTime() + realtimeLeaseMs()));
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  const client = records.length ? clientFactory() : undefined;
  for (const record of records) {
    try {
      const payload = JSON.parse(record.payload) as Record<string, unknown>;
      await client!.channels.get(record.channel).publish(record.type, payload);
      await store.delivered(record.id, leaseOwner, new Date());
      // Subscribers on the same instance receive the delivered, already-redacted payload.
      publishRealtimeEvent({ id: record.id, channel: record.channel, event: record.type, record: payload });
      delivered++;
    } catch (error) {
      const attempts = record.attempts + 1;
      const message = String(error).slice(0, 2000);
      if (attempts >= realtimeMaxAttempts()) {
        await store.dead(record.id, leaseOwner, attempts, message, new Date());
        deadLettered++;
      } else {
        const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6));
        await store.failed(record.id, leaseOwner, attempts, message, new Date(Date.now() + delay));
        failed++;
      }
    }
  }
  return { delivered, failed, deadLettered };
}

export async function cleanupRealtimeOutbox(retentionDays = realtimeRetentionDays(), store: RealtimeOutboxStore = databaseOutboxStore, now = new Date(), actorId?: string): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Realtime retention days must be an integer from 1 to 3650");
  return store.cleanupDelivered(new Date(now.getTime() - retentionDays * 86400000), actorId ? { actorId, retentionDays } : undefined);
}

export interface RealtimeOutboxWorkerHandle {
  dispatchTimer: ReturnType<typeof setInterval>;
  cleanupTimer: ReturnType<typeof setInterval>;
  stop(): void;
}

export function startRealtimeOutboxWorker(): RealtimeOutboxWorkerHandle | undefined {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return undefined;
  const pollMs = Number(Bun.env.QIY_REALTIME_POLL_MS ?? 5000);
  if (!Number.isSafeInteger(pollMs) || pollMs < 250) throw new Error("QIY_REALTIME_POLL_MS must be an integer of at least 250ms");
  const cleanupMs = realtimeCleanupMs();
  const dispatch = () => void dispatchRealtimeOutbox().catch((error) => console.error("Realtime outbox dispatch failed", error));
  const cleanup = () => void cleanupRealtimeOutbox()
    .then((deleted) => { if (deleted > 0) console.info("Realtime outbox cleanup removed " + deleted + " delivered record(s)"); })
    .catch((error) => console.error("Realtime outbox cleanup failed", error));
  dispatch();
  cleanup();
  const dispatchTimer = setInterval(dispatch, pollMs);
  const cleanupTimer = setInterval(cleanup, cleanupMs);
  dispatchTimer.unref();
  cleanupTimer.unref();
  return {
    dispatchTimer,
    cleanupTimer,
    stop() {
      clearInterval(dispatchTimer);
      clearInterval(cleanupTimer);
    },
  };
}

export function createRealtimeRoutes(authenticate: Authenticator, clientFactory: AblyClientFactory = createAblyClient, store: RealtimeOutboxStore = databaseOutboxStore) {
  return new Elysia({ prefix: "/api/v1/realtime" }).post("/token", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    const capability = realtimeCapabilities(principal);
    if (!Object.keys(capability).length) return status(403, { error: "Realtime subscription is not permitted" });
    if (Bun.env.QIY_REALTIME_DISABLED === "1") return status(503, { error: "Realtime is disabled" });
    return clientFactory().auth.createTokenRequest({ clientId: principal.id, capability: JSON.stringify(capability) });
  }).get("/outbox/dead", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    return { data: await store.deadLetters(100) };
  }).get("/outbox/metrics", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    return await store.metrics(new Date());
  }).get("/outbox/metrics/prometheus", async ({ request, status }) => {
    if (!hasRealtimeMetricsToken(request)) {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    }
    const now = new Date();
    return new Response(renderRealtimePrometheus(await store.metrics(now), now), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
  }).get("/outbox/health", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    const now = new Date();
    const health = evaluateRealtimeOutboxHealth(await store.metrics(now), now);
    return status(health.status === "ok" ? 200 : 503, health);
  }).post("/outbox/replay", async ({ request, body, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    if (new Set(body.ids).size !== body.ids.length) return status(400, { error: "Realtime replay ids must be unique" });
    const replayedIds = new Set(await store.replayMany(body.ids, new Date(), principal.id));
    return { replayed: body.ids.filter((id) => replayedIds.has(id)), notFound: body.ids.filter((id) => !replayedIds.has(id)) };
  }, { body: t.Object({ ids: t.Array(t.String({ format: "uuid" }), { minItems: 1, maxItems: 100 }) })
  }).post("/outbox/:id/replay", async ({ request, params, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    if (!await store.replay(params.id, new Date(), principal.id)) return status(404, { error: "Dead-letter event was not found" });
    return { replayed: true, id: params.id };
  }, { params: t.Object({ id: t.String({ format: "uuid" }) }) }).delete("/outbox/delivered", async ({ request, query, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    const retentionDays = query.retentionDays ?? realtimeRetentionDays();
    return { deleted: await cleanupRealtimeOutbox(retentionDays, store, new Date(), principal.id), retentionDays };
  }, { query: t.Object({ retentionDays: t.Optional(t.Numeric({ minimum: 1, maximum: 3650 })) }) });
}

/**
 * Subscription source for GraphQL. The in-process bus keeps latency low on the
 * instance that delivered the event, and the outbox tail makes events delivered by
 * any other replica visible too, so subscriptions work with several API instances.
 */
export function realtimeChannelIterator(channel: string): AsyncIterableIterator<QiyRealtimeRecordEvent> & { close: () => void } {
  const queue: QiyRealtimeRecordEvent[] = [];
  const seen = new Set<string>();
  let pending: ((result: IteratorResult<QiyRealtimeRecordEvent>) => void) | undefined;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let cursor: { createdAt: Date; id: string } | undefined;
  const pollMs = Math.max(100, Number(Bun.env.QIY_REALTIME_SUBSCRIBE_POLL_MS ?? 1000));
  const emit = (event: QiyRealtimeRecordEvent) => {
    if (closed || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 5000) seen.clear();
    const resolve = pending;
    if (resolve) { pending = undefined; resolve({ value: event, done: false }); }
    else queue.push(event);
  };
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (event.channel === channel) emit({ id: event.id, channel: event.channel, event: event.event, record: event.record });
  });
  const stop = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    unsubscribe();
    const resolve = pending;
    pending = undefined;
    resolve?.({ value: undefined as never, done: true });
  };
  const advance = (row: { id: string; createdAt: Date | number }) => { cursor = { createdAt: new Date(row.createdAt), id: row.id }; };
  const tail = async () => {
    if (closed) return;
    try {
      const after = cursor
        ? or(gt(realtimeOutbox.createdAt, cursor.createdAt), and(eq(realtimeOutbox.createdAt, cursor.createdAt), gt(realtimeOutbox.id, cursor.id)))
        : undefined;
      const rows = await db.select().from(realtimeOutbox)
        .where(and(eq(realtimeOutbox.channel, channel), isNotNull(realtimeOutbox.deliveredAt), after))
        .orderBy(asc(realtimeOutbox.createdAt), asc(realtimeOutbox.id))
        .limit(100);
      for (const row of rows) {
        advance(row);
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(row.payload) as Record<string, unknown>; } catch { payload = {}; }
        emit({ id: row.id, channel: row.channel, event: row.type, record: payload });
      }
    } catch { /* a transient read must not kill an active subscription */ }
  };
  const start = async () => {
    try {
      const latest = await db.select({ id: realtimeOutbox.id, createdAt: realtimeOutbox.createdAt }).from(realtimeOutbox)
        .where(and(eq(realtimeOutbox.channel, channel), isNotNull(realtimeOutbox.deliveredAt)))
        .orderBy(desc(realtimeOutbox.createdAt), desc(realtimeOutbox.id))
        .limit(1);
      if (latest[0]) advance(latest[0]);
    } catch { /* start from the beginning of the outbox */ }
    if (closed) return;
    timer = setInterval(() => { void tail(); }, pollMs);
    await tail();
  };
  void start();
  const iterator = {
    close: stop,
    [Symbol.asyncIterator]() { return iterator; },
    next() {
      if (closed) return Promise.resolve({ value: undefined as never, done: true });
      const queued = queue.shift();
      if (queued) return Promise.resolve({ value: queued, done: false });
      return new Promise<IteratorResult<QiyRealtimeRecordEvent>>((resolve) => { pending = resolve; });
    },
    return() { stop(); return Promise.resolve({ value: undefined as never, done: true }); },
  };
  return iterator;
}
