import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import type { Db } from "./db.js";
import type { Config } from "./config.js";
import type { Mailer } from "./mailer.js";
import { Auth, AuthError, MemberAuth, safeEqual } from "./auth.js";
import { registerMemberRoutes } from "./member.js";
import { registerPackageRoutes } from "./packages.js";
import { ingest, type EventResult } from "./pipeline.js";
import type { Actor } from "./envelope.js";
import { makeQrToken } from "./qr.js";
import { passport, wallet } from "./wallet.js";
import { registerCatalog } from "./catalog.js";
import { WpClient } from "./wordpress/client.js";
import { registerAdminRoutes } from "./admin.js";
import { RateLimiter } from "./ratelimit.js";
import { registerAdminPanel } from "./admin-panel.js";

const MAX_BATCH = 100;
const Id = z.string().regex(/^[a-z0-9-]+$/, "ids are lowercase letters, digits and dashes");

export function buildApp(db: Db, cfg: Config, mailer: Mailer, opts: { logger?: boolean; wpClient?: WpClient } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1_000_000, trustProxy: cfg.trustProxy ?? false });
  const wpClient = opts.wpClient ?? (cfg.ruralgreeceUrl ? new WpClient(cfg.ruralgreeceUrl) : undefined);

  // Per-IP limits on the login endpoints (the per-email limits live in Auth) and on failed admin tokens.
  const limits = {
    start: new RateLimiter(20, 60 * 60 * 1000),
    verify: new RateLimiter(60, 60 * 60 * 1000),
    adminFail: new RateLimiter(20, 15 * 60 * 1000),
  };
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0]!;
    const which = path.endsWith("/auth/email/start") ? limits.start : path.endsWith("/auth/email/verify") ? limits.verify : null;
    if (which && !which.hit(req.ip)) return reply.status(429).send({ error: "too_many_requests" });
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    return payload;
  });
  const auth = new Auth(db, mailer, cfg.jwtSecret);
  const memberAuth = new MemberAuth(db, auth, cfg.jwtSecret);
  const pipelineCfg = { qrKeys: cfg.qrKeys, networkTz: cfg.networkTz };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.code });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid_request", details: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal_error" });
  });

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith("Bearer ") ? h.slice(7) : null;
  };
  const visitorOf = async (req: FastifyRequest) => {
    const t = bearer(req);
    if (!t) throw new AuthError("unauthorized", 401);
    return auth.visitorFromAccessToken(t);
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req);
    if (t && safeEqual(t, cfg.adminToken)) return;
    if (!limits.adminFail.hit(req.ip)) return reply.status(429).send({ error: "too_many_requests" });
    return reply.status(401).send({ error: "unauthorized" });
  };

  const submit = async (body: unknown, actor: Actor) => {
    const list = Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events : [body];
    if (list.length > MAX_BATCH) throw new AuthError("batch_too_large", 413);
    const results: EventResult[] = [];
    for (const raw of list) results.push(...(await ingest(db, pipelineCfg, raw, actor)));
    return { results };
  };

  registerCatalog(app, db, {
    wpClient,
    webhookSecret: cfg.wpWebhookSecret,
  });

  registerAdminPanel(app);

  app.get("/health", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  // ---- visitor login (passwordless email code) ----
  app.post("/v1/auth/email/start", async (req) => {
    const { email } = z.object({ email: z.string().email().max(254) }).parse(req.body);
    await auth.start(email);
    return { sent: true };
  });
  app.post("/v1/auth/email/verify", async (req) => {
    const { email, code } = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return auth.verify(email, code);
  });
  app.post("/v1/auth/refresh", async (req) => {
    const { refresh_token } = z.object({ refresh_token: z.string().min(20) }).parse(req.body);
    return auth.refresh(refresh_token);
  });

  // ---- visitor API ----
  app.post("/v1/events", async (req) => submit(req.body, { kind: "visitor", visitorId: await visitorOf(req) }));
  app.get("/v1/me/wallet", async (req) => wallet(db, "visitor", await visitorOf(req)));
  app.get("/v1/me/passport", async (req) => passport(db, await visitorOf(req)));

  registerMemberRoutes(app, { db, auth, memberAuth, qrKeys: cfg.qrKeys, visitorOf });
  registerPackageRoutes(app, db, visitorOf);

  // ---- admin API (ETAM) ----
  app.register(async (admin) => {
    admin.addHook("onRequest", requireAdmin);
    registerAdminRoutes(admin, { db, qrKeys: cfg.qrKeys, wpClient });

    admin.post("/v1/admin/events", async (req) => submit(req.body, { kind: "admin" }));

    admin.put<{ Params: { id: string } }>("/v1/admin/members/:id", async (req) => {
      const id = Id.parse(req.params.id);
      const b = z
        .object({ name: z.string().min(1), wp_id: z.number().int().optional(), lat: z.number().optional(), lng: z.number().optional() })
        .parse(req.body);
      await db.query(
        `INSERT INTO members(id, wp_id, name, lat, lng) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET wp_id = EXCLUDED.wp_id, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
        [id, b.wp_id ?? null, b.name, b.lat ?? null, b.lng ?? null],
      );
      return { id };
    });

    admin.put<{ Params: { id: string } }>("/v1/admin/pois/:id", async (req) => {
      const id = Id.parse(req.params.id);
      const b = z
        .object({
          name: z.string().min(1),
          wp_id: z.number().int().optional(),
          lat: z.number(),
          lng: z.number(),
          radius_m: z.number().int().min(10).max(1000).optional(),
        })
        .parse(req.body);
      await db.query(
        `INSERT INTO pois(id, wp_id, name, lat, lng, radius_m) VALUES ($1, $2, $3, $4, $5, COALESCE($6, 75))
         ON CONFLICT (id) DO UPDATE SET wp_id = EXCLUDED.wp_id, name = EXCLUDED.name, lat = EXCLUDED.lat,
                                        lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m`,
        [id, b.wp_id ?? null, b.name, b.lat, b.lng, b.radius_m ?? null],
      );
      return { id };
    });

    // Create or rotate a QR target and return the string to print as a QR code.
    admin.put<{ Params: { id: string } }>("/v1/admin/qr-targets/:id", async (req) => {
      const id = Id.parse(req.params.id);
      const b = z
        .object({
          kind: z.enum(["member", "poi", "shared"]),
          member_ids: z.array(Id).default([]),
          poi_id: Id.optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          key_version: z.number().int().positive().default(1),
          active: z.boolean().default(true),
        })
        .parse(req.body);
      if (b.kind === "poi" && b.poi_id !== id) throw new AuthError("poi_target_id_must_equal_poi_id");
      if (b.kind !== "poi" && b.member_ids.length === 0) throw new AuthError("member_ids_required");
      if (b.kind === "member" && b.member_ids.length !== 1) throw new AuthError("member_target_needs_one_member");
      await db.query(
        `INSERT INTO qr_targets(id, kind, member_ids, poi_id, lat, lng, key_version, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, member_ids = EXCLUDED.member_ids, poi_id = EXCLUDED.poi_id,
                                        lat = EXCLUDED.lat, lng = EXCLUDED.lng, key_version = EXCLUDED.key_version,
                                        active = EXCLUDED.active`,
        [id, b.kind, b.member_ids, b.poi_id ?? null, b.lat ?? null, b.lng ?? null, b.key_version, b.active],
      );
      return { id, qr: makeQrToken(cfg.qrKeys, id, b.key_version) };
    });

    admin.put<{ Params: { id: string } }>("/v1/admin/routes/:id", async (req) => {
      const id = Id.parse(req.params.id);
      const b = z.object({ name: z.string().min(1), wp_id: z.number().int().optional(), stops: z.array(Id).min(1) }).parse(req.body);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO routes(id, wp_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET wp_id = EXCLUDED.wp_id, name = EXCLUDED.name",
          [id, b.wp_id ?? null, b.name],
        );
        await client.query("DELETE FROM route_stops WHERE route_id = $1", [id]);
        for (const [i, stop] of b.stops.entries()) {
          await client.query("INSERT INTO route_stops(route_id, target_id, position) VALUES ($1, $2, $3)", [id, stop, i]);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      return { id, stops: b.stops.length };
    });

    admin.post("/v1/admin/referrals", async (req) => {
      const b = z.object({ from_member_id: Id, to_member_id: Id, valid_days: z.number().int().min(1).max(365).default(30) }).parse(req.body);
      if (b.from_member_id === b.to_member_id) throw new AuthError("self_referral");
      const id = `ref_${ulid()}`;
      const code = randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 7);
      await db.query(
        "INSERT INTO referrals(id, code, from_member_id, to_member_id, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))",
        [id, code, b.from_member_id, b.to_member_id, b.valid_days],
      );
      return { id, code };
    });

    // Let an email (besides the business email on ruralgreece.gr) act for a member.
    admin.put("/v1/admin/member-users", async (req) => {
      const b = z.object({ email: z.string().email(), member_id: Id }).parse(req.body);
      await db.query("INSERT INTO member_users(email_hash, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [auth.memberEmailHash(b.email), b.member_id]);
      return { ok: true };
    });

    admin.put<{ Params: { id: string } }>("/v1/admin/packages/:id", async (req) => {
      const id = Id.parse(req.params.id);
      const b = z
        .object({
          title_el: z.string().min(1),
          title_en: z.string().optional(),
          description: z.object({ el: z.string().nullable().optional(), en: z.string().nullable().optional() }).default({}),
          stops: z.array(Id).min(2),
          active: z.boolean().default(true),
        })
        .parse(req.body);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO routes(id, name, kind, title_en, description, active) VALUES ($1, $2, 'package', $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = 'package', title_en = EXCLUDED.title_en,
                                          description = EXCLUDED.description, active = EXCLUDED.active`,
          [id, b.title_el, b.title_en ?? null, JSON.stringify(b.description), b.active],
        );
        await client.query("DELETE FROM route_stops WHERE route_id = $1", [id]);
        for (const [i, stop] of b.stops.entries()) {
          await client.query("INSERT INTO route_stops(route_id, target_id, position) VALUES ($1, $2, $3)", [id, stop, i]);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      return { id, stops: b.stops.length };
    });

    // Network-wide rewards offered by ETAM (member_id = null).
    admin.put<{ Params: { id: string } }>("/v1/admin/rewards/:id", async (req) => {
      const id = Id.parse(req.params.id);
      const b = z.object({ member_id: Id.nullable().default(null), title_el: z.string().min(1), title_en: z.string().optional(), cost: z.number().int().positive(), active: z.boolean().default(true) }).parse(req.body);
      await db.query(
        `INSERT INTO rewards(id, member_id, title_el, title_en, cost, active) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET member_id = EXCLUDED.member_id, title_el = EXCLUDED.title_el, title_en = EXCLUDED.title_en,
                                        cost = EXCLUDED.cost, active = EXCLUDED.active`,
        [id, b.member_id, b.title_el, b.title_en ?? null, b.cost, b.active],
      );
      return { id };
    });

    admin.get("/v1/admin/analytics", async (req) => {
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
      const byType = await db.query(
        `SELECT type, status, count(*)::int AS n FROM events WHERE occurred_at > now() - make_interval(days => $1)
          GROUP BY type, status ORDER BY type, status`,
        [days],
      );
      const rejected = await db.query(
        `SELECT reason, count(*)::int AS n FROM events WHERE status = 'rejected' AND occurred_at > now() - make_interval(days => $1)
          GROUP BY reason ORDER BY n DESC`,
        [days],
      );
      const top = await db.query(
        `SELECT mid AS member_id, m.name, count(*)::int AS visits FROM (
           SELECT unnest(member_ids) AS mid FROM events
            WHERE type = 'checkin.qr' AND status = 'verified' AND occurred_at > now() - make_interval(days => $1)) x
           JOIN members m ON m.id = x.mid GROUP BY mid, m.name ORDER BY visits DESC LIMIT 20`,
        [days],
      );
      const totals = await db.query(
        `SELECT (SELECT count(*)::int FROM visitors) AS visitors,
                (SELECT count(DISTINCT visitor_id)::int FROM events WHERE status = 'verified' AND type LIKE 'checkin.%'
                   AND occurred_at > now() - make_interval(days => $1)) AS active_visitors,
                (SELECT count(*)::int FROM partnerships WHERE status = 'active') AS active_partnerships,
                (SELECT COALESCE(SUM(points), 0)::int FROM ledger WHERE owner_type = 'visitor' AND points > 0
                   AND created_at > now() - make_interval(days => $1)) AS points_issued`,
        [days],
      );
      return { days, totals: totals.rows[0], events: byType.rows, rejected_reasons: rejected.rows, top_members: top.rows };
    });

    admin.get<{ Params: { id: string } }>("/v1/admin/members/:id/wallet", async (req) => wallet(db, "member", Id.parse(req.params.id)));
  });

  return app;
}
