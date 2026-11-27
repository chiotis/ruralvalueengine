-- Member area: logins, partnerships, rewards, packages.

-- Emails allowed to act for a member (besides the business email synced from ruralgreece.gr).
CREATE TABLE member_users (
  email_hash  text NOT NULL,
  member_id   text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_hash, member_id)
);

CREATE TABLE member_refresh_tokens (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- epaithros Connect: a partnership exists once both sides have confirmed.
CREATE TABLE partnerships (
  id            text PRIMARY KEY,
  member_a      text NOT NULL REFERENCES members(id),
  member_b      text NOT NULL REFERENCES members(id),
  requested_by  text NOT NULL REFERENCES members(id),
  note          text,
  status        text NOT NULL CHECK (status IN ('pending', 'active', 'declined', 'ended')),
  event_id      text REFERENCES events(event_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz,
  CHECK (member_a < member_b)
);
CREATE UNIQUE INDEX partnerships_pair ON partnerships(member_a, member_b) WHERE status IN ('pending', 'active');

CREATE TABLE rewards (
  id          text PRIMARY KEY,
  member_id   text REFERENCES members(id),    -- NULL = network-wide reward offered by ETAM
  title_el    text NOT NULL,
  title_en    text,
  cost        integer NOT NULL CHECK (cost > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE redemptions (
  id            text PRIMARY KEY,
  code          text UNIQUE NOT NULL,
  reward_id     text NOT NULL REFERENCES rewards(id),
  visitor_id    text NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired')),
  expires_at    timestamptz NOT NULL,
  confirmed_by  text REFERENCES members(id),
  event_id      text REFERENCES events(event_id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Dynamic Rural Packaging: a package is a route of member stops, with its own text.
ALTER TABLE routes
  ADD COLUMN kind text NOT NULL DEFAULT 'route' CHECK (kind IN ('route', 'package')),
  ADD COLUMN title_en text,
  ADD COLUMN description jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN active boolean NOT NULL DEFAULT true;
