-- Initial STR Ops v2 schema. Keep schema.sql in sync for fresh manual installs.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT, beds REAL, baths REAL,
  sleeps INTEGER, has_pool INTEGER NOT NULL DEFAULT 0 CHECK (has_pool IN (0, 1)),
  has_hottub INTEGER NOT NULL DEFAULT 0 CHECK (has_hottub IN (0, 1)),
  checkout_time TEXT NOT NULL DEFAULT '11:00', checkin_time TEXT NOT NULL DEFAULT '16:00',
  water_test_cadence_days INTEGER NOT NULL DEFAULT 2,
  cleaning_rate_cents INTEGER NOT NULL DEFAULT 0, ical_urls TEXT
);
CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cleaner')),
  pin_hash TEXT NOT NULL, pin_salt TEXT NOT NULL,
  pin_iterations INTEGER NOT NULL DEFAULT 120000,
  color TEXT NOT NULL DEFAULT '#C9A46B', email TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_ts TEXT NOT NULL, locked_until_ts TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  created_ts TEXT NOT NULL, expires_ts TEXT NOT NULL, last_seen_ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL, uid TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  start_time TEXT, end_time TEXT, summary TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), last_seen_ts TEXT NOT NULL,
  UNIQUE (property_id, source, uid)
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  checkout_date TEXT NOT NULL, checkin_date TEXT, checkout_time TEXT, checkin_time TEXT,
  same_day INTEGER NOT NULL DEFAULT 0 CHECK (same_day IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'needs_cleaning'
    CHECK (status IN ('needs_cleaning', 'in_progress', 'ready', 'done')),
  assigned_to TEXT REFERENCES team(id) ON DELETE SET NULL, started_at TEXT, completed_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual', booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
  items TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turn_checks (
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE, item_idx INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)), photo_key TEXT,
  updated_by TEXT REFERENCES team(id) ON DELETE SET NULL, updated_ts TEXT,
  PRIMARY KEY (turn_id, item_idx)
);
CREATE TABLE IF NOT EXISTS water_assets (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pool', 'hottub')), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS water_readings (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES water_assets(id) ON DELETE CASCADE,
  ts TEXT NOT NULL, chlorine REAL NOT NULL, ph REAL NOT NULL, alk REAL NOT NULL,
  note TEXT, logged_by TEXT REFERENCES team(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  opened_ts TEXT NOT NULL, opened_by TEXT REFERENCES team(id) ON DELETE SET NULL,
  note TEXT NOT NULL, photo_key TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  closed_ts TEXT
);
CREATE TABLE IF NOT EXISTS financials (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  month TEXT NOT NULL, revenue_cents INTEGER NOT NULL DEFAULT 0,
  expenses_cents INTEGER NOT NULL DEFAULT 0, cleaning_cost_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT, UNIQUE (property_id, month)
);
CREATE TABLE IF NOT EXISTS owner_tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL, due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  recurring TEXT CHECK (recurring IS NULL OR recurring IN ('weekly', 'monthly')),
  assigned_to TEXT REFERENCES team(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  notes TEXT, created_ts TEXT NOT NULL, done_ts TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, target_value REAL NOT NULL,
  current_value REAL NOT NULL DEFAULT 0, unit TEXT, deadline TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hit', 'archived'))
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplies (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, reorder_at INTEGER NOT NULL DEFAULT 0,
  unit TEXT, updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photo_objects (
  object_key TEXT PRIMARY KEY, uploaded_by TEXT REFERENCES team(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_ts TEXT NOT NULL,
  purge_after_ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES team(id) ON DELETE SET NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  detail_json TEXT, created_ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_ts);
CREATE INDEX IF NOT EXISTS idx_bookings_property_dates ON bookings(property_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_turns_property_checkout ON turns(property_id, checkout_date);
CREATE INDEX IF NOT EXISTS idx_turns_status ON turns(status, checkout_date);
CREATE INDEX IF NOT EXISTS idx_readings_asset_ts ON water_readings(asset_id, ts);
CREATE INDEX IF NOT EXISTS idx_financials_property_month ON financials(property_id, month);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON owner_tasks(done, due_date);
CREATE INDEX IF NOT EXISTS idx_tickets_property_status ON maintenance_tickets(property_id, status);
CREATE INDEX IF NOT EXISTS idx_supplies_property ON supplies(property_id);
CREATE INDEX IF NOT EXISTS idx_photos_purge ON photo_objects(purge_after_ts);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_ts);
