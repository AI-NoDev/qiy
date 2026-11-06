export interface QiyRealtimeBusEvent { id: string; channel: string; event: string; record: Record<string, unknown> }

type Listener = (event: QiyRealtimeBusEvent) => void;
const listeners = new Set<Listener>();

/** In-process fan-out of outbox events to this instance's SSE and GraphQL subscribers. */
export function publishRealtimeEvent(event: QiyRealtimeBusEvent): void {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* one failing subscriber must not break delivery */ }
  }
}

export function subscribeRealtimeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
