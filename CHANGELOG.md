# Changelog

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
