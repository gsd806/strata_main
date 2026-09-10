# STRATA 7.8.1 readiness

Status: the complete local release gate passed on 2026-09-10. This candidate adds selectable session generation and optional muscle-group and specific-muscle filters. It has not been deployed. Release promotion still requires the exact commit to pass the required Node 24 Linux GitHub Actions check.

## Current verification

Checks ran on Darwin arm64 with Node.js 24.20.0. Provider-dependent checks use controlled fakes and isolated temporary data.

| Check | Observed result |
| --- | --- |
| Complete release gate | `npm run check` passed |
| Node regression suite | 685 passed; zero failures, skips, or cancellations |
| Coverage | 94.44% lines; 79.80% branches; 89.61% functions; enforced floors passed |
| Browser E2E | 39 passed; zero failures, skips, or cancellations |
| Session browser checks | Eight checks cover the new selection, history, filtering, save, conflict, and responsive behavior |
| Session layout | 320, 390, and 1440 pixels; no horizontal overflow; visible controls meet 44-pixel touch targets |
| Runtime smoke checks | Account, Strata+, Plan, Train, and PWA passed |
| Architecture | 39 server modules; seven page boundaries and 65 unique browser modules; zero cycles or policy violations |
| Boundary type checking and lint | Passed |
| Managed release references | Aligned at 7.8.1 across 32 allowlisted files |
| Performance budgets | All seven endpoint/storage budgets passed |
| Exact-commit Linux CI | Required before release promotion; not run for this local candidate |
| Hosted runtime and live providers | Not verified for this candidate |

## Product behavior

Build a session now offers Random, Not in my week, Needs focus, and My preferences. Every mode respects the selected training focus, equipment, movement limits, duration, and optional muscle filters. Previewing or changing the brief does not save a plan.

Not in my week excludes every exercise present on any day of the saved week. Pool shortages produce an explanation; the builder never fills gaps with scheduled repeats. Saving uses the existing plan revision check. A conflicting week must be reviewed, and strict-exclusion sessions are rebuilt against the new snapshot.

Needs focus compares completed sets by muscle target over the last 28 calendar days. My preferences uses the member's own ratings, saved movement board, and repeated completed choices. Missing or partial history is disclosed, and repeat use is described as observed training rather than proof of enjoyment. Both methods fall back to the saved profile when relevant evidence is absent.

## Deployment requirements

Deploy the Node server and matching public assets together. Build 7.8.1 updates managed asset versions and the service-worker cache. The selection helper is public pure logic; account APIs and private pages retain their existing network-only behavior. No database migration, new secret, provider configuration, or payment-catalog change is needed.

Rollback redeploys the prior application and its matching assets. Sessions already added to a week remain ordinary entries in the existing plan format.

See the [7.8.1 release guide](release-7.8.1.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.0 release guide](release-7.8.0.md) records the prior release and its separate validation.
