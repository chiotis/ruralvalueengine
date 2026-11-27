/**
 * Turn ruralgreece.gr REST records (business, route, pois) into catalogue rows.
 * Field names are the real ACF keys seen on the live site on 2026-11-27.
 */

export type WpKind = "business" | "route" | "pois";
export type CatalogKind = "business" | "route" | "poi";

export const KIND_OF: Record<WpKind, CatalogKind> = { business: "business", route: "route", pois: "poi" };
export const PREFIX: Record<CatalogKind, string> = { business: "biz", route: "route", poi: "poi" };

/** Taxonomies attached to each post type, as top-level arrays of term ids. */
export const TAXONOMIES: Record<WpKind, string[]> = {
  business: ["tags", "price_range", "location", "business-type", "kitchen_type"],
  route: ["categories", "tags", "activity", "difficulty", "location", "path_markers"],
  pois: [
    "tags", "activity", "difficulty", "museum-theme", "monument-status", "period", "location",
    "protection-status", "path_markers", "monument-type", "museum-type", "ecosystem-type", "beach-type", "poi-type",
  ],
};

export interface WpPost {
  id: number;
  slug: string;
  link?: string;
  status?: string;
  modified_gmt: string;
  title: { rendered: string };
  featured_media?: number;
  acf?: Record<string, unknown> | unknown[];
  [taxonomy: string]: unknown;
}

export interface CatalogRow {
  id: string;
  kind: CatalogKind;
  wp_id: number;
  slug: string;
  link: string | null;
  title_el: string;
  title_en: string | null;
  lat: number | null;
  lng: number | null;
  term_ids: number[];
  wp_modified: Date;
  data: Record<string, unknown>;
  media_ids: number[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && x > 0) : []);
const pair = (acf: Record<string, unknown>, el: string, en: string) => ({ el: str(acf[el]), en: str(acf[en]) });

export function parseCoord(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > max) return null;
  return n;
}

export function normalise(wpKind: WpKind, post: WpPost): CatalogRow {
  const kind = KIND_OF[wpKind];
  // ACF returns [] instead of {} when a post has no fields.
  const acf = (Array.isArray(post.acf) ? {} : (post.acf ?? {})) as Record<string, unknown>;
  let lat = parseCoord(acf.latitude, 90);
  let lng = parseCoord(acf.longitude, 180);
  if (lat == null || lng == null) lat = lng = null;

  const taxonomies: Record<string, number[]> = {};
  for (const t of TAXONOMIES[wpKind]) {
    const list = ids(post[t]);
    if (list.length) taxonomies[t] = list;
  }

  const banner = num(acf.banner_image);
  const gallery = ids(acf.photo_gallery);
  const featured = num(post.featured_media);

  const data: Record<string, unknown> = {
    subtitle: pair(acf, "υπότιτλος_el", "υπότιτλος_en"),
    intro: pair(acf, "εισαγωγικό_κείμενο", "εισαγωγικό_κείμενο_en"),
    body: pair(acf, "κεντρικό_κείμενο", "κεντρικό_κείμενο_en"),
    featured_media: featured,
    banner_image: banner,
    photo_gallery: gallery,
    youtube_video: str(acf.youtube_video),
    map_kml: str(acf.map_kml),
    taxonomies,
  };

  if (wpKind === "business") {
    Object.assign(data, {
      address: str(acf.address),
      email: str(acf.email),
      telephone: str(acf.telephone),
      website_url: str(acf.website_url),
      booking_url: str(acf.booking_url), // shown as an external link only
      open_on: str(acf.open_on),
      services: pair(acf, "υπηρεσίες_επιχείρησης_el", "υπηρεσίες_επιχείρησης_en"),
      tourist_packages: pair(acf, "τουριστικά_πακέτα_el", "τουριστικά_πακέτα_en"),
    });
  } else if (wpKind === "route") {
    Object.assign(data, {
      trail_length: str(acf["μήκος_μονοπατιού"]),
      season: pair(acf, "προτεινόμενη_περίοδος_el", "προτεινόμενη_περίοδος_en"),
      duration: pair(acf, "διάρκεια_el", "διάρκεια_en"),
    });
  } else {
    Object.assign(data, {
      address: str(acf.address),
      email: str(acf.email),
      telephone: str(acf.telephone),
      website_url: str(acf.website_url),
      opening_hours: pair(acf, "ωράριο_λειτουργίας_el", "ωράριο_λειτουργίας_en"),
    });
  }

  const modified = new Date(post.modified_gmt.endsWith("Z") ? post.modified_gmt : `${post.modified_gmt}Z`);

  return {
    id: `${PREFIX[kind]}-${post.id}`,
    kind,
    wp_id: post.id,
    slug: post.slug,
    link: str(post.link),
    title_el: decodeEntities(post.title?.rendered ?? "").trim() || post.slug,
    title_en: str(acf.title_en) ? decodeEntities(str(acf.title_en)!) : null,
    lat,
    lng,
    term_ids: [...new Set(Object.values(taxonomies).flat())],
    wp_modified: modified,
    data,
    media_ids: [...new Set([featured, banner, ...gallery].filter((x): x is number => x != null))],
  };
}
