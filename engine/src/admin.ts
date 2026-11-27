import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import type { Db } from "./db.js";
import { AuthError } from "./auth.js";
import { makeQrToken } from "./qr.js";
import type { WpClient } from "./wordpress/client.js";
import { syncRuralGreece, type SyncReport } from "./wordpress/sync.js";

const Id = z.string().regex(/^[a-z0-9-]+$/);

export interface AdminDeps {
  db: Db;
  qrKeys: Record<string, string>;
  wpClient?: WpClient;
}

/** The current QR key version: the highest configured one. New codes are signed with it. */
export const currentKeyVersion = (keys: Record<string, string>) => Math.max(...Object.keys(keys).map(Number));

/**
 * Read-side and bulk endpoints behind the ETAM admin panel. Registered inside the
 * admin scope, so every route here already requires ADMIN_TOKEN.
 */
export function registerAdminRoutes(admin: FastifyInstance, d: AdminDeps) {
  const { db } = d;

  admin.get("/v1/admin/overview", async () => {
    const r = await db.query(
      `SELECT (SELECT count(*)::int FROM members) AS members,
              (SELECT count(*)::int FROM members m WHERE NOT EXISTS
                 (SELECT 1 FROM qr_targets q WHERE q.kind = 'member' AND q.member_ids = ARRAY[m.id] AND q.active)) AS members_without_qr,
              (SELECT count(*)::int FROM pois) AS pois,
              (SELECT count(*)::int FROM routes WHERE kind = 'package') AS packages,
              (SELECT count(*)::int FROM visitors) AS visitors,
              (SELECT count(*)::int FROM events WHERE received_at > now() - interval '1 day') AS events_24h,
              (SELECT count(*)::int FROM events WHERE status = 'rejected' AND received_at > now() - interval '1 day') AS rejected_24h,
              (SELECT count(*)::int FROM partnerships WHERE status = 'pending') AS pending_partnerships`,
    );
    const sync = await db.query("SELECT source, last_modified, last_full_at, last_run_at FROM sync_state ORDER BY source");
    return { ...r.rows[0], sync: sync.rows };
  });

  admin.get("/v1/admin/members", async (req) => {
    const q = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const rows = await db.query(
      `SELECT m.id, m.name, m.wp_id, m.lat, m.lng,
              (SELECT q.id FROM qr_targets q WHERE q.kind = 'member' AND q.member_ids = ARRAY[m.id] AND q.active ORDER BY q.id LIMIT 1) AS qr_target,
              (SELECT count(*)::int FROM member_users u WHERE u.member_id = m.id) AS extra_logins,
              (SELECT COALESCE(SUM(points), 0)::int FROM ledger l WHERE l.owner_type = 'member' AND l.owner_id = m.id) AS points,
              c.data->>'email' AS email
         FROM members m LEFT JOIN catalog_items c ON c.id = m.id
        WHERE $1::text IS NULL OR m.name ILIKE '%' || $1 || '%' OR m.id = $1
        ORDER BY m.name LIMIT $2`,
      [q.q?.trim() || null, q.limit],
    );
    return { members: rows.rows };
  });

  admin.get("/v1/admin/pois", async () => {
    const rows = await db.query(
      `SELECT p.id, p.name, p.lat, p.lng, p.radius_m,
              EXISTS (SELECT 1 FROM qr_targets q WHERE q.id = p.id AND q.active) AS has_qr
         FROM pois p ORDER BY p.name`,
    );
    return { pois: rows.rows };
  });

  admin.get("/v1/admin/qr-targets", async () => {
    const rows = await db.query<{ id: string; kind: string; member_ids: string[]; poi_id: string | null; key_version: number; active: boolean; label: string | null }>(
      `SELECT q.id, q.kind, q.member_ids, q.poi_id, q.key_version, q.active,
              COALESCE(p.name, (SELECT string_agg(m.name, ' + ' ORDER BY m.name) FROM members m WHERE m.id = ANY(q.member_ids))) AS label
         FROM qr_targets q LEFT JOIN pois p ON p.id = q.poi_id
        ORDER BY q.kind, label`,
    );
    return { qr_targets: rows.rows.map((r) => ({ ...r, qr: makeQrToken(d.qrKeys, r.id, r.key_version) })) };
  });

  // Printable QR image for one target.
  admin.get<{ Params: { id: string } }>("/v1/admin/qr-targets/:id/svg", async (req, reply) => {
    const id = Id.parse(req.params.id);
    const t = (await db.query<{ key_version: number }>("SELECT key_version FROM qr_targets WHERE id = $1", [id])).rows[0];
    if (!t) throw new AuthError("not_found", 404);
    const svg = await QRCode.toString(makeQrToken(d.qrKeys, id, t.key_version), {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1c2c23", light: "#ffffff" },
    });
    return reply.type("image/svg+xml").header("cache-control", "no-store").send(svg);
  });

  // One QR per member that doesn't have one yet, signed with the current key.
  admin.post("/v1/admin/qr-targets/bulk-members", async () => {
    const v = currentKeyVersion(d.qrKeys);
    const r = await db.query(
      `INSERT INTO qr_targets(id, kind, member_ids, lat, lng, key_version, active)
       SELECT m.id, 'member', ARRAY[m.id], m.lat, m.lng, $1, true FROM members m
        WHERE NOT EXISTS (SELECT 1 FROM qr_targets q WHERE q.kind = 'member' AND q.member_ids = ARRAY[m.id] AND q.active)
          AND NOT EXISTS (SELECT 1 FROM qr_targets q WHERE q.id = m.id)
       RETURNING id`,
      [v],
    );
    return { created: r.rowCount };
  });

  admin.get("/v1/admin/packages", async () => {
    const rows = await db.query(
      `SELECT r.id, r.name AS title_el, r.title_en, r.description, r.active,
              COALESCE(array_agg(s.target_id ORDER BY s.position) FILTER (WHERE s.target_id IS NOT NULL), '{}') AS stops
         FROM routes r LEFT JOIN route_stops s ON s.route_id = r.id
        WHERE r.kind = 'package' GROUP BY r.id ORDER BY r.name`,
    );
    return { packages: rows.rows };
  });

  admin.get("/v1/admin/rewards", async () => {
    const rows = await db.query(
      `SELECT w.id, w.member_id, m.name AS member_name, w.title_el, w.title_en, w.cost, w.active,
              (SELECT count(*)::int FROM redemptions d WHERE d.reward_id = w.id AND d.status = 'confirmed') AS redeemed
         FROM rewards w LEFT JOIN members m ON m.id = w.member_id ORDER BY w.active DESC, w.cost, w.id`,
    );
    return { rewards: rows.rows };
  });

  admin.get("/v1/admin/partnerships", async () => {
    const rows = await db.query(
      `SELECT p.id, p.status, p.note, p.created_at, p.confirmed_at, p.requested_by,
              a.name AS member_a_name, b.name AS member_b_name, p.member_a, p.member_b
         FROM partnerships p JOIN members a ON a.id = p.member_a JOIN members b ON b.id = p.member_b
        ORDER BY p.created_at DESC LIMIT 500`,
    );
    return { partnerships: rows.rows };
  });

  // Recent events, for support questions ("my scan didn't count") and for cancelling or correcting one.
  admin.get("/v1/admin/events", async (req) => {
    const q = z
      .object({
        status: z.enum(["verified", "rejected", "duplicate", "cancelled"]).optional(),
        type: z.string().max(40).optional(),
        member_id: Id.optional(),
        visitor_id: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const rows = await db.query(
      `SELECT event_id, type, status, reason, occurred_at, received_at, source, visitor_id, member_ids, target_id, poi_id,
              refers_to_event_id, rule_version,
              (SELECT COALESCE(SUM(points), 0)::int FROM ledger l WHERE l.event_id = e.event_id) AS points
         FROM events e
        WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR type = $2)
          AND ($3::text IS NULL OR $3 = ANY(member_ids)) AND ($4::text IS NULL OR visitor_id = $4)
        ORDER BY received_at DESC LIMIT $5`,
      [q.status ?? null, q.type ?? null, q.member_id ?? null, q.visitor_id ?? null, q.limit],
    );
    return { events: rows.rows };
  });

  // Run a content sync from ruralgreece.gr now, instead of waiting for the 15-minute timer.
  let running: Promise<SyncReport> | null = null;
  admin.post("/v1/admin/sync", async (req, reply) => {
    if (!d.wpClient) throw new AuthError("sync_not_configured", 409);
    const { full } = z.object({ full: z.boolean().default(false) }).parse(req.body ?? {});
    if (running) return reply.status(409).send({ error: "sync_running" });
    running = syncRuralGreece(db, d.wpClient, { full });
    try {
      return { full, report: await running };
    } finally {
      running = null;
    }
  });
}
