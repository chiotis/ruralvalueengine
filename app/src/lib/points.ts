/**
 * What a visit earns a visitor, for showing on cards and map pins.
 * Mirrors POINTS_V1 in engine/src/rules/v1.ts (docs/SPEC.md section 6). The engine decides what is
 * actually credited; these are only labels, so keep them in step when the rules change.
 */
export const VISITOR_POINTS = {
  business: 10,
  poiQr: 5,
  poiGeo: 3,
  packageCompleted: 30,
} as const;

export type PlaceKind = "business" | "route" | "poi";

/** A short label like "+10" or "+3–5", or null when a visit there earns nothing by itself (routes). */
export function pointsLabel(kind: PlaceKind): string | null {
  if (kind === "business") return `+${VISITOR_POINTS.business}`;
  if (kind === "poi") return `+${VISITOR_POINTS.poiGeo}–${VISITOR_POINTS.poiQr}`;
  return null;
}

/** Engine catalogue ids start with the kind: "biz-…", "poi-…", "route-…". */
export function kindOfId(id: string): PlaceKind | null {
  if (id.startsWith("biz-")) return "business";
  if (id.startsWith("poi-")) return "poi";
  if (id.startsWith("route-")) return "route";
  return null;
}
