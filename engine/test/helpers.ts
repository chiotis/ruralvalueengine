import { ulid } from "ulid";
import { createPool, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { makeQrToken } from "../src/qr.js";
import type { PipelineConfig } from "../src/pipeline.js";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/rve_test";

export const cfg: PipelineConfig = { qrKeys: { "1": "test-key-1", "2": "test-key-2" }, networkTz: "Europe/Athens" };

export async function freshDb(): Promise<Db> {
  const db = createPool(DATABASE_URL);
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
  return db;
}

/** Seed: two members (taverna, winery), one POI, QR targets for each, a shared experience. */
export async function seed(db: Db) {
  await db.query(`INSERT INTO members(id, name, lat, lng) VALUES
    ('biz-1', 'Taverna', 37.5545, 22.0771),
    ('biz-2', 'Winery', 37.5600, 22.0800),
    ('biz-3', 'Cheese maker', 37.5700, 22.0900)`);
  await db.query(`INSERT INTO pois(id, name, lat, lng, radius_m) VALUES ('poi-9', 'Old bridge', 37.5500, 22.0700, 75)`);
  await db.query(`INSERT INTO qr_targets(id, kind, member_ids, poi_id, lat, lng) VALUES
    ('biz-1', 'member', '{biz-1}', NULL, 37.5545, 22.0771),
    ('biz-2', 'member', '{biz-2}', NULL, 37.5600, 22.0800),
    ('poi-9', 'poi', '{}', 'poi-9', 37.5500, 22.0700),
    ('exp-harvest', 'shared', '{biz-1,biz-2}', NULL, NULL, NULL)`);
  await db.query(`INSERT INTO visitors(id, email_hash) VALUES ('v_alice', 'h-alice'), ('v_bob', 'h-bob')`);
}

export const qr = (target: string, version = 1) => makeQrToken(cfg.qrKeys, target, version);

/** Where a phone standing at each seeded QR would be. */
const AT: Record<string, { lat: number; lng: number; accuracy_m: number }> = {
  "biz-1": { lat: 37.5546, lng: 22.0772, accuracy_m: 15 },
  "biz-2": { lat: 37.5601, lng: 22.0801, accuracy_m: 15 },
  "biz-3": { lat: 37.5701, lng: 22.0901, accuracy_m: 15 },
  "poi-9": { lat: 37.5501, lng: 22.0701, accuracy_m: 15 },
};

export function qrCheckin(target: string, at: Date, extra: Record<string, unknown> = {}, id = ulid()) {
  return {
    event_id: id,
    type: "checkin.qr",
    occurred_at: at.toISOString(),
    ...(AT[target] ? { geo: AT[target] } : {}),
    payload: { qr_token: qr(target), ...extra },
  };
}

export async function balance(db: Db, ownerType: "visitor" | "member", id: string): Promise<number> {
  const r = await db.query<{ b: string }>(
    "SELECT COALESCE(SUM(points),0) AS b FROM ledger WHERE owner_type = $1 AND owner_id = $2",
    [ownerType, id],
  );
  return Number(r.rows[0]!.b);
}

export const alice = { kind: "visitor", visitorId: "v_alice" } as const;
export const admin = { kind: "admin" } as const;
