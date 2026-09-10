# STRATA 7.7.0 readiness

Status: the complete local release gate and responsive UI audit passed. Promotion still requires the exact commit to pass the required Node 24 Linux GitHub Actions check before the tag and GitHub release are created. Live provider and deployed-runtime checks remain separate.

## Current verification

The final local checks ran on Darwin arm64 with Node.js 24.19.0 and npm 11.11.1. Provider-dependent tests use controlled fakes and isolated temporary data; they do not contact production services or modify production data.

| Check | Observed result |
| --- | --- |
| Complete release gate | Passed with `npm run check` |
| Node regression suite | 583 passed; zero failures, skips, or cancellations |
| Coverage | 94.21% lines; 80.16% branches; 90.48% functions; enforced 90% / 78% / 85% floors passed |
| Runtime smoke checks | Account, Discover, planner, workout, and PWA checks passed |
| Architecture | 38 modules; zero cycles; zero policy violations |
| Boundary type checking and lint | Passed |
| Managed release references | Aligned at 7.7.0 across 32 allowlisted files |
| Browser E2E | 29 passed in Chromium and WebKit |
| Responsive UI audit | 18 routes at eight widths from 320–768 px, plus planner geometry through 1440 px; zero overflow, text, dialog, focus-navigation, or console failures |
| Performance budgets | Passed |
| Linux Firefox and 100-user profiles | Required in GitHub Actions before promotion |
| Live Paddle, Resend, Turso and hosted runtime | Not verified locally |

New tests cover exact grant expiry, indefinite access, early revocation, future starts, invalid durations, calendar leap days, offline expiry limits, the admin grant dialog and security reset, ordinary-user and CSRF denial, stale grant updates, unused trials and unchanged purchase records, direct account deletion, billing blockers, fresh checkout closure, provider cancellation failure, unsupported draft states, re-enabling checkouts, concurrent provider creation and admin grants/holds, and recovery of an already-completed transaction while checkout blocking remains active.

SQLite and the SQLite-backed Turso transport fixture check commit-time owner elevation, grant and hold revision conflicts, audit rollback, primary-owner grants, payment hold enforcement, recording accepted provider work only against a matching durable claim, and explicit administrator-control cleanup during both self-service and administrator deletion when foreign-key enforcement is unavailable. This is adapter-parity evidence, not a live Turso test.

Independent review found and prompted fixes for administrator-dialog reset, in-flight checkout responses, interrupted transaction recovery, concurrent closure or re-enable targeting, explicit Turso deletion cleanup, and disclosure of complimentary grants that coexist with paid or grandfathered lifetime access. Release and architecture documentation was reconciled with the implemented 7.7.0 behavior. The final code, security, release, and UI reviews found no remaining concrete local blocker.

## Deployment requirements

The app remains a Node web service. No new dependency or payment-catalog change was introduced. Deploy the server and public assets together. Startup creates the additive `admin_account_controls` table on SQLite or Turso. Existing account, purchase, and trial rows are preserved. The 7.6.0 product improvements and seven-day trial policy are included.

Paddle cancellation is limited to supported unfinished transaction states. A checkout hold does not cancel recurring subscriptions or reverse payments. Resolve live subscriptions and unresolved payments before permanent account deletion. Verify provider behavior and mobile and administrator workflows in the configured deployment before using the new controls on customers.

See [the release guide](release-7.7.0.md) for operating instructions and [the founder plan](founder-plan.md) for product priorities. Historical release records describe their own builds and are not current verification evidence.
