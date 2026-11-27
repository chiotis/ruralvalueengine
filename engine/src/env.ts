import { existsSync } from "node:fs";

/**
 * Load settings from a .env file when one exists (ENV_FILE, or .env in the working directory).
 * Variables already set in the environment win, so systemd's EnvironmentFile still works.
 * CloudPanel starts the engine with pm2, which has no env file of its own, so this is how it gets its settings there.
 */
const file = process.env.ENV_FILE ?? ".env";
if (existsSync(file)) process.loadEnvFile(file);
