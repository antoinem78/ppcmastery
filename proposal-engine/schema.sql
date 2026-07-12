-- Proposal engine schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  template TEXT NOT NULL DEFAULT 'proposal',
  data TEXT NOT NULL,                                -- JSON merge data
  status TEXT NOT NULL DEFAULT 'sent',               -- sent | viewed | accepted | declined | expired
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  first_viewed_at TEXT,
  accepted_at TEXT,
  accepted_name TEXT,
  accepted_ip TEXT,
  expires_at TEXT                                    -- ISO date, optional
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  type TEXT NOT NULL,                                -- view | section_view | section_time | pricing_viewed | scroll_depth | pdf_download | accepted
  meta TEXT,                                         -- JSON
  ip TEXT,
  ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_proposal ON events (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (proposal_id, type);
