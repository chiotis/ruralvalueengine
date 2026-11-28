# Roadmap: app redesign (Google Stitch, 2026-11-28)

The Stitch designs are in `design/stitch_rural_greece_travel_companion/` (one folder per screen with `screen.png` and `code.html`).
They were reviewed with Chris on 2026-11-28. Decisions:

- **We keep our own data and rules.** The designs use mock numbers (150 m / 75 m QR radius, +15 / +45 points, ratings, a 35-stamp total). Those are placeholders only. The app uses the engine's values: rules v1 points (`engine/src/rules/v1.ts`), the 500 m QR distance check, and GPS check-ins at 75 m for 2 minutes.
- **Brand colours stay** (`docs/theme.json`), not Stitch's generated palette.

## Batch 1: build now (app only, the engine already supports it)

| | Feature | Effort |
|---|---|---|
| A | New look everywhere: warm cream surfaces, rounded cards, serif headings, icon chips, light header with a points pill | M–L |
| F | Featured packages and routes carousel on Explore | S–M |
| G | Points a visit earns (rules v1) on cards and map pins | S |
| H | Map: category chips, map/list toggle, place card that slides up with directions | M |
| I | Package progress as a step-by-step timeline | S–M |
| K | Scan success with a stamp, confetti and the new balance | S–M |
| L | Scanner states: too far (with a distance bar), not our QR, location needed, saved offline | M |
| N | GPS check-in countdown ring and distance | S–M |

## Batch 2: next (needs small engine work)

| | Feature | Engine work | Effort |
|---|---|---|---|
| B | Traveller levels ("level 3, 60 points to level 4"), from lifetime points | Level thresholds as a versioned rule, returned with the wallet | S + S |
| C | Stamp collection: "8 of N", locked stamps, counts per region | Passport returns collected and total per `location` term (all QR and GPS places) | M |
| E | Categories on Explore and Map (Food, Stays, Crafts, Nature, Culture) | `GET /v1/catalog/terms`, plus a mapping from the WordPress taxonomies to these categories | M |
| Q | Wallet: collected and redeemed totals; reward categories; "2 left" stock | Totals in the wallet response; `category` and `quantity` on rewards | S / S / M |
| R | Redemption screen updates live: "waiting for the business", then success | `GET /v1/me/redemptions/:id` status | S–M |
| S | Business area on one page: today's visits and redemptions, scan or type a code, offers with pause/edit and monthly counts | Today's stats; edit and pause a reward; redemptions per reward | M |
| Y | Saved places (bookmark) | List of `interaction.save` per visitor, and unsave | M |

## Batch 3: later (bigger, or needs a decision)

| | Feature | Notes | Effort |
|---|---|---|---|
| D | Badges (regional badges, a badge for redeeming) | The spec mentions badges in the Passport module but they are not defined yet. Needs badge definitions, award rules and admin | L |
| O | Visitor name and avatar ("Καλημέρα, Ελένη") | Visitors are pseudonymous today; an optional display name kept apart from the visitor id | M |
| M | Typed code for a place QR when the camera can't read it (e.g. "MET-204") | Short codes per QR target, printed under the QR; lookup endpoint with rate limits | M |
| P | Invite a friend, both get points | A new visitor-to-visitor referral type in the rules; needs ETAM's OK on the values | M–L |

## Not planned

Star ratings and reviews (no data source), Google/Apple sign-in, offline map downloads, "you're near" notifications, a travel journal, the weather/altitude header and "open now". Each is large or depends on data we don't have.
