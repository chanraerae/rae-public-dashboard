PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'app' CHECK(kind IN ('app','tool')),
  domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain_id);
CREATE INDEX IF NOT EXISTS idx_links_kind ON links(kind);
