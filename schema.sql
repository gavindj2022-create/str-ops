-- STR Ops D1 schema
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, name TEXT, location TEXT,
  beds REAL, baths REAL, sleeps INTEGER,
  has_pool INTEGER, has_hottub INTEGER, ical_urls TEXT
);
CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY, name TEXT, role TEXT, pin TEXT, color TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, property_id TEXT, checkout_date TEXT, checkin_date TEXT,
  checkout_time TEXT, checkin_time TEXT,          -- v2: real window ("clean by 11am, guest 4pm")
  same_day INTEGER DEFAULT 0, status TEXT DEFAULT 'needs_cleaning',
  assigned_to TEXT, started_at TEXT, completed_at TEXT,   -- started_at = v2 live "I'm on it" stamp
  source TEXT
);
CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY, property_id TEXT, items TEXT
);
CREATE TABLE IF NOT EXISTS turn_checks (
  turn_id TEXT, item_idx INTEGER, done INTEGER DEFAULT 0, photo_url TEXT,
  PRIMARY KEY (turn_id, item_idx)
);
CREATE TABLE IF NOT EXISTS water_assets (
  id TEXT PRIMARY KEY, property_id TEXT, type TEXT, name TEXT
);
CREATE TABLE IF NOT EXISTS water_readings (
  id TEXT PRIMARY KEY, asset_id TEXT, ts TEXT, chlorine REAL, ph REAL, alk REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id TEXT PRIMARY KEY, property_id TEXT, opened_ts TEXT, opened_by TEXT, note TEXT, photo_url TEXT,
  status TEXT DEFAULT 'open', closed_ts TEXT
);

-- ── v2: Owner cockpit ─────────────────────────────────────────────────────────
-- Business numbers. One row per property per month. Occupancy is derived from
-- turns/feed at read time, so it is NOT stored here.
CREATE TABLE IF NOT EXISTS financials (
  id TEXT PRIMARY KEY, property_id TEXT, month TEXT,          -- month = 'YYYY-MM'
  revenue REAL DEFAULT 0, expenses REAL DEFAULT 0,
  cleaning_cost REAL DEFAULT 0, note TEXT
);

-- Owner/manager personal to-dos tied to a property (inspections, owner visits, etc).
CREATE TABLE IF NOT EXISTS owner_tasks (
  id TEXT PRIMARY KEY, title TEXT, property_id TEXT,          -- property_id nullable = portfolio-wide
  due_date TEXT, done INTEGER DEFAULT 0, recurring TEXT,      -- recurring = null|'weekly'|'monthly'
  created_ts TEXT, done_ts TEXT
);

-- Personal/business goals with progress (revenue target, review score, add 5th property).
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT, target_value REAL, current_value REAL DEFAULT 0,
  unit TEXT, deadline TEXT, status TEXT DEFAULT 'active'      -- active|hit|archived
);

-- Web Push subscriptions, one per device/person.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY, team_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, created_ts TEXT
);

-- Supplies per property with a low-stock threshold that feeds the alerts/reorder list.
CREATE TABLE IF NOT EXISTS supplies (
  id TEXT PRIMARY KEY, property_id TEXT, name TEXT,
  count INTEGER DEFAULT 0, reorder_at INTEGER DEFAULT 0, unit TEXT
);

-- Opaque login sessions issued by the Worker after a server-side PIN check.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, team_id TEXT, created_ts TEXT, expires_ts TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_prop ON turns(property_id, checkout_date);
CREATE INDEX IF NOT EXISTS idx_readings_asset ON water_readings(asset_id, ts);
CREATE INDEX IF NOT EXISTS idx_financials_prop ON financials(property_id, month);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON owner_tasks(done, due_date);
CREATE INDEX IF NOT EXISTS idx_tickets_prop ON maintenance_tickets(property_id, status);
CREATE INDEX IF NOT EXISTS idx_supplies_prop ON supplies(property_id);
