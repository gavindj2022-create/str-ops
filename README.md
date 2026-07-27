# STR Ops — Short Term Retreats team app

Private, phone-first operations app for the four Short Term Retreats properties.
Dark-luxury brand skin, big buttons, built so "a fifth grader could use it." Anna (Head
Operations Manager) is admin.

## Modules (v1)
- **Turnover board** — per-property cards driven by the Airbnb calendar. Checklist per
  home (real layouts), verification photos, same-day-turn red flag.
- **Pool + hot tub log** — two pools + two hot tubs (Westgate + Hickory). Dosing hints,
  balanced/adjust/needs-care status, next-test-due, one-tap compliance PDF export.
- **Daily brief** — Today tab: what to clean, who is arriving, which pools need testing.
- **Team / admin** — auto-assign cleaners (Anna approves), manage the team.

Wave 1 features live in the demo: auto-assign, photo-verified ready gate, pool compliance log.
Wave 2/3 (maintenance tickets, supplies, weather-smart care, hours, review link) are
scaffolded in the schema and roadmap.

## Run locally
Static front end, no build step:
```
python -m http.server 8123 --directory public
```
Open http://localhost:8123 . PINs: Anna 1234, Gav 0000, Maria 1111, Jess 2222.
Data seeds to localStorage; "Reset demo data" is under Team (manager only).

## Going live (Cloudflare)
The front end currently reads from `data.js` (localStorage). The swap point is `DB.load()`
/ `DB.save()` → `fetch('/api/...')` against the Worker.

1. `wrangler d1 create str-ops` → paste `database_id` into `wrangler.toml`.
2. `wrangler d1 execute str-ops --file=schema.sql`
3. Set the 7 iCal secrets (same names/URLs as the str-website project):
   `wrangler pages secret put ICAL_WESTGATE_AIRBNB --project-name=str-ops` (etc).
   **Blocker:** the `.ics` export URLs must be pulled by Anabelle or Gale — Gav's account
   is a calendar co-host and can't reach Airbnb's Export Calendar link. See the STR website
   note `iCal Setup - Ready for Tomorrow.md`.
4. `wrangler pages deploy public` → attach `team.shorttermretreats.com`.
5. Cron (every 30 min) refreshes turns from the feeds via `scheduled()`.

## Files
- `public/` — the PWA (index.html, styles.css, data.js, app.js, sw.js, manifest, icon).
- `worker/index.js` — API + iCal sync (drop-in live backend).
- `schema.sql` — D1 tables. `wrangler.toml` — bindings + cron.
