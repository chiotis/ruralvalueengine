import { EventInputSchema, type Actor, type EventInput, type GeoPoint } from "./envelope.js";
import { withTx, type Db, type Tx } from "./db.js";
import { verifyQrToken } from "./qr.js";
import { distanceMeters, localDay } from "./geo.js";
import { getRuleSet, type LedgerRow, type RuleEvent, type TargetKind } from "./rules/index.js";

export interface PipelineConfig {
  qrKeys: Record<string, string>;
  networkTz: string;
}

/** Limits used by verification. */
export const LIMITS = {
  maxFutureSkewMs: 5 * 60 * 1000, // device clock ahead of server
  maxOfflineAgeMs: 72 * 60 * 60 * 1000, // offline queue may hold scans up to 3 days
  qrMaxDistanceM: 500, // phone location vs the place, for a QR whose place has coordinates
  qrMaxAccuracyM: 300, // a fix vaguer than this can't prove the phone is at the place
  geoMaxAccuracyM: 50,
  geoMinDwellS: 120,
} as const;

export type EventStatus = "verified" | "rejected" | "duplicate" | "cancelled";

export interface EventResult {
  event_id: string;
  type: string;
  status: EventStatus | "already_received";
  reason?: string;
  points: LedgerRow[];
}

interface StoredEvent {
  event_id: string;
  type: string;
  occurred_at: Date;
  visitor_id: string | null;
  member_ids: string[];
  target_id: string | null;
  poi_id: string | null;
  referral_id: string | null;
  refers_to_event_id: string | null;
  status: EventStatus;
  payload: Record<string, unknown>;
}

interface NewEvent {
  event_id: string;
  type: string;
  occurred_at: Date;
  received_at: Date;
  source: string;
  source_ref?: string | null;
  visitor_id: string | null;
  member_ids: string[];
  target_id?: string | null;
  route_id?: string | null;
  poi_id?: string | null;
  referral_id?: string | null;
  refers_to_event_id?: string | null;
  geo?: GeoPoint | null;
  status: EventStatus;
  reason?: string | null;
  checks: string[];
  dedupe_key?: string | null;
  rule_version?: string | null;
  payload: Record<string, unknown>;
}

class Rejection extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

const reject = (reason: string): never => {
  throw new Rejection(reason);
};

/**
 * Ingest one event: validate, verify, deduplicate, apply the active rules and
 * write ledger and passport rows, all in one transaction. Returns the result for
 * the event and for any events derived from it (referral, route completion).
 */
export async function ingest(
  db: Db,
  cfg: PipelineConfig,
  raw: unknown,
  actor: Actor,
  now: Date = new Date(),
): Promise<EventResult[]> {
  const parsed = EventInputSchema.safeParse(raw);
  if (!parsed.success) {
    const id = typeof (raw as { event_id?: unknown })?.event_id === "string" ? (raw as { event_id: string }).event_id : "";
    return [{ event_id: id, type: String((raw as { type?: unknown })?.type ?? ""), status: "rejected", reason: "invalid_envelope", points: [] }];
  }
  const input = parsed.data;

  const forbidden = authorize(input, actor);
  if (forbidden) return [{ event_id: input.event_id, type: input.type, status: "rejected", reason: forbidden, points: [] }];

  try {
    return await withTx(db, (tx) => process(tx, cfg, input, actor, now));
  } catch (err) {
    // Two copies of the same event racing: the loser sees the unique violation.
    if ((err as { code?: string }).code === "23505") {
      const existing = await db.query<{ status: EventStatus }>("SELECT status FROM events WHERE event_id = $1", [input.event_id]);
      if (existing.rows[0]) {
        return [{ event_id: input.event_id, type: input.type, status: "already_received", reason: existing.rows[0].status, points: [] }];
      }
    }
    throw err;
  }
}

function authorize(input: EventInput, actor: Actor): string | null {
  const adminOnly = input.type === "cancellation" || input.type === "correction";
  if (adminOnly) return actor.kind === "admin" ? null : "forbidden";
  if (actor.kind === "visitor") return null;
  if (actor.kind === "admin") return input.visitor_id ? null : "visitor_id_required";
  return "forbidden";
}

async function process(tx: Tx, cfg: PipelineConfig, input: EventInput, actor: Actor, now: Date): Promise<EventResult[]> {
  const existing = await tx.query<{ status: EventStatus }>("SELECT status FROM events WHERE event_id = $1", [input.event_id]);
  if (existing.rows[0]) {
    return [{ event_id: input.event_id, type: input.type, status: "already_received", reason: existing.rows[0].status, points: [] }];
  }

  const visitorId = actor.kind === "visitor" ? actor.visitorId : (input.visitor_id ?? null);
  const base: NewEvent = {
    event_id: input.event_id,
    type: input.type,
    occurred_at: new Date(input.occurred_at),
    received_at: now,
    source: actor.kind === "admin" ? "admin" : "app",
    source_ref: input.source_ref ?? null,
    visitor_id: visitorId,
    member_ids: [],
    route_id: input.route_id ?? null,
    poi_id: input.poi_id ?? null,
    refers_to_event_id: input.refers_to_event_id ?? null,
    geo: input.geo ?? null,
    status: "verified",
    checks: [],
    payload: input.payload,
  };

  try {
    switch (input.type) {
      case "checkin.qr":
        return await processQrCheckin(tx, cfg, input, base, now);
      case "checkin.geo":
        return await processGeoCheckin(tx, cfg, input, base, now);
      case "cancellation":
        return await processCancellation(tx, base);
      case "correction":
        return await processCorrection(tx, base);
      default: {
        checkTimeWindow(base, now);
        await insertEvent(tx, base);
        return [result(base, [])];
      }
    }
  } catch (err) {
    if (err instanceof Rejection) {
      // Rejected events are stored too, so ETAM can see what was refused and why.
      await insertEvent(tx, { ...base, status: "rejected", reason: err.reason, dedupe_key: null });
      return [{ event_id: base.event_id, type: base.type, status: "rejected", reason: err.reason, points: [] }];
    }
    throw err;
  }
}

function checkTimeWindow(ev: NewEvent, now: Date): void {
  const t = ev.occurred_at.getTime();
  if (Number.isNaN(t)) reject("bad_time");
  if (t > now.getTime() + LIMITS.maxFutureSkewMs) reject("time_in_future");
  if (t < now.getTime() - LIMITS.maxOfflineAgeMs) reject("too_old");
  ev.checks.push("time_window");
}

// ---------- check-ins ----------

interface QrTarget {
  id: string;
  kind: TargetKind;
  member_ids: string[];
  poi_id: string | null;
  lat: number | null;
  lng: number | null;
  key_version: number;
  active: boolean;
}

async function processQrCheckin(tx: Tx, cfg: PipelineConfig, input: EventInput, ev: NewEvent, now: Date): Promise<EventResult[]> {
  if (!ev.visitor_id) reject("visitor_required");
  checkTimeWindow(ev, now);

  const token = input.payload.qr_token;
  if (typeof token !== "string") reject("qr_missing");
  const qr = verifyQrToken(cfg.qrKeys, token as string);
  if (!qr.ok) return reject(qr.reason);
  ev.checks.push("qr_signature");

  // A target without its own coordinates uses its member's or POI's, so a QR made before the
  // place had coordinates still gets the distance check.
  const t = (
    await tx.query<QrTarget>(
      `SELECT q.id, q.kind, q.member_ids, q.poi_id, q.key_version, q.active,
              COALESCE(q.lat, p.lat, CASE WHEN q.kind = 'member' THEN m.lat END) AS lat,
              COALESCE(q.lng, p.lng, CASE WHEN q.kind = 'member' THEN m.lng END) AS lng
         FROM qr_targets q
         LEFT JOIN pois p ON p.id = q.poi_id
         LEFT JOIN members m ON m.id = q.member_ids[1]
        WHERE q.id = $1`,
      [qr.target],
    )
  ).rows[0];
  if (!t || !t.active) reject("qr_unknown_target");
  const target = t as QrTarget;
  if (target.key_version !== qr.version) reject("qr_rotated");

  // A place with coordinates needs the phone's location: a photo of the QR must not earn points from afar.
  // ETAM's manual entries from the admin panel are exempt from needing one.
  if (target.lat != null && target.lng != null && (ev.geo || ev.source !== "admin")) {
    if (!ev.geo) reject("geo_required");
    const geo = ev.geo as GeoPoint;
    if (geo.accuracy_m != null && geo.accuracy_m > LIMITS.qrMaxAccuracyM) reject("geo_inaccurate");
    if (distanceMeters(geo, { lat: target.lat, lng: target.lng }) > LIMITS.qrMaxDistanceM) reject("geo_too_far");
    ev.checks.push("geo_distance");
  }

  // The server decides who the visit belongs to, never the client.
  ev.target_id = target.id;
  ev.member_ids = target.member_ids;
  ev.poi_id = target.poi_id;
  ev.payload = { ...ev.payload, target_kind: target.kind };

  return finishCheckin(tx, cfg, ev, target.kind, input.payload.referral_code);
}

interface PoiRow {
  id: string;
  lat: number;
  lng: number;
  radius_m: number;
}

async function processGeoCheckin(tx: Tx, cfg: PipelineConfig, input: EventInput, ev: NewEvent, now: Date): Promise<EventResult[]> {
  if (!ev.visitor_id) reject("visitor_required");
  checkTimeWindow(ev, now);
  if (!input.poi_id) reject("poi_required");
  const poi = (await tx.query<PoiRow>("SELECT id, lat, lng, radius_m FROM pois WHERE id = $1", [input.poi_id])).rows[0];
  if (!poi) reject("poi_unknown");
  const p = poi as PoiRow;
  if (!ev.geo) reject("geo_required");
  const geo = ev.geo as GeoPoint;
  if (geo.accuracy_m == null || geo.accuracy_m > LIMITS.geoMaxAccuracyM) reject("geo_inaccurate");
  if (distanceMeters(geo, p) > p.radius_m) reject("geo_too_far");
  ev.checks.push("geo_distance");
  const dwell = input.payload.dwell_seconds;
  if (typeof dwell !== "number" || dwell < LIMITS.geoMinDwellS) reject("dwell_too_short");
  ev.checks.push("dwell");

  ev.target_id = p.id;
  ev.poi_id = p.id;
  ev.member_ids = [];
  ev.payload = { ...ev.payload, target_kind: "poi" };
  return finishCheckin(tx, cfg, ev, "poi", undefined);
}

/** Dedupe, store, credit, add to the passport, then derive referral and route events. */
async function finishCheckin(
  tx: Tx,
  cfg: PipelineConfig,
  ev: NewEvent,
  kind: TargetKind,
  referralCode: unknown,
): Promise<EventResult[]> {
  // One check-in per visitor per place per day. A POI counts once whether by QR or GPS.
  const place = ev.poi_id ?? ev.target_id;
  ev.dedupe_key = `checkin:${ev.visitor_id}:${place}:${localDay(ev.occurred_at, cfg.networkTz)}`;
  const dup = await tx.query("SELECT 1 FROM events WHERE dedupe_key = $1", [ev.dedupe_key]);
  if (dup.rowCount) {
    await insertEvent(tx, { ...ev, status: "duplicate", reason: "repeat_checkin", dedupe_key: null });
    return [{ event_id: ev.event_id, type: ev.type, status: "duplicate", reason: "repeat_checkin", points: [] }];
  }
  ev.checks.push("dedupe");

  const version = await activeRuleVersion(tx);
  ev.rule_version = version;
  await insertEvent(tx, ev);
  const rows = await credit(tx, version, ev.event_id, ruleEvent(ev, kind, null));
  await tx.query(
    "INSERT INTO passport_entries(visitor_id, event_id, kind, target_id, occurred_at) VALUES ($1, $2, 'checkin', $3, $4)",
    [ev.visitor_id, ev.event_id, place, ev.occurred_at],
  );

  const results: EventResult[] = [result(ev, rows)];
  if (typeof referralCode === "string" && referralCode) {
    const r = await deriveReferral(tx, version, ev, referralCode);
    if (r) results.push(r);
  }
  results.push(...(await deriveRouteCompletions(tx, version, ev, place as string)));
  return results;
}

async function deriveReferral(tx: Tx, version: string, checkin: NewEvent, code: string): Promise<EventResult | null> {
  const ref = (
    await tx.query<{ id: string; from_member_id: string; to_member_id: string; expires_at: Date }>(
      "SELECT id, from_member_id, to_member_id, expires_at FROM referrals WHERE code = $1",
      [code],
    )
  ).rows[0];
  // An unknown, expired or misplaced code does not spoil the check-in; it just earns no referral.
  if (!ref) return null;
  if (ref.expires_at.getTime() < checkin.occurred_at.getTime()) return null;
  if (!checkin.member_ids.includes(ref.to_member_id)) return null;

  const dedupeKey = `referral:${checkin.visitor_id}:${ref.id}`;
  if ((await tx.query("SELECT 1 FROM events WHERE dedupe_key = $1", [dedupeKey])).rowCount) return null;

  const ev: NewEvent = {
    event_id: `${checkin.event_id}.ref`,
    type: "referral.redeemed",
    occurred_at: checkin.occurred_at,
    received_at: checkin.received_at,
    source: "engine",
    visitor_id: checkin.visitor_id,
    member_ids: [ref.from_member_id, ref.to_member_id],
    target_id: checkin.target_id,
    referral_id: ref.id,
    refers_to_event_id: checkin.event_id,
    status: "verified",
    checks: ["referral_code", "referral_target", "referral_expiry", "dedupe"],
    dedupe_key: dedupeKey,
    rule_version: version,
    payload: {},
  };
  await insertEvent(tx, ev);
  const rows = await credit(tx, version, ev.event_id, {
    ...ruleEvent(ev, null, null),
    referral: { from_member_id: ref.from_member_id, to_member_id: ref.to_member_id },
  });
  return result(ev, rows);
}

async function deriveRouteCompletions(tx: Tx, version: string, checkin: NewEvent, place: string): Promise<EventResult[]> {
  const routes = (await tx.query<{ route_id: string }>("SELECT route_id FROM route_stops WHERE target_id = $1", [place])).rows;
  const out: EventResult[] = [];
  for (const { route_id } of routes) {
    const dedupeKey = `route:${checkin.visitor_id}:${route_id}`;
    if ((await tx.query("SELECT 1 FROM events WHERE dedupe_key = $1", [dedupeKey])).rowCount) continue;

    // Each stop needs a live passport entry; take the earliest one per stop.
    const stops = (
      await tx.query<{ target_id: string; event_id: string | null; member_ids: string[] | null }>(
        `SELECT s.target_id,
                (SELECT p.event_id FROM passport_entries p
                  WHERE p.visitor_id = $2 AND p.target_id = s.target_id AND p.kind = 'checkin' AND p.revoked_at IS NULL
                  ORDER BY p.occurred_at LIMIT 1) AS event_id,
                q.member_ids
           FROM route_stops s
           LEFT JOIN qr_targets q ON q.id = s.target_id
          WHERE s.route_id = $1
          ORDER BY s.position`,
        [route_id, checkin.visitor_id],
      )
    ).rows;
    if (stops.length === 0 || stops.some((s) => !s.event_id)) continue;

    const ev: NewEvent = {
      event_id: `${checkin.event_id}.route.${route_id}`,
      type: "route.completed",
      occurred_at: checkin.occurred_at,
      received_at: checkin.received_at,
      source: "engine",
      visitor_id: checkin.visitor_id,
      member_ids: [...new Set(stops.flatMap((s) => s.member_ids ?? []))],
      route_id,
      refers_to_event_id: checkin.event_id,
      status: "verified",
      checks: ["all_stops_checked_in", "dedupe"],
      dedupe_key: dedupeKey,
      rule_version: version,
      payload: { stop_event_ids: stops.map((s) => s.event_id) },
    };
    await insertEvent(tx, ev);
    const rows = await credit(tx, version, ev.event_id, ruleEvent(ev, null, null));
    await tx.query(
      "INSERT INTO passport_entries(visitor_id, event_id, kind, target_id, occurred_at) VALUES ($1, $2, 'route', $3, $4)",
      [ev.visitor_id, ev.event_id, route_id, ev.occurred_at],
    );
    out.push(result(ev, rows));
  }
  return out;
}

// ---------- cancellations and corrections ----------

async function loadEvent(tx: Tx, id: string | null | undefined): Promise<StoredEvent> {
  if (!id) return reject("refers_to_required");
  const row = (await tx.query<StoredEvent>("SELECT * FROM events WHERE event_id = $1 FOR UPDATE", [id])).rows[0];
  if (!row) return reject("refers_to_unknown");
  return row;
}

/**
 * Cancel an event and everything that depends on it: its derived referral, any
 * route completion that counted it as a stop, and any correction of it.
 */
async function processCancellation(tx: Tx, ev: NewEvent): Promise<EventResult[]> {
  const original = await loadEvent(tx, ev.refers_to_event_id);
  if (original.status !== "verified") reject("not_cancellable");
  ev.visitor_id = original.visitor_id;
  ev.member_ids = original.member_ids;
  ev.checks.push("admin", "refers_to");
  await insertEvent(tx, ev);

  const dependents = (
    await tx.query<{ event_id: string }>(
      `SELECT event_id FROM events
        WHERE status = 'verified' AND event_id <> $1
          AND (refers_to_event_id = $1 OR (type = 'route.completed' AND payload->'stop_event_ids' ? $1))`,
      [original.event_id],
    )
  ).rows.map((r) => r.event_id);

  const rows: LedgerRow[] = [];
  for (const id of [original.event_id, ...dependents]) {
    rows.push(...(await reverse(tx, id, ev.event_id)));
    // Free the dedupe key so a genuine visit can be recorded again.
    await tx.query("UPDATE events SET status = 'cancelled', dedupe_key = NULL WHERE event_id = $1", [id]);
    await tx.query("UPDATE passport_entries SET revoked_at = now() WHERE event_id = $1 AND revoked_at IS NULL", [id]);
  }
  return [result(ev, rows)];
}

/**
 * Correct who an event is credited to. The original stays on record; its points
 * (and those of any earlier correction) are reversed and the rules are applied
 * again to the corrected facts under the current rule version.
 */
async function processCorrection(tx: Tx, ev: NewEvent): Promise<EventResult[]> {
  const original = await loadEvent(tx, ev.refers_to_event_id);
  if (original.status !== "verified") reject("not_correctable");
  if (!original.type.startsWith("checkin.")) reject("not_correctable_type");
  const changes = ev.payload.changes as { member_ids?: unknown } | undefined;
  const memberIds = changes?.member_ids;
  if (!Array.isArray(memberIds) || !memberIds.every((m) => typeof m === "string")) reject("changes_member_ids_required");
  const ids = memberIds as string[];
  if (ids.length) {
    const known = await tx.query("SELECT id FROM members WHERE id = ANY($1)", [ids]);
    if (known.rowCount !== new Set(ids).size) reject("unknown_member");
  }

  const version = await activeRuleVersion(tx);
  ev.visitor_id = original.visitor_id;
  ev.member_ids = ids;
  ev.target_id = original.target_id;
  ev.poi_id = original.poi_id;
  ev.rule_version = version;
  ev.checks.push("admin", "refers_to");
  await insertEvent(tx, ev);

  const reversed: LedgerRow[] = [...(await reverse(tx, original.event_id, ev.event_id))];
  const earlier = (
    await tx.query<{ event_id: string }>(
      "SELECT event_id FROM events WHERE type = 'correction' AND status = 'verified' AND refers_to_event_id = $1 AND event_id <> $2",
      [original.event_id, ev.event_id],
    )
  ).rows;
  for (const { event_id } of earlier) {
    reversed.push(...(await reverse(tx, event_id, ev.event_id)));
    await tx.query("UPDATE events SET status = 'cancelled' WHERE event_id = $1", [event_id]);
  }

  const kind = (original.payload.target_kind as TargetKind | undefined) ?? null;
  const applied = await credit(tx, version, ev.event_id, {
    event_id: ev.event_id,
    type: original.type,
    visitor_id: original.visitor_id,
    member_ids: ids,
    target_kind: kind,
    referral: null,
  });
  return [result(ev, [...reversed, ...applied])];
}

/** Write negative rows for every not-yet-reversed ledger row of an event. */
async function reverse(tx: Tx, eventId: string, byEventId: string): Promise<LedgerRow[]> {
  const res = await tx.query<LedgerRow & { id: string; rule_version: string }>(
    `INSERT INTO ledger(owner_type, owner_id, points, event_id, rule_version, rule_id, reverses_id)
     SELECT l.owner_type, l.owner_id, -l.points, $2, l.rule_version, 'reverse:' || l.rule_id, l.id
       FROM ledger l
      WHERE l.event_id = $1 AND l.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger r WHERE r.reverses_id = l.id)
     RETURNING owner_type, owner_id, points, rule_id`,
    [eventId, byEventId],
  );
  return res.rows;
}

// ---------- helpers ----------

async function activeRuleVersion(tx: Tx): Promise<string> {
  const row = (await tx.query<{ version: string }>("SELECT version FROM rule_sets WHERE active")).rows[0];
  if (!row) throw new Error("No active rule set");
  return row.version;
}

function ruleEvent(ev: NewEvent, kind: TargetKind | null, referral: RuleEvent["referral"]): RuleEvent {
  return {
    event_id: ev.event_id,
    type: ev.type,
    visitor_id: ev.visitor_id,
    member_ids: ev.member_ids,
    target_kind: kind,
    referral,
  };
}

async function credit(tx: Tx, version: string, eventId: string, rev: RuleEvent): Promise<LedgerRow[]> {
  const rows = getRuleSet(version)(rev);
  for (const r of rows) {
    await tx.query(
      "INSERT INTO ledger(owner_type, owner_id, points, event_id, rule_version, rule_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [r.owner_type, r.owner_id, r.points, eventId, version, r.rule_id],
    );
  }
  return rows;
}

async function insertEvent(tx: Tx, ev: NewEvent): Promise<void> {
  await tx.query(
    `INSERT INTO events(event_id, type, occurred_at, received_at, source, source_ref, visitor_id, member_ids, target_id,
                        route_id, poi_id, referral_id, refers_to_event_id, geo, status, reason, checks, dedupe_key,
                        rule_version, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      ev.event_id,
      ev.type,
      ev.occurred_at,
      ev.received_at,
      ev.source,
      ev.source_ref ?? null,
      ev.visitor_id,
      ev.member_ids,
      ev.target_id ?? null,
      ev.route_id ?? null,
      ev.poi_id ?? null,
      ev.referral_id ?? null,
      // A rejected event may point at a missing original; keep the reference only if valid.
      ev.status === "rejected" ? await validRef(tx, ev.refers_to_event_id) : (ev.refers_to_event_id ?? null),
      ev.geo ? JSON.stringify(ev.geo) : null,
      ev.status,
      ev.reason ?? null,
      ev.checks,
      ev.dedupe_key ?? null,
      ev.rule_version ?? null,
      JSON.stringify(ev.payload),
    ],
  );
}

async function validRef(tx: Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await tx.query("SELECT 1 FROM events WHERE event_id = $1", [id])).rowCount ? id : null;
}

function result(ev: NewEvent, points: LedgerRow[]): EventResult {
  return { event_id: ev.event_id, type: ev.type, status: ev.status, points };
}

/**
 * Record an event produced by the engine itself (partnership confirmed, reward
 * redeemed) inside an existing transaction, credit it under the active rules,
 * and add any extra ledger rows (for example a points spend).
 */
export async function recordEngineEvent(
  tx: Tx,
  ev: {
    event_id: string;
    type: string;
    occurred_at: Date;
    source: string;
    visitor_id?: string | null;
    member_ids?: string[];
    dedupe_key?: string | null;
    checks?: string[];
    payload?: Record<string, unknown>;
  },
  extra: LedgerRow[] = [],
): Promise<LedgerRow[]> {
  const version = await activeRuleVersion(tx);
  const full: NewEvent = {
    event_id: ev.event_id,
    type: ev.type,
    occurred_at: ev.occurred_at,
    received_at: new Date(),
    source: ev.source,
    visitor_id: ev.visitor_id ?? null,
    member_ids: ev.member_ids ?? [],
    status: "verified",
    checks: ev.checks ?? [],
    dedupe_key: ev.dedupe_key ?? null,
    rule_version: version,
    payload: ev.payload ?? {},
  };
  await insertEvent(tx, full);
  const rows = await credit(tx, version, full.event_id, ruleEvent(full, null, null));
  for (const r of extra) {
    await tx.query(
      "INSERT INTO ledger(owner_type, owner_id, points, event_id, rule_version, rule_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [r.owner_type, r.owner_id, r.points, full.event_id, version, r.rule_id],
    );
  }
  return [...rows, ...extra];
}
