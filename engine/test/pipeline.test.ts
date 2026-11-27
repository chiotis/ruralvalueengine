import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import type { Db } from "../src/db.js";
import { ingest } from "../src/pipeline.js";
import { admin, alice, balance, cfg, freshDb, qr, qrCheckin, seed } from "./helpers.js";

let db: Db;
const NOW = new Date("2026-11-27T10:00:00Z"); // 12:00 in Athens
const later = (ms: number) => new Date(NOW.getTime() + ms);
const H = 60 * 60 * 1000;

beforeEach(async () => {
  if (db) await db.end();
  db = await freshDb();
  await seed(db);
});
afterAll(async () => {
  await db?.end();
});

const run = (raw: unknown, actor: Parameters<typeof ingest>[3] = alice, now = NOW) => ingest(db, cfg, raw, actor, now);

describe("QR check-in at a member", () => {
  it("credits visitor +10 and member +5 and adds a passport entry", async () => {
    const [r] = await run(qrCheckin("biz-1", NOW));
    expect(r!.status).toBe("verified");
    expect(await balance(db, "visitor", "v_alice")).toBe(10);
    expect(await balance(db, "member", "biz-1")).toBe(5);
    const p = await db.query("SELECT * FROM passport_entries WHERE visitor_id = 'v_alice'");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].target_id).toBe("biz-1");
  });

  it("ignores member ids sent by the client", async () => {
    await run({ ...qrCheckin("biz-1", NOW), member_ids: ["biz-3"] });
    expect(await balance(db, "member", "biz-3")).toBe(0);
    expect(await balance(db, "member", "biz-1")).toBe(5);
  });
});

describe("edge case 1: repeated QR scan", () => {
  it("re-sending the same event never credits twice", async () => {
    const ev = qrCheckin("biz-1", NOW);
    await run(ev);
    const [again] = await run(ev);
    expect(again!.status).toBe("already_received");
    expect(await balance(db, "visitor", "v_alice")).toBe(10);
  });

  it("a second scan the same day is a duplicate; the next day counts again", async () => {
    await run(qrCheckin("biz-1", NOW));
    const [dup] = await run(qrCheckin("biz-1", later(3 * H)), alice, later(3 * H));
    expect(dup).toMatchObject({ status: "duplicate", reason: "repeat_checkin" });
    expect(await balance(db, "visitor", "v_alice")).toBe(10);

    const [next] = await run(qrCheckin("biz-1", later(24 * H)), alice, later(24 * H));
    expect(next!.status).toBe("verified");
    expect(await balance(db, "visitor", "v_alice")).toBe(20);
  });

  it("uses the Athens calendar day, not UTC", async () => {
    // 21:30 UTC = 23:30 Athens on the 27th; 22:30 UTC = 00:30 Athens on the 28th.
    const a = new Date("2026-11-27T21:30:00Z");
    const b = new Date("2026-11-27T22:30:00Z");
    await run(qrCheckin("biz-1", a), alice, b);
    const [r] = await run(qrCheckin("biz-1", b), alice, b);
    expect(r!.status).toBe("verified");
  });

  it("two visitors scanning the same QR both count", async () => {
    await run(qrCheckin("biz-1", NOW));
    await run(qrCheckin("biz-1", NOW), { kind: "visitor", visitorId: "v_bob" });
    expect(await balance(db, "member", "biz-1")).toBe(10);
  });
});

describe("QR verification", () => {
  it("rejects a forged token and stores the rejection", async () => {
    const ev = { ...qrCheckin("biz-1", NOW), payload: { qr_token: qr("biz-1").replace(/.$/, "A") } };
    const [r] = await run(ev);
    expect(r).toMatchObject({ status: "rejected", reason: "qr_bad_signature" });
    const stored = await db.query("SELECT status, reason FROM events WHERE event_id = $1", [ev.event_id]);
    expect(stored.rows[0]).toEqual({ status: "rejected", reason: "qr_bad_signature" });
    expect(await balance(db, "visitor", "v_alice")).toBe(0);
  });

  it("rejects an old code after the key is rotated", async () => {
    await db.query("UPDATE qr_targets SET key_version = 2 WHERE id = 'biz-1'");
    const [old] = await run(qrCheckin("biz-1", NOW));
    expect(old!.reason).toBe("qr_rotated");
    const [fresh] = await run({ ...qrCheckin("biz-1", NOW), payload: { qr_token: qr("biz-1", 2) } });
    expect(fresh!.status).toBe("verified");
  });

  it("rejects a scan whose phone location is far from the place", async () => {
    const [r] = await run({ ...qrCheckin("biz-1", NOW), geo: { lat: 38.0, lng: 23.7, accuracy_m: 10 } });
    expect(r!.reason).toBe("geo_too_far");
  });

  it("requires the phone's location when the place has coordinates", async () => {
    const { geo: _geo, ...noGeo } = qrCheckin("biz-1", NOW);
    expect((await run(noGeo))[0]!.reason).toBe("geo_required");
    const vague = { ...qrCheckin("biz-1", NOW), geo: { lat: 37.5546, lng: 22.0772, accuracy_m: 2000 } };
    expect((await run(vague))[0]!.reason).toBe("geo_inaccurate");
    expect(await balance(db, "visitor", "v_alice")).toBe(0);
  });

  it("uses the member's coordinates when the QR has none of its own", async () => {
    await db.query("UPDATE qr_targets SET lat = NULL, lng = NULL WHERE id = 'biz-1'");
    const [far] = await run({ ...qrCheckin("biz-1", NOW), geo: { lat: 38.0, lng: 23.7, accuracy_m: 10 } });
    expect(far!.reason).toBe("geo_too_far");
    const [near] = await run(qrCheckin("biz-1", NOW));
    expect(near!.status).toBe("verified");
  });

  it("rejects times in the future and scans older than 3 days", async () => {
    expect((await run(qrCheckin("biz-1", later(H))))[0]!.reason).toBe("time_in_future");
    expect((await run(qrCheckin("biz-1", later(-4 * 24 * H))))[0]!.reason).toBe("too_old");
    // An offline scan from yesterday is fine.
    expect((await run(qrCheckin("biz-1", later(-20 * H))))[0]!.status).toBe("verified");
  });

  it("rejects an invalid envelope", async () => {
    const [r] = await run({ event_id: "nope", type: "checkin.qr" });
    expect(r).toMatchObject({ status: "rejected", reason: "invalid_envelope" });
  });
});

describe("edge case 3: a visit shared by several members", () => {
  it("credits the visitor once and each co-host", async () => {
    await run(qrCheckin("exp-harvest", NOW));
    expect(await balance(db, "visitor", "v_alice")).toBe(10);
    expect(await balance(db, "member", "biz-1")).toBe(5);
    expect(await balance(db, "member", "biz-2")).toBe(5);
  });
});

describe("edge case 2: cancellation", () => {
  it("reverses points, revokes the passport entry and is audit-traceable", async () => {
    const ev = qrCheckin("biz-1", NOW);
    await run(ev);
    const cancel = { event_id: ulid(), type: "cancellation", occurred_at: NOW.toISOString(), refers_to_event_id: ev.event_id, payload: { note: "test scan" } };
    const [r] = await run(cancel, admin);
    expect(r!.status).toBe("verified");
    expect(await balance(db, "visitor", "v_alice")).toBe(0);
    expect(await balance(db, "member", "biz-1")).toBe(0);

    const orig = await db.query("SELECT status FROM events WHERE event_id = $1", [ev.event_id]);
    expect(orig.rows[0].status).toBe("cancelled");
    const live = await db.query("SELECT 1 FROM passport_entries WHERE event_id = $1 AND revoked_at IS NULL", [ev.event_id]);
    expect(live.rowCount).toBe(0);
    // Every reversal row points at the row it reverses.
    const rev = await db.query("SELECT count(*)::int AS n FROM ledger WHERE event_id = $1 AND reverses_id IS NOT NULL", [cancel.event_id]);
    expect(rev.rows[0].n).toBe(2);
  });

  it("cannot cancel twice, and only admins can cancel", async () => {
    const ev = qrCheckin("biz-1", NOW);
    await run(ev);
    const cancel = (id = ulid()) => ({ event_id: id, type: "cancellation", occurred_at: NOW.toISOString(), refers_to_event_id: ev.event_id });
    expect((await run(cancel(), alice))[0]!.reason).toBe("forbidden");
    await run(cancel(), admin);
    expect((await run(cancel(), admin))[0]!.reason).toBe("not_cancellable");
    expect(await balance(db, "visitor", "v_alice")).toBe(0);
  });

  it("frees the day so a genuine check-in can be recorded after a cancelled one", async () => {
    const ev = qrCheckin("biz-1", NOW);
    await run(ev);
    await run({ event_id: ulid(), type: "cancellation", occurred_at: NOW.toISOString(), refers_to_event_id: ev.event_id }, admin);
    const [r] = await run(qrCheckin("biz-1", later(H)), alice, later(H));
    expect(r!.status).toBe("verified");
    expect(await balance(db, "visitor", "v_alice")).toBe(10);
  });
});

describe("edge case 4: corrected event", () => {
  it("moves the member credit and keeps the visitor total", async () => {
    const ev = qrCheckin("biz-1", NOW);
    await run(ev);
    const fix = (id = ulid(), to = ["biz-3"]) => ({
      event_id: id,
      type: "correction",
      occurred_at: NOW.toISOString(),
      refers_to_event_id: ev.event_id,
      payload: { changes: { member_ids: to }, note: "QR was placed at the wrong shop" },
    });
    const [r] = await run(fix(), admin);
    expect(r!.status).toBe("verified");
    expect(await balance(db, "member", "biz-1")).toBe(0);
    expect(await balance(db, "member", "biz-3")).toBe(5);
    expect(await balance(db, "visitor", "v_alice")).toBe(10);

    // Correcting again replaces the first correction rather than stacking.
    await run(fix(ulid(), ["biz-2"]), admin);
    expect(await balance(db, "member", "biz-3")).toBe(0);
    expect(await balance(db, "member", "biz-2")).toBe(5);
    expect(await balance(db, "visitor", "v_alice")).toBe(10);

    // Cancelling the original also undoes the live correction.
    await run({ event_id: ulid(), type: "cancellation", occurred_at: NOW.toISOString(), refers_to_event_id: ev.event_id }, admin);
    expect(await balance(db, "member", "biz-2")).toBe(0);
    expect(await balance(db, "visitor", "v_alice")).toBe(0);
  });

  it("rejects unknown members", async () => {
    const ev = qrCheckin("biz-1", NOW);
    await run(ev);
    const [r] = await run(
      { event_id: ulid(), type: "correction", occurred_at: NOW.toISOString(), refers_to_event_id: ev.event_id, payload: { changes: { member_ids: ["biz-404"] } } },
      admin,
    );
    expect(r!.reason).toBe("unknown_member");
  });
});

describe("GPS check-in at a POI without a QR", () => {
  const geoCheckin = (geo: object, dwell = 180, id = ulid()) => ({
    event_id: id,
    type: "checkin.geo",
    occurred_at: NOW.toISOString(),
    poi_id: "poi-9",
    geo,
    payload: { dwell_seconds: dwell },
  });

  it("credits +3 when close, accurate and after a dwell", async () => {
    const [r] = await run(geoCheckin({ lat: 37.5502, lng: 22.0701, accuracy_m: 20 }));
    expect(r!.status).toBe("verified");
    expect(await balance(db, "visitor", "v_alice")).toBe(3);
  });

  it("rejects far, inaccurate or too-short visits", async () => {
    expect((await run(geoCheckin({ lat: 37.56, lng: 22.07, accuracy_m: 10 })))[0]!.reason).toBe("geo_too_far");
    expect((await run(geoCheckin({ lat: 37.5502, lng: 22.0701, accuracy_m: 120 })))[0]!.reason).toBe("geo_inaccurate");
    expect((await run(geoCheckin({ lat: 37.5502, lng: 22.0701, accuracy_m: 10 }, 30)))[0]!.reason).toBe("dwell_too_short");
  });

  it("QR and GPS at the same POI on the same day count once", async () => {
    await run(qrCheckin("poi-9", NOW));
    const [r] = await run(geoCheckin({ lat: 37.5502, lng: 22.0701, accuracy_m: 20 }));
    expect(r!.status).toBe("duplicate");
    expect(await balance(db, "visitor", "v_alice")).toBe(5);
  });
});

describe("referrals", () => {
  beforeEach(async () => {
    await db.query(
      "INSERT INTO referrals(id, code, from_member_id, to_member_id, expires_at) VALUES ('ref-1', 'WINE42', 'biz-1', 'biz-2', $1)",
      [later(30 * 24 * H)],
    );
  });

  it("a taverna sends a guest to the winery: referrer +10, host +5 extra, visitor +5 extra", async () => {
    const results = await run(qrCheckin("biz-2", NOW, { referral_code: "WINE42" }));
    expect(results.map((r) => r.type)).toEqual(["checkin.qr", "referral.redeemed"]);
    expect(await balance(db, "member", "biz-1")).toBe(10);
    expect(await balance(db, "member", "biz-2")).toBe(10);
    expect(await balance(db, "visitor", "v_alice")).toBe(15);
  });

  it("a referral pays once per visitor, and only at the referred member", async () => {
    await run(qrCheckin("biz-2", NOW, { referral_code: "WINE42" }));
    const again = await run(qrCheckin("biz-2", later(24 * H), { referral_code: "WINE42" }), alice, later(24 * H));
    expect(again).toHaveLength(1);
    const elsewhere = await run(qrCheckin("biz-1", NOW, { referral_code: "WINE42" }), { kind: "visitor", visitorId: "v_bob" });
    expect(elsewhere).toHaveLength(1);
  });

  it("cancelling the check-in also cancels the referral", async () => {
    const ev = qrCheckin("biz-2", NOW, { referral_code: "WINE42" });
    await run(ev);
    await run({ event_id: ulid(), type: "cancellation", occurred_at: NOW.toISOString(), refers_to_event_id: ev.event_id }, admin);
    expect(await balance(db, "member", "biz-1")).toBe(0);
    expect(await balance(db, "member", "biz-2")).toBe(0);
    expect(await balance(db, "visitor", "v_alice")).toBe(0);
  });
});

describe("route completion", () => {
  beforeEach(async () => {
    await db.query("INSERT INTO routes(id, name) VALUES ('route-wine', 'Wine and bridge walk')");
    await db.query("INSERT INTO route_stops(route_id, target_id, position) VALUES ('route-wine', 'biz-1', 0), ('route-wine', 'poi-9', 1)");
  });

  it("awards +30 and +5 per member once all stops are checked in", async () => {
    await run(qrCheckin("biz-1", NOW));
    const results = await run(qrCheckin("poi-9", later(H)), alice, later(H));
    expect(results.map((r) => r.type)).toEqual(["checkin.qr", "route.completed"]);
    expect(await balance(db, "visitor", "v_alice")).toBe(10 + 5 + 30);
    expect(await balance(db, "member", "biz-1")).toBe(5 + 5);
    const p = await db.query("SELECT kind FROM passport_entries WHERE visitor_id = 'v_alice' ORDER BY id");
    expect(p.rows.map((r) => r.kind)).toEqual(["checkin", "checkin", "route"]);

    // Completing it again on another day earns no second bonus.
    await run(qrCheckin("biz-1", later(25 * H)), alice, later(25 * H));
    expect(await balance(db, "visitor", "v_alice")).toBe(45 + 10); // a normal check-in, no second route bonus
  });

  it("cancelling a stop check-in takes the route bonus back", async () => {
    const first = qrCheckin("biz-1", NOW);
    await run(first);
    await run(qrCheckin("poi-9", later(H)), alice, later(H));
    await run({ event_id: ulid(), type: "cancellation", occurred_at: NOW.toISOString(), refers_to_event_id: first.event_id }, admin, later(2 * H));
    expect(await balance(db, "visitor", "v_alice")).toBe(5);
    expect(await balance(db, "member", "biz-1")).toBe(0);
  });
});
