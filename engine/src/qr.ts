import { createHmac, timingSafeEqual } from "node:crypto";

// QR payload: rve://c/<target>/<key_version>/<signature>
// signature = base64url(HMAC-SHA256(key[version], "<target>:<version>")) truncated to 22 chars.

const PREFIX = "rve://c/";

function sign(key: string, target: string, version: string): string {
  return createHmac("sha256", key).update(`${target}:${version}`).digest("base64url").slice(0, 22);
}

export function makeQrToken(keys: Record<string, string>, target: string, version: number): string {
  const key = keys[String(version)];
  if (!key) throw new Error(`No QR key for version ${version}`);
  if (!/^[a-z0-9-]+$/.test(target)) throw new Error("QR target ids must be lowercase letters, digits and dashes");
  return `${PREFIX}${target}/${version}/${sign(key, target, String(version))}`;
}

export type QrParse =
  | { ok: true; target: string; version: number }
  | { ok: false; reason: "qr_malformed" | "qr_unknown_key" | "qr_bad_signature" };

export function verifyQrToken(keys: Record<string, string>, token: string): QrParse {
  if (!token.startsWith(PREFIX)) return { ok: false, reason: "qr_malformed" };
  const parts = token.slice(PREFIX.length).split("/");
  if (parts.length !== 3) return { ok: false, reason: "qr_malformed" };
  const [target, version, signature] = parts as [string, string, string];
  if (!/^[a-z0-9-]+$/.test(target) || !/^\d+$/.test(version)) return { ok: false, reason: "qr_malformed" };
  const key = keys[version];
  if (!key) return { ok: false, reason: "qr_unknown_key" };
  const expected = Buffer.from(sign(key, target, version));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "qr_bad_signature" };
  }
  return { ok: true, target, version: Number(version) };
}
