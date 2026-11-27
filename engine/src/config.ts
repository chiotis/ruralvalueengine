export interface Config {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  qrKeys: Record<string, string>;
  adminToken: string;
  networkTz: string;
  ruralgreeceUrl?: string;
  wpWebhookSecret?: string;
  smtpUrl?: string;
  mailFrom?: string;
  /** Behind nginx on lighthouse03: trust X-Forwarded-For from the proxy so rate limits see real client IPs. */
  trustProxy?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required environment variable ${name}`);
    return v;
  };
  const cfg: Config = {
    databaseUrl: required("DATABASE_URL"),
    port: Number(env.PORT ?? 8080),
    jwtSecret: required("JWT_SECRET"),
    qrKeys: JSON.parse(required("QR_KEYS")) as Record<string, string>,
    adminToken: required("ADMIN_TOKEN"),
    networkTz: env.NETWORK_TZ ?? "Europe/Athens",
    ruralgreeceUrl: env.RURALGREECE_URL || undefined,
    wpWebhookSecret: env.WP_WEBHOOK_SECRET || undefined,
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM ?? "Rural Greece <no-reply@ruralgreece.gr>",
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  };
  if (cfg.jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  if (cfg.adminToken.length < 24) throw new Error("ADMIN_TOKEN must be at least 24 characters");
  for (const [v, k] of Object.entries(cfg.qrKeys)) if (!/^\d+$/.test(v) || k.length < 16) throw new Error("QR_KEYS needs numeric versions and keys of 16+ characters");
  if (cfg.wpWebhookSecret && cfg.wpWebhookSecret.length < 16) throw new Error("WP_WEBHOOK_SECRET must be at least 16 characters");
  return cfg;
}
