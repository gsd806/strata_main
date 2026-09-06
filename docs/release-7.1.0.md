# STRATA 7.1.0 — Review and deployment guide

This is a reviewable release candidate built from the actual GitHub v7.0.0 tag. It has not been deployed. The automated Chromium gate and hosted provider checks must pass before calling it production-ready.

## Baseline audit

Source: [STRATA v7.0.0](https://github.com/gsd806/strata_main/releases/tag/v7.0.0). The archive identifier and downloaded archive checksum are recorded in [source provenance](verification/7.0.0-source.json).

The tagged release already contained the 200-exercise catalog, verified account lifecycle, administration, signed Paddle entitlement processing, weekly plan CAS, Strata+ discovery, monthly plans, community sharing, PWA installation, and the 100-user local test harness. It also contained the prior shared-network limits and interface improvements. Those were retained rather than described as new 7.1.0 features.

The audit verified that persistent workout logging/history and first-week onboarding were absent. It reproduced an administrator password-reset race and a planner account-switch overwrite before fixing them. The 7.0.0 baseline passed its non-browser gates here; its Chromium stage could not launch in this environment.

## Implementation and boundaries

| Area | Delivered behavior | Boundary |
| --- | --- | --- |
| Workout room | Start a planned day; actual loads, repetitions and seconds; completed sets; absolute rest deadline; pause/reset; save/close; recovery; completion | Account logging is free. Guests explicitly choose separate browser storage. |
| Workout history | Paginated sessions, details, previous performance, best recorded results, SVG charts and exact-value tables | Results describe the loaded history window. Load more to extend it; no invented all-time records. |
| Measurement | Separate exercise/measurement/load-type/unit groups; timed and bodyweight defaults from the catalog | Assistance is not lifted weight. Bodyweight and timed work do not generate external lifting volume. |
| Onboarding | Goal, experience, equipment, available days and movement filters; first-week preview; explicit replacement; editable saved week | Setup choices stay in this browser, scoped by account. The generated account week syncs. |
| Planning | Undo removals, searchable replacement retaining prescription, named week templates, JSON import/export, per-tab account drafts | Templates are local reusable week copies, not a new dated calendar or cloud template library. |
| Synchronization | Account identity checks and CSRF; atomic account plan/workout revisions; explicit conflict recovery | Guest writers share Web Locks where available; raw-storage checks are best effort in browsers without Web Locks. |
| Interface | Black/lime identity, responsive layouts, loading/error/empty states, native dialogs, focus states, finite motion, reduced-motion CSS | Desktop browser flow verified; full mobile/zoom/browser matrix remains a gate. |
| Providers | Existing production integrations retained; explicit isolated Paddle sandbox configuration added | No real payment, email, or live Turso operation was performed. |

Workout records are private and owner-scoped. The new table has a composite owner/session key, indexed summary pagination, immutable creation hash, and monotonically increasing revisions. A delayed identical create retry returns the latest record rather than overwriting later edits. An account is limited to 10,000 stored workouts; each workout allows 30 exercise entries and 10 sets per entry. API validation rejects malformed dates, non-numeric actuals, invalid completion data, and oversized values.

## Confirmed defects and regression evidence

| Defect | Root cause | Fix and regression |
| --- | --- | --- |
| Old password accepted during admin reset race | Admin claiming reread a newer credential version after an older password had already been checked | Preserve the verified credential snapshot; advance only the initial ownership-claim increment; session insert CAS rejects intervening resets. Real SQLite race tests cover before/after claim and before insertion. |
| Plan A written into account B | A stale tab adopted a userless shared-plan response's new CSRF token | Verify account identity, bind mutation headers/plan bodies to the expected account, return shared-plan owner identity, and lock stale tabs. Runtime tests prevent conflict buttons reopening a switched tab. |
| Guest week overwritten by a stale tab | Unconditional browser-storage write | Compare the originally loaded raw value inside a shared Web Lock, save immutable snapshots, retain rejected drafts, and never advance the expected raw value after failure. |
| Guest onboarding retry falsely conflicts | Expected storage value advanced before the storage write succeeded | Advance only after successful write; quota failure/retry test preserves the saved week. |
| HTTP preview could not generate IDs | Unconditional secure-context-only randomUUID call | Safe non-secret identifier fallback, tested without randomUUID. |
| Timed prescriptions treated as repetitions | Format inference omitted catalog shorthand such as `15–30 s` | Actual catalog regression covers all timed entries and compact shorthand. |
| Selected training day lost at guest entry | Initialization replaced the URL-selected day with today | Validate and preserve the day through guest entry/reload; invalid values fall back to today. |
| Login lost new workflow destination | Internal redirect allowlists lacked workout/setup destinations | Exact internal aliases survive native/enhanced login and verification; external redirect attacks still fail. |
| No payment sandbox path | Live-only key validation and browser initialization | Explicit matching sandbox credentials/catalog, sandbox API/Paddle.js environment, visible test mode, and production-mode rejection. |

## Reproduce validation

Use Node 24 on Linux. No production credentials are required for local tests.

```bash
npm ci --no-audit --no-fund
npx playwright install --with-deps chromium
npm run check
npm run load:100
npm run load:100:shared
node --test test/database-backup-restore.test.js
```

The complete `check` command includes release consistency, architecture, strict boundary types, lint, Node coverage, simulated-browser runtime checks, endpoint/storage performance budgets, and real Chromium E2E. Do not remove the browser gate to obtain a green result. The existing CI workflow installs Chromium and runs both 100-user modes.

The added browser suite uses isolated synthetic accounts, a temporary SQLite store, and blocked external browser traffic. It covers guest onboarding/planner/template import; failed-save draft recovery against a newer server revision; switched-account protection; guest workout resume/completion/history; and authenticated workout persistence plus account-lookup failure. It includes a narrow viewport and reduced-motion setting. It is implemented, but could not execute here because the Chromium binary download timed out.

See [release readiness](release-readiness.md) and [verification files](verification/7.1.0-load-distinct.json) for measured outcomes, environment, CPU, memory, percentiles and limitations. Local loopback tests do not establish production host or Turso capacity.

## Migration from 7.0.0

1. Take a verified database backup before deploying. Restore it to an isolated database and confirm account, plan, purchase and session counts before touching production.
2. Keep the existing database URL/token, email configuration, signing secrets, production domain, and Paddle catalog. Do not create a replacement production database for this upgrade.
3. Run the full test gate and inspect the source diff. The package targets Node 24 and retains `npm start` and the existing Render/Turso deployment model.
4. Deploy only after authorization. Startup runs the additive schema creation: `workouts` and `workouts_user_started`. Existing account/plan/purchase records are not rewritten or reseeded.
5. Confirm `/healthz`, `/api/status` build 7.1.0, original-account login, original plans and entitlement. Log a test workout, restart/redeploy, and verify it persists with its revision/history.
6. Confirm account deletion removes its workout rows; test both a clean deployment and upgrade of a restored 7.0.0 database.

The local backup regression uses Node SQLite's online backup while WAL storage is active, mutates the source after the snapshot, restores to a fresh directory, and verifies credentials, two private plans, workout revision/summaries, owner isolation, subsequent CAS writes, `quick_check`, and `foreign_key_check`. This verifies local SQLite restoration only. Run the hosted Turso restoration drill separately; do not copy a live SQLite main file without accounting for its WAL.

## Production configuration

`render.yaml` retains the always-on 1 CPU / 2 GB starting configuration, Node 24, deterministic production dependency installation, health endpoint, and the existing domain/integration identifiers. This is a proposed configuration, not a purchased or provisioned service. Keep one application instance initially because request throttles are process-local. Move throttles to shared storage or trusted ingress before horizontal scaling.

Production requires Turso. Set the real host's `NODE_ENV=production`, `HOST=0.0.0.0`, HTTPS `APP_BASE_URL`, and `TRUST_PROXY=true` only behind the trusted configured ingress. Enable email verification with a verified Resend sender and independent verification secret. Keep secrets in the host's secret manager. Never enable the test-only verification bypass outside isolated tests.

For **isolated payment staging**, use a separate database and nonproduction instance:

```dotenv
NODE_ENV=development
HOST=0.0.0.0
APP_BASE_URL=https://your-isolated-staging-host.example
SECURE_COOKIES=true
PADDLE_ENVIRONMENT=sandbox
PADDLE_CHECKOUT_ENABLED=true
PADDLE_CLIENT_TOKEN=test_<sandbox-browser-token>
PADDLE_API_KEY=pdl_sdbx_apikey_<sandbox-private-key>
PADDLE_PRODUCT_ID=<sandbox-product-id>
PADDLE_PRICE_ID=<sandbox-one-time-price-id>
PADDLE_WEBHOOK_SECRET=<sandbox-notification-secret>
```

Supply separate staging Turso and email settings as appropriate. Never reuse staging database records in production. The code rejects sandbox in production mode and mixed live/test credentials; STRATA's default live catalog cannot be used for sandbox. The live default remains `PADDLE_ENVIRONMENT=live`.

Verify provider delivery, signed webhook replay, checkout retries, completed purchase entitlement, refund/revocation, and existing-customer access on that staging deployment. Unit/integration fixtures simulate provider responses; they are not a completed Paddle sandbox transaction. Implementation references: [Paddle sandbox](https://developer.paddle.com/sdks/sandbox), [Paddle.js](https://developer.paddle.com/paddle-js/about).

## Rollback

Pause writes or place the application in maintenance before switching code or restoring data. If billing is implicated, set `PADDLE_CHECKOUT_ENABLED=false` to stop new checkout creation while retaining configured webhook reconciliation. Retain logs without secrets and take a new backup containing any 7.1.0 workouts.

Prefer a code-only rollback to the reviewed 7.0.0 artifact while keeping the database and the additive workout table. Old code cannot display new workout history; do not drop the table or restore an older backup merely to hide it. Stop workout mutations during rollback and preserve browser drafts for recovery. Verify existing users, plans, entitlements and email/payment reconciliation. If the storage adapter cannot enforce foreign keys, defer account deletion during the old-code interval because that code predates explicit workout cleanup.

A database restore discards writes after its snapshot. Use it only for a confirmed data problem after exporting/reconciling newer data and receiving authorization. Do not combine an automatic old-code rollback with a destructive database restore. Reapplying 7.1.0 is additive/idempotent.

## Remaining release gates

- Run the full Chromium suite successfully, including the new training journeys. Manually confirm keyboard navigation, 390px mobile layout, 200% text/zoom, reduced motion and assistive-technology announcements.
- Test 100 concurrent authenticated users against the intended host and Turso region, including shared Wi-Fi, with a sustained workload and realistic database size. Measure p95 latency, errors, CPU/memory, database/connection limits and account isolation. Agree hosted acceptance thresholds before the run.
- Verify real Resend verification/recovery/deletion delivery and an isolated Paddle sandbox transaction/refund. Confirm live production configuration separately before enabling sales.
- Restore a hosted backup to a separate database and verify counts/ownership before accepting production recovery readiness.
- Obtain production deployment authorization after these results are reviewable.

No claim is made that every possible defect is eliminated or that an untested production deployment supports 100 users.
