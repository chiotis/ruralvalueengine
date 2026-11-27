import type { RuleSet } from "./types.js";
import { rulesV1 } from "./v1.js";

/** Every rule set ever activated must stay here so past results can be recomputed. */
export const RULE_SETS: Record<string, RuleSet> = {
  v1: rulesV1,
};

export function getRuleSet(version: string): RuleSet {
  const rs = RULE_SETS[version];
  if (!rs) throw new Error(`Unknown rule set version ${version}`);
  return rs;
}

export type { RuleSet, RuleEvent, LedgerRow, TargetKind } from "./types.js";
