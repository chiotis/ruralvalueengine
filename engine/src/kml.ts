import { inflateRawSync } from "node:zlib";
import type { Db } from "./db.js";
import { decodeEntities } from "./wordpress/normalise.js";

/** A route's path, ready to draw: [lat, lng] lines and the named stops marked in the KML. */
export interface RouteTrack {
  lines: [number, number][][];
  stops: { name: string; lat: number; lng: number }[];
}

/** Simplification tolerance in metres. A phone map can't show detail finer than this. */
const TOLERANCE_M = 8;
/** If a track is still bigger than this after simplifying, simplify harder. */
const MAX_POINTS = 1500;
const MAX_BYTES = 15_000_000;
const FETCH_TIMEOUT_MS = 15_000;
/** A KML that failed to load or parse is retried after this long. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/** Unpack the first .kml file inside a KMZ (a zip). Some ruralgreece.gr ".kml" uploads are really KMZ. */
export function unzipKml(buf: Buffer): string | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith(".kml")) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) return data.toString("utf8");
    if (method === 8) return inflateRawSync(data).toString("utf8");
    return null;
  }
  return null;
}

const text = (s: string | undefined) => (s ? decodeEntities(s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).replace(/<[^>]+>/g, "").trim() : "");

function coords(block: string): [number, number][] {
  return block
    .trim()
    .split(/\s+/)
    .map((t) => t.split(",").map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]!) <= 90)
    // Some CalTopo exports wrap longitude past 180 (e.g. 382.54 for 22.54).
    .map((c) => [c[1]!, Math.abs(c[0]!) <= 180 ? c[0]! : ((((c[0]! + 180) % 360) + 360) % 360) - 180]);
}

/** Read LineStrings / gx:Tracks as lines and Points as named stops. */
export function parseKml(kml: string): RouteTrack {
  const lines: [number, number][][] = [];
  const stops: RouteTrack["stops"] = [];
  const found = kml.match(/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/g);
  const placemarks = found ?? [kml];
  for (const pm of placemarks) {
    for (const m of pm.matchAll(/<(?:\w+:)?LineString\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/g)) {
      const pts = coords(m[1]!);
      if (pts.length > 1) lines.push(pts);
    }
    for (const m of pm.matchAll(/<gx:Track\b[\s\S]*?<\/gx:Track>/g)) {
      const pts = [...m[0].matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map((c) => c[1]!.trim().split(/\s+/).join(",")).join(" ");
      const line = coords(pts);
      if (line.length > 1) lines.push(line);
    }
    const point = pm.match(/<(?:\w+:)?Point\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/);
    if (point && found) {
      const [c] = coords(point[1]!);
      const name = text(pm.match(/<(?:\w+:)?name>([\s\S]*?)<\/(?:\w+:)?name>/)?.[1]);
      if (c && name) stops.push({ name, lat: c[0], lng: c[1] });
    }
  }
  return { lines, stops };
}

/** Douglas–Peucker on a local flat projection, in metres. */
export function simplify(line: [number, number][], toleranceM: number): [number, number][] {
  if (line.length < 3) return line;
  const lat0 = (line[0]![0] * Math.PI) / 180;
  const kx = 111_320 * Math.cos(lat0);
  const ky = 110_540;
  const xy = line.map(([la, ln]) => [ln * kx, la * ky] as const);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a]!;
    const [bx, by] = xy[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

/** Parse a KML or KMZ file and simplify it to a size a phone map draws instantly. */
export function trackFromFile(buf: Buffer): RouteTrack {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const kml = isZip ? unzipKml(buf) : buf.toString("utf8");
  if (!kml) throw new Error("kmz_without_kml");
  const raw = parseKml(kml);
  let tol = TOLERANCE_M;
  let lines = raw.lines.map((l) => simplify(l, tol));
  while (lines.reduce((n, l) => n + l.length, 0) > MAX_POINTS && tol < 500) {
    tol *= 2;
    lines = raw.lines.map((l) => simplify(l, tol));
  }
  return {
    lines: lines.map((l) => l.map(([la, ln]) => [round(la), round(ln)] as [number, number])),
    stops: raw.stops.slice(0, 100).map((s) => ({ name: s.name.slice(0, 200), lat: round(s.lat), lng: round(s.lng) })),
  };
}

export type KmlFetch = (url: string) => Promise<Buffer>;

export const fetchKml: KmlFetch = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`kml_http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("kml_too_large");
  return buf;
};

const inflight = new Map<string, Promise<RouteTrack | null>>();

/**
 * The simplified track for a route, from the route_tracks cache. Fetched and parsed
 * on first use, and again whenever the route's KML link changes.
 */
export async function routeTrack(db: Db, itemId: string, url: string | null | undefined, get: KmlFetch = fetchKml): Promise<RouteTrack | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const cached = (
    await db.query<{ kml_url: string; track: RouteTrack | null; fetched_at: Date }>("SELECT kml_url, track, fetched_at FROM route_tracks WHERE item_id = $1", [itemId])
  ).rows[0];
  if (cached && cached.kml_url === url && (cached.track || Date.now() - cached.fetched_at.getTime() < RETRY_AFTER_MS)) return cached.track;

  const key = `${itemId} ${url}`;
  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      let track: RouteTrack | null = null;
      let error: string | null = null;
      try {
        track = trackFromFile(await get(url));
        if (!track.lines.length && !track.stops.length) {
          track = null;
          error = "kml_empty";
        }
      } catch (e) {
        error = (e as Error).message.slice(0, 200);
      }
      await db.query(
        `INSERT INTO route_tracks(item_id, kml_url, track, error, fetched_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (item_id) DO UPDATE SET kml_url = EXCLUDED.kml_url, track = EXCLUDED.track, error = EXCLUDED.error, fetched_at = now()`,
        [itemId, url, track ? JSON.stringify(track) : null, error],
      );
      return track;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

/** Fill the cache for every route whose KML is new or changed, so first opens are instant. */
export async function warmRouteTracks(db: Db, get: KmlFetch = fetchKml): Promise<{ ok: number; failed: number }> {
  const rows = await db.query<{ id: string; url: string }>(
    `SELECT c.id, c.data->>'map_kml' AS url FROM catalog_items c LEFT JOIN route_tracks t ON t.item_id = c.id
      WHERE c.kind = 'route' AND c.deleted_at IS NULL AND COALESCE(c.data->>'map_kml', '') <> ''
        AND (t.item_id IS NULL OR t.kml_url <> c.data->>'map_kml')`,
  );
  let ok = 0;
  let failed = 0;
  for (const r of rows.rows) {
    if (await routeTrack(db, r.id, r.url, get)) ok++;
    else failed++;
  }
  return { ok, failed };
}
