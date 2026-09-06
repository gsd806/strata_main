# STRATA 7.1.3 — Shared design and simpler navigation

This reviewable source candidate is based on the latest GitHub release found at the start of this work, [v7.1.2](https://github.com/gsd806/strata_main/releases/tag/v7.1.2), published 6 September 2026. It has not been deployed. The source archive provenance is in `docs/verification/7.1.2-source.json`.

## What changed

- Applied the Strata+ visual language to every HTML entry point: charcoal surfaces, lime actions, Manrope headings/body, DM Mono utility text, rounded controls, and brief optional transitions. Page CSS retains component layout while `experience.css` owns shared theme tokens. Font fallbacks remain available when Google Fonts cannot load.
- Simplified the rankings homepage: removed the photo backdrop, moving ticker, redundant editorial section, and founder section; reduced the sales block and kept rankings, the scoring explanation, sources, and public policy links.
- Added the public `/policies` hub with Terms, Privacy, Refunds, support, and the founder biography. Existing legal terms and policy URLs remain intact. The public page is included in offline fallback caching.
- Added a permanent **Set up my week** card to Strata+, so members can rebuild an existing week. The state-aware workout action and seven in-page tools retain their existing navigation and focus behavior.
- Simplified the free planner's instructions and account introductions, grouped the pricing feature list, removed technical secrets/provider jargon from support copy, and aligned public-page navigation.
- Preserved free planning, week templates, export, sharing, and explicit rest-day add/remove actions. Weekly setup, workouts, and paid tools retain server-side Strata+ access checks.
- Corrected contrast across primary, destructive, selected, hover, and recovery states. Restored the weekly distribution chart as a planner-owned component after replacing the old shared stylesheet. Reduced-motion and print rules remain supported.

## Data and compatibility

No new database migration, credential change, price change, or entitlement rule is introduced by 7.1.3. Existing plans, guest data, workouts, preferences, templates, ratings, and integrations retain the v7.1.2 formats and write paths. In particular, atomic plan/profile setup, optimistic revision checks, and the database's one-active-workout constraint are preserved.

When upgrading from **before 7.1.2**, first read `docs/release-7.1.2.md`: its active-workout index and legacy-duplicate reconciliation still apply. Reconciliation is inherited behavior, not a new migration in this release.

## Review and deployment

1. Use Node 24 and run `npm ci`.
2. Run `npm run check`. The complete gate includes Chromium E2E; install the matching Playwright browser in your test environment (`npx playwright install chromium`) or configure an existing compatible binary with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
3. Run `npm run qa:ui` against an isolated test instance. It creates synthetic accounts and changes plans; never point it at production. Review desktop and 700/390/320 px layouts, enlarged text, reduced motion, keyboard navigation, and paid/trial workspaces.
4. Run `npm run load:100` and `npm run load:100:shared` on Linux, then perform production-like Turso capacity checks and real provider sandbox checks. Local SQLite results do not establish hosted capacity.
5. Take and verify the backup described in `docs/deployment.md`. Keep existing environment configuration from `.env.example` / `render.yaml`.
6. After approval, deploy the complete server, public pages, CSS, scripts, and service worker together. Refresh installed/open clients and check public policies, free planning/rest markers, paid setup, session resume, and a successful save.

## Rollback

For an upgrade directly from v7.1.2, restore the complete v7.1.2 application and assets while retaining the current database. No 7.1.3-specific schema downgrade is needed. Avoid restoring an old database automatically because doing so would lose new user work. Refresh open/PWA clients to avoid mixed assets.

Do not downgrade below 7.1.2 without following its migration and rollback instructions for `workouts_one_active_per_user` and pausing competing writers.

## Validation

See `docs/release-readiness.md` for measured results and limitations. Automated Chromium execution is blocked in this workspace by a missing browser binary; authenticated visual and mobile checks are therefore required before deployment. No production deployment, real email, real payment, or hosted Turso load test was performed.
