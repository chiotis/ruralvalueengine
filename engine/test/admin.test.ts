import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ConsoleMailer, loginCodeMessage } from "../src/mailer.js";
import { RateLimiter } from "../src/ratelimit.js";
import { cfg as pcfg, freshDb, qr, seed } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
const ADMIN = { authorization: "Bearer admin-secret" };

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  app = buildApp(db, { databaseUrl: "", port: 0, jwtSecret: "jwt", qrKeys: pcfg.qrKeys, adminToken: "admin-secret", networkTz: "Europe/Athens" }, new ConsoleMailer(false));
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe("admin panel API", () => {
  it("serves the panel with a strict content security policy", async () => {
    const page = await app.inject({ url: "/admin" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(page.body).toContain("/admin/app.js");
    expect((await app.inject({ url: "/admin/app.js" })).headers["content-type"]).toContain("javascript");
    // The panel itself is public; its data is not.
    expect((await app.inject({ url: "/v1/admin/overview" })).statusCode).toBe(401);
  });

  it("shows an overview and lists members with their QR state", async () => {
    const o = (await app.inject({ url: "/v1/admin/overview", headers: ADMIN })).json();
    expect(o).toMatchObject({ members: 3, members_without_qr: 1, pois: 1 });
    const m = (await app.inject({ url: "/v1/admin/members?q=tav", headers: ADMIN })).json().members;
    expect(m).toEqual([expect.objectContaining({ id: "biz-1", name: "Taverna", qr_target: "biz-1", points: 0 })]);
  });

  it("creates the missing member QR codes in bulk and renders them as SVG", async () => {
    const r = (await app.inject({ method: "POST", url: "/v1/admin/qr-targets/bulk-members", headers: ADMIN, payload: {} })).json();
    expect(r.created).toBe(1); // only the cheese maker had none
    const again = (await app.inject({ method: "POST", url: "/v1/admin/qr-targets/bulk-members", headers: ADMIN, payload: {} })).json();
    expect(again.created).toBe(0);

    const list = (await app.inject({ url: "/v1/admin/qr-targets", headers: ADMIN })).json().qr_targets;
    const cheese = list.find((t: { id: string }) => t.id === "biz-3");
    expect(cheese).toMatchObject({ kind: "member", label: "Cheese maker", key_version: 2 });
    expect(list.find((t: { id: string }) => t.id === "exp-harvest").label).toBe("Taverna + Winery");

    const svg = await app.inject({ url: "/v1/admin/qr-targets/biz-3/svg", headers: ADMIN });
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    expect(svg.body).toMatch(/^<svg/);
    expect((await app.inject({ url: "/v1/admin/qr-targets/nope/svg", headers: ADMIN })).statusCode).toBe(404);
  });

  it("lists events with their points and lets ETAM cancel one", async () => {
    const id = ulid();
    await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: ADMIN,
      payload: { event_id: id, type: "checkin.qr", occurred_at: new Date().toISOString(), visitor_id: "v_bob", payload: { qr_token: qr("biz-2") } },
    });
    const ev = (await app.inject({ url: "/v1/admin/events?member_id=biz-2", headers: ADMIN })).json().events;
    expect(ev[0]).toMatchObject({ event_id: id, status: "verified", points: 15 });

    await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: ADMIN,
      payload: { event_id: ulid(), type: "cancellation", occurred_at: new Date().toISOString(), refers_to_event_id: id, payload: { note: "test" } },
    });
    const after = (await app.inject({ url: `/v1/admin/events?status=cancelled`, headers: ADMIN })).json().events;
    expect(after.map((e: { event_id: string }) => e.event_id)).toContain(id);
  });

  it("lists packages, rewards and partnerships, and reports when sync isn't configured", async () => {
    await app.inject({ method: "PUT", url: "/v1/admin/packages/tasting", headers: ADMIN, payload: { title_el: "Γευσιγνωσία", stops: ["biz-1", "biz-2"] } });
    await app.inject({ method: "PUT", url: "/v1/admin/rewards/net-tote", headers: ADMIN, payload: { title_el: "Τσάντα", cost: 50 } });
    expect((await app.inject({ url: "/v1/admin/packages", headers: ADMIN })).json().packages[0]).toMatchObject({ id: "tasting", stops: ["biz-1", "biz-2"], active: true });
    expect((await app.inject({ url: "/v1/admin/rewards", headers: ADMIN })).json().rewards[0]).toMatchObject({ id: "net-tote", member_name: null, redeemed: 0 });
    expect((await app.inject({ url: "/v1/admin/partnerships", headers: ADMIN })).json().partnerships).toEqual([]);
    const s = await app.inject({ method: "POST", url: "/v1/admin/sync", headers: ADMIN, payload: { full: false } });
    expect(s.json().error).toBe("sync_not_configured");
  });
});

describe("hardening", () => {
  it("rate limits failed admin tokens per IP", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await app.inject({ url: "/v1/admin/overview", headers: { authorization: "Bearer wrong" }, remoteAddress: "10.0.0.9" })).statusCode;
    expect(last).toBe(429);
    // The right token still works from that address.
    expect((await app.inject({ url: "/v1/admin/overview", headers: ADMIN, remoteAddress: "10.0.0.9" })).statusCode).toBe(200);
  });

  it("rate limits login code requests per IP across many emails", async () => {
    let last = 0;
    for (let i = 0; i < 22; i++) {
      last = (await app.inject({ method: "POST", url: "/v1/auth/email/start", payload: { email: `spam${i}@example.com` }, remoteAddress: "10.0.0.7" })).statusCode;
    }
    expect(last).toBe(429);
  });

  it("sets basic security headers", async () => {
    const r = await app.inject({ url: "/health" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });

  it("refuses weak secrets at start-up", () => {
    const ok = { DATABASE_URL: "postgres://x", JWT_SECRET: "j".repeat(32), ADMIN_TOKEN: "a".repeat(24), QR_KEYS: JSON.stringify({ "1": "k".repeat(16) }) };
    expect(loadConfig(ok).trustProxy).toBe(false);
    expect(() => loadConfig({ ...ok, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...ok, ADMIN_TOKEN: "short" })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ ...ok, QR_KEYS: JSON.stringify({ v1: "k".repeat(16) }) })).toThrow(/QR_KEYS/);
  });

  it("rate limiter resets after its window", () => {
    const l = new RateLimiter(2, 1000);
    expect([l.hit("a", 0), l.hit("a", 1), l.hit("a", 2)]).toEqual([true, true, false]);
    expect(l.hit("a", 1001)).toBe(true);
  });

  it("login email carries the code in Greek and English", () => {
    const m = loginCodeMessage("042917");
    expect(m.subject).toContain("042917");
    expect(m.text).toContain("Ο κωδικός σύνδεσής σας");
    expect(m.text).toContain("Your Rural Greece login code is: 042917");
  });
});
