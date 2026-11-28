import { test } from "node:test";
import assert from "node:assert/strict";
import { kmlToLatLngs } from "../src/lib/kml.ts";
import { htmlToParagraphs } from "../src/lib/html.ts";
import { describeOutcome } from "../src/lib/outcome.ts";
import { fillDays } from "../src/lib/days.ts";

test("kml: lng,lat[,alt] becomes [lat, lng], one line per LineString", () => {
  const kml = `<kml><Placemark><LineString><coordinates>
    22.1,39.5,100 22.2,39.6,110
  </coordinates></LineString></Placemark><Point><coordinates>22.3,39.7</coordinates></Point></kml>`;
  assert.deepEqual(kmlToLatLngs(kml), [[[39.5, 22.1], [39.6, 22.2]]]);
});

test("kml: longitudes wrapped past 180 come back to Greece", () => {
  const [[p]] = kmlToLatLngs("<kml><LineString><coordinates>382.54,40.98 382.55,40.99</coordinates></LineString></kml>");
  assert.equal(p![0], 40.98);
  assert.ok(Math.abs(p![1] - 22.54) < 1e-9);
});

test("html: paragraphs, line breaks and entities", () => {
  assert.deepEqual(htmlToParagraphs("<p>Καλώς <b>ήρθατε</b>&nbsp;!</p><p>A &amp; B<br>C</p>"), ["Καλώς ήρθατε !", "A & B\nC"]);
  assert.deepEqual(htmlToParagraphs(null), []);
});

test("outcome: sums visitor points and lists derived events", () => {
  const r = describeOutcome([
    { event_id: "e1", type: "checkin.qr", status: "verified", points: [{ owner_type: "visitor", owner_id: "v", points: 10 }, { owner_type: "member", owner_id: "m", points: 5 }] },
    { event_id: "e2", type: "route.completed", status: "verified", points: [{ owner_type: "visitor", owner_id: "v", points: 30 }] },
  ] as never);
  assert.deepEqual(r, { kind: "ok", points: 40, extra: ["route.completed"] });
  assert.deepEqual(describeOutcome(null), { kind: "queued" });
  assert.deepEqual(describeOutcome([{ status: "duplicate", points: [] }] as never), { kind: "duplicate" });
});

test("days: fills missing days with zero", () => {
  const out = fillDays([{ day: "2026-11-26", visits: 3 }], 3, new Date("2026-11-27T10:00:00Z"));
  assert.deepEqual(out, [
    { day: "2026-11-25", visits: 0 },
    { day: "2026-11-26", visits: 3 },
    { day: "2026-11-27", visits: 0 },
  ]);
});

test("qr: routes check-in and redemption codes, rejects others", async () => {
  const { parseQr, redeemQr } = await import("../src/lib/qr.ts");
  assert.deepEqual(parseQr("rve://c/abc.def"), { kind: "checkin", token: "rve://c/abc.def" });
  assert.deepEqual(parseQr(redeemQr("012345")), { kind: "redeem", code: "012345" });
  assert.deepEqual(parseQr("rve://r/12345"), { kind: "foreign" });
  assert.deepEqual(parseQr("WIFI:S:cafe;;"), { kind: "foreign" });
});

test("scan view: each outcome gets its own result screen", async () => {
  const { scanView } = await import("../src/lib/outcome.ts");
  assert.equal(scanView({ kind: "ok", points: 10, extra: [] }), "success");
  assert.equal(scanView({ kind: "duplicate" }), "duplicate");
  assert.equal(scanView({ kind: "queued" }), "queued");
  assert.equal(scanView({ kind: "rejected", reason: "geo_too_far" }), "too_far");
  assert.equal(scanView({ kind: "rejected", reason: "geo_required" }), "location");
  assert.equal(scanView({ kind: "rejected", reason: "geo_inaccurate" }), "location");
  assert.equal(scanView({ kind: "rejected", reason: "qr_bad_signature" }), "invalid");
  assert.equal(scanView({ kind: "rejected", reason: "qr_rotated" }), "invalid");
  assert.equal(scanView({ kind: "rejected", reason: "too_old" }), "other");
});

test("qr: check-in target id", async () => {
  const { checkinTarget } = await import("../src/lib/qr.ts");
  assert.equal(checkinTarget("rve://c/biz-123/1/abcDEF"), "biz-123");
  assert.equal(checkinTarget("rve://c/poi-9/2/x"), "poi-9");
  assert.equal(checkinTarget("rve://r/123456"), null);
  assert.equal(checkinTarget("rve://c/BAD id/1/x"), null);
});

test("points labels follow rules v1", async () => {
  const { pointsLabel, kindOfId } = await import("../src/lib/points.ts");
  assert.equal(pointsLabel("business"), "+10");
  assert.equal(pointsLabel("poi"), "+3–5");
  assert.equal(pointsLabel("route"), null);
  assert.equal(kindOfId("biz-1"), "business");
  assert.equal(kindOfId("pkg-1"), null);
});

test("points labels match the engine's rules v1", async () => {
  const { readFileSync } = await import("node:fs");
  const { VISITOR_POINTS } = await import("../src/lib/points.ts");
  const src = readFileSync(new URL("../../engine/src/rules/v1.ts", import.meta.url), "utf8");
  const v = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(src)?.[1]);
  assert.equal(VISITOR_POINTS.business, v("checkinMemberVisitor"));
  assert.equal(VISITOR_POINTS.poiQr, v("checkinPoiQr"));
  assert.equal(VISITOR_POINTS.poiGeo, v("checkinPoiGeo"));
  assert.equal(VISITOR_POINTS.packageCompleted, v("routeCompletedVisitor"));
});
