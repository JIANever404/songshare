PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songshare_site_visitors_v1 (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS songshare_site_visitors_v1_last_seen_idx
ON songshare_site_visitors_v1 (last_seen_at DESC);
