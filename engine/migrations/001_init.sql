-- Rural Value Engine: core schema (v1)

CREATE TABLE members (
  id          text PRIMARY KEY,            -- 'biz-<wp business id>'
  wp_id       integer UNIQUE,
  name        text NOT NULL,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pois (
  id          text PRIMARY KEY,            -- 'poi-<wp pois id>'
  wp_id       integer UNIQUE,
  name        text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  radius_m    integer NOT NULL DEFAULT 75,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A place that can be checked in to by QR: a member, a POI, or a shared
-- experience co-hosted by several members.
CREATE TABLE qr_targets (
  id           text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('member', 'poi', 'shared')),
  member_ids   text[] NOT NULL DEFAULT '{}',
  poi_id       text REFERENCES pois(id),
  lat          double precision,
  lng          double precision,
  key_version  integer NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routes (
  id          text PRIMARY KEY,            -- 'route-<wp route id>' or 'pkg-<id>'
  wp_id       integer,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Stops a visitor must check in at to complete a route or package.
-- target_id is a qr_targets id, or a poi id for GPS check-ins.
CREATE TABLE route_stops (
  route_id   text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  target_id  text NOT NULL,
  position   integer NOT NULL,
  PRIMARY KEY (route_id, target_id)
);
CREATE INDEX route_stops_target ON route_stops(target_id);

CREATE TABLE visitors (
  id          text PRIMARY KEY,            -- pseudonymous 'v_<ulid>'
  email_hash  text UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Contact details kept apart from the pseudonymous visitor id.
CREATE TABLE visitor_contacts (
  visitor_id  text PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE,
  email       text NOT NULL
);

CREATE TABLE login_codes (
  id          bigserial PRIMARY KEY,
  email_hash  text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_email ON login_codes(email_hash, created_at DESC);

CREATE TABLE refresh_tokens (
  token_hash  text PRIMARY KEY,
  visitor_id  text NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  id              text PRIMARY KEY,
  code            text UNIQUE NOT NULL,
  from_member_id  text NOT NULL REFERENCES members(id),
  to_member_id    text NOT NULL REFERENCES members(id),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rule_sets (
  version      text PRIMARY KEY,
  description  text NOT NULL,
  active       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rule_sets_one_active ON rule_sets(active) WHERE active;

-- Every event received, including rejected and duplicate ones (audit trail).
CREATE TABLE events (
  event_id             text PRIMARY KEY,
  type                 text NOT NULL,
  occurred_at          timestamptz NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),
  source               text NOT NULL,
  source_ref           text,
  visitor_id           text,
  member_ids           text[] NOT NULL DEFAULT '{}',
  target_id            text,
  route_id             text,
  poi_id               text,
  referral_id          text,
  refers_to_event_id   text REFERENCES events(event_id),
  geo                  jsonb,
  status               text NOT NULL CHECK (status IN ('verified', 'rejected', 'duplicate', 'cancelled')),
  reason               text,
  checks               text[] NOT NULL DEFAULT '{}',
  dedupe_key           text UNIQUE,
  rule_version         text,
  payload              jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX events_visitor ON events(visitor_id, occurred_at DESC);
CREATE INDEX events_refers ON events(refers_to_event_id);
CREATE INDEX events_members ON events USING gin(member_ids);

-- Points ledger. Balances are SUM(points); rows are never updated.
CREATE TABLE ledger (
  id            bigserial PRIMARY KEY,
  owner_type    text NOT NULL CHECK (owner_type IN ('visitor', 'member')),
  owner_id      text NOT NULL,
  points        integer NOT NULL,
  event_id      text NOT NULL REFERENCES events(event_id),
  rule_version  text NOT NULL,
  rule_id       text NOT NULL,
  reverses_id   bigint REFERENCES ledger(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_owner ON ledger(owner_type, owner_id);
CREATE INDEX ledger_event ON ledger(event_id);

-- Rural Passport: verified experiences of a visitor.
CREATE TABLE passport_entries (
  id           bigserial PRIMARY KEY,
  visitor_id   text NOT NULL,
  event_id     text UNIQUE NOT NULL REFERENCES events(event_id),
  kind         text NOT NULL,              -- 'checkin' | 'route'
  target_id    text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX passport_visitor ON passport_entries(visitor_id, occurred_at DESC);

INSERT INTO rule_sets(version, description, active)
VALUES ('v1', 'Initial point rules (SPEC.md section 6)', true);
