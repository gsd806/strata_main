# Changelog

## 7.0.0 — Pilot readiness and interface update

- Added 100-user workloads for separate IPs and one shared network, covering private-plan isolation, concurrent writes, stale-edit rejection, restart persistence, and auth limits.
- Replaced the shared ten-attempt login/signup bottleneck with bounded network and hashed-identity limits. Verification limits follow the challenge; durable email restrictions remain enforced.
- Reject non-object JSON with HTTP 400. Preload/precompress allowlisted public assets within 16 MiB; private HTML remains dynamic.
- Added HTTP timeouts and a ten-second graceful shutdown deadline.
- Added atomic monthly plan revision checks for both storage adapters, conflict guidance, and recovery of corrupt monthly records.
- Prevent new weekly plans exceeding 30 exercises/day or 140/week; preserve older oversized guest drafts and offer explicit offline guest access.
- Enforce equipment and movement constraints on imported monthly exercises; reject eligibility calculation errors.
- Correct logout failures, rating/monthly save races, comparison focus, and mobile Account access.
- Added coordinated styling, score indicators, a weekly distribution chart, and finite animations with reduced-motion support.
- Updated the deployment blueprint to an always-on 1 CPU / 2 GB baseline, deterministic npm installation, and optional local .env loading. No hosted services are changed by this source update.


## v6.9.9.007 — 2026-09-06

Build 6.9.9.007 turns the previous quality measurements into enforceable release boundaries.

- Added an explicit server-module policy with reviewed size budgets, allowed dependency edges, cycle detection, and a generated dependency/size report.
- Added strict `checkJs` type checking for HTTP, Paddle, storage registration, and production service wiring, with declared dependency interfaces for the extracted authentication, administration, and support modules.
- Enforced calibrated 90% line, 78% branch, and 85% function coverage floors while keeping risk-focused tests more important than a 100% headline.
- Separated unit, integration, contract, and E2E test entry points and documented where each class belongs.
- Added isolated Chromium journeys for login and recovery, concurrent plan-conflict resolution, signed Paddle entitlement and replay handling, and emailed account deletion.
- Added reproducible median/p95 evidence and conservative regression budgets for health, status, authenticated-plan, session lookup, plan lookup, and compare-and-swap operations.
- Expanded `npm run check` and GitHub Actions so architecture, types, lint, coverage, runtime QA, performance, and browser E2E all gate the release.

## v6.9.9 — 2026-09-06

Build 6.9.9 is a focused maintenance and security release with no major feature expansion.

- Split authentication, session, administrator, audit, and support responsibilities out of the HTTP composition root.
- Added correctness-focused ESLint, a single `npm run check` release gate, and informational test coverage reporting.
- Expanded trust-boundary tests for authentication, CSRF, administrator permissions, session revocation, storage parity, and Paddle webhook replay and mismatch cases.
- Documented the architecture and security-reporting process, tightened PWA maintenance checks, and removed speculative database indexes.
- Improved dialog keyboard behavior, accessible status announcements, actionable validation/conflict errors, and consistent `Saving…`, `Saved`, and `Couldn't save — Retry` states.
