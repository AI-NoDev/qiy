export interface QiyRealtimeBusEvent { id: string; channel: string; event: string; record: Record<string, unknown> }

export type QiyRealtimeRecordEvent = { id: string; channel: string; event: string; record: Record<string, unknown> };

type Listener = (event: QiyRealtimeBusEvent) => void;
const listeners = new Set<Listener>();

/** In-process fan-out for delivered realtime events. Cross-replica delivery still uses Ably. */
export function publishRealtimeEvent(event: QiyRealtimeBusEvent): void {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* one slow subscriber must not break delivery */ }
  }
}

export function subscribeRealtimeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type QiyRealtimeIterator = AsyncIterableIterator<QiyRealtimeBusEvent> & { close: () => void };

/** Bridges the bus into the async iterator graphql-js subscriptions consume. */
export function realtimeEventIterator(channel: string): QiyRealtimeIterator {
  const queue: QiyRealtimeBusEvent[] = [];
  let pending: ((result: IteratorResult<QiyRealtimeBusEvent>) => void) | undefined;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    const resolve = pending;
    pending = undefined;
    resolve?.({ value: undefined as never, done: true });
  };
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (closed || event.channel !== channel) return;
    const resolve = pending;
    if (resolve) { pending = undefined; resolve({ value: event, done: false }); }
    else queue.push(event);
  });
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
