ALTER TABLE maintenance_tickets ADD COLUMN turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL;
ALTER TABLE maintenance_tickets ADD COLUMN category TEXT NOT NULL DEFAULT 'maintenance';
ALTER TABLE maintenance_tickets ADD COLUMN summary TEXT;
