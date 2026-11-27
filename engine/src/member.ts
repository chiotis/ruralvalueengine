import { randomInt } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ulid } from "ulid";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { Auth, AuthError, MemberAuth, type MemberSession } from "./auth.js";
import { makeQrToken } from "./qr.js";
import { recordEngineEvent } from "./pipeline.js";
import { impactScore, MEMBER_VISITS_SQL } from "./score.js";
import { wallet } from "./wallet.js";
import { distanceMeters } from "./geo.js";

const Id = z.string().regex(/^[a-z0-9-]+$/);
const REDEMPTION_TTL_MS = 15 * 60 * 1000;
const MATCH_RADIUS_KM = 30;

export interface MemberDeps {
  db: Db;
  auth: Auth;
  memberAuth: MemberAuth;
  qrKeys: Record<string, string>;
  visitorOf: (req: FastifyRequest) => Promise<string>;
}

/** Pick the member a request acts for: the one asked for, or the only one on the session. */
function actingAs(session: MemberSession, requested?: string | null): string {
  if (requested) {
    if (!session.members.includes(requested)) throw new AuthError("not_your_member", 403);
    return requested;
  }
  if (session.members.length === 1) return session.members[0]!;
  throw new AuthError("member_id_required");
}

const redemptionCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function registerMemberRoutes(app: FastifyInstance, d: MemberDeps) {
  const { db, memberAuth } = d;
  const sessionOf = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new AuthError("unauthorized", 401);
    return memberAuth.session(h.slice(7));
  };
  const memberParam = (req: FastifyRequest) =>
    z.object({ member_id: Id.optional() }).passthrough().parse({ ...(req.query as object), ...((req.body as object) ?? {}) }).member_id;

  // ---------- member login ----------
  app.post("/v1/member/auth/email/start", async (req) => {
    const { email } = z.object({ email: z.string().email().max(254) }).parse(req.body);
    await memberAuth.start(email);
    return { sent: true };
  });
  app.post("/v1/member/auth/email/verify", async (req) => {
    const { email, code } = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return memberAuth.verify(email, code);
  });
  app.post("/v1/member/auth/refresh", async (req) => {
    const { refresh_token } = z.object({ refresh_token: z.string().min(20) }).parse(req.body);
    return memberAuth.refresh(refresh_token);
  });

  app.get("/v1/member/me", async (req) => {
    const s = await sessionOf(req);
    const rows = await db.query("SELECT id, name, lat, lng FROM members WHERE id = ANY($1) ORDER BY id", [s.members]);
    return { email: s.email, members: rows.rows };
  });

  // ---------- dashboard ----------
  app.get("/v1/member/dashboard", async (req) => {
    const m = actingAs(await sessionOf(req), memberParam(req));
    const [w, score, month, refs, partners] = await Promise.all([
      wallet(db, "member", m, 10),
      impactScore(db, m),
      db.query<{ visits: string; visitors: string }>(
        `SELECT count(*) AS visits, count(DISTINCT visitor_id) AS visitors FROM (${MEMBER_VISITS_SQL}) v`,
        [m, 30],
      ),
      db.query<{ sent: string; received: string }>(
        `SELECT count(*) FILTER (WHERE member_ids[1] = $1) AS sent, count(*) FILTER (WHERE member_ids[2] = $1) AS received
           FROM events WHERE type = 'referral.redeemed' AND status = 'verified' AND $1 = ANY(member_ids)
            AND occurred_at > now() - interval '30 days'`,
        [m],
      ),
      db.query<{ n: string }>("SELECT count(*) AS n FROM partnerships WHERE status = 'active' AND (member_a = $1 OR member_b = $1)", [m]),
    ]);
    return {
      member_id: m,
      points: w.balance,
      recent_points: w.entries,
      impact_score: score,
      last_30_days: {
        visits: Number(month.rows[0]!.visits),
        unique_visitors: Number(month.rows[0]!.visitors),
        referrals_sent: Number(refs.rows[0]!.sent),
        referrals_received: Number(refs.rows[0]!.received),
      },
      active_partners: Number(partners.rows[0]!.n),
    };
  });

  // ---------- QR codes ----------
  app.get("/v1/member/qr", async (req) => {
    const m = actingAs(await sessionOf(req), memberParam(req));
    const rows = await db.query<{ id: string; kind: string; key_version: number }>(
      "SELECT id, kind, key_version FROM qr_targets WHERE active AND $1 = ANY(member_ids) ORDER BY id",
      [m],
    );
    return { qr_codes: rows.rows.map((r) => ({ ...r, qr: makeQrToken(d.qrKeys, r.id, r.key_version) })) };
  });

  // ---------- referrals ----------
  app.post("/v1/member/referrals", async (req) => {
    const s = await sessionOf(req);
    const b = z.object({ member_id: Id.optional(), to_member_id: Id, valid_days: z.number().int().min(1).max(365).default(30) }).parse(req.body);
    const from = actingAs(s, b.member_id);
    if (from === b.to_member_id) throw new AuthError("self_referral");
    const exists = await db.query("SELECT 1 FROM members WHERE id = $1", [b.to_member_id]);
    if (!exists.rowCount) throw new AuthError("unknown_member", 404);
    const id = `ref_${ulid()}`;
    // 8 characters from an alphabet without look-alikes (no 0/O, 1/I).
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(0, alphabet.length)]).join("");
    await db.query(
      "INSERT INTO referrals(id, code, from_member_id, to_member_id, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))",
      [id, code, from, b.to_member_id, b.valid_days],
    );
    return { id, code, from_member_id: from, to_member_id: b.to_member_id };
  });

  app.get("/v1/member/referrals", async (req) => {
    const m = actingAs(await sessionOf(req), memberParam(req));
    const rows = await db.query(
      `SELECT r.id, r.code, r.from_member_id, r.to_member_id, r.expires_at, r.created_at,
              mf.name AS from_name, mt.name AS to_name,
              (SELECT count(*)::int FROM events e WHERE e.referral_id = r.id AND e.type = 'referral.redeemed' AND e.status = 'verified') AS redeemed
         FROM referrals r
         LEFT JOIN members mf ON mf.id = r.from_member_id
         LEFT JOIN members mt ON mt.id = r.to_member_id
        WHERE r.from_member_id = $1 OR r.to_member_id = $1
        ORDER BY r.created_at DESC LIMIT 200`,
      [m],
    );
    return { referrals: rows.rows };
  });

  // ---------- epaithros Connect: partnerships ----------
  app.post("/v1/member/partnerships", async (req, reply) => {
    const s = await sessionOf(req);
    const b = z.object({ member_id: Id.optional(), partner_id: Id, note: z.string().max(500).optional() }).parse(req.body);
    const me = actingAs(s, b.member_id);
    if (me === b.partner_id) throw new AuthError("self_partnership");
    if (!(await db.query("SELECT 1 FROM members WHERE id = $1", [b.partner_id])).rowCount) throw new AuthError("unknown_member", 404);
    const [a, bb] = [me, b.partner_id].sort() as [string, string];
    const id = `pship_${ulid()}`;
    try {
      await db.query(
        "INSERT INTO partnerships(id, member_a, member_b, requested_by, note, status) VALUES ($1, $2, $3, $4, $5, 'pending')",
        [id, a, bb, me, b.note ?? null],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return reply.status(409).send({ error: "partnership_exists" });
      throw e;
    }
    return { id, status: "pending" };
  });

  const decide = (accept: boolean) => async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const s = await sessionOf(req);
    return withTx(db, async (tx) => {
      const p = (
        await tx.query<{ id: string; member_a: string; member_b: string; requested_by: string; status: string }>(
          "SELECT id, member_a, member_b, requested_by, status FROM partnerships WHERE id = $1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!p) throw new AuthError("not_found", 404);
      const other = p.requested_by === p.member_a ? p.member_b : p.member_a;
      if (!s.members.includes(other)) throw new AuthError("only_the_invited_member_can_answer", 403);
      if (p.status !== "pending") throw new AuthError("not_pending", 409);
      if (!accept) {
        await tx.query("UPDATE partnerships SET status = 'declined' WHERE id = $1", [p.id]);
        return { id: p.id, status: "declined" };
      }
      // Points for a pair are paid once, even if they part and partner again later.
      const dedupe = `partnership:${p.member_a}:${p.member_b}`;
      const paid = (await tx.query("SELECT 1 FROM events WHERE dedupe_key = $1", [dedupe])).rowCount;
      let points: unknown[] = [];
      let eventId: string | null = null;
      if (!paid) {
        eventId = `${p.id}.created`;
        points = await recordEngineEvent(tx, {
          event_id: eventId,
          type: "partnership.created",
          occurred_at: new Date(),
          source: "member",
          member_ids: [p.member_a, p.member_b],
          dedupe_key: dedupe,
          checks: ["both_members_confirmed"],
          payload: { partnership_id: p.id },
        });
      }
      await tx.query("UPDATE partnerships SET status = 'active', confirmed_at = now(), event_id = $2 WHERE id = $1", [p.id, eventId]);
      return { id: p.id, status: "active", points };
    });
  };
  app.post<{ Params: { id: string } }>("/v1/member/partnerships/:id/confirm", decide(true));
  app.post<{ Params: { id: string } }>("/v1/member/partnerships/:id/decline", decide(false));

  app.get("/v1/member/partnerships", async (req) => {
    const m = actingAs(await sessionOf(req), memberParam(req));
    const rows = await db.query(
      `SELECT p.id, p.status, p.requested_by, p.note, p.created_at, p.confirmed_at,
              CASE WHEN p.member_a = $1 THEN p.member_b ELSE p.member_a END AS partner_id,
              mm.name AS partner_name
         FROM partnerships p
         JOIN members mm ON mm.id = CASE WHEN p.member_a = $1 THEN p.member_b ELSE p.member_a END
        WHERE p.member_a = $1 OR p.member_b = $1
        ORDER BY p.created_at DESC`,
      [m],
    );
    return { partnerships: rows.rows };
  });

  // ---------- AI Rural Matchmaking (v1: explainable heuristic) ----------
  app.get("/v1/member/matches", async (req) => {
    const m = actingAs(await sessionOf(req), memberParam(req));
    return { matches: await matches(db, m) };
  });

  // ---------- rewards ----------
  app.put<{ Params: { id: string } }>("/v1/member/rewards/:id", async (req) => {
    const s = await sessionOf(req);
    const b = z
      .object({ member_id: Id.optional(), title_el: z.string().min(1).max(120), title_en: z.string().max(120).optional(), cost: z.number().int().min(1).max(100000), active: z.boolean().default(true) })
      .parse(req.body);
    const m = actingAs(s, b.member_id);
    const id = Id.parse(req.params.id);
    const owner = (await db.query<{ member_id: string | null }>("SELECT member_id FROM rewards WHERE id = $1", [id])).rows[0];
    if (owner && owner.member_id !== m) throw new AuthError("not_your_reward", 403);
    await db.query(
      `INSERT INTO rewards(id, member_id, title_el, title_en, cost, active) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET title_el = EXCLUDED.title_el, title_en = EXCLUDED.title_en, cost = EXCLUDED.cost, active = EXCLUDED.active`,
      [id, m, b.title_el, b.title_en ?? null, b.cost, b.active],
    );
    return { id };
  });

  // The member's own rewards, active or not, with both titles for editing.
  app.get("/v1/member/rewards", async (req) => {
    const m = actingAs(await sessionOf(req), memberParam(req));
    const rows = await db.query(
      "SELECT id, title_el, title_en, cost, active FROM rewards WHERE member_id = $1 ORDER BY active DESC, cost, id",
      [m],
    );
    return { rewards: rows.rows };
  });

  app.get("/v1/rewards", async (req) => {
    const q = z.object({ member_id: Id.optional(), lang: z.enum(["el", "en"]).default("el") }).parse(req.query);
    const rows = await db.query<{ id: string; member_id: string | null; title_el: string; title_en: string | null; cost: number; member_name: string | null }>(
      `SELECT r.id, r.member_id, r.title_el, r.title_en, r.cost, m.name AS member_name
         FROM rewards r LEFT JOIN members m ON m.id = r.member_id
        WHERE r.active AND ($1::text IS NULL OR r.member_id = $1)
        ORDER BY r.cost, r.id`,
      [q.member_id ?? null],
    );
    return {
      rewards: rows.rows.map((r) => ({
        id: r.id,
        member_id: r.member_id,
        member_name: r.member_name,
        title: q.lang === "en" ? (r.title_en ?? r.title_el) : r.title_el,
        cost: r.cost,
      })),
    };
  });

  // Visitor asks to redeem: gets a 6-digit code to show at the member. Points move only when the member confirms.
  app.post("/v1/me/redemptions", async (req) => {
    const visitorId = await d.visitorOf(req);
    const { reward_id } = z.object({ reward_id: Id }).parse(req.body);
    const reward = (await db.query<{ cost: number; active: boolean }>("SELECT cost, active FROM rewards WHERE id = $1", [reward_id])).rows[0];
    if (!reward || !reward.active) throw new AuthError("unknown_reward", 404);
    const w = await wallet(db, "visitor", visitorId, 1);
    if (w.balance < reward.cost) throw new AuthError("not_enough_points", 409);
    const id = `rdm_${ulid()}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = redemptionCode();
      try {
        await db.query(
          "INSERT INTO redemptions(id, code, reward_id, visitor_id, status, expires_at) VALUES ($1,$2,$3,$4,'pending',$5)",
          [id, code, reward_id, visitorId, new Date(Date.now() + REDEMPTION_TTL_MS)],
        );
        return { id, code, expires_in: REDEMPTION_TTL_MS / 1000 };
      } catch (e) {
        if ((e as { code?: string }).code !== "23505") throw e;
        // A code still in use elsewhere: expire stale ones and try another.
        await db.query("UPDATE redemptions SET status = 'expired', code = id WHERE status = 'pending' AND expires_at < now()");
      }
    }
    throw new AuthError("try_again", 503);
  });

  app.post("/v1/member/redemptions/confirm", async (req) => {
    const s = await sessionOf(req);
    const b = z.object({ member_id: Id.optional(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const me = actingAs(s, b.member_id);
    return withTx(db, async (tx) => {
      const r = (
        await tx.query<{ id: string; visitor_id: string; status: string; expires_at: Date; reward_id: string; cost: number; owner: string | null; title_el: string }>(
          `SELECT d.id, d.visitor_id, d.status, d.expires_at, d.reward_id, w.cost, w.member_id AS owner, w.title_el
             FROM redemptions d JOIN rewards w ON w.id = d.reward_id
            WHERE d.code = $1 FOR UPDATE OF d`,
          [b.code],
        )
      ).rows[0];
      if (!r || r.status !== "pending") throw new AuthError("unknown_code", 404);
      if (r.expires_at.getTime() < Date.now()) {
        await tx.query("UPDATE redemptions SET status = 'expired' WHERE id = $1", [r.id]);
        throw new AuthError("code_expired", 410);
      }
      if (r.owner && r.owner !== me) throw new AuthError("reward_belongs_to_another_member", 403);
      // Serialise spends per visitor so two confirmations can't overspend.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [r.visitor_id]);
      const bal = await tx.query<{ b: string }>(
        "SELECT COALESCE(SUM(points), 0) AS b FROM ledger WHERE owner_type = 'visitor' AND owner_id = $1",
        [r.visitor_id],
      );
      if (Number(bal.rows[0]!.b) < r.cost) throw new AuthError("not_enough_points", 409);
      const eventId = `${r.id}.redeemed`;
      await recordEngineEvent(
        tx,
        {
          event_id: eventId,
          type: "wallet.redeemed",
          occurred_at: new Date(),
          source: "member",
          visitor_id: r.visitor_id,
          member_ids: [me],
          checks: ["code", "expiry", "balance", "member_confirmed"],
          payload: { reward_id: r.reward_id, redemption_id: r.id, cost: r.cost },
        },
        [{ owner_type: "visitor", owner_id: r.visitor_id, points: -r.cost, rule_id: "reward.redeem" }],
      );
      await tx.query("UPDATE redemptions SET status = 'confirmed', confirmed_by = $2, event_id = $3 WHERE id = $1", [r.id, me, eventId]);
      return { id: r.id, status: "confirmed", reward: r.title_el, cost: r.cost };
    });
  });

  // ---------- analytics ----------
  app.get("/v1/member/analytics", async (req) => {
    const s = await sessionOf(req);
    const q = z.object({ member_id: Id.optional(), days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const m = actingAs(s, q.member_id);
    return memberAnalytics(db, m, q.days);
  });

  // ---------- public score ----------
  app.get<{ Params: { id: string } }>("/v1/members/:id/score", async (req) => impactScore(db, Id.parse(req.params.id)));
}

export async function memberAnalytics(db: Db, m: string, days: number) {
  const perDay = await db.query<{ day: string; visits: string }>(
    `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'Europe/Athens'), 'YYYY-MM-DD') AS day, count(*) AS visits
       FROM (${MEMBER_VISITS_SQL}) v GROUP BY 1 ORDER BY 1`,
    [m, days],
  );
  const visitors = await db.query<{ unique: string; repeat: string }>(
    `SELECT count(*) AS unique, count(*) FILTER (WHERE n > 1) AS repeat
       FROM (SELECT visitor_id, count(*) AS n FROM (${MEMBER_VISITS_SQL}) v GROUP BY visitor_id) x`,
    [m, days],
  );
  // Where else this member's visitors go: the strongest hint for partnerships and packages.
  const alsoVisited = await db.query<{ member_id: string; name: string; shared_visitors: string }>(
    `WITH mine AS (SELECT DISTINCT visitor_id FROM (${MEMBER_VISITS_SQL}) v)
     SELECT o.mid AS member_id, mm.name, count(DISTINCT o.visitor_id) AS shared_visitors
       FROM (SELECT unnest(member_ids) AS mid, visitor_id FROM events
              WHERE status = 'verified' AND type = 'checkin.qr' AND occurred_at > now() - make_interval(days => $2)) o
       JOIN mine ON mine.visitor_id = o.visitor_id
       JOIN members mm ON mm.id = o.mid
      WHERE o.mid <> $1
      GROUP BY o.mid, mm.name ORDER BY shared_visitors DESC, o.mid LIMIT 10`,
    [m, days],
  );
  const refs = await db.query<{ sent: string; received: string }>(
    `SELECT count(*) FILTER (WHERE member_ids[1] = $1) AS sent, count(*) FILTER (WHERE member_ids[2] = $1) AS received
       FROM events WHERE type = 'referral.redeemed' AND status = 'verified' AND $1 = ANY(member_ids)
        AND occurred_at > now() - make_interval(days => $2)`,
    [m, days],
  );
  const pts = await db.query<{ p: string }>(
    "SELECT COALESCE(SUM(points), 0) AS p FROM ledger WHERE owner_type = 'member' AND owner_id = $1 AND created_at > now() - make_interval(days => $2)",
    [m, days],
  );
  return {
    member_id: m,
    days,
    visits_per_day: perDay.rows.map((r) => ({ day: r.day, visits: Number(r.visits) })),
    unique_visitors: Number(visitors.rows[0]!.unique),
    repeat_visitors: Number(visitors.rows[0]!.repeat),
    referrals_sent: Number(refs.rows[0]!.sent),
    referrals_received: Number(refs.rows[0]!.received),
    points_earned: Number(pts.rows[0]!.p),
    visitors_also_visited: alsoVisited.rows.map((r) => ({ member_id: r.member_id, name: r.name, shared_visitors: Number(r.shared_visitors) })),
  };
}

interface Candidate {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  types: number[];
  locations: number[];
  shared_visitors: number;
}

/**
 * Suggest partners for a member. Explainable by design: each suggestion lists
 * the reasons that produced its score. Complementary businesses (a taverna and a
 * winery) rank above similar ones; nearby ones and those sharing visitors rank higher.
 */
export async function matches(db: Db, m: string) {
  const self = (
    await db.query<{ lat: number | null; lng: number | null; types: number[] | null; locations: number[] | null }>(
      `SELECT m.lat, m.lng,
              ARRAY(SELECT jsonb_array_elements_text(c.data->'taxonomies'->'business-type')::int) AS types,
              ARRAY(SELECT jsonb_array_elements_text(c.data->'taxonomies'->'location')::int) AS locations
         FROM members m LEFT JOIN catalog_items c ON c.id = m.id WHERE m.id = $1`,
      [m],
    )
  ).rows[0];
  if (!self) throw new AuthError("unknown_member", 404);

  const rows = await db.query<Candidate>(
    `WITH mine AS (
       SELECT DISTINCT visitor_id FROM events
        WHERE status = 'verified' AND type = 'checkin.qr' AND $1 = ANY(member_ids) AND occurred_at > now() - interval '180 days')
     SELECT m.id, m.name, m.lat, m.lng,
            ARRAY(SELECT jsonb_array_elements_text(c.data->'taxonomies'->'business-type')::int) AS types,
            ARRAY(SELECT jsonb_array_elements_text(c.data->'taxonomies'->'location')::int) AS locations,
            (SELECT count(DISTINCT e.visitor_id)::int FROM events e JOIN mine ON mine.visitor_id = e.visitor_id
              WHERE e.status = 'verified' AND e.type = 'checkin.qr' AND m.id = ANY(e.member_ids)
                AND e.occurred_at > now() - interval '180 days') AS shared_visitors
       FROM members m
       LEFT JOIN catalog_items c ON c.id = m.id
      WHERE m.id <> $1
        AND (c.id IS NULL OR c.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM partnerships p WHERE p.status IN ('pending', 'active')
                         AND ((p.member_a = $1 AND p.member_b = m.id) OR (p.member_b = $1 AND p.member_a = m.id)))`,
    [m],
  );

  const myTypes = new Set(self.types ?? []);
  const myLocations = new Set(self.locations ?? []);
  const out = [];
  for (const c of rows.rows) {
    const reasons: string[] = [];
    let score = 0;
    let km: number | null = null;
    if (self.lat != null && self.lng != null && c.lat != null && c.lng != null) {
      km = distanceMeters({ lat: self.lat, lng: self.lng }, { lat: c.lat, lng: c.lng }) / 1000;
      if (km > MATCH_RADIUS_KM) continue;
      score += 3 * (1 - km / MATCH_RADIUS_KM);
      reasons.push(`${km.toFixed(1)} km away`);
    }
    const overlap = c.types.filter((t) => myTypes.has(t)).length;
    if (c.types.length && myTypes.size) {
      if (overlap === 0) {
        score += 2;
        reasons.push("complementary business type");
      } else {
        score += 0.5;
        reasons.push("similar business type");
      }
    }
    if (c.locations.some((l) => myLocations.has(l))) {
      score += 1;
      reasons.push("same area");
    }
    if (c.shared_visitors > 0) {
      score += Math.min(5, c.shared_visitors);
      reasons.push(`${c.shared_visitors} shared visitor${c.shared_visitors > 1 ? "s" : ""}`);
    }
    if (score <= 0) continue;
    out.push({ member_id: c.id, name: c.name, score: Math.round(score * 10) / 10, distance_km: km == null ? null : Math.round(km * 10) / 10, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.member_id.localeCompare(b.member_id));
  return out.slice(0, 10);
}
