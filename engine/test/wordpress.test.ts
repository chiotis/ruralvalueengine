import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db.js";
import { WpClient, type FetchFn } from "../src/wordpress/client.js";
import { normalise, type WpPost } from "../src/wordpress/normalise.js";
import { syncRuralGreece } from "../src/wordpress/sync.js";
import { buildApp } from "../src/app.js";
import { ConsoleMailer } from "../src/mailer.js";
import { cfg as pcfg, freshDb } from "./helpers.js";
import { business, media, poi, route } from "./fixtures/wp.js";
import { SAMPLE_KML } from "./fixtures/kml.js";

/** Fake WordPress: serves collections, single posts, terms and media from memory, and records URLs. */
function fakeWp(posts: Record<"business" | "route" | "pois", WpPost[]>) {
  const calls: URL[] = [];
  const respond = (body: unknown, totalPages = 1) => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "x-wp-totalpages" ? String(totalPages) : null) },
    json: async () => body,
  });
  const fetchFn: FetchFn = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const path = u.pathname.replace("/wp-json/wp/v2/", "");
    const [type, id] = path.split("/");
    if (type === "media") {
      const ids = (u.searchParams.get("include") ?? "").split(",").filter(Boolean).map(Number);
      return respond(ids.map(media));
    }
    if (type === "location") return respond(u.searchParams.get("page") === "1" ? [{ id: 793, name: "Αρκαδία", slug: "arkadia", parent: 0 }] : []);
    if (type === "business" || type === "route" || type === "pois") {
      const list = posts[type];
      if (id) {
        const p = list.find((x) => x.id === Number(id));
        return p ? respond(p) : { ...respond({}), ok: false, status: 404 };
      }
      // Two pages of one item each, to exercise pagination.
      const page = Number(u.searchParams.get("page"));
      return respond(list.slice(page - 1, page), Math.max(list.length, 1));
    }
    return respond([]);
  };
  return { client: new WpClient("https://ruralgreece.gr/", fetchFn), calls, posts };
}

let db: Db;
beforeEach(async () => {
  if (db) await db.end();
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

describe("normalise", () => {
  it("maps the real ACF fields of a business", () => {
    const r = normalise("business", business(17789, "37.55453447742308", "22.077115512433835", "Mpelleiko &amp; Co"));
    expect(r).toMatchObject({ id: "biz-17789", kind: "business", title_el: "Mpelleiko & Co", title_en: "Mpelleiko", lat: 37.55453447742308, lng: 22.077115512433835 });
    expect(r.data).toMatchObject({ telephone: "+30 2795081286", booking_url: null, body: { el: "<p>Μια ιστορία</p>", en: "<p>A story</p>" } });
    expect(r.term_ids.sort()).toEqual([151, 156, 455, 793]);
    expect(r.media_ids.sort()).toEqual([17796, 17797, 17798]);
  });

  it("drops bad coordinates and handles empty ACF", () => {
    const b = business(1, "", "22.1", "x");
    expect(normalise("business", b)).toMatchObject({ lat: null, lng: null });
    const empty = { ...poi, acf: [] };
    expect(normalise("pois", empty)).toMatchObject({ id: "poi-17531", lat: null, title_en: null });
  });

  it("decodes numeric entities in route titles and keeps the KML track", () => {
    const r = normalise("route", route);
    expect(r.title_el).toBe("Το Μονοπάτι των Στενών της Τσιγγάνας – Αξιός");
    expect(r.data.map_kml).toMatch(/\.kml$/);
    expect(r.data.duration).toEqual({ el: "3 ώρες", en: null });
  });
});

describe("syncRuralGreece", () => {
  it("full sync fills the catalogue, members, pois, routes, media and terms", async () => {
    const wp = fakeWp({ business: [business(17789, "37.5545", "22.0771", "Mpelleiko"), business(18000, "38.9", "23.9", "Far away")], route: [route], pois: [poi] });
    const report = await syncRuralGreece(db, wp.client, { full: true });
    expect(report.upserted).toEqual({ business: 2, route: 1, poi: 1 });
    expect(report.terms).toBe(1);
    expect((await db.query("SELECT id FROM members ORDER BY id")).rows.map((r) => r.id)).toEqual(["biz-17789", "biz-18000"]);
    expect((await db.query("SELECT id FROM pois")).rows.map((r) => r.id)).toEqual(["poi-17531"]);
    expect((await db.query("SELECT id FROM routes")).rows.map((r) => r.id)).toEqual(["route-17002"]);
    expect(Number((await db.query("SELECT count(*) FROM catalog_media")).rows[0].count)).toBeGreaterThan(0);
  });

  it("incremental sync asks only for recent changes, full sync marks removed posts", async () => {
    const wp = fakeWp({ business: [business(17789, "37.5545", "22.0771", "Mpelleiko")], route: [route], pois: [poi] });
    await syncRuralGreece(db, wp.client, { full: true });
    wp.calls.length = 0;
    await syncRuralGreece(db, wp.client);
    const bizCall = wp.calls.find((u) => u.pathname.endsWith("/business"))!;
    expect(bizCall.searchParams.get("modified_after")).toBe("2026-11-19T10:00:00.000Z");

    wp.posts.business = [];
    const report = await syncRuralGreece(db, wp.client, { full: true });
    expect(report.deleted).toBe(1);
    const row = await db.query("SELECT deleted_at FROM catalog_items WHERE id = 'biz-17789'");
    expect(row.rows[0].deleted_at).not.toBeNull();
  });
});

describe("catalogue API and webhook", () => {
  let app: FastifyInstance;
  let wp: ReturnType<typeof fakeWp>;
  const secret = "hook-secret";
  let kmlCalls: string[] = [];

  beforeEach(async () => {
    wp = fakeWp({ business: [business(17789, "37.5545", "22.0771", "Mpelleiko"), business(18000, "38.9", "23.9", "Far away")], route: [route], pois: [poi] });
    await syncRuralGreece(db, wp.client, { full: true });
    kmlCalls = [];
    app = buildApp(
      db,
      { databaseUrl: "", port: 0, jwtSecret: "j", qrKeys: pcfg.qrKeys, adminToken: "a", networkTz: "Europe/Athens", wpWebhookSecret: secret },
      new ConsoleMailer(false),
      {
        wpClient: wp.client,
        kmlFetch: async (url) => {
          kmlCalls.push(url);
          return Buffer.from(SAMPLE_KML);
        },
      },
    );
  });

  it("lists items by kind and language, and by distance", async () => {
    const all = (await app.inject({ url: "/v1/catalog/businesses?lang=en" })).json().items;
    expect(all.map((i: { title: string }) => i.title)).toEqual(["Mpelleiko", "Mpelleiko"]);
    const near = (await app.inject({ url: "/v1/catalog/businesses?near=37.555,22.078&radius_km=5" })).json().items;
    expect(near.map((i: { id: string }) => i.id)).toEqual(["biz-17789"]);
    expect(near[0].distance_km).toBeLessThan(1);
    expect(near[0].image.url).toMatch(/17798\.jpg$/);
    expect((await app.inject({ url: "/v1/catalog/nope" })).statusCode).toBe(404);
  });

  it("shows a route with nearby businesses and POIs", async () => {
    const r = (await app.inject({ url: "/v1/catalog/item/route-17002?lang=en" })).json();
    expect(r.title).toBe("The Tsigganas Trail");
    expect(r.duration).toBe("3 ώρες"); // falls back to Greek when English is empty
    expect(r.nearby.map((n: { id: string }) => n.id)).toEqual(["biz-17789", "poi-17531"]);
    expect(r.gallery).toHaveLength(2);
  });

  it("returns the route's KML as a simplified path with stops, and caches it", async () => {
    const r = (await app.inject({ url: "/v1/catalog/item/route-17002" })).json();
    expect(r.track.lines[0][0]).toEqual([41.0371, 22.5756]);
    expect(r.track.lines[0].length).toBeLessThanOrEqual(4);
    expect(r.track.stops).toEqual([{ name: "Πηγή & βρύση", lat: 41.0362, lng: 22.575 }]);
    await app.inject({ url: "/v1/catalog/item/route-17002?lang=en" });
    expect(kmlCalls).toEqual(["https://ruralgreece.gr/wp-content/uploads/kml/the-tsigganas-trail.kml"]);
    expect((await app.inject({ url: "/v1/catalog/item/biz-17789" })).json().track).toBeNull();
  });

  it("webhook refuses bad signatures and applies upserts and deletes", async () => {
    const send = (body: object, sig?: string) => {
      const raw = JSON.stringify(body);
      return app.inject({
        method: "POST",
        url: "/v1/webhooks/wordpress",
        headers: { "content-type": "application/json", "x-rve-signature": sig ?? createHmac("sha256", secret).update(raw).digest("hex") },
        payload: raw,
      });
    };
    expect((await send({ type: "business", id: 17789, action: "delete" }, "0".repeat(64))).statusCode).toBe(401);

    wp.posts.business[0] = { ...wp.posts.business[0]!, title: { rendered: "Mpelleiko (renamed)" } };
    expect((await send({ type: "business", id: 17789, action: "upsert" })).statusCode).toBe(200);
    expect((await db.query("SELECT name FROM members WHERE id = 'biz-17789'")).rows[0].name).toBe("Mpelleiko (renamed)");

    await send({ type: "business", id: 17789, action: "delete" });
    expect((await app.inject({ url: "/v1/catalog/item/biz-17789" })).statusCode).toBe(404);
  });
});
