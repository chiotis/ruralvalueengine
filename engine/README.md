# Rural Value Engine (backend)

Node.js + TypeScript + PostgreSQL service that receives events from the app, verifies them, removes duplicates, applies versioned point rules and keeps the Wallet ledger and Rural Passport. See `../docs/SPEC.md` and `../docs/DATA-CONTRACT.md`.

## What's in this first version

- **Events:** QR check-in (`checkin.qr`), GPS check-in at POIs without a QR (`checkin.geo`), interactions, and admin `cancellation` / `correction`.
- **Derived events:** `referral.redeemed` (check-in with a member's referral code) and `route.completed` (all stops of a route checked in).
- **Verification:** signed QR codes with key rotation, a time window (up to 5 min clock skew, up to 3 days offline), a distance check when the phone sends a location, and GPS accuracy, radius and dwell time for POI check-ins.
- **Deduplication:** by `event_id` (re-sent events are ignored) and one check-in per visitor, per place, per Athens calendar day (QR and GPS at the same POI count once).
- **Rules:** `src/rules/v1.ts`, a pure function. Every ledger row stores its `event_id`, `rule_version` and `rule_id`. Balances are always summed from the ledger.
- **Corrections and cancellations:** the original event stays on record; reversal rows point at the rows they undo. Cancelling a check-in also cancels its referral and any route bonus it unlocked.
- **Login:** passwordless email code (6 digits, 10 minutes, 5 attempts, 5 codes per hour), a 1-hour access token, and a 90-day rotating refresh token.
- **Admin API** (bearer `ADMIN_TOKEN`): members, POIs, QR targets (returns the string to print as a QR code), routes and stops, referral codes, member wallets.

- **Content sync from ruralgreece.gr:** businesses, routes, POIs, terms and media, plus a catalogue API (`/v1/catalog/{businesses,routes,pois}`, `/v1/catalog/item/:id` with nearby places and, for routes, the KML track as a simplified path with stops) and a signed webhook for the `rve-sync` plugin. Run `npm run sync -- --full` by hand, or let the server do it every 15 minutes.

- **Member area:** login with the business email listed on ruralgreece.gr (or emails ETAM adds), a dashboard, the member's QR codes, referral codes, epaithros Connect partnerships (both sides confirm, +20 points each once), matchmaking suggestions with reasons, member rewards, visitor redemption with a 6-digit code confirmed by the member, and analytics including where else their visitors go.
- **Packages:** themed sets of member stops with a visitor progress view; completing one pays the route bonus.
- **Rural Impact Score** (`score-v1`, 0–100): 90 days of verified visitors, referrals, partnerships and completed routes, on a log scale, with every input shown.
- **Network analytics** for ETAM: events by type and status, rejection reasons, top members, active visitors and points issued.

- **Admin panel for ETAM** at `/admin` (Greek): overview and sync, members and extra logins, POIs and their radius, printable QR sheets, packages, network rewards, partnerships, events with cancellation, and network analytics. It uses the admin API with `ADMIN_TOKEN`.
- **Email:** login codes go out over SMTP (`SMTP_URL`), in Greek and English. Without it they are written to the log.
- **Hardening:** per-IP limits on login and on wrong admin tokens, security headers, a strict CSP on the admin panel, and start-up checks that refuse short secrets.

Not yet included: login with epaithros+ accounts (members currently log in by email code) and an LLM-based matchmaking layer.

## Run locally

```bash
cp .env.example .env        # fill in values
npm ci
npm run migrate
npm run dev                 # http://localhost:8080/health
```

## Tests

Tests need a PostgreSQL database they can wipe:

```bash
DATABASE_URL=postgres://postgres@localhost:5433/rve_test npm test
```

The pipeline tests cover the four edge cases from the technical description: a repeated QR scan, a cancellation, a visit shared by several members, and a corrected event.

## Deploying to lighthouse03

See `../docs/DEPLOY.md`. On a fresh Ubuntu VPS, `../deploy/install.sh` sets everything up in one go. On lighthouse03 (CloudPanel), the engine runs as a Node.js site under pm2 and reads `engine/.env`.
