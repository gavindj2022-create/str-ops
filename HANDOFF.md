# STR Ops — Codex Build Handoff

**Read this first, top to bottom.** It is the single source of truth for finishing this app.
Everything below is decided. Where something is still open it is marked **ASSUMPTION** with a
safe default — build the default, do not stop to ask.

## Current test-build checkpoint — 2026-07-28

A runnable v2 local test version now exists on branch `codex/str-ops-v2-test`.

Start it with:

```bash
npm install
npm run test-version
```

Open `http://127.0.0.1:8787`. Local test mode signs in when a name is tapped. Fallback
PINs are Gav (Dev) `135790`, Gale (Owner) `975310`, Larry (House Manager) `246810`,
and Anna (Worker) `1111`.

Completed in this checkpoint:

- Unified Worker plus static-assets runtime, D1 migrations, idempotent demo seed, R2
  binding, authenticated sessions, rate limiting, role enforcement, audit log, computed
  alerts, and booking/iCal reconciliation
- Dev/owner/house-manager/worker role migration
- Ops cockpit with financials, tasks, alerts, goals, and property snapshots
- Worker claim/start state, turnover windows, issue reporting, water streak, two-day
  test cadence, and phone-width layout
- Progressive API adapter with a localStorage fallback for the test/demo experience
- Authenticated R2 verification-photo upload, server-enforced checklist/photo gate, and
  invalidation when a photo is deleted or purged
- Automated backend/frontend tests, positive/negative ready-gate coverage, local Worker
  integration test, and a 375px browser pass

Still required before production:

- Production D1/R2 resources, real `SESSION_SECRET`, Cloudflare Access, and custom domain
- Seven Airbnb/Vrbo iCal secrets
- Actual VAPID Web Push delivery
- Production R2 retention verification
- Final real-device authentication and camera acceptance test with the actual team

The sections below remain the product and production contract. Where an older status line
conflicts with this checkpoint, this checkpoint is authoritative.

---

## 0. What this is (30-second version)

A **private, phone-first PWA** for **Short Term Retreats (STR)** — 4 waterfront Airbnb
rentals near Peoria, IL, run by a tiny team. It shows the team exactly what to clean and
when (driven by the Airbnb calendar), logs pool + hot tub chemistry, and gives one daily
overview. **v2 adds an Ops cockpit** (business numbers, tasks/schedule, an exceptions
feed, goals) for Gav, Gale, and Larry.

- **This is an internal tool, NOT a SaaS.** No sign-up, no multi-tenant, no billing. Do not
  build any of that.
- **Standalone.** Do NOT wire this into Limitless, Alfred, Discord, or any other system.
- **Dev:** Gav (Gavin Johnson). **Owner:** Gale. **House manager:** Larry. **Worker:** Anna.

### GO-LIVE BLOCKER (call this out to Gav, do not let it stall the build)
The turnover calendar needs **7 Airbnb/VRBO `.ics` export URLs**. Gale or Larry should
export them from the listing calendars. Gav's account should not be treated as the owner.
**They have never been captured.** Until they arrive, **build and demo entirely on seed
data** (already in `public/data.js`). The live cutover is a one-step swap (§7). Do not block
any feature on this.

---

## 1. Current state — what already exists (do not rebuild)

Working v1 demo, verified in-browser. Runs with no build step:
```bash
python -m http.server 8123 --directory public   # then open http://localhost:8123
```
Fallback PINs today: Gav 135790, Gale 975310, Larry 246810, Anna 1111.

- `public/index.html` — app shell + tab bar. `public/styles.css` — the **dark-luxury design
  system** (near-black `#0F0F10`, bone `#F4F1EC`, gold `#C9A46B`, teal `#1F4E5F`, red
  `#D72638`, Fraunces + Inter). **Match this. Do not restyle.**
- `public/app.js` — all UI + logic. Global state `S = {turns, readings, checks, photos,
  tickets}`. Views switch via `go(view)`; tabs carry `data-view`.
- `public/data.js` — seeds the four properties, water assets, checklists, team, and complete
  v2 demo state. Local storage is the non-blocking fallback. `public/api.js` is the camelCase
  Worker adapter, and mutations progressively sync to the API when it is available.
- `public/sw.js` — service worker, **network-first** (keep it; a cache-first SW served stale
  code before). Add Web Push handlers here.
- `worker/index.js` plus `worker/*.js` — unified Cloudflare Worker with authenticated CRUD,
  D1 state, R2 routes, computed alerts, audit history, booking reconciliation, iCal sync,
  and a 30-minute cron.
- `schema.sql` — D1 tables, **already extended for v2** (financials, owner_tasks, goals,
  push_subscriptions, supplies, sessions; turns has checkout_time/checkin_time/started_at).
- `wrangler.toml` — D1 + R2 bindings, cron, secret notes. `.env.example` — every secret.

Features already built in the demo: PIN login, turnover board (iCal-shaped), per-property
checklists, photo-verified ready gate, auto-assign workers, pool/hot-tub log with dosing
hints + status, compliance PDF export, same-day-turn red flag.

---

## 2. Fixed decisions & assumptions

| Topic | Decision |
|---|---|
| Product type | Internal tool only. No SaaS/multi-tenant/billing. |
| Reminders | **Web Push + in-app only.** No SMS, no email provider. (ASSUMPTION: push is enough; skip the email digest for now.) |
| Roles | `dev` (Gav), `owner` (Gale), `manager` (Larry), `cleaner` (Anna). See §3. |
| Cockpit access | Dev, owner, and house manager see the cockpit. Tasks/schedule/alerts/goals are shared. |
| Team roster | Seed the actual test roster: Gav, Gale, Larry, Anna. Maria and Jess are stale demo users and should stay inactive. |
| Worker visibility | ASSUMPTION: workers see **all** turns (matches v1). Assigned turns are highlighted. |
| Money source | ASSUMPTION: **manual entry** per property/month in the cockpit; occupancy is **derived** from turns/feed. Wire a "pull from feed × nightly rate" helper but do not depend on it. |
| Pool test cadence | ASSUMPTION: **due every 2 days**; overdue → alerts feed. Make the interval a constant that's easy to change. |
| Ready-by time | ASSUMPTION: same-day turns flag against a **4:00pm** check-in unless the feed gives a real time. |
| Subdomain | `team.shorttermretreats.com` (cockpit is role-gated behind the same login — no separate domain). |
| Cloudflare | Reuse account `2a34aeab729ff9e5650051c3059e6b0a` (same as `str-website`). Same 7 iCal secret names. |

Anything Gav later corrects overrides these — keep them in one place so they're easy to flip.

---

## 3. Role model migration

`team.role` now supports **`dev|owner|manager|cleaner`**:
- **dev** = Gav, app build and test access.
- **owner** = Gale, business owner.
- **manager** = Larry, house manager with operations control.
- **cleaner** = Anna, shown in the UI as Worker; the **cockpit tab is hidden**.

Keep `isLeaderRole()` true for `dev|owner|manager`, and use `isOwner()` only where
Gale-level ownership is required. Local test mode signs in by tapping a person; non-local
environments still use the PIN pad.

---

## 4. What to build — the Ops cockpit (v2 core)

A new **`cockpit` tab**, visible to `dev|owner|manager`, same dark-luxury skin, one scrollable
phone screen with four sections:

1. **Business numbers** — per property + portfolio totals: revenue, occupancy % (derived
   from booked nights in `turns`/feed over the month), cleaning cost/payouts, net. Month
   switcher. Manual add/edit writes to `financials`. Show a big portfolio number up top.
2. **My tasks + schedule** — leadership to-do list from `owner_tasks`: title, optional
   property, due date, recurring (weekly/monthly), done toggle. A simple **today / this week**
   grouping. Overdue tasks also surface in Alerts.
3. **Alerts + exceptions feed** — the "only what needs you" stream, **computed at read time**
   (no table): same-day turns today, any pool/hot tub reading that is `bad`/red, a turn not
   started/finished past its ready-by time, open `maintenance_tickets`, supplies at/under
   `reorder_at`, overdue pool tests, overdue ops tasks. Sort by urgency. This is the
   daily-glance answer to Gav's "I need to see it."
4. **Goals tracker** — from `goals`: name, target, current, unit, deadline, progress bar.
   E.g. monthly revenue target, keep review score ≥ 4.9, add a 5th property. Leadership edits.

### Also locked in (build alongside the cockpit)
- **Real turnover window** — show `checkout_time` / `checkin_time` on turn cards
  ("Clean by 11am · Guest 4pm") when the feed provides them; fall back to date-only.
- **Live worker status** — a one-tap **"I'm on it"** (sets `started_at`) and **"Done"** on a
  turn, with timestamps. Drives the board's live state and the Alerts feed (unstarted/late).
- **Damage/issue report** — from a worker's phone: photo + note → opens a
  `maintenance_ticket` and pushes leadership. Workers hit problems first; capture in the
  moment.
- **Pool compliance streak** — on the Water tab, a visible "N days logged · next due <date>"
  to make the habit stick and keep the insurance PDF airtight.

### Roadmap (build after the above, in this order)
Worker hours + payouts (feeds Business numbers) → supplies auto-count + reorder list →
maintenance ticket list view → weather-smart pool care (free weather API; hot days raise
cadence, freeze warnings for hot tubs) → review-to-turn link.

---

## 5. API contract (source of truth for the frontend↔Worker swap)

The Worker owns the DB; `data.js` becomes a thin `fetch` client. All JSON, all
`content-type: application/json`. Auth via an httpOnly session cookie (see §6). Keep the
existing seed **shapes** — these mirror what `DB.load()` returns today so the UI barely
changes.

**Auth**
- `POST /api/login` `{teamId, pin}` → `{ok, user:{id,name,role,color}}` + sets session cookie.
  Server-side PIN check, rate-limited, lockout after 5 fails.
- `POST /api/logout` → clears cookie.
- `GET  /api/me` → `{user}` or 401.

**Bootstrap**
- `GET /api/state` → one payload the app loads on start:
  `{properties, waterAssets, checklists, team, turns, readings, checks, photos, tickets,
    financials, ownerTasks, goals, supplies}`. (Static seeds like properties/checklists can
  stay client-side; everything mutable comes from D1.)

**Turns**
- `GET  /api/turns`
- `PATCH /api/turns/:id` `{status?, assigned_to?, started_at?, completed_at?}`
- `GET  /api/turns/:id/checks` · `PUT /api/turns/:id/checks/:idx` `{done, photoKey?}`

**Photos** (R2)
- `POST /api/photos` (multipart, compressed client-side) → `{key}`; store key in
  `turn_checks.photo_url` / ticket. `GET /api/photos/:key` → **signed** stream (never public).

**Water**
- `GET /api/water` · `POST /api/water` `{assetId, chlorine, ph, alk, note}` (server stamps ts).

**Cockpit**
- `GET/POST/PATCH /api/financials` · `GET/POST/PATCH/DELETE /api/tasks`
- `GET/POST/PATCH /api/goals` · `GET/POST/PATCH /api/tickets` · `GET/PATCH /api/supplies`
- `GET /api/alerts` → computed exceptions array (see §4.3), each `{type, severity, propertyId,
  label, ts}`.

**Push**
- `GET /api/push/key` → VAPID public key. `POST /api/push/subscribe` `{subscription}`.
  Worker sends pushes on: new assignment, turn due, same-day turn, pool gone red, new ticket.

Keep `/api/sync` (manual feed refresh) and `/api/health`. The 30-min cron still calls
`syncAll`; extend `upsertTurns` to also store `checkout_time`/`checkin_time` from the
VEVENT when present.

---

## 6. Security (required, not optional — this app shows revenue)

- **Server-side PIN check.** Never trust the client. Issue an httpOnly, Secure, SameSite
  session cookie signed with `SESSION_SECRET`; store in `sessions`; expire in ~30 days.
- **Stronger PINs for elevated roles.** dev/owner/manager use a **6-digit** PIN; workers
  may keep 4. Lockout after 5 bad tries; rate-limit `/api/login`.
- **Cloudflare Access in front of the whole subdomain** (free, email one-time-code) so only
  the team's emails can even load the app. Belt-and-suspenders over PINs.
- **Private photos.** R2 bucket stays private; serve only via short-lived signed URLs.
  Auto-purge verification photos after **90 days** (guest-privacy).
- **Secrets never committed.** Everything in `.env.example` is a Worker secret. `.gitignore`
  already blocks `.dev.vars`/`.env`. Add a pre-commit check that greps staged files for
  `airbnb.com/calendar` and VAPID keys and refuses the commit.

---

## 7. iCal cutover (one step, when the URLs arrive)

1. Gale/Larry export each listing's `.ics` (Availability → Export Calendar). 7 links total.
   The copy-paste ask is drafted in vault `Projects/STR Website/iCal Setup - Ready for
   Tomorrow.md`.
2. `wrangler secret put ICAL_WESTGATE_AIRBNB` (repeat for all seven).
3. Hit `/api/sync` once. Real turns replace the seed turns. **No code change.** The seeder
   in `data.js` intentionally mirrors the feed shape so every screen already works.

---

## 8. Build order (do them in this sequence)

1. **Worker CRUD API** (§5) + repoint `DB.*` in `data.js` to `fetch`. App runs off D1;
   localStorage is only an offline cache. Verify data survives with localStorage cleared.
2. **Role migration** (§3) + `cockpit` tab shell gated to dev|owner|manager.
3. **Cockpit modules** — Business numbers → Tasks/schedule → Alerts feed → Goals.
4. **Auth hardening + Web Push + R2 photos** (§6).
5. **Locked-in extras** — turnover window, live worker status, damage report, pool streak.
6. **Roadmap** features (§4) in the listed order.
7. **iCal cutover** (§7) whenever Gav delivers the URLs — independent of everything else.

---

## 9. Setup, run, deploy

```bash
# local test version (Worker + local D1 + static assets)
npm install
npm run test-version

# production
wrangler d1 create str-ops                  # paste database_id into wrangler.toml
wrangler d1 migrations apply str-ops --remote
wrangler r2 bucket create str-ops-photos
wrangler secret put SESSION_SECRET
# set each iCal/VAPID secret with: wrangler secret put <NAME>
wrangler deploy
# attach team.shorttermretreats.com to the Worker; enable Cloudflare Access
```

---

## 10. Guardrails (hard rules — do not violate)

- **Match the existing dark-luxury design system.** Do not restyle or introduce a new look.
- **Keep the service worker network-first.** The team must always get the latest code.
- **No em-dash** in any team- or guest-facing copy. Use commas, periods, or parentheses.
- **No SaaS / multi-tenant / billing / sign-up** code.
- **Do not wire into Limitless / Alfred / Discord.** STR is standalone.
- **Phone-first, big buttons, "a fifth grader could use it."** Test on a real phone viewport.
- **Real, maintainable repo:** clean structure, comments where non-obvious, `.env.example`
  current, this file kept accurate. Hand Gav working credentials at the end.

---

## 11. Verification (how you prove it's done)

- **Backend swap:** clear localStorage, reload → all data still present (it's in D1).
- **Roles:** log in as Gav (Dev), Gale (Owner), and Larry (House Manager) → cockpit visible;
  log in as Anna (Worker) → cockpit hidden, only turns.
- **Cockpit:** seed a same-day turn + a red pool reading + an unstarted late turn + an open
  ticket → **all four appear in Alerts**. Add a financial row → portfolio total updates. Add
  a goal → progress bar renders. Add an ops task due today → shows in today + alerts.
- **Live status:** tap "I'm on it" → timestamp + board flips; leave a turn unstarted past
  ready-by → it surfaces in Alerts.
- **Web Push:** subscribe on a real phone, trigger a due turn → a clean push fires.
- **Photos:** upload a verification photo → lands in R2, served via signed URL; ready-gate
  blocks "Done" until required photos exist.
- **Demo→live:** run on seed data, set one real iCal secret, hit `/api/sync` → a real turn
  replaces the demo turn with no code change.
- **Phone test:** whole thing on a real device, big buttons, no horizontal scroll.
