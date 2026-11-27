import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

// The panel is two static files in engine/admin/. They hold no secrets: the admin
// types the ADMIN_TOKEN into the page, and every call goes through the admin API.
const dir = new URL("../admin/", import.meta.url);
const files: Record<string, { body: string; type: string }> = {
  "/admin": { body: readFileSync(new URL("index.html", dir), "utf8"), type: "text/html; charset=utf-8" },
  "/admin/app.js": { body: readFileSync(new URL("app.js", dir), "utf8"), type: "text/javascript; charset=utf-8" },
  "/admin/app.css": { body: readFileSync(new URL("app.css", dir), "utf8"), type: "text/css; charset=utf-8" },
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function registerAdminPanel(app: FastifyInstance) {
  for (const [path, f] of Object.entries(files)) {
    app.get(path, async (_req, reply) =>
      reply.type(f.type).header("content-security-policy", CSP).header("cache-control", "no-cache").send(f.body),
    );
  }
  app.get("/admin/", async (_req, reply) => reply.redirect("/admin"));
}
