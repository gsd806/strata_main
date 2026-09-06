# STRATA 7.1.1 — Review and deployment guide

This candidate updates the delivered 7.1.0 source. It has not been deployed. The 7.0.0 source provenance and existing integrations remain documented in release-7.1.0.md.

## Feature access

| Capability | Free | Strata+ paid or active trial |
| --- | --- | --- |
| Manual weekly planner, exercises, sets/reps, rest markers | Yes; local guest or synced account | Yes |
| Undo, replacement, week templates and export | Yes | Yes |
| Publish/manage own shared week | Free signed-in account | Yes |
| Start planned workout, log actuals, rest timer, resume | No | Yes |
| Workout history and progress charts | No | Yes |
| Set up my week | No | Yes |
| Existing discovery, comparisons, personalized sessions, community browsing and monthly planning | Existing public catalog unchanged; private tools require Plus | Yes |

Workout API routes use the existing server-side paid/trial entitlement. The workout and setup HTML pages are private, no-store and excluded from service-worker HTML caches. The prior guest-workout query is no longer an entry path. Setup verifies access before generation and saving. Basic plan endpoints stay free, authenticated and revision-checked.

Expired or revoked access does not delete workouts, plans or device records. Account deletion retains its existing cleanup behavior. Existing browser guest logs are left untouched; they are no longer an active logging mode or automatically imported into an account.

## Rest-day data compatibility

Weekly plans retain `version:1`, add ordered `restDays` (zero to seven distinct weekday names), and keep `restDay` as `restDays[0] ?? null`. Legacy files containing only a valid `restDay` are accepted. Explicit empty arrays stay empty. Mismatched alias/array inputs are rejected before template replacement or server writes.

There is no SQL migration: these fields live in existing plan JSON columns. Strict writes reject exercises on marked rest days. Repair reads preserve scheduled exercises and remove occupied rest markers without moving rest elsewhere. Removing a rest marker does not remove exercises. Adding one requires an empty day. Undo restores the removed exercise and clears only that target's rest marker when necessary.

## Deployment

1. Use the existing Node 24/Turso/Paddle/Resend deployment configuration and secrets. No external credentials or deployment settings were changed.
2. Run `npm ci` and the complete `npm run check` in CI with Chromium installed. Run `npm run load:100:shared` against the isolated local fixture, then the appropriate production-like capacity checks before claiming hosted readiness.
3. Take a verified backup using the existing online-backup procedure. See release-7.1.0.md for provider setup, restoration and migration from earlier releases.
4. Deploy the complete matching 7.1.1 server, client and service worker together only after authorization. Never deploy just the toolbar changes.
5. Confirm free planning; anonymous/free training denial; paid and trial access; expiry/refund revocation; and persisted zero/multiple rest days. Check the installed PWA after its worker activates. Existing open tabs must refresh to use the new contract and feature access.

## Rollback

Keep a backup of the pre-upgrade database and a copy of the new deployment. Do not automatically restore a database: it would discard newer plans and workouts.

Older 7.1.0 clients cannot represent zero/multiple rest days reliably and require one empty recovery day. Do not roll back code to 7.1.0 against modified plans without pausing writes, exporting the current data, and reviewing a compatibility conversion. Prefer a forward fix or rollback to a build that understands `restDays`. A conversion must preserve all exercise entries and be reviewed explicitly for weeks with no empty day. Never silently replace such weeks with a default plan.

## Validation and remaining gates

See verification/7.1.1-load-shared.json for that release's retained measured load record; the check summary is preserved in this guide. Local SQLite, fake signed Paddle-webhook tests and limited browser checks do not establish hosted Turso performance or real payment-provider readiness. The full authenticated desktop/mobile browser journey remains a release gate if Chromium is unavailable on this runner.
