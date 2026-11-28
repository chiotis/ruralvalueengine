import type { EventResult } from "./api";

export type Outcome =
  | { kind: "ok"; points: number; extra: string[] }
  | { kind: "duplicate" }
  | { kind: "queued" }
  | { kind: "rejected"; reason?: string };

/** Turn the engine's results for one check-in (plus derived events) into what the visitor sees. */
export function describeOutcome(results: EventResult[] | null): Outcome {
  if (!results || !results[0]) return { kind: "queued" };
  const main = results[0];
  if (main.status === "duplicate" || main.status === "already_received") return { kind: "duplicate" };
  if (main.status === "rejected") return { kind: "rejected", reason: main.reason };
  const mine = results.flatMap((r) => r.points).filter((p) => p.owner_type === "visitor");
  return { kind: "ok", points: mine.reduce((n, p) => n + p.points, 0), extra: results.slice(1).map((r) => r.type) };
}

/** Which result screen the scanner shows. */
export type ScanView = "success" | "duplicate" | "queued" | "too_far" | "location" | "invalid" | "other";

const INVALID_QR = new Set(["qr_missing", "qr_malformed", "qr_unknown_key", "qr_bad_signature", "qr_unknown_target", "qr_rotated"]);

export function scanView(o: Outcome): ScanView {
  if (o.kind === "ok") return "success";
  if (o.kind === "duplicate" || o.kind === "queued") return o.kind;
  if (o.reason === "geo_too_far") return "too_far";
  if (o.reason === "geo_required" || o.reason === "geo_inaccurate") return "location";
  if (o.reason && INVALID_QR.has(o.reason)) return "invalid";
  return "other";
}
