import { api, ApiError, type EventResult } from "./api";
import { store } from "./storage";
import { ulid } from "./ulid";

/**
 * Offline-first check-ins. Every event gets its id on the device and is saved
 * before sending, so a scan in a village with no signal is sent later with the
 * same id and the engine never counts it twice.
 */
const KEY = "rve.queue.v1";
const BATCH = 100;
/** The engine refuses scans older than this (engine/src/pipeline.ts LIMITS.maxOfflineAgeMs), so stop retrying them. */
const MAX_AGE_MS = 72 * 60 * 60 * 1000;

export interface QueuedEvent {
  event_id: string;
  type: string;
  occurred_at: string;
  poi_id?: string;
  geo?: { lat: number; lng: number; accuracy_m?: number };
  payload: Record<string, unknown>;
}

/** Why the last send failed: no network at all, or the engine answered with an error. */
export interface SendError {
  network: boolean;
  status?: number;
  code: string;
}

export function newEvent(type: string, fields: Omit<QueuedEvent, "event_id" | "type" | "occurred_at">): QueuedEvent {
  return { event_id: ulid(), type, occurred_at: new Date().toISOString(), ...fields };
}

export const pending = () => store.getJson<QueuedEvent[]>(KEY, []);

let lastError: SendError | null = null;
/** The error from the last send, or null when it went through. A function, so callers always read the current value. */
export const lastSendError = () => lastError;

export function toSendError(e: unknown): SendError {
  if (e instanceof ApiError) return { network: false, status: e.status, code: e.code };
  return { network: true, code: String((e as Error)?.message ?? e) };
}

/** An answer that says "never send this again": the engine refused it for good (not auth, rate limit or a server fault). */
export const isFinalRefusal = (err: SendError) => !err.network && err.status != null && err.status < 500 && err.status !== 401 && err.status !== 429;

/** Take events out of the queue, re-reading it so scans saved meanwhile are kept. */
async function remove(ids: Set<string>) {
  if (!ids.size) return;
  await store.setJson(KEY, (await pending()).filter((e) => !ids.has(e.event_id)));
}

const send = (events: QueuedEvent[]) => api<{ results: EventResult[] }>("/v1/events", { body: { events }, role: "visitor" }).then((r) => r.results);

let flushing: Promise<EventResult[]> | null = null;

/** Send everything waiting. Returns the engine's results; keeps events only when they may still go through later. */
export function flush(): Promise<EventResult[]> {
  if (!flushing) {
    flushing = (async () => {
      const now = Date.now();
      const all = await pending();
      const stale = all.filter((e) => now - Date.parse(e.occurred_at) > MAX_AGE_MS);
      await remove(new Set(stale.map((e) => e.event_id)));
      const list = all.filter((e) => !stale.includes(e)).slice(0, BATCH);
      if (!list.length) {
        lastError = null;
        return [];
      }
      try {
        const results = await send(list);
        await remove(new Set(list.map((e) => e.event_id)));
        lastError = null;
        return results;
      } catch (e) {
        lastError = toSendError(e);
        if (isFinalRefusal(lastError)) {
          // The engine refused the whole batch (should not happen): drop it rather than retry forever.
          await remove(new Set(list.map((e) => e.event_id)));
          return [];
        }
        if (lastError.network || lastError.status === 401 || lastError.status === 429 || list.length === 1) return [];
        // A server error: send one at a time, so a single bad event can't hold up every scan after it.
        const results: EventResult[] = [];
        const done = new Set<string>();
        lastError = null;
        for (const ev of list) {
          try {
            results.push(...(await send([ev])));
            done.add(ev.event_id);
          } catch (e1) {
            const err = toSendError(e1);
            if (isFinalRefusal(err)) done.add(ev.event_id);
            else lastError = err;
            if (err.network) break;
          }
        }
        await remove(done);
        return results;
      } finally {
        flushing = null;
      }
    })();
  }
  return flushing;
}

/** Queue one event and try to send it now. `null` result means it is still waiting (see `lastSendError()` for why). */
export async function submit(ev: QueuedEvent): Promise<EventResult[] | null> {
  await store.setJson(KEY, [...(await pending()), ev]);
  // A send already running (e.g. started when the app came to the foreground) may have read the
  // queue before this event was added: wait for it, then send again, and look in both results.
  const earlier = flushing ? await flushing : [];
  const results = [...earlier, ...(await flush())];
  const mine = results.filter((r) => r.event_id === ev.event_id || r.event_id.startsWith(`${ev.event_id}.`));
  return mine.length ? mine : null;
}
