# STR Ops

Private, phone-first operations app for the four Short Term Retreats properties.

## Test version status

The v2 local test build is runnable. It includes:

- Dev, owner, house manager, and worker roles
- Ops cockpit with revenue, net, expenses, worker payouts, alerts, tasks, and goals
- Ana owner-organizer tools for auto-assigning open turns and copying a daily crew brief
- Team assignment and one-tap "Claim + Start" status
- Per-house role lanes for Clean, Laundry, Water, Inspect, Supplies, and Maintenance
- Turnover windows and same-day warnings
- Checklist items that can be checked and unchecked, plus a required-photo ready gate
- Authenticated R2 photo upload with deleted-photo invalidation
- Worker damage/issue reporting
- Pool and hot-tub logging, Photo Test Log kit-photo attachment, two-day cadence,
  safe-water streak, simple care hints, and compliance export
- Unified Cloudflare Worker, D1 migrations, local seed data, authenticated API, R2 routes,
  scheduled iCal reconciliation, and role enforcement

Production Web Push delivery, Cloudflare Access, live iCal feeds, production deployment,
and real-phone camera acceptance are not complete.

## Start the test version

Requirements: Node.js 20 or newer.

```bash
npm install
npm run test-version
```

Open `http://127.0.0.1:8787`. In local test mode, tap a name to sign in.

Fallback demo PINs:

| Person | Role | PIN |
|---|---|---|
| Gav | Dev | `135790` |
| the property owner | Owner | `975310` |
| the co-owner | House Manager | `246810` |
| Ana | Owner + Organizer | `864210` |

`npm run test-version` applies local D1 migrations, refreshes the idempotent demo seed, and
starts the Worker with a test-only session secret. The browser keeps a local fallback copy
so the interface remains demonstrable if the API is temporarily unavailable.

## Verification

```bash
npm run test:all
npx wrangler deploy --dry-run
```

- `npm test` runs backend unit and frontend contract tests.
- `npm run test:backend` starts a separate local Worker and verifies authentication,
  role redaction, CRUD, team claim/start, positive and negative checklist/photo ready
  gates, deleted-photo invalidation, water photo logs, and computed alerts.

## Local-test boundaries

- This build uses synthetic data and demo PINs. Offline PIN fallback is limited to
  loopback/file URLs and must not be used for real operations.
- Offline mutations are retained on the current device but are not yet queued for later
  cloud replay.
- Desktop and 375px phone-viewport browser passes are complete. A real-phone camera pass
  remains part of production acceptance.

## Architecture

- `public/` - installable PWA and progressive API adapter
- `worker/` - authenticated Worker API, alerts, auth, iCal, and SQL/DTO adapters
- `migrations/` - versioned D1 schema
- `seed/demo.sql` - idempotent local demo data
- `tests/` - backend unit/integration and frontend contract tests
- `wrangler.toml` - one Worker serving `/api/*`, static assets, D1, R2, and cron
- `HANDOFF.md` - product scope, API contract, guardrails, and remaining go-live work

## Production remaining

1. Create the production D1 database and replace the placeholder `database_id`.
2. Create/bind the production `str-ops-photos` R2 bucket.
3. Set `SESSION_SECRET` with `wrangler secret put SESSION_SECRET`.
4. Configure Cloudflare Access and the team email allowlist.
5. Add the seven Airbnb/Vrbo iCal secrets from the property owner or the co-owner.
6. Implement and verify VAPID Web Push delivery.
7. Deploy with `npm run deploy`, attach `team.shorttermretreats.com`, and run real-phone
   authentication, camera, and acceptance testing.
