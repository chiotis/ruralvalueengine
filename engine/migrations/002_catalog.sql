-- Catalogue content synced from ruralgreece.gr (read-only copy).

CREATE TABLE catalog_items (
  id            text PRIMARY KEY,          -- 'biz-<wp id>', 'route-<wp id>', 'poi-<wp id>'
  kind          text NOT NULL CHECK (kind IN ('business', 'route', 'poi')),
  wp_id         integer NOT NULL,
  slug          text NOT NULL,
  link          text,
  title_el      text NOT NULL,
  title_en      text,
  lat           double precision,
  lng           double precision,
  term_ids      integer[] NOT NULL DEFAULT '{}',
  data          jsonb NOT NULL,            -- normalised fields for the app
  wp_modified   timestamptz NOT NULL,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (kind, wp_id)
);
CREATE INDEX catalog_items_kind ON catalog_items(kind) WHERE deleted_at IS NULL;
CREATE INDEX catalog_items_terms ON catalog_items USING gin(term_ids);

CREATE TABLE catalog_terms (
  taxonomy  text NOT NULL,
  id        integer NOT NULL,
  name      text NOT NULL,
  slug      text NOT NULL,
  parent    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (taxonomy, id)
);

CREATE TABLE catalog_media (
  id          integer PRIMARY KEY,
  source_url  text NOT NULL,
  sizes       jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE sync_state (
  source       text PRIMARY KEY,           -- 'ruralgreece:business' etc.
  last_modified timestamptz,
  last_full_at  timestamptz,
  last_run_at   timestamptz
);
