import { z } from "zod";

export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Event types a client may submit. Derived types are produced by the engine itself. */
export const INPUT_TYPES = [
  "checkin.qr",
  "checkin.geo",
  "interaction.view",
  "interaction.save",
  "interaction.share",
  "cancellation",
  "correction",
] as const;

export const DERIVED_TYPES = ["referral.redeemed", "route.completed"] as const;

export type InputType = (typeof INPUT_TYPES)[number];
export type EventType = InputType | (typeof DERIVED_TYPES)[number];

const Geo = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative().optional(),
});

export const EventInputSchema = z.object({
  event_id: z.string().regex(ULID, "event_id must be a ULID"),
  type: z.enum(INPUT_TYPES),
  occurred_at: z.string().datetime({ offset: true }),
  visitor_id: z.string().optional(),
  poi_id: z.string().optional(),
  route_id: z.string().optional(),
  refers_to_event_id: z.string().optional(),
  source_ref: z.string().max(200).optional(),
  geo: Geo.optional(),
  payload: z.record(z.unknown()).default({}),
});

export type EventInput = z.infer<typeof EventInputSchema>;
export type GeoPoint = z.infer<typeof Geo>;

export type Actor =
  | { kind: "visitor"; visitorId: string }
  | { kind: "member"; memberId: string }
  | { kind: "admin" };
