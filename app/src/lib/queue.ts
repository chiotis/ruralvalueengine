import { api, ApiError, type EventResult } from "./api";
import { store } from "./storage";
import { ulid } from "./ulid";

/**
 * Offline-first check-ins. Every event gets its id on the device and is saved
 * before sending, so a scan in a village with no signal is sent later with the
 * same id and the engine never counts it twice.
 */
const KEY = "rve.queue.v1";
export interface QueuedEvent {
  event_id: string;
  type: string;
  occurred_at: string;
  poi_id?: string;
  geo?: { lat: number; lng: number; accuracy_m?: number };
  payload: Record<string, unknown>;
}

export function newEvent(type: string, fields: Omit<QueuedEvent, "event_id" | "type" | "occurred_at">): QueuedEvent {
  return { event_id: ulid(), type, occurred_at: new Date().toISOString(), ...fields };
}

export const pending = () => store.getJson<QueuedEvent[]>(KEY, []);

let flushing: Promise<EventResult[]> | null = null;

/** Send everything waiting. Returns the engine's results; keeps events only if the network failed. */
export function flush(): Promise<EventResult[]> {
  if (!flushing) {
    flushing = (async () => {
      const list = await pending();
      if (!list.length) return [];
      try {
        const res = await api<{ results: EventResult[] }>("/v1/events", { body: { events: list.slice(0, 100) }, role: "visitor" });
        const sent = new Set(list.slice(0, 100).map((e) => e.event_id));
        const rest = (await pending()).filter((e) => !sent.has(e.event_id));
        await store.setJson(KEY, rest);
        return res.results;
      } catch (e) {
        if (e instanceof ApiError && e.status < 500 && e.status !== 401 && e.status !== 429) {
          // The engine refused the whole batch (should not happen): drop it rather than retry forever.
          await store.setJson(KEY, []);
        }
        return [];
      } finally {
        flushing = null;
      }
    })();
  }
  return flushing;
}

/** Queue one event and try to send it now. `null` result means it is waiting for the network. */
export async function submit(ev: QueuedEvent): Promise<EventResult[] | null> {
  await store.setJson(KEY, [...(await pending()), ev]);
  const results = await flush();
  const mine = results.filter((r) => r.event_id === ev.event_id || r.event_id.startsWith(`${ev.event_id}.`));
  return mine.length ? mine : null;
}
