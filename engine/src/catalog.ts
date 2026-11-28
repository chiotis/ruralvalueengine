import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
import type { WpClient } from "./wordpress/client.js";
import { markDeleted, syncOne } from "./wordpress/sync.js";
import { routeTrack, type KmlFetch } from "./kml.js";

const KINDS = { businesses: "business", routes: "route", pois: "poi" } as const;

// Great-circle distance in km between a row's (lat, lng) and the given placeholders.
const distKm = (lat: string, lng: string) =>
  `(6371 * 2 * asin(sqrt(power(sin(radians(lat - ${lat}::float8) / 2), 2) + cos(radians(${lat}::float8)) * cos(radians(lat)) * power(sin(radians(lng - ${lng}::float8) / 2), 2))))`;
const DIST_KM = distKm("$1", "$2");

interface Item {
  id: string;
  kind: string;
  title_el: string;
  title_en: string | null;
  lat: number | null;
  lng: number | null;
  term_ids: number[];
  data: Record<string, unknown>;
  link: string | null;
  distance_km?: number;
}

function pick<T extends { el: unknown; en: unknown }>(v: T | undefined, lang: "el" | "en") {
  if (!v) return null;
  return (lang === "en" ? (v.en ?? v.el) : (v.el ?? v.en)) ?? null;
}

async function mediaUrls(db: Db, ids: number[]): Promise<Map<number, { url: string; sizes: unknown }>> {
  if (!ids.length) return new Map();
  const rows = await db.query<{ id: number; source_url: string; sizes: unknown }>("SELECT id, source_url, sizes FROM catalog_media WHERE id = ANY($1)", [ids]);
  return new Map(rows.rows.map((r) => [r.id, { url: r.source_url, sizes: r.sizes }]));
}

function summary(it: Item, lang: "el" | "en", media: Map<number, { url: string; sizes: unknown }>) {
  const img = (it.data.featured_media as number | null) ?? (it.data.banner_image as number | null);
  return {
    id: it.id,
    kind: it.kind,
    title: lang === "en" ? (it.title_en ?? it.title_el) : it.title_el,
    subtitle: pick(it.data.subtitle as { el: unknown; en: unknown }, lang),
    lat: it.lat,
    lng: it.lng,
    term_ids: it.term_ids,
    image: img ? (media.get(img) ?? null) : null,
    ...(it.distance_km != null ? { distance_km: Math.round(it.distance_km * 10) / 10 } : {}),
  };
}

export function registerCatalog(app: FastifyInstance, db: Db, opts: { wpClient?: WpClient; webhookSecret?: string; kmlFetch?: KmlFetch }) {
  const Lang = z.enum(["el", "en"]).default("el");

  app.get<{ Params: { kind: string } }>("/v1/catalog/:kind", async (req, reply) => {
    const kind = KINDS[req.params.kind as keyof typeof KINDS];
    if (!kind) return reply.status(404).send({ error: "unknown_kind" });
    const q = z
      .object({
        lang: Lang,
        term: z.coerce.number().int().optional(),
        q: z.string().max(100).optional(),
        near: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
        radius_km: z.coerce.number().positive().max(200).default(20),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    // Postgres needs every $n to be used, so placeholders are numbered as they are added.
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = [`kind = ${p(kind)}`, "deleted_at IS NULL"];
    let dist = "NULL::float";
    if (q.near) {
      const [lat, lng] = q.near.split(",").map(Number);
      dist = distKm(p(lat), p(lng));
      where.push(`lat IS NOT NULL AND ${dist} <= ${p(q.radius_km)}`);
    }
    if (q.term) where.push(`${p(q.term)} = ANY(term_ids)`);
    if (q.q) {
      const like = p(`%${q.q}%`);
      where.push(`(title_el ILIKE ${like} OR title_en ILIKE ${like})`);
    }
    const rows = await db.query<Item>(
      `SELECT id, kind, title_el, title_en, lat, lng, term_ids, data, link, ${dist} AS distance_km
         FROM catalog_items
        WHERE ${where.join(" AND ")}
        ORDER BY ${q.near ? "distance_km" : "title_el"}, id
        LIMIT ${p(q.limit)} OFFSET ${p(q.offset)}`,
      params,
    );
    const media = await mediaUrls(db, rows.rows.map((r) => (r.data.featured_media as number) ?? (r.data.banner_image as number)).filter(Boolean));
    return { items: rows.rows.map((r) => summary({ ...r, distance_km: r.distance_km ?? undefined }, q.lang, media)) };
  });

  app.get<{ Params: { id: string } }>("/v1/catalog/item/:id", async (req, reply) => {
    const { lang, radius_km } = z.object({ lang: Lang, radius_km: z.coerce.number().positive().max(50).default(10) }).parse(req.query);
    const it = (
      await db.query<Item>("SELECT id, kind, title_el, title_en, lat, lng, term_ids, data, link FROM catalog_items WHERE id = $1 AND deleted_at IS NULL", [req.params.id])
    ).rows[0];
    if (!it) return reply.status(404).send({ error: "not_found" });

    const d = it.data;
    const gallery = (d.photo_gallery as number[]) ?? [];
    const media = await mediaUrls(db, [d.featured_media as number, d.banner_image as number, ...gallery].filter(Boolean));
    const terms = await db.query<{ taxonomy: string; id: number; name: string; slug: string }>(
      "SELECT taxonomy, id, name, slug FROM catalog_terms WHERE id = ANY($1)",
      [it.term_ids],
    );
    const localised: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) {
      if (v && typeof v === "object" && !Array.isArray(v) && "el" in v && "en" in v) localised[k] = pick(v as { el: unknown; en: unknown }, lang);
    }

    // Routes list the businesses and POIs near them, as on ruralgreece.gr.
    let nearby: unknown[] = [];
    if (it.lat != null && it.lng != null) {
      const rows = await db.query<Item>(
        `SELECT id, kind, title_el, title_en, lat, lng, term_ids, data, link, ${DIST_KM} AS distance_km
           FROM catalog_items
          WHERE deleted_at IS NULL AND id <> $3 AND lat IS NOT NULL
            AND kind = ANY($4) AND ${DIST_KM} <= $5
          ORDER BY distance_km LIMIT 30`,
        [it.lat, it.lng, it.id, it.kind === "route" ? ["business", "poi"] : ["business", "poi", "route"], radius_km],
      );
      const nm = await mediaUrls(db, rows.rows.map((r) => (r.data.featured_media as number) ?? (r.data.banner_image as number)).filter(Boolean));
      nearby = rows.rows.map((r) => summary(r, lang, nm));
    }

    return {
      ...summary(it, lang, media),
      link: it.link,
      ...localised,
      contact: {
        address: d.address ?? null,
        email: d.email ?? null,
        telephone: d.telephone ?? null,
        website_url: d.website_url ?? null,
        booking_url: d.booking_url ?? null,
      },
      trail_length: d.trail_length ?? null,
      map_kml: d.map_kml ?? null,
      // The KML parsed and simplified by the engine, so the app can draw the path without fetching the file.
      track: it.kind === "route" ? await routeTrack(db, it.id, d.map_kml as string | undefined, opts.kmlFetch).catch(() => null) : null,
      youtube_video: d.youtube_video ?? null,
      gallery: gallery.map((g) => media.get(g)).filter(Boolean),
      terms: terms.rows,
      nearby,
    };
  });

  // Webhook from the rve-sync WordPress plugin: {type, id, action}, signed with HMAC-SHA256 of the raw body.
  app.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    hooks.post("/v1/webhooks/wordpress", async (req, reply) => {
      if (!opts.webhookSecret || !opts.wpClient) return reply.status(503).send({ error: "webhook_not_configured" });
      const raw = typeof req.body === "string" ? req.body : "";
      const given = String(req.headers["x-rve-signature"] ?? "");
      const expected = createHmac("sha256", opts.webhookSecret).update(raw).digest("hex");
      if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return reply.status(401).send({ error: "bad_signature" });
      }
      const b = z
        .object({ type: z.enum(["business", "route", "pois"]), id: z.number().int().positive(), action: z.enum(["upsert", "delete"]) })
        .parse(JSON.parse(raw));
      // An edited route may have a new KML file at the same link: drop its cached path.
      if (b.type === "route") await db.query("DELETE FROM route_tracks WHERE item_id = $1", [`route-${b.id}`]);
      if (b.action === "delete") await markDeleted(db, b.type, b.id);
      else await syncOne(db, opts.wpClient, b.type, b.id);
      return { ok: true };
    });
  });
}
