# STRATA 7.8.3 readiness

Local verification uses Darwin arm64 and Node.js 24.20.0 with isolated temporary accounts and controlled provider fixtures. The release commit must also pass the required Node 24 Linux GitHub Actions gate, including browser compatibility and both 100-account load scenarios, before tagging.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 737 passed; zero failures, skips, or cancellations |
| Coverage | 94.86% lines; 81.12% branches; 90.68% functions; enforced floors passed |
| Browser suite | 57 passed; zero failures, skips, or cancellations |
| Visual regression suite | 9 passed; zero failures, skips, or cancellations |
| Full UI audit | Passed: 18 routes at eight widths (320–768px), Plan at 12 widths (320–1440px); zero overflow, layout or text issues; keyboard dialogs and skip link passed |
| Dedicated UX state checks | 5 passed; all ten child views at mobile/desktop widths passed Axe WCAG A/AA checks |
| Train state checks | 5 passed; empty, active, error/retry and inactive-access flows |
| Runtime smoke | Account, exercise/planning tools, Plan, Train and PWA passed |
| Architecture | 40 server files including bootstrap; seven page boundaries; 68 unique browser modules; zero cycles or violations |
| Boundary types and lint | Passed |
| Managed versions | 7.8.3 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

Final screenshots were inspected at 320, 390 and 1440px. All five primary navigation targets fit in one row without clipping, and the selected exercise child is visible. Automated compatibility checks run Chromium and WebKit locally; the required Linux CI also includes Firefox.

## Preserved boundaries

No migration, saved-data format, billing rule, entitlement rule, score calculation, or exercise-selection algorithm change. Private HTML and API responses remain network-only. Account identity and access are checked before showing asynchronously loaded private history. Existing workout, weekly-plan, training-block and community-plan confirmations retain revision checks. Build 7.8.2 weight progression remains available.

## Deployment

Deploy the Node server and matching public assets together. Build 7.8.3 advances the service-worker cache and managed asset versions. No new secret, provider setting or payment catalog configuration is required. Rollback redeploys 7.8.2 with its matching assets; existing plans and logs remain compatible.

The [release guide](release-7.8.3.md) records the information architecture, copy decisions, routes, file inventory and intentional limits. No live provider purchase or email transaction is claimed by this UX release.
