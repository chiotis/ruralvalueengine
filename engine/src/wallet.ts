import type { Db } from "./db.js";

export async function wallet(db: Db, ownerType: "visitor" | "member", ownerId: string, limit = 50) {
  const balance = await db.query<{ balance: string }>(
    "SELECT COALESCE(SUM(points), 0) AS balance FROM ledger WHERE owner_type = $1 AND owner_id = $2",
    [ownerType, ownerId],
  );
  const entries = await db.query(
    `SELECT l.id, l.points, l.rule_id, l.rule_version, l.event_id, e.type AS event_type, l.created_at
       FROM ledger l JOIN events e ON e.event_id = l.event_id
      WHERE l.owner_type = $1 AND l.owner_id = $2
      ORDER BY l.id DESC LIMIT $3`,
    [ownerType, ownerId, limit],
  );
  return { balance: Number(balance.rows[0]?.balance ?? 0), entries: entries.rows };
}

export async function passport(db: Db, visitorId: string) {
  const rows = await db.query(
    `SELECT kind, target_id, event_id, occurred_at
       FROM passport_entries
      WHERE visitor_id = $1 AND revoked_at IS NULL
      ORDER BY occurred_at DESC`,
    [visitorId],
  );
  return { entries: rows.rows };
}
