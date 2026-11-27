import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";

const Lang = z.enum(["el", "en"]).default("el");

/** Dynamic Rural Packaging: themed sets of member stops, with progress per visitor. */
export function registerPackageRoutes(app: FastifyInstance, db: Db, visitorOf: (req: FastifyRequest) => Promise<string>) {
  app.get("/v1/packages", async (req) => {
    const { lang } = z.object({ lang: Lang }).parse(req.query);
    const rows = await db.query<{ id: string; name: string; title_en: string | null; description: Record<string, string | null>; stops: { target_id: string; name: string | null }[] }>(
      `SELECT r.id, r.name, r.title_en, r.description,
              COALESCE(json_agg(json_build_object('target_id', s.target_id, 'name', COALESCE(m.name, p.name)) ORDER BY s.position)
                       FILTER (WHERE s.target_id IS NOT NULL), '[]') AS stops
         FROM routes r
         LEFT JOIN route_stops s ON s.route_id = r.id
         LEFT JOIN qr_targets q ON q.id = s.target_id
         LEFT JOIN members m ON m.id = q.member_ids[1]
         LEFT JOIN pois p ON p.id = s.target_id
        WHERE r.kind = 'package' AND r.active
        GROUP BY r.id ORDER BY r.name`,
    );
    return {
      packages: rows.rows.map((r) => ({
        id: r.id,
        title: lang === "en" ? (r.title_en ?? r.name) : r.name,
        description: (lang === "en" ? (r.description.en ?? r.description.el) : (r.description.el ?? r.description.en)) ?? null,
        stops: r.stops,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/v1/me/progress/:id", async (req, reply) => {
    const visitorId = await visitorOf(req);
    const route = (await db.query("SELECT id FROM routes WHERE id = $1", [req.params.id])).rows[0];
    if (!route) return reply.status(404).send({ error: "not_found" });
    const stops = await db.query<{ target_id: string; done_at: Date | null }>(
      `SELECT s.target_id,
              (SELECT min(p.occurred_at) FROM passport_entries p
                WHERE p.visitor_id = $2 AND p.target_id = s.target_id AND p.kind = 'checkin' AND p.revoked_at IS NULL) AS done_at
         FROM route_stops s WHERE s.route_id = $1 ORDER BY s.position`,
      [req.params.id, visitorId],
    );
    const completed = await db.query(
      "SELECT occurred_at FROM passport_entries WHERE visitor_id = $1 AND kind = 'route' AND target_id = $2 AND revoked_at IS NULL",
      [visitorId, req.params.id],
    );
    const done = stops.rows.filter((s) => s.done_at).length;
    return {
      id: req.params.id,
      stops: stops.rows,
      done,
      total: stops.rows.length,
      completed_at: completed.rows[0]?.occurred_at ?? null,
    };
  });
}
