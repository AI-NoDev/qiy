import { Elysia } from "elysia";
import { asc, count, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { realtimeOutbox } from "./schema";
import { publishRealtimeEvent, subscribeRealtimeEvents, type QiyRealtimeBusEvent } from "./realtime-bus";
import type { Authenticator, Principal } from "./auth/guard";

export type QiyRealtimeEvent = "created" | "updated" | "deleted";
export interface QiyRealtimeSubscription { resource: string; events: string[]; roles: string[]; claim?: { field: string; claim: string } }
export interface QiyRealtimeEventSubscription { event: string; roles: string[] }
// Declared element types: an empty capability list must still be typed, otherwise
// an empty const array becomes readonly never[] and the generated server fails tsc.
export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] = [{"resource":"inventory","events":["created","updated","deleted"],"roles":["admin","operator"]},{"resource":"stock_movements","events":["created"],"roles":["admin","operator"]},{"resource":"shipments","events":["created","updated"],"roles":["admin","operator"]}];
export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] = [{"event":"inventory.received","roles":["admin","operator"]},{"event":"inventory.moved","roles":["admin","operator"]},{"event":"sales.allocated","roles":["admin","operator"]},{"event":"inventory.adjusted","roles":["admin","operator"]},{"event":"sales.shipped","roles":["admin","operator"]},{"event":"inventory.transferred","roles":["admin","operator"]},{"event":"production.completed","roles":["admin","operator"]},{"event":"purchasing.approved","roles":["admin","operator"]}];

function realtimeInteger(name: "QIY_REALTIME_POLL_MS" | "QIY_REALTIME_RETENTION_DAYS" | "QIY_REALTIME_CLEANUP_MS", fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = Number(Bun.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(name + " must be an integer from " + minimum + " to " + maximum);
  return value;
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

// Rows stay in the read window this long, so a transaction that commits after a
// newer one (or on a replica with a slightly skewed clock) is still delivered.
const lookbackMs = 5000;
let cursor = new Date();
// Rows written before the poller started belong to no current subscriber.
let startedAt = cursor.getTime();
const seen = new Map<string, number>();
let subscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let polling: Promise<void> | undefined;
let pollAgain = false;

async function readOutbox(): Promise<void> {
  try {
    const rows = await db.select().from(realtimeOutbox)
      .where(gte(realtimeOutbox.createdAt, new Date(cursor.getTime() - lookbackMs)))
      .orderBy(asc(realtimeOutbox.createdAt), asc(realtimeOutbox.id))
      .limit(1000);
    for (const row of rows) {
      const createdAt = new Date(row.createdAt).getTime();
      if (createdAt > cursor.getTime()) cursor = new Date(createdAt);
      if (seen.has(row.id)) continue;
      seen.set(row.id, createdAt);
      if (createdAt < startedAt) continue;
      let record: Record<string, unknown> = {};
      try { record = JSON.parse(row.payload) as Record<string, unknown>; } catch { record = {}; }
      publishRealtimeEvent({ id: row.id, channel: row.channel, event: row.type, record });
    }
    const horizon = cursor.getTime() - lookbackMs;
    for (const [id, createdAt] of seen) if (createdAt < horizon) seen.delete(id);
  } catch (error) {
    console.error("Realtime outbox poll failed", error);
  }
}

/**
 * Fans committed outbox rows out to this instance's subscribers. Every replica
 * tails the same table, so an event written by any instance reaches every
 * connected browser; services call this right after a commit for low latency.
 */
export function pollRealtimeOutbox(): Promise<void> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1" || subscribers === 0) return Promise.resolve();
  if (polling) { pollAgain = true; return polling; }
  polling = (async () => {
    try { do { pollAgain = false; await readOutbox(); } while (pollAgain); }
    finally { polling = undefined; }
  })();
  return polling;
}

function retainPoller(): () => void {
  subscribers += 1;
  if (!pollTimer && Bun.env.QIY_REALTIME_DISABLED !== "1") {
    cursor = new Date();
    startedAt = cursor.getTime();
    seen.clear();
    pollTimer = setInterval(() => { void pollRealtimeOutbox(); }, realtimeInteger("QIY_REALTIME_POLL_MS", 1000, 100));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers -= 1;
    if (subscribers === 0 && pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  };
}

export type QiyRealtimeIterator = AsyncIterableIterator<QiyRealtimeBusEvent> & { close: () => void };

/** Events on the given channels as an async iterator; closing it releases the shared poller. */
export function realtimeChannelIterator(channels: string | readonly string[]): QiyRealtimeIterator {
  const accepted = new Set<string>(typeof channels === "string" ? [channels] : channels);
  const queue: QiyRealtimeBusEvent[] = [];
  let pending: ((result: IteratorResult<QiyRealtimeBusEvent>) => void) | undefined;
  let closed = false;
  const release = retainPoller();
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (closed || !accepted.has(event.channel)) return;
    const resolve = pending;
    if (resolve) { pending = undefined; resolve({ value: event, done: false }); }
    else if (queue.length < 1000) queue.push(event);
  });
  const stop = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    release();
    const resolve = pending;
    pending = undefined;
    resolve?.({ value: undefined as never, done: true });
  };
  const iterator: QiyRealtimeIterator = {
    close: stop,
    [Symbol.asyncIterator]() { return iterator; },
    next() {
      if (closed) return Promise.resolve({ value: undefined as never, done: true });
      const queued = queue.shift();
      if (queued) return Promise.resolve({ value: queued, done: false });
      return new Promise<IteratorResult<QiyRealtimeBusEvent>>((resolve) => { pending = resolve; });
    },
    return() { stop(); return Promise.resolve({ value: undefined as never, done: true }); },
  };
  return iterator;
}

export function realtimeCleanupCutoff(retentionDays: number, now = new Date()): Date {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Realtime retention days must be an integer from 1 to 3650");
  return new Date(now.getTime() - retentionDays * 86400000);
}

/** Outbox rows only need to outlive the read window; older rows are removed. */
export async function cleanupRealtimeOutbox(retentionDays = realtimeInteger("QIY_REALTIME_RETENTION_DAYS", 1, 1, 3650), now = new Date()): Promise<number> {
  const cutoff = realtimeCleanupCutoff(retentionDays, now);
  const [row] = await db.select({ value: count() }).from(realtimeOutbox).where(lt(realtimeOutbox.createdAt, cutoff));
  const total = Number(row?.value ?? 0);
  if (total > 0) await db.delete(realtimeOutbox).where(lt(realtimeOutbox.createdAt, cutoff));
  return total;
}

export function startRealtimeOutboxCleanup(): ReturnType<typeof setInterval> | undefined {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return undefined;
  const cleanup = () => void cleanupRealtimeOutbox()
    .then((deleted) => { if (deleted > 0) console.info("Realtime outbox cleanup removed " + deleted + " record(s)"); })
    .catch((error) => console.error("Realtime outbox cleanup failed", error));
  cleanup();
  const timer = setInterval(cleanup, realtimeInteger("QIY_REALTIME_CLEANUP_MS", 3600000, 60000));
  timer.unref?.();
  return timer;
}

/**
 * GET /api/v1/realtime/stream: one authenticated text/event-stream carrying every
 * channel the caller is granted. The first frame (event: ready) lists them.
 */
export function createRealtimeRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/realtime" }).get("/stream", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    const channels = Object.keys(realtimeCapabilities(principal));
    if (!channels.length) return status(403, { error: "Realtime subscription is not permitted" });
    if (Bun.env.QIY_REALTIME_DISABLED === "1") return status(503, { error: "Realtime is disabled" });
    const events = realtimeChannelIterator(channels);
    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    request.signal?.addEventListener("abort", () => events.close());
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("event: ready\ndata: " + JSON.stringify({ channels }) + "\n\n"));
        heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { /* stream closed */ } }, 25000);
        try {
          for await (const event of events) controller.enqueue(encoder.encode("event: " + event.event + "\ndata: " + JSON.stringify(event) + "\n\n"));
        } catch { /* the client went away */ } finally {
          if (heartbeat) clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        events.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  });
}
