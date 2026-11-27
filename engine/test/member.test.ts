import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { ConsoleMailer } from "../src/mailer.js";
import { scoreFromInputs } from "../src/score.js";
import { cfg as pcfg, freshDb, qr, qrCheckin } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let mailer: ConsoleMailer;
const ADMIN = { authorization: "Bearer admin-secret" };

beforeEach(async () => {
  if (app) await app.close();
  if (db) await db.end();
  db = await freshDb();
  mailer = new ConsoleMailer(false);
  app = buildApp(db, { databaseUrl: "", port: 0, jwtSecret: "jwt", qrKeys: pcfg.qrKeys, adminToken: "admin-secret", networkTz: "Europe/Athens" }, mailer);

  // Three members as synced from ruralgreece.gr: a taverna and a winery close together, a far hotel.
  const biz = (id: string, name: string, email: string, lat: number, lng: number, types: number[]) =>
    db.query(
      `INSERT INTO catalog_items(id, kind, wp_id, slug, title_el, lat, lng, term_ids, data, wp_modified)
       VALUES ($1, 'business', $2, $1, $3, $4, $5, $6, $7, now())`,
      [id, Number(id.split("-")[1]), name, lat, lng, types, JSON.stringify({ email, taxonomies: { "business-type": types, location: [793] } })],
    ).then(() => db.query("INSERT INTO members(id, wp_id, name, lat, lng) VALUES ($1, $2, $3, $4, $5)", [id, Number(id.split("-")[1]), name, lat, lng]));
  await biz("biz-1", "Taverna", "taverna@example.gr", 37.5545, 22.0771, [151]);
  await biz("biz-2", "Winery", "wine@example.gr", 37.56, 22.08, [160]);
  await biz("biz-3", "Hotel far away", "hotel@example.gr", 39.6, 20.8, [170]);
  for (const id of ["biz-1", "biz-2", "biz-3"]) {
    await app.inject({ method: "PUT", url: `/v1/admin/qr-targets/${id}`, headers: ADMIN, payload: { kind: "member", member_ids: [id] } });
  }
});
afterAll(async () => {
  await app?.close();
  await db?.end();
});

async function memberLogin(email: string) {
  await app.inject({ method: "POST", url: "/v1/member/auth/email/start", payload: { email } });
  const sent = mailer.sent.filter((m) => m.email === email).at(-1);
  if (!sent) return null;
  const r = await app.inject({ method: "POST", url: "/v1/member/auth/email/verify", payload: { email, code: sent.code } });
  return r.json() as { members: string[]; access_token: string };
}
async function visitorLogin(email: string) {
  await app.inject({ method: "POST", url: "/v1/auth/email/start", payload: { email } });
  const code = mailer.sent.filter((m) => m.email === email).at(-1)!.code;
  const r = (await app.inject({ method: "POST", url: "/v1/auth/email/verify", payload: { email, code } })).json();
  return { authorization: `Bearer ${r.access_token}` };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const scan = (auth: object, target: string, extra: object = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/events",
    headers: auth,
    payload: qrCheckin(target, new Date(), extra),
  });

describe("member login", () => {
  it("lets the business email from ruralgreece.gr log in, and nobody else", async () => {
    const s = await memberLogin("taverna@example.gr");
    expect(s!.members).toEqual(["biz-1"]);
    expect(await memberLogin("stranger@example.com")).toBeNull(); // no code is even sent
    const me = await app.inject({ url: "/v1/member/me", headers: bearer(s!.access_token) });
    expect(me.json().members[0].name).toBe("Taverna");
  });

  it("ETAM can add a second email; one email can manage several members", async () => {
    await app.inject({ method: "PUT", url: "/v1/admin/member-users", headers: ADMIN, payload: { email: "owner@example.gr", member_id: "biz-1" } });
    await app.inject({ method: "PUT", url: "/v1/admin/member-users", headers: ADMIN, payload: { email: "owner@example.gr", member_id: "biz-2" } });
    const s = await memberLogin("owner@example.gr");
    expect(s!.members).toEqual(["biz-1", "biz-2"]);
    const noPick = await app.inject({ url: "/v1/member/dashboard", headers: bearer(s!.access_token) });
    expect(noPick.json().error).toBe("member_id_required");
    const other = await app.inject({ url: "/v1/member/dashboard?member_id=biz-3", headers: bearer(s!.access_token) });
    expect(other.statusCode).toBe(403);
  });

  it("a visitor token does not open the member area", async () => {
    const v = await visitorLogin("v@example.com");
    expect((await app.inject({ url: "/v1/member/dashboard", headers: v })).statusCode).toBe(401);
  });
});

describe("member dashboard, QR and referrals", () => {
  it("creates a referral code that pays out when the guest checks in at the partner", async () => {
    const taverna = (await memberLogin("taverna@example.gr"))!;
    const ref = (await app.inject({ method: "POST", url: "/v1/member/referrals", headers: bearer(taverna.access_token), payload: { to_member_id: "biz-2" } })).json();
    expect(ref.code).toMatch(/^[A-Z2-9]{8}$/);

    const v = await visitorLogin("guest@example.com");
    const r = (await scan(v, "biz-2", { referral_code: ref.code })).json();
    expect(r.results.map((x: { type: string }) => x.type)).toEqual(["checkin.qr", "referral.redeemed"]);

    const dash = (await app.inject({ url: "/v1/member/dashboard", headers: bearer(taverna.access_token) })).json();
    expect(dash.points).toBe(10);
    expect(dash.last_30_days.referrals_sent).toBe(1);
    const list = (await app.inject({ url: "/v1/member/referrals", headers: bearer(taverna.access_token) })).json();
    expect(list.referrals[0]).toMatchObject({ redeemed: 1, from_name: "Taverna" });

    const qrs = (await app.inject({ url: "/v1/member/qr", headers: bearer(taverna.access_token) })).json();
    expect(qrs.qr_codes[0].qr).toMatch(/^rve:\/\/c\/biz-1\//);
  });
});

describe("epaithros Connect partnerships", () => {
  it("needs the other member to confirm, pays +20 each once, and blocks duplicates", async () => {
    const taverna = (await memberLogin("taverna@example.gr"))!;
    const winery = (await memberLogin("wine@example.gr"))!;
    const req = (await app.inject({ method: "POST", url: "/v1/member/partnerships", headers: bearer(taverna.access_token), payload: { partner_id: "biz-2", note: "Wine pairing evenings" } })).json();
    expect(req.status).toBe("pending");
    const dup = await app.inject({ method: "POST", url: "/v1/member/partnerships", headers: bearer(winery.access_token), payload: { partner_id: "biz-1" } });
    expect(dup.statusCode).toBe(409);

    const self = await app.inject({ method: "POST", url: `/v1/member/partnerships/${req.id}/confirm`, headers: bearer(taverna.access_token) });
    expect(self.statusCode).toBe(403);
    const ok = (await app.inject({ method: "POST", url: `/v1/member/partnerships/${req.id}/confirm`, headers: bearer(winery.access_token) })).json();
    expect(ok.status).toBe("active");

    const t = (await app.inject({ url: "/v1/member/dashboard", headers: bearer(taverna.access_token) })).json();
    expect(t.points).toBe(20);
    expect(t.active_partners).toBe(1);
    const list = (await app.inject({ url: "/v1/member/partnerships", headers: bearer(winery.access_token) })).json();
    expect(list.partnerships[0]).toMatchObject({ partner_id: "biz-1", partner_name: "Taverna", status: "active" });
  });
});

describe("matchmaking", () => {
  it("suggests nearby complementary members with reasons, and skips far or existing partners", async () => {
    const taverna = (await memberLogin("taverna@example.gr"))!;
    const v = await visitorLogin("guest@example.com");
    await scan(v, "biz-1");
    await scan(v, "biz-2");
    const m = (await app.inject({ url: "/v1/member/matches", headers: bearer(taverna.access_token) })).json().matches;
    expect(m.map((x: { member_id: string }) => x.member_id)).toEqual(["biz-2"]);
    expect(m[0].reasons).toEqual(expect.arrayContaining(["complementary business type", "same area", "1 shared visitor"]));

    await app.inject({ method: "POST", url: "/v1/member/partnerships", headers: bearer(taverna.access_token), payload: { partner_id: "biz-2" } });
    const after = (await app.inject({ url: "/v1/member/matches", headers: bearer(taverna.access_token) })).json().matches;
    expect(after).toEqual([]);
  });
});

describe("rewards", () => {
  it("visitor redeems with a code the member confirms; points move only then, and never below zero", async () => {
    const taverna = (await memberLogin("taverna@example.gr"))!;
    await app.inject({ method: "PUT", url: "/v1/member/rewards/free-coffee", headers: bearer(taverna.access_token), payload: { title_el: "Δωρεάν καφές", title_en: "Free coffee", cost: 15 } });
    const v = await visitorLogin("guest@example.com");

    const tooPoor = await app.inject({ method: "POST", url: "/v1/me/redemptions", headers: v, payload: { reward_id: "free-coffee" } });
    expect(tooPoor.json().error).toBe("not_enough_points");

    await scan(v, "biz-1");
    await scan(v, "biz-2"); // 20 points
    const listed = (await app.inject({ url: "/v1/rewards?lang=en" })).json().rewards;
    expect(listed[0]).toMatchObject({ id: "free-coffee", title: "Free coffee", cost: 15, member_name: "Taverna" });
    const own = (await app.inject({ url: "/v1/member/rewards", headers: bearer(taverna.access_token) })).json().rewards;
    expect(own).toEqual([{ id: "free-coffee", title_el: "Δωρεάν καφές", title_en: "Free coffee", cost: 15, active: true }]);

    const r1 = (await app.inject({ method: "POST", url: "/v1/me/redemptions", headers: v, payload: { reward_id: "free-coffee" } })).json();
    const r2 = (await app.inject({ method: "POST", url: "/v1/me/redemptions", headers: v, payload: { reward_id: "free-coffee" } })).json();
    expect((await app.inject({ url: "/v1/me/wallet", headers: v })).json().balance).toBe(20);

    const winery = (await memberLogin("wine@example.gr"))!;
    const wrong = await app.inject({ method: "POST", url: "/v1/member/redemptions/confirm", headers: bearer(winery.access_token), payload: { code: r1.code } });
    expect(wrong.statusCode).toBe(403);

    const ok = await app.inject({ method: "POST", url: "/v1/member/redemptions/confirm", headers: bearer(taverna.access_token), payload: { code: r1.code } });
    expect(ok.json().status).toBe("confirmed");
    expect((await app.inject({ url: "/v1/me/wallet", headers: v })).json().balance).toBe(5);

    // The second request was made while the visitor had 20; at confirm time they only have 5.
    const second = await app.inject({ method: "POST", url: "/v1/member/redemptions/confirm", headers: bearer(taverna.access_token), payload: { code: r2.code } });
    expect(second.json().error).toBe("not_enough_points");
    const again = await app.inject({ method: "POST", url: "/v1/member/redemptions/confirm", headers: bearer(taverna.access_token), payload: { code: r1.code } });
    expect(again.statusCode).toBe(404);
  });
});

describe("packages", () => {
  it("shows a package and the visitor's progress, then pays the completion bonus", async () => {
    await app.inject({
      method: "PUT",
      url: "/v1/admin/packages/pkg-taste",
      headers: ADMIN,
      payload: { title_el: "Γεύσεις της Αρκαδίας", title_en: "Tastes of Arcadia", description: { en: "Lunch, then wine." }, stops: ["biz-1", "biz-2"] },
    });
    const list = (await app.inject({ url: "/v1/packages?lang=en" })).json().packages;
    expect(list[0]).toMatchObject({ id: "pkg-taste", title: "Tastes of Arcadia", description: "Lunch, then wine." });
    expect(list[0].stops.map((s: { name: string }) => s.name)).toEqual(["Taverna", "Winery"]);

    const v = await visitorLogin("guest@example.com");
    await scan(v, "biz-1");
    let p = (await app.inject({ url: "/v1/me/progress/pkg-taste", headers: v })).json();
    expect(p).toMatchObject({ done: 1, total: 2, completed_at: null });
    const r = (await scan(v, "biz-2")).json();
    expect(r.results.map((x: { type: string }) => x.type)).toContain("route.completed");
    p = (await app.inject({ url: "/v1/me/progress/pkg-taste", headers: v })).json();
    expect(p.done).toBe(2);
    expect(p.completed_at).not.toBeNull();
    expect((await app.inject({ url: "/v1/me/wallet", headers: v })).json().balance).toBe(50);
  });
});

describe("Impact Score and analytics", () => {
  it("maps raw activity to 0-100 on a log scale", () => {
    expect(scoreFromInputs({ visitors: 0, referrals_sent: 0, referrals_received: 0, partnerships: 0, routes_completed: 0 }).score).toBe(0);
    expect(scoreFromInputs({ visitors: 10, referrals_sent: 2, referrals_received: 0, partnerships: 1, routes_completed: 0 })).toEqual({ raw: 21, score: 58 });
    expect(scoreFromInputs({ visitors: 500, referrals_sent: 0, referrals_received: 0, partnerships: 0, routes_completed: 0 }).score).toBe(100);
  });

  it("counts real activity and shows where visitors also go", async () => {
    for (const e of ["a@x.gr", "b@x.gr", "c@x.gr"]) {
      const v = await visitorLogin(e);
      await scan(v, "biz-1");
      if (e !== "c@x.gr") await scan(v, "biz-2");
    }
    const s = (await app.inject({ url: "/v1/members/biz-1/score" })).json();
    expect(s.inputs.visitors).toBe(3);
    expect(s.score).toBeGreaterThan(0);

    const taverna = (await memberLogin("taverna@example.gr"))!;
    const a = (await app.inject({ url: "/v1/member/analytics?days=7", headers: bearer(taverna.access_token) })).json();
    expect(a.unique_visitors).toBe(3);
    expect(a.visits_per_day.reduce((n: number, d: { visits: number }) => n + d.visits, 0)).toBe(3);
    expect(a.visitors_also_visited).toEqual([{ member_id: "biz-2", name: "Winery", shared_visitors: 2 }]);

    const admin = (await app.inject({ url: "/v1/admin/analytics", headers: ADMIN })).json();
    expect(admin.totals.active_visitors).toBe(3);
    expect(admin.top_members[0]).toMatchObject({ member_id: "biz-1", visits: 3 });
  });
});
