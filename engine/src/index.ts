import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { buildApp } from "./app.js";
import { ConsoleMailer } from "./mailer.js";

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
await migrate(db);
const app = buildApp(db, cfg, new ConsoleMailer(), { logger: true });
await app.listen({ host: "0.0.0.0", port: cfg.port });
