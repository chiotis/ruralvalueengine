export type TargetKind = "member" | "poi" | "shared";

/** The facts a rule set may look at. Built by the pipeline from a verified event. */
export interface RuleEvent {
  event_id: string;
  type: string;
  visitor_id: string | null;
  member_ids: string[];
  target_kind: TargetKind | null;
  referral: { from_member_id: string; to_member_id: string } | null;
}

export interface LedgerRow {
  owner_type: "visitor" | "member";
  owner_id: string;
  points: number;
  rule_id: string;
}

export type RuleSet = (ev: RuleEvent) => LedgerRow[];
