# Rural Value Engine: build spec (v0.1, draft for review)

Source: "Rural Value Engine Τεχνική Περιγραφή" (Drive) and decisions agreed with Chris on 2026-11-27.

## 1. Purpose

ruralgreece.gr and epaithros+ show what the network has: routes, points of interest and businesses. Neither can show what the network *does*: real visits and real cooperation between members. The Rural Value Engine records those as verified events, credits them to the right members under versioned rules and exposes the results to visitors, members and ETAM.

The deliverable is an Android and iOS app for ETAM, backed by the engine on the `lighthouse03` server.

## 2. Scope decisions

| Topic | Decision |
|---|---|
| Platforms | Android + iOS from one codebase (React Native, Expo, TypeScript) |
| Engine | Node.js (TypeScript) + PostgreSQL, standalone service on `lighthouse03` |
| Content sources | WordPress REST API of ruralgreece.gr (and epaithros+, see open questions) |
| Bookings | None. Neither site takes bookings. `acf.booking_url` is shown as an external link only. |
| Money | None. Wallet holds in-app points only; no payments, vouchers or cash value. |
| Distribution | Manual test installs (APK on Android, ad-hoc / TestFlight later on iOS). No store accounts yet. |
| Languages | Greek (default) and English. Content already has EL/EN fields in ACF. |
| Look | Colours and type close to ruralgreece.gr (see `docs/theme.json`). |

## 3. Users and roles

- **Visitor**: anyone with the app. Can browse without an account; needs an account to check in, collect points and keep a Passport. Login is passwordless: the visitor enters an email, receives a 6-digit code, and is signed in; the session stays on the device (refresh token) so they rarely repeat it. Sign in with Apple/Google can be added later. Stored with a pseudonymous id in the engine.
- **Member**: a business or organisation of the network. Members have an account on epaithros+ (LMS, research and small services) and are promoted on ruralgreece.gr as a `business`, shown along the routes near them. Members log in to the member area of the same app with their **existing epaithros+ credentials**.
- **Network admin (ETAM)**: web admin panel (part of the engine), not in the mobile app. Manages rules, QR codes, members, corrections and reports.

## 4. Events (what the engine counts)

Catalogue content (a route, a POI or a business listing) is **not** an event. Only behaviour is counted:

| Event type | Produced by | Verified by |
|---|---|---|
| `checkin.qr` | Visitor scans a member's or POI's QR code in the app | Signed QR token + server time window + optional GPS distance check |
| `checkin.geo` | Visitor taps "I'm here" at a POI that has no physical QR | GPS within the POI's radius (default 75 m, max accuracy 50 m), dwell of at least 2 minutes, one per POI per day; earns fewer points than a QR check-in |
| `route.completed` | Visitor checks in at the required stops of a route or package | All component check-ins verified |
| `referral.issued` | Member A refers a visitor to member B (in-app referral code or QR) | Issued by an authenticated member |
| `referral.redeemed` | Visitor checks in at member B with A's referral | Matching `checkin.qr` at B within the validity window |
| `partnership.created` | Two members confirm a cooperation (epaithros Connect) | Both members confirm |
| `interaction.*` | Visitor saves, shares or opens a route, POI or package | Logged for analytics only; earns no points by default |
| `correction` / `cancellation` | Admin, or an automatic rule | Admin identity, linked to the original event |

Every event uses the common envelope in `docs/DATA-CONTRACT.md`. Events are immutable; corrections are new events that reference the original.

## 5. Engine pipeline

1. **Ingest**: app API, WordPress webhooks, CSV import.
2. **Normalise** into the common envelope.
3. **Verify**: schema, source signature, QR token, time window. Reject with a reason code.
4. **Deduplicate**: by `event_id`, and by a business key (same visitor + same QR + same day = one check-in). Re-sending never credits twice.
5. **Correlate**: visitor, member(s), route, package and referral, using explicit ids only.
6. **Apply rules**: each rule set has a version number. Every output row stores `event_id` + `rule_version`, so any result can be traced and recomputed.
7. **Write outputs**: Wallet ledger, Passport entries, Impact Score inputs, analytics aggregates.

## 6. Point rules, first version (`rules v1`), to be tuned with ETAM

| Case | Visitor | Member(s) |
|---|---|---|
| First check-in at a member on a given day | +10 | +5 to the member |
| Repeat scan at the same place on the same day | 0 (duplicate) | 0 |
| Check-in at a POI (QR) | +5 | none |
| Check-in at a POI (GPS, no QR) | +3 | none |
| Completed route or package | +30 bonus | +5 to each member on it |
| Redeemed referral (A refers to B) | +5 | A +10 (referrer), B +5 (host) |
| New confirmed partnership | none | +20 to each member |
| Visit shared by several members (one QR for a co-hosted experience) | +10 once | +5 to each co-host |
| Cancellation or correction | reverses the original rows | reverses the original rows |

Points are spent only on rewards that members or ETAM define (for example "free coffee", or a badge). Redemption is an event too (`wallet.redeemed`), confirmed by the member scanning the visitor's code.

## 7. Modules to app features

| # | Module | Visitor side | Member side | Admin |
|---|---|---|---|---|
| 1 | Impact & Referral Engine | none (runs in the background) | Referral codes, referral history | Rule editor, audit trail |
| 2 | Rural Wallet | Points balance, history, rewards, redeem | Define rewards, confirm redemptions | Ledger, adjustments |
| 3 | Rural Value Network | Map of members, routes and POIs | Network view of partners | Graph and reports |
| 4 | Dynamic Rural Packaging | Themed packages (several members + route), progress | Join or propose packages | Create and publish packages |
| 5 | Rural Impact Score | Public badge on the member profile | Score, breakdown, trend | Criteria and weights (versioned) |
| 6 | Rural Passport | Verified experiences, stamps, badges | none | none |
| 7 | epaithros Connect | none | Find members, request and confirm partnerships | Moderate |
| 8 | AI Matchmaking | "You may also like" suggestions | Suggested partners with reasons | Tune or disable |
| none | Premium Analytics | none | Visits, referrals and origin of visitors | Network dashboards and exports |

## 8. App screens (first pass)

**Visitor tabs:** Explore (destination picker: Crete / Macedonia / Peloponnese; routes, POIs and businesses by type: Gastronomy, Stay, Experience, Products) · Map · Scan (QR) · Passport · Wallet · Profile.

**Detail screens:** Route (description, length, duration, difficulty, KML track on the map, stops), POI, Business (contact details, external website or booking link, Impact Score badge), Package.

**Member area** (same app, role switch after login): Dashboard (score, this month's visits and referrals) · My QR codes · Referrals · Partners (Connect + Matchmaking) · Rewards · Analytics.

Offline: catalogue cached for browsing; check-ins queued offline with the signed QR token and sent when back online (verified server-side by scan time).

## 9. Delivery order

1. This spec + data contract (this PR).
2. Engine core: ingest → verify → dedupe → rules → Wallet/Passport, with tests for the four edge cases in the source document (repeat QR scan, cancellation, visit shared by several members, corrected event).
3. WordPress sync plugin (ruralgreece.gr, then epaithros+).
4. App: Explore + Map → Scan + Passport + Wallet → Member area → Packages → Impact Score + Analytics → Connect + Matchmaking.
5. Admin panel, hardening, handover docs for ETAM.

## 10. Decisions from review (2026-11-27)

1. **epaithros+** is the members' platform (LMS, research, small services). ruralgreece.gr promotes those members through routes, each route showing nearby businesses and POIs. Members log in with epaithros+ accounts; each member must be linked to its `business` on ruralgreece.gr (link field to be confirmed when we inspect epaithros+).
2. **Colours**: greens `#1c2c23`, `#376245`, `#2d9141` are the main colours; `#7a3123`, `#8a5a3c`, `#b1d1ea` are complementary/accent. Fonts still to confirm.
3. **QR codes**: on businesses for sure, on POIs where ETAM places them. POIs without a QR use GPS check-in (`checkin.geo`).
4. **Point values**: keep section 6 as is for now; ETAM tunes later (rules are versioned).
5. **Visitor login**: passwordless email code.

### Still open
- Fonts used on ruralgreece.gr.
- How an epaithros+ member record is linked to a ruralgreece.gr `business` (same email, or an id field).
