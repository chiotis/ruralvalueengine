-- Route paths parsed from each route's KML on ruralgreece.gr, simplified for phone maps.
-- Refetched when the route's map_kml link changes; failures are kept (error) and retried later.
CREATE TABLE route_tracks (
  item_id     text PRIMARY KEY,
  kml_url     text NOT NULL,
  track       jsonb,
  error       text,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
