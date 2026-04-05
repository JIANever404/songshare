PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songshare_share_registry_v2 (
  share_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  creator_name TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  hot_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_viewed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS songshare_share_registry_v2_kind_created_idx
ON songshare_share_registry_v2 (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS songshare_subject_dim_v1 (
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  localized_name TEXT,
  cover TEXT,
  release_year INTEGER,
  genres TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, subject_id)
);

CREATE INDEX IF NOT EXISTS songshare_subject_dim_v1_subject_idx
ON songshare_subject_dim_v1 (subject_id);
