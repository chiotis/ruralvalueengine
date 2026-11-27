import "./env.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { WpClient } from "./wordpress/client.js";
import { syncRuralGreece } from "./wordpress/sync.js";

const url = process.env.DATABASE_URL;
const site = process.env.RURALGREECE_URL ?? "https://ruralgreece.gr";
if (!url) throw new Error("DATABASE_URL is required");
const db = createPool(url);
await migrate(db);
const report = await syncRuralGreece(db, new WpClient(site), { full: process.argv.includes("--full") });
console.log(JSON.stringify(report));
await db.end();
