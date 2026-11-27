import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { ConsoleMailer } from "../src/mailer.js";
import { cfg as pcfg, freshDb } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
const mailer = new ConsoleMailer(false);
const ADMIN = { authorization: "Bearer admin-secret" };

beforeAll(async () => {
  db = await freshDb();
  app = buildApp(db, { databaseUrl: "", port: 0, jwtSecret: "jwt-test-secret", qrKeys: pcfg.qrKeys, adminToken: "admin-secret", networkTz: "Europe/Athens" }, mailer);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

async function login(email: string) {
  await app.inject({ method: "POST", url: "/v1/auth/email/start", payload: { email } });
  const code = mailer.sent.filter((m) => m.email === email.toLowerCase()).at(-1)!.code;
  const res = await app.inject({ method: "POST", url: "/v1/auth/email/verify", payload: { email, code } });
  expect(res.statusCode).toBe(200);
  return res.json() as { visitor_id: string; access_token: string; refresh_token: string };
}

describe("passwordless email login", () => {
  it("logs in with a 6-digit code and keeps the same visitor on next login", async () => {
    const a = await login("Maria@Example.com");
    expect(a.visitor_id).toMatch(/^v_/);
    const b = await login("maria@example.com");
    expect(b.visitor_id).toBe(a.visitor_id);
  });

  it("rejects a wrong code and locks after too many attempts", async () => {
    await app.inject({ method: "POST", url: "/v1/auth/email/start", payload: { email: "nikos@example.com" } });
    const real = mailer.sent.at(-1)!.code;
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/v1/auth/email/verify", payload: { email: "nikos@example.com", code: wrong } });
      expect(r.json().error).toBe("code_invalid");
    }
    const locked = await app.inject({ method: "POST", url: "/v1/auth/email/verify", payload: { email: "nikos@example.com", code: real } });
    expect(locked.statusCode).toBe(429);
  });

  it("rotates refresh tokens", async () => {
    const a = await login("eleni@example.com");
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh_token: a.refresh_token } });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh_token: a.refresh_token } });
    expect(r2.statusCode).toBe(401);
  });
});

describe("end to end: admin sets up a QR, visitor scans it", () => {
  it("returns points in the wallet and the visit in the passport", async () => {
    const m = await app.inject({ method: "PUT", url: "/v1/admin/members/biz-17789", headers: ADMIN, payload: { name: "Mpelleiko", wp_id: 17789, lat: 37.5545, lng: 22.0771 } });
    expect(m.statusCode).toBe(200);
    const q = await app.inject({ method: "PUT", url: "/v1/admin/qr-targets/biz-17789", headers: ADMIN, payload: { kind: "member", member_ids: ["biz-17789"], lat: 37.5545, lng: 22.0771 } });
    const { qr } = q.json() as { qr: string };
    expect(qr).toMatch(/^rve:\/\/c\/biz-17789\/1\//);

    const v = await login("visitor@example.com");
    const auth = { authorization: `Bearer ${v.access_token}` };
    const ev = { event_id: ulid(), type: "checkin.qr", occurred_at: new Date().toISOString(), geo: { lat: 37.5546, lng: 22.0772, accuracy_m: 12 }, payload: { qr_token: qr } };
    const r = await app.inject({ method: "POST", url: "/v1/events", headers: auth, payload: { events: [ev, ev] } });
    expect(r.json().results.map((x: { status: string }) => x.status)).toEqual(["verified", "already_received"]);

    const w = await app.inject({ method: "GET", url: "/v1/me/wallet", headers: auth });
    expect(w.json().balance).toBe(10);
    const p = await app.inject({ method: "GET", url: "/v1/me/passport", headers: auth });
    expect(p.json().entries).toHaveLength(1);
    const mw = await app.inject({ method: "GET", url: "/v1/admin/members/biz-17789/wallet", headers: ADMIN });
    expect(mw.json().balance).toBe(5);
  });

  it("protects visitor and admin endpoints", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me/wallet" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/wallet", headers: { authorization: "Bearer junk" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/members/x", payload: { name: "x" } })).statusCode).toBe(401);
  });
});
