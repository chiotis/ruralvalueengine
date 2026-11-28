/** What a scanned QR code is for. One scanner serves both visitors and businesses. */
export type ScannedQr = { kind: "checkin"; token: string } | { kind: "redeem"; code: string } | { kind: "foreign" };

/** A place or business QR (printed, scanned by visitors to check in). */
export const CHECKIN_PREFIX = "rve://c/";
/** A redemption QR (shown on the visitor's phone, scanned by the business to confirm). */
export const REDEEM_PREFIX = "rve://r/";

export const redeemQr = (code: string) => `${REDEEM_PREFIX}${code}`;

export function parseQr(data: string): ScannedQr {
  const d = data.trim();
  if (d.startsWith(CHECKIN_PREFIX)) return { kind: "checkin", token: d };
  if (d.startsWith(REDEEM_PREFIX)) {
    const code = d.slice(REDEEM_PREFIX.length);
    if (/^\d{6}$/.test(code)) return { kind: "redeem", code };
  }
  return { kind: "foreign" };
}

/** The place a check-in QR points at (its catalogue id), e.g. "biz-123" from "rve://c/biz-123/1/<sig>". */
export function checkinTarget(token: string): string | null {
  if (!token.startsWith(CHECKIN_PREFIX)) return null;
  const target = token.slice(CHECKIN_PREFIX.length).split("/")[0];
  return /^[a-z0-9-]+$/.test(target ?? "") ? target! : null;
}
