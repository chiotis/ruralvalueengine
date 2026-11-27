export interface Config {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  qrKeys: Record<string, string>;
  adminToken: string;
  networkTz: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required environment variable ${name}`);
    return v;
  };
  return {
    databaseUrl: required("DATABASE_URL"),
    port: Number(env.PORT ?? 8080),
    jwtSecret: required("JWT_SECRET"),
    qrKeys: JSON.parse(required("QR_KEYS")) as Record<string, string>,
    adminToken: required("ADMIN_TOKEN"),
    networkTz: env.NETWORK_TZ ?? "Europe/Athens",
  };
}
