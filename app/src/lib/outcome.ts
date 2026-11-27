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
