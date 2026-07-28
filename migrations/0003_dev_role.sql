PRAGMA foreign_keys = OFF;

CREATE TABLE team_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dev', 'owner', 'manager', 'cleaner')),
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_iterations INTEGER NOT NULL DEFAULT 120000,
  color TEXT NOT NULL DEFAULT '#C9A46B',
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO team_new
  (id, name, role, pin_hash, pin_salt, pin_iterations, color, email, active)
SELECT id, name, role, pin_hash, pin_salt, pin_iterations, color, email, active
FROM team;

DROP TABLE team;
ALTER TABLE team_new RENAME TO team;

PRAGMA foreign_keys = ON;
