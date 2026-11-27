import type { Db } from "./db.js";

/**
 * Rural Impact Score, version score-v1.
 * Counts verified activity in the last 90 days with explicit weights, then maps
 * the raw total to 0–100 on a log scale so small members are not invisible and
 * large ones do not run away. Every input is returned so the score can be explained.
 */
export const SCORE_V1 = {
  version: "score-v1",
  windowDays: 90,
  weights: { visitors: 1, referrals_sent: 3, referrals_received: 1, partnerships: 5, routes_completed: 2 },
  rawFor100: 200,
} as const;

export interface ScoreResult {
  member_id: string;
  score: number;
  version: string;
  window_days: number;
  inputs: Record<keyof typeof SCORE_V1.weights, number>;
  raw: number;
}

export function scoreFromInputs(inputs: ScoreResult["inputs"]): { raw: number; score: number } {
  const w = SCORE_V1.weights;
  const raw =
    inputs.visitors * w.visitors +
    inputs.referrals_sent * w.referrals_sent +
    inputs.referrals_received * w.referrals_received +
    inputs.partnerships * w.partnerships +
    inputs.routes_completed * w.routes_completed;
  const score = Math.min(100, Math.round((100 * Math.log10(1 + raw)) / Math.log10(1 + SCORE_V1.rawFor100)));
  return { raw, score };
}

/** Visits credited to a member: verified check-ins, or the live correction that moved one to them. */
export const MEMBER_VISITS_SQL = `
  SELECT e.event_id, e.visitor_id, e.occurred_at
    FROM events e
   WHERE e.status = 'verified' AND $1 = ANY(e.member_ids)
     AND (
       (e.type = 'checkin.qr' AND NOT EXISTS (
          SELECT 1 FROM events c WHERE c.type = 'correction' AND c.status = 'verified' AND c.refers_to_event_id = e.event_id))
       OR e.type = 'correction')
     AND e.occurred_at > now() - make_interval(days => $2)`;

export async function impactScore(db: Db, memberId: string): Promise<ScoreResult> {
  const days = SCORE_V1.windowDays;
  const q = await db.query<{ visitors: string; sent: string; received: string; partners: string; routes: string }>(
    `SELECT
       (SELECT count(DISTINCT visitor_id) FROM (${MEMBER_VISITS_SQL}) v) AS visitors,
       (SELECT count(*) FROM events WHERE type = 'referral.redeemed' AND status = 'verified' AND member_ids[1] = $1
          AND occurred_at > now() - make_interval(days => $2)) AS sent,
       (SELECT count(*) FROM events WHERE type = 'referral.redeemed' AND status = 'verified' AND member_ids[2] = $1
          AND occurred_at > now() - make_interval(days => $2)) AS received,
       (SELECT count(*) FROM partnerships WHERE status = 'active' AND (member_a = $1 OR member_b = $1)) AS partners,
       (SELECT count(*) FROM events WHERE type = 'route.completed' AND status = 'verified' AND $1 = ANY(member_ids)
          AND occurred_at > now() - make_interval(days => $2)) AS routes`,
    [memberId, days],
  );
  const r = q.rows[0]!;
  const inputs = {
    visitors: Number(r.visitors),
    referrals_sent: Number(r.sent),
    referrals_received: Number(r.received),
    partnerships: Number(r.partners),
    routes_completed: Number(r.routes),
  };
  return { member_id: memberId, version: SCORE_V1.version, window_days: days, inputs, ...scoreFromInputs(inputs) };
}
