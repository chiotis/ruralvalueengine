import type { LedgerRow, RuleSet } from "./types.js";

/**
 * Point rules v1 (docs/SPEC.md section 6).
 * Pure function: same event in, same rows out. Never read the database here.
 */
export const POINTS_V1 = {
  checkinMemberVisitor: 10,
  checkinMemberHost: 5,
  checkinPoiQr: 5,
  checkinPoiGeo: 3,
  routeCompletedVisitor: 30,
  routeCompletedMember: 5,
  referralVisitor: 5,
  referralReferrer: 10,
  referralHost: 5,
} as const;

export const rulesV1: RuleSet = (ev) => {
  const rows: LedgerRow[] = [];
  const visitor = (points: number, rule_id: string) => {
    if (ev.visitor_id) rows.push({ owner_type: "visitor", owner_id: ev.visitor_id, points, rule_id });
  };
  const member = (id: string, points: number, rule_id: string) =>
    rows.push({ owner_type: "member", owner_id: id, points, rule_id });

  switch (ev.type) {
    case "checkin.qr":
      if (ev.target_kind === "poi") {
        visitor(POINTS_V1.checkinPoiQr, "checkin.poi.qr");
      } else {
        visitor(POINTS_V1.checkinMemberVisitor, "checkin.member.visitor");
        // A visit shared by several members credits each co-host in full.
        for (const id of new Set(ev.member_ids)) member(id, POINTS_V1.checkinMemberHost, "checkin.member.host");
      }
      break;
    case "checkin.geo":
      visitor(POINTS_V1.checkinPoiGeo, "checkin.poi.geo");
      break;
    case "route.completed":
      visitor(POINTS_V1.routeCompletedVisitor, "route.completed.visitor");
      for (const id of new Set(ev.member_ids)) member(id, POINTS_V1.routeCompletedMember, "route.completed.member");
      break;
    case "referral.redeemed":
      if (ev.referral) {
        visitor(POINTS_V1.referralVisitor, "referral.visitor");
        member(ev.referral.from_member_id, POINTS_V1.referralReferrer, "referral.referrer");
        member(ev.referral.to_member_id, POINTS_V1.referralHost, "referral.host");
      }
      break;
    default:
      break; // interactions earn nothing in v1
  }
  return rows;
};
