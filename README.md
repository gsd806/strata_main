# STRATA — Exercise Rankings and Workout Planning

STRATA is an evidence-informed workout index with server-backed, email-verified accounts, a private Strata+ studio, and weekly, community, and monthly workout planning. It includes 200 resistance-training exercises—25 per muscle group, including 50 bodyweight options—across 8 muscle groups and 26 sub-muscle targets. Build 6.9.9 is an installable Progressive Web App (PWA) with Resend-powered account email, Paddle-powered one-time Strata+ access, and a private owner dashboard.

**Build 6.9.9 is a focused hardening and maintainability release.** Authentication, administration, auditing, and support now live in injected modules instead of the HTTP composition root. The release also adds one-command quality checks, informational coverage, stronger storage/payment/security boundaries, safer PWA caching, clearer save errors, and verified keyboard-dialog behavior without introducing a major new feature.

STRATA also includes a login-free local weekly planner, account-synced plans, structured community-plan sharing, a deterministic 31-day workspace, community ratings, printable exports, and a private administrator help desk. Strata+ is **$5.99 USD as a one-time purchase with no subscription**. Paddle is the merchant of record, and the server grants access only after verifying a signed matching webhook.

See [CHANGELOG.md](CHANGELOG.md) for the concise release history.

## Requirements

- Node.js 24.x (the included `.node-version` selects the supported major)
- npm

## Quick start

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`. Local development creates `data/strata.sqlite`; a Turso account is not required.

Copy `.env.example` into your preferred local environment loader when testing email, admin, proxy, or payment configuration. Keep database tokens, email secrets, Paddle API keys, webhook secrets, and private promotion codes out of Git, browser code, logs, screenshots, and chat.

## Project structure

Build 6.9.9 separates browser files from private server code while preserving every public URL used by visitors, Paddle, Render, and installed PWAs:

```text
server.js          Stable npm/Render bootstrap
src/               Private application modules, storage adapters, and schema
scripts/           Allowlisted release-version tooling
public/pages/      HTML served at stable public routes
public/scripts/    Browser JavaScript
public/styles/     Browser stylesheets
public/data/       Intentionally public exercise catalog
public/icons/      PWA and site icons
data/              Generated local SQLite data; ignored by Git
test/              Automated Node test suite
qa/                Runtime and optional browser checks
docs/              Architecture and deployment guidance
```

See [docs/architecture.md](docs/architecture.md) for module responsibilities, request and database flow, trust boundaries, Paddle, Resend, and PWA caching.

## Quality commands

```bash
npm run check       # release consistency, lint, tests, and runtime QA
npm run lint        # correctness-focused ESLint checks; no formatting policy
npm test            # Node test suite
npm run coverage    # informational application-code coverage report
npm run qa:runtime  # browser-free runtime smoke checks
npm run qa:ui       # optional Playwright accessibility/layout audit
```

Coverage is a measurement, not a 100% target or a release gate. Use the uncovered branches to find meaningful boundary tests rather than writing tests solely to improve the percentage. The optional browser audit and its environment variables are documented in [qa/README.md](qa/README.md).

Before a release, audit managed version references with `npm run release:check`. Preview a bump with `npm run release:version -- --dry-run x.y.z`, then apply it with `npm run release:version -- x.y.z`. The tool changes only its explicit release manifest.

## Accounts, plans, and administrator access

- Passwords use scrypt with a unique random salt; plaintext and reversible passwords are never stored.
- Sessions are random database-backed tokens in HttpOnly, SameSite cookies. Sensitive writes also require a same-session CSRF token and trusted origin.
- Signup verification, password reset, and account deletion use time-limited email flows. Reset revokes every session; deletion requires a one-time registered-email confirmation.
- Signed-out plans stay in that browser. Signed-in weekly and monthly plans are private account records and sync through the configured store.
- Community plans publish validated structured workout data and a display name, never the member's email address or a binary upload.
- The one verified account matching server-only `ADMIN_EMAIL` may become the permanently bound primary owner. Admin elevation requires the current password and expires after 30 minutes.
- Admin mutations require elevation, CSRF and origin checks, typed confirmation, an audit reason, and guarded storage operations. The primary owner cannot suspend or delete itself through Admin.

No separate administrator password or Gmail integration is required. `SUPPORT_EMAIL` selects the reply mailbox; Resend sends transactional messages. Changing `ADMIN_EMAIL` does not transfer an already bound owner identity.

## PWA behavior

The deployed site can be installed from `/install.html` on supported iPhone, iPad, Android, Chrome, and Edge environments. The service worker uses a build-versioned cache, deletes older STRATA cache versions during activation, and caches only an explicit set of public assets and public offline fallbacks.

Account APIs, authentication routes, health checks, personalized pages, the administrator area, recovery/deletion pages, and saved account data stay network-only. Bearer-link reset and deletion pages intentionally do not initialize the PWA. An internet connection is required to sign in, use Admin or support, complete account actions, buy Strata+, or sync changes.

## Public pricing, support, and policies

Build 6.9.9 has public, mobile-friendly pages at `/pricing`, `/contact`, `/terms`, `/privacy`, and `/refunds`. The published refund window is 14 calendar days after purchase. Support is available through the Contact form and at `stratafitness.official@gmail.com`.

Paddle receives payment information; STRATA does not receive or store full payment-card or bank-account details. Do not change the displayed price independently of the live Paddle catalog. Before accepting payments, make sure the public operator details match the identity required by Paddle and applicable law rather than inventing missing legal information.

## Deployment

Production is a Node web service, not a static site. The application fails closed in production without Turso credentials, preventing account data from being accepted into an ephemeral filesystem. Email verification and checkout each remain disabled until their complete provider configuration is present.

Use [docs/deployment.md](docs/deployment.md) for:

- Turso and Render setup
- Resend domain and account-email configuration
- Paddle catalog, checkout, webhook, and go-live checks
- health, persistence, rollback, and production-limit checks

The checked-in `render.yaml` is the source of truth for fixed deployment values and secret prompts. The checked-in `.env.example` documents every supported local variable without containing credentials.

## Storage modes

- Without `TURSO_DATABASE_URL`, development and tests use a local SQLite file.
- With `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, the application uses Turso.
- Both adapters implement the same application-facing contract and schema behavior.
- Production intentionally refuses to start without the durable Turso configuration.

## Security

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Please report security issues privately instead of opening a public issue. The architecture and trust-boundary notes in [docs/architecture.md](docs/architecture.md) are useful context for review.

## Production limitations

Free hosting can sleep, has usage limits, and uses an ephemeral filesystem. An installed PWA cannot eliminate a server cold start, and account syncing still depends on the live web service and Turso. Transactional email also depends on Resend and valid sender-domain DNS. For real users, choose an appropriate service tier and operational monitoring.

STRATA currently has one password-stepped-up owner account. It does not yet include MFA, multiple administrator roles, file attachments, real-time chat, or automated community-content moderation.

## Editorial note

FitScore is an editorial synthesis for hypertrophy-oriented exercise selection. It is not a validated clinical scale, personalized medical prescription, or a claim made by the cited sources.
