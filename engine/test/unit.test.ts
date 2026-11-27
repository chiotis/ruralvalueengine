import { describe, expect, it } from "vitest";
import { makeQrToken, verifyQrToken } from "../src/qr.js";
import { rulesV1 } from "../src/rules/v1.js";
import { distanceMeters, localDay } from "../src/geo.js";

const keys = { "1": "k1", "2": "k2" };

describe("QR tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = makeQrToken(keys, "biz-17789", 1);
    expect(verifyQrToken(keys, t)).toEqual({ ok: true, target: "biz-17789", version: 1 });
    expect(verifyQrToken(keys, t.replace("biz-17789", "biz-17788"))).toEqual({ ok: false, reason: "qr_bad_signature" });
    expect(verifyQrToken(keys, t.replace("/1/", "/3/"))).toEqual({ ok: false, reason: "qr_unknown_key" });
    expect(verifyQrToken(keys, "https://example.com")).toEqual({ ok: false, reason: "qr_malformed" });
  });
});

describe("rules v1", () => {
  const base = { event_id: "e", visitor_id: "v", member_ids: [] as string[], target_kind: null, referral: null };
  it("credits a member check-in to visitor and each co-host", () => {
    const rows = rulesV1({ ...base, type: "checkin.qr", target_kind: "shared", member_ids: ["a", "b", "a"] });
    expect(rows).toEqual([
      { owner_type: "visitor", owner_id: "v", points: 10, rule_id: "checkin.member.visitor" },
      { owner_type: "member", owner_id: "a", points: 5, rule_id: "checkin.member.host" },
      { owner_type: "member", owner_id: "b", points: 5, rule_id: "checkin.member.host" },
    ]);
  });
  it("gives POI QR 5 and POI GPS 3, interactions nothing", () => {
    expect(rulesV1({ ...base, type: "checkin.qr", target_kind: "poi" })[0]!.points).toBe(5);
    expect(rulesV1({ ...base, type: "checkin.geo", target_kind: "poi" })[0]!.points).toBe(3);
    expect(rulesV1({ ...base, type: "interaction.view" })).toEqual([]);
  });
});

describe("geo", () => {
  it("measures distance and local day", () => {
    expect(Math.round(distanceMeters({ lat: 37.55, lng: 22.07 }, { lat: 37.551, lng: 22.07 }))).toBe(111);
    // 22:30 UTC on 27 Nov is already 28 Nov in Athens (UTC+2).
    expect(localDay(new Date("2026-11-27T22:30:00Z"), "Europe/Athens")).toBe("2026-11-28");
  });
});
