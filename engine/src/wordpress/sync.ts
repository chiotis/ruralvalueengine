import type { Db } from "../db.js";
import { WpClient } from "./client.js";
import { KIND_OF, PREFIX, normalise, type CatalogRow, type WpKind, type WpPost } from "./normalise.js";

const KINDS: WpKind[] = ["business", "route", "pois"];
/** Term taxonomies to mirror (REST base). */
const TERM_TAXONOMIES = [
  "location", "business-type", "kitchen_type", "price_range", "activity", "difficulty", "path_markers",
  "poi-type", "museum-type", "museum-theme", "monument-type", "monument-status", "period",
  "ecosystem-type", "beach-type", "protection-status", "categories", "tags",
];

export interface SyncReport {
  upserted: Record<CatalogRow["kind"], number>;
  deleted: number;
  media: number;
  terms: number;
}

/**
 * Mirror ruralgreece.gr content into the catalogue and keep members / pois /
 * routes in step. Incremental by default (posts modified since the last run);
 * `full` re-reads everything, refreshes terms and marks vanished posts deleted.
 */
export async function syncRuralGreece(db: Db, client: WpClient, opts: { full?: boolean } = {}): Promise<SyncReport> {
  const report: SyncReport = { upserted: { business: 0, route: 0, poi: 0 }, deleted: 0, media: 0, terms: 0 };
  const mediaIds = new Set<number>();

  if (opts.full) report.terms = await syncTerms(db, client);

  for (const wpKind of KINDS) {
    const source = `ruralgreece:${wpKind}`;
    const state = (await db.query<{ last_modified: Date | null }>("SELECT last_modified FROM sync_state WHERE source = $1", [source])).rows[0];
    // Step back a day: WordPress compares in site-local time, and re-reading a few posts is harmless.
    const since = !opts.full && state?.last_modified ? new Date(state.last_modified.getTime() - 24 * 60 * 60 * 1000) : null;
    const params = { orderby: "modified", order: "asc", status: "publish", ...(since ? { modified_after: since.toISOString() } : {}) };

    const seen: number[] = [];
    let newest = state?.last_modified ?? null;
    for await (const post of client.all<WpPost>(wpKind, params)) {
      const row = normalise(wpKind, post);
      await upsertRow(db, row);
      row.media_ids.forEach((m) => mediaIds.add(m));
      seen.push(row.wp_id);
      report.upserted[row.kind]++;
      if (!newest || row.wp_modified > newest) newest = row.wp_modified;
    }

    if (opts.full) {
      const gone = await db.query(
        "UPDATE catalog_items SET deleted_at = now() WHERE kind = $1 AND deleted_at IS NULL AND NOT (wp_id = ANY($2)) RETURNING id",
        [KIND_OF[wpKind], seen],
      );
      report.deleted += gone.rowCount ?? 0;
    }
    await db.query(
      `INSERT INTO sync_state(source, last_modified, last_full_at, last_run_at) VALUES ($1, $2, CASE WHEN $3 THEN now() END, now())
       ON CONFLICT (source) DO UPDATE SET last_modified = EXCLUDED.last_modified, last_run_at = now(),
         last_full_at = COALESCE(EXCLUDED.last_full_at, sync_state.last_full_at)`,
      [source, newest, !!opts.full],
    );
  }

  report.media = await syncMedia(db, client, [...mediaIds]);
  return report;
}

/** Fetch and store a single post, used by the webhook. */
export async function syncOne(db: Db, client: WpClient, wpKind: WpKind, wpId: number): Promise<CatalogRow> {
  const { body } = await client.get<WpPost>(`${wpKind}/${wpId}`);
  const row = normalise(wpKind, body);
  if (body.status && body.status !== "publish") {
    await markDeleted(db, wpKind, wpId);
    return row;
  }
  await upsertRow(db, row);
  await syncMedia(db, client, row.media_ids);
  return row;
}

export async function markDeleted(db: Db, wpKind: WpKind, wpId: number): Promise<void> {
  await db.query("UPDATE catalog_items SET deleted_at = now() WHERE kind = $1 AND wp_id = $2", [KIND_OF[wpKind], wpId]);
}

async function upsertRow(db: Db, r: CatalogRow): Promise<void> {
  await db.query(
    `INSERT INTO catalog_items(id, kind, wp_id, slug, link, title_el, title_en, lat, lng, term_ids, data, wp_modified, synced_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), NULL)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, link = EXCLUDED.link, title_el = EXCLUDED.title_el,
       title_en = EXCLUDED.title_en, lat = EXCLUDED.lat, lng = EXCLUDED.lng, term_ids = EXCLUDED.term_ids,
       data = EXCLUDED.data, wp_modified = EXCLUDED.wp_modified, synced_at = now(), deleted_at = NULL`,
    [r.id, r.kind, r.wp_id, r.slug, r.link, r.title_el, r.title_en, r.lat, r.lng, r.term_ids, JSON.stringify(r.data), r.wp_modified],
  );
  // Keep the engine's own tables in step. Radius and QR settings are engine-owned and left alone.
  if (r.kind === "business") {
    await db.query(
      `INSERT INTO members(id, wp_id, name, lat, lng) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET wp_id = EXCLUDED.wp_id, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
      [r.id, r.wp_id, r.title_el, r.lat, r.lng],
    );
  } else if (r.kind === "poi" && r.lat != null && r.lng != null) {
    await db.query(
      `INSERT INTO pois(id, wp_id, name, lat, lng) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET wp_id = EXCLUDED.wp_id, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
      [r.id, r.wp_id, r.title_el, r.lat, r.lng],
    );
  } else if (r.kind === "route") {
    await db.query(
      `INSERT INTO routes(id, wp_id, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET wp_id = EXCLUDED.wp_id, name = EXCLUDED.name`,
      [r.id, r.wp_id, r.title_el],
    );
  }
}

async function syncTerms(db: Db, client: WpClient): Promise<number> {
  let n = 0;
  for (const taxonomy of TERM_TAXONOMIES) {
    for await (const t of client.all<{ id: number; name: string; slug: string; parent?: number }>(taxonomy, { hide_empty: "false" })) {
      await db.query(
        `INSERT INTO catalog_terms(taxonomy, id, name, slug, parent) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (taxonomy, id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, parent = EXCLUDED.parent`,
        [taxonomy, t.id, t.name, t.slug, t.parent ?? 0],
      );
      n++;
    }
  }
  return n;
}

async function syncMedia(db: Db, client: WpClient, ids: number[]): Promise<number> {
  const known = new Set(
    (await db.query<{ id: number }>("SELECT id FROM catalog_media WHERE id = ANY($1)", [ids])).rows.map((r) => r.id),
  );
  const missing = ids.filter((i) => !known.has(i));
  let n = 0;
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    for await (const m of client.all<{ id: number; source_url: string; media_details?: { sizes?: Record<string, { source_url: string; width: number; height: number }> } }>(
      "media",
      { include: chunk.join(","), _fields: "id,source_url,media_details" },
    )) {
      const sizes = Object.fromEntries(
        Object.entries(m.media_details?.sizes ?? {}).map(([k, v]) => [k, { url: v.source_url, w: v.width, h: v.height }]),
      );
      await db.query(
        "INSERT INTO catalog_media(id, source_url, sizes) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url, sizes = EXCLUDED.sizes",
        [m.id, m.source_url, JSON.stringify(sizes)],
      );
      n++;
    }
  }
  return n;
}

export { PREFIX };
