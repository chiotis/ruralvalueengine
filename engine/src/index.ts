import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { buildApp } from "./app.js";
import { ConsoleMailer } from "./mailer.js";
import { WpClient } from "./wordpress/client.js";
import { syncRuralGreece } from "./wordpress/sync.js";

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
await migrate(db);
const app = buildApp(db, cfg, new ConsoleMailer(), { logger: true });
await app.listen({ host: "0.0.0.0", port: cfg.port });

// Content sync: incremental every 15 minutes, full pass every night.
if (cfg.ruralgreeceUrl) {
  const client = new WpClient(cfg.ruralgreeceUrl);
  let running = false;
  let lastFullDay = "";
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const day = new Date().toISOString().slice(0, 10);
      const full = day !== lastFullDay;
      const report = await syncRuralGreece(db, client, { full });
      if (full) lastFullDay = day;
      app.log.info({ report, full }, "ruralgreece sync");
    } catch (err) {
      app.log.error(err, "ruralgreece sync failed");
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, 15 * 60 * 1000).unref();
}
