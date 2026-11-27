import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { ulid } from "ulid";
import type { Db } from "./db.js";
import type { Mailer } from "./mailer.js";

export const AUTH_LIMITS = {
  codeTtlMs: 10 * 60 * 1000,
  maxCodesPerHour: 5,
  maxAttempts: 5,
  accessTtlS: 60 * 60,
  refreshTtlMs: 90 * 24 * 60 * 60 * 1000,
} as const;

export class AuthError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class Auth {
  private key: Uint8Array;
  constructor(
    private db: Db,
    private mailer: Mailer,
    private secret: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  private emailHash(email: string) {
    return sha256(`${this.secret}:email:${normaliseEmail(email)}`);
  }

  /** Send a 6-digit code to the email. Same response whether or not the email is known. */
  async start(email: string): Promise<void> {
    const eh = this.emailHash(email);
    const recent = await this.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM login_codes WHERE email_hash = $1 AND created_at > now() - interval '1 hour'",
      [eh],
    );
    if (Number(recent.rows[0]?.n ?? 0) >= AUTH_LIMITS.maxCodesPerHour) throw new AuthError("too_many_codes", 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.query("INSERT INTO login_codes(email_hash, code_hash, expires_at) VALUES ($1, $2, $3)", [
      eh,
      sha256(`${eh}:${code}`),
      new Date(Date.now() + AUTH_LIMITS.codeTtlMs),
    ]);
    await this.mailer.sendLoginCode(normaliseEmail(email), code);
  }

  /** Check the latest code; on success create the visitor if new and issue tokens. */
  async verify(email: string, code: string) {
    const eh = this.emailHash(email);
    const row = (
      await this.db.query<{ id: string; code_hash: string; attempts: number; expires_at: Date; used_at: Date | null }>(
        "SELECT id, code_hash, attempts, expires_at, used_at FROM login_codes WHERE email_hash = $1 ORDER BY created_at DESC LIMIT 1",
        [eh],
      )
    ).rows[0];
    if (!row || row.used_at || row.expires_at.getTime() < Date.now()) throw new AuthError("code_expired");
    if (row.attempts >= AUTH_LIMITS.maxAttempts) throw new AuthError("too_many_attempts", 429);
    const expected = Buffer.from(row.code_hash);
    const given = Buffer.from(sha256(`${eh}:${code.trim()}`));
    if (!timingSafeEqual(expected, given)) {
      await this.db.query("UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
      throw new AuthError("code_invalid");
    }
    await this.db.query("UPDATE login_codes SET used_at = now() WHERE id = $1", [row.id]);

    const visitorId = `v_${ulid()}`;
    const v = await this.db.query<{ id: string }>(
      `INSERT INTO visitors(id, email_hash) VALUES ($1, $2)
       ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
       RETURNING id`,
      [visitorId, eh],
    );
    const id = v.rows[0]!.id;
    await this.db.query(
      "INSERT INTO visitor_contacts(visitor_id, email) VALUES ($1, $2) ON CONFLICT (visitor_id) DO UPDATE SET email = EXCLUDED.email",
      [id, normaliseEmail(email)],
    );
    return { visitor_id: id, ...(await this.issue(id)) };
  }

  /** Exchange a refresh token for new tokens. The old refresh token stops working. */
  async refresh(refreshToken: string) {
    const th = sha256(refreshToken);
    const row = (
      await this.db.query<{ visitor_id: string }>(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING visitor_id",
        [th],
      )
    ).rows[0];
    if (!row) throw new AuthError("refresh_invalid", 401);
    return { visitor_id: row.visitor_id, ...(await this.issue(row.visitor_id)) };
  }

  private async issue(visitorId: string) {
    const access_token = await new SignJWT({ role: "visitor" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(visitorId)
      .setIssuedAt()
      .setExpirationTime(`${AUTH_LIMITS.accessTtlS}s`)
      .sign(this.key);
    const refresh_token = randomBytes(32).toString("base64url");
    await this.db.query("INSERT INTO refresh_tokens(token_hash, visitor_id, expires_at) VALUES ($1, $2, $3)", [
      sha256(refresh_token),
      visitorId,
      new Date(Date.now() + AUTH_LIMITS.refreshTtlMs),
    ]);
    return { access_token, refresh_token, expires_in: AUTH_LIMITS.accessTtlS };
  }

  async visitorFromAccessToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      if (payload.role !== "visitor" || typeof payload.sub !== "string") throw new Error("bad claims");
      return payload.sub;
    } catch {
      throw new AuthError("unauthorized", 401);
    }
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}
