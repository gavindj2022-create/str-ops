-- Idempotent demo data for local/test use only.
-- PIN hashes are PBKDF2-SHA256. Plaintext credentials are intentionally absent here
-- and are never returned by the API.
PRAGMA foreign_keys = ON;

INSERT INTO properties
  (id, name, location, beds, baths, sleeps, has_pool, has_hottub, checkout_time,
   checkin_time, water_test_cadence_days, cleaning_rate_cents)
VALUES
  ('millpoint', 'Millpoint Waterfront', 'East Peoria', 2, 2, 6, 0, 0, '10:00', '16:00', 2, 13500),
  ('westgate', 'Westgate Oasis', 'Washington, IL', 4, 2, 12, 1, 1, '10:00', '16:00', 2, 23000),
  ('galena', 'Galena Shores', 'Peoria Heights', 2, 2, 6, 0, 0, '10:00', '16:00', 2, 12000),
  ('hickory', 'Hickory Hideaway', 'East Peoria', 3, 2.5, 10, 1, 1, '10:00', '16:00', 2, 19000)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, location=excluded.location, beds=excluded.beds, baths=excluded.baths,
  sleeps=excluded.sleeps, has_pool=excluded.has_pool, has_hottub=excluded.has_hottub;

INSERT INTO team
  (id, name, role, pin_hash, pin_salt, pin_iterations, color, active)
VALUES
  ('gav', 'Gav', 'dev', 'q6HWfs04eXVTz7A4Mhg21OQYtLSL1LzrJ9_ge8-lHPk',
   'str-ops-demo-gav-v3', 120000, '#E0A94B', 1),
  ('gale', 'Gale', 'owner', 'rM05CnzOn6fc_0TEMJBNXBgU6aguIXXBSRbWZDV02BU',
   'str-ops-demo-gale-v3', 120000, '#C9A46B', 1),
  ('larry', 'Larry', 'manager', 'SURJnMYJPBLwkQKD4LS1GMCtK9eJ0ISLs2Uyp2G-mP4',
   'str-ops-demo-larry-v3', 120000, '#4FB0C6', 1),
  ('anna', 'Ana', 'owner', 'gjlbl87EOIMFT_o62DHD7s24Rp5hlGkKwYGcPLj522U',
   'str-ops-demo-anna-v4', 120000, '#5BB98B', 1)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, role=excluded.role, pin_hash=excluded.pin_hash,
  pin_salt=excluded.pin_salt, pin_iterations=excluded.pin_iterations,
  color=excluded.color, active=excluded.active;

UPDATE team SET active=0 WHERE id IN ('maria', 'jess');

INSERT INTO checklist_templates (id, property_id, items) VALUES
  ('checklist-millpoint', 'millpoint',
   '[{"group":"Bedrooms","role":"clean","label":"Strip and remake all beds","photo":"required"},{"group":"Laundry","role":"laundry","label":"Bag used linens and towels for laundry","photo":false},{"group":"Bathrooms","role":"clean","label":"Scrub and disinfect bathrooms","photo":"required"},{"group":"Kitchen","role":"clean","label":"Wash dishes, wipe counters, empty fridge","photo":false},{"group":"Waterfront","role":"clean","label":"Rinse and store kayaks","photo":"optional"},{"group":"Finish","role":"inspect","label":"Final walkthrough photo","photo":"required"}]'),
  ('checklist-westgate', 'westgate',
   '[{"group":"Bedrooms","role":"clean","label":"Strip and remake all beds","photo":"required"},{"group":"Laundry","role":"laundry","label":"Bag used linens and towels for laundry","photo":false},{"group":"Bathrooms","role":"clean","label":"Scrub and disinfect bathrooms","photo":"required"},{"group":"Kitchen","role":"supplies","label":"Restock coffee, supplies, trash bags","photo":false},{"group":"Pool","role":"water","label":"Skim pool, empty baskets, tidy loungers","photo":"required"},{"group":"Hot tub","role":"water","label":"Wipe hot tub and log chemistry","photo":"required"},{"group":"Finish","role":"inspect","label":"Final walkthrough photo","photo":"required"}]'),
  ('checklist-galena', 'galena',
   '[{"group":"Bedrooms","role":"clean","label":"Strip and remake all beds","photo":"required"},{"group":"Laundry","role":"laundry","label":"Bag used linens and towels for laundry","photo":false},{"group":"Bathrooms","role":"clean","label":"Scrub and disinfect bathrooms","photo":"required"},{"group":"Arcade","role":"clean","label":"Wipe arcade and games area","photo":false},{"group":"Beach","role":"clean","label":"Rinse and store kayaks","photo":"optional"},{"group":"Finish","role":"inspect","label":"Final walkthrough photo","photo":"required"}]'),
  ('checklist-hickory', 'hickory',
   '[{"group":"Suites","role":"clean","label":"Reset both king suites","photo":"optional"},{"group":"Laundry","role":"laundry","label":"Bag used linens and towels for laundry","photo":false},{"group":"Bathrooms","role":"clean","label":"Scrub and disinfect bathrooms","photo":"required"},{"group":"Pool","role":"water","label":"Skim pool and log chemistry","photo":"required"},{"group":"Hot tub","role":"water","label":"Wipe cabana hot tub and log chemistry","photo":"required"},{"group":"Finish","role":"inspect","label":"Final walkthrough photo","photo":"required"}]')
ON CONFLICT(property_id) DO UPDATE SET items=excluded.items;

INSERT INTO water_assets (id, property_id, type, name) VALUES
  ('westgate-pool', 'westgate', 'pool', 'Pool (18x36 heated)'),
  ('westgate-tub', 'westgate', 'hottub', 'Hot tub (4-season room)'),
  ('hickory-pool', 'hickory', 'pool', 'Pool (heated in-ground)'),
  ('hickory-tub', 'hickory', 'hottub', 'Cabana hot tub')
ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type;

INSERT INTO turns
  (id, property_id, checkout_date, checkin_date, checkout_time, checkin_time, same_day,
   status, assigned_to, source, updated_ts)
VALUES
  ('demo-turn-westgate', 'westgate', date('now', '-5 hours'), date('now', '-5 hours', '+2 day'), '10:00', '16:00',
   0, 'needs_cleaning', 'anna', 'seed', datetime('now')),
  ('demo-turn-hickory', 'hickory', date('now', '-5 hours'), date('now', '-5 hours'), '10:00', '16:00',
   1, 'needs_cleaning', NULL, 'seed', datetime('now')),
  ('demo-turn-millpoint', 'millpoint', date('now', '-5 hours'), date('now', '-5 hours', '+1 day'), '10:00', '16:00',
   0, 'in_progress', 'anna', 'seed', datetime('now')),
  ('demo-turn-galena', 'galena', date('now', '-5 hours', '+1 day'), date('now', '-5 hours', '+3 day'), '10:00', '16:00',
   0, 'needs_cleaning', NULL, 'seed', datetime('now')),
  ('demo-turn-westgate-next', 'westgate', date('now', '-5 hours', '+4 day'), date('now', '-5 hours', '+6 day'), '10:00', '16:00',
   0, 'needs_cleaning', NULL, 'seed', datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  checkout_date=excluded.checkout_date, checkin_date=excluded.checkin_date,
  checkout_time=excluded.checkout_time, checkin_time=excluded.checkin_time,
  same_day=excluded.same_day, status=excluded.status, assigned_to=excluded.assigned_to,
  started_at=NULL, completed_at=NULL, source=excluded.source, updated_ts=excluded.updated_ts;

INSERT INTO water_readings (id, asset_id, ts, chlorine, ph, alk, note, logged_by, photo_key) VALUES
  ('demo-reading-westgate-pool', 'westgate-pool', datetime('now', '-3 day'), 0.6, 7.1, 70, 'Treat and retest', 'anna', NULL),
  ('demo-reading-westgate-tub', 'westgate-tub', datetime('now', '-1 day'), 3.0, 7.4, 100, NULL, 'anna', NULL),
  ('demo-reading-hickory-pool', 'hickory-pool', datetime('now', '-1 day'), 2.2, 7.5, 95, NULL, 'anna', NULL),
  ('demo-reading-hickory-tub', 'hickory-tub', datetime('now', '-6 day'), 2.0, 7.3, 90, 'Overdue test demo', 'anna', NULL)
ON CONFLICT(id) DO UPDATE SET
  ts=excluded.ts, chlorine=excluded.chlorine, ph=excluded.ph, alk=excluded.alk,
  note=excluded.note, logged_by=excluded.logged_by, photo_key=excluded.photo_key;

INSERT INTO maintenance_tickets
  (id, property_id, opened_ts, opened_by, note, priority, status)
VALUES
  ('demo-ticket-1', 'westgate', datetime('now', '-2 hour'), 'anna',
   'Patio string lights are out near the pool gate.', 'normal', 'open')
ON CONFLICT(id) DO UPDATE SET status='open', closed_ts=NULL;

INSERT INTO financials
  (id, property_id, month, revenue_cents, expenses_cents, cleaning_cost_cents, note)
VALUES
  ('demo-fin-westgate', 'westgate', strftime('%Y-%m', 'now', '-5 hours'), 842000, 231000, 92000, 'Demo month'),
  ('demo-fin-hickory', 'hickory', strftime('%Y-%m', 'now', '-5 hours'), 706000, 188000, 76000, 'Demo month'),
  ('demo-fin-millpoint', 'millpoint', strftime('%Y-%m', 'now', '-5 hours'), 514000, 121000, 54000, 'Demo month'),
  ('demo-fin-galena', 'galena', strftime('%Y-%m', 'now', '-5 hours'), 468000, 108000, 48000, 'Demo month')
ON CONFLICT(property_id, month) DO UPDATE SET
  revenue_cents=excluded.revenue_cents, expenses_cents=excluded.expenses_cents,
  cleaning_cost_cents=excluded.cleaning_cost_cents, note=excluded.note;

INSERT INTO owner_tasks
  (id, title, property_id, due_date, done, recurring, assigned_to, priority, notes, created_ts)
VALUES
  ('demo-task-overdue', 'Replace Westgate patio string lights', 'westgate',
   date('now', '-5 hours', '-1 day'), 0, NULL, 'anna', 'urgent', 'Coordinate after the next checkout', datetime('now')),
  ('demo-task-kayaks', 'Order Millpoint kayak life jackets', 'millpoint',
   date('now', '-5 hours', '+4 day'), 0, NULL, 'gav', 'normal', NULL, datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title, due_date=excluded.due_date, done=excluded.done,
  assigned_to=excluded.assigned_to, priority=excluded.priority;

INSERT INTO goals (id, name, target_value, current_value, unit, deadline, status) VALUES
  ('demo-goal-revenue', 'Monthly revenue', 3200000, 2530000, 'cents', date('now', '-5 hours', 'start of month', '+1 month', '-1 day'), 'active'),
  ('demo-goal-turns', 'Turns ready on time', 98, 94, 'percent', date('now', '-5 hours', '+30 day'), 'active'),
  ('demo-goal-rating', 'Guest rating', 4.9, 4.86, 'rating', date('now', '-5 hours', '+90 day'), 'active')
ON CONFLICT(id) DO UPDATE SET
  target_value=excluded.target_value, current_value=excluded.current_value,
  deadline=excluded.deadline, status=excluded.status;

INSERT INTO supplies (id, property_id, name, count, reorder_at, unit, updated_ts) VALUES
  ('demo-supply-paper', 'hickory', 'Toilet paper', 3, 4, 'rolls', datetime('now')),
  ('demo-supply-coffee', 'westgate', 'Coffee pods', 24, 12, 'pods', datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  count=excluded.count, reorder_at=excluded.reorder_at, updated_ts=excluded.updated_ts;
