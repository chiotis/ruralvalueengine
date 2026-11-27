import Constants from "expo-constants";
import { secure } from "./storage";

export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

type Role = "visitor" | "member";
const KEYS: Record<Role, { access: string; refresh: string }> = {
  visitor: { access: "rve.visitor.access", refresh: "rve.visitor.refresh" },
  member: { access: "rve.member.access", refresh: "rve.member.refresh" },
};
const REFRESH_PATH: Record<Role, string> = { visitor: "/v1/auth/refresh", member: "/v1/member/auth/refresh" };

export async function saveTokens(role: Role, t: { access_token: string; refresh_token: string }) {
  await secure.set(KEYS[role].access, t.access_token);
  await secure.set(KEYS[role].refresh, t.refresh_token);
}
export async function clearTokens(role: Role) {
  await secure.del(KEYS[role].access);
  await secure.del(KEYS[role].refresh);
}
export async function hasSession(role: Role) {
  return !!(await secure.get(KEYS[role].refresh));
}

const TIMEOUT_MS = 15000;

async function raw(path: string, init: RequestInit = {}, token?: string | null) {
  // A request that never answers (bad signal) must not leave the screen waiting forever.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    signal: ctrl.signal,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  }).finally(() => clearTimeout(timer));
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `http_${res.status}`);
  return body;
}

let refreshing: Partial<Record<Role, Promise<string | null>>> = {};

async function refresh(role: Role): Promise<string | null> {
  if (!refreshing[role]) {
    refreshing[role] = (async () => {
      const rt = await secure.get(KEYS[role].refresh);
      if (!rt) return null;
      try {
        const t = (await raw(REFRESH_PATH[role], { method: "POST", body: JSON.stringify({ refresh_token: rt }) })) as {
          access_token: string;
          refresh_token: string;
        };
        await saveTokens(role, t);
        return t.access_token;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clearTokens(role);
        return null;
      } finally {
        refreshing[role] = undefined;
      }
    })();
  }
  return refreshing[role]!;
}

/** Call the engine. With a role, sends that role's token and refreshes it once on 401. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; role?: Role } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body ? "POST" : "GET"), body: opts.body ? JSON.stringify(opts.body) : undefined };
  if (!opts.role) return (await raw(path, init)) as T;
  let token = await secure.get(KEYS[opts.role].access);
  if (!token) token = await refresh(opts.role);
  if (!token) throw new ApiError(401, "unauthorized");
  try {
    return (await raw(path, init, token)) as T;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    const fresh = await refresh(opts.role);
    if (!fresh) throw e;
    return (await raw(path, init, fresh)) as T;
  }
}

// ---------- types returned by the engine ----------
export interface CatalogSummary {
  id: string;
  kind: "business" | "route" | "poi";
  title: string;
  subtitle: string | null;
  lat: number | null;
  lng: number | null;
  image: { url: string; sizes: Record<string, { url: string; w: number; h: number }> } | null;
  distance_km?: number;
}
export interface CatalogItem extends CatalogSummary {
  link: string | null;
  intro: string | null;
  body: string | null;
  duration?: string | null;
  season?: string | null;
  opening_hours?: string | null;
  services?: string | null;
  trail_length: string | null;
  map_kml: string | null;
  youtube_video: string | null;
  contact: { address: string | null; email: string | null; telephone: string | null; website_url: string | null; booking_url: string | null };
  gallery: { url: string }[];
  terms: { taxonomy: string; id: number; name: string }[];
  nearby: CatalogSummary[];
}
export interface EventResult {
  event_id: string;
  type: string;
  status: "verified" | "rejected" | "duplicate" | "cancelled" | "already_received";
  reason?: string;
  points: { owner_type: string; owner_id: string; points: number; rule_id: string }[];
}
