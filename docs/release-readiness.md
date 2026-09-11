# STRATA 7.8.3 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 732 passed; zero failures, skips, or cancellations |
| Coverage | 94.54% lines; 80.74% branches; 90.06% functions; enforced floors passed |
| Browser suite | 49 passed; zero failures, skips, or cancellations |
| Repaired Strata+ state matrix | No-plan, empty-day, scheduled, active, Progress, score-guide, mobile, focus, and reduced-motion paths passed |
| Full responsive UI audit | 18 routes passed at 320, 339, 360, 390, 430, 600, 700, and 768 pixels with zero overflow or text-layout findings |
| Runtime smoke | Account, Strata+, Plan, Train, and PWA passed |
| Architecture | 40 server modules; seven page boundaries; 67 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.3 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Build 7.8.3 restores the 7.8.1 presentation and navigation baseline while preserving the 7.8.2 progression model. Plan leads with the saved weekly plan and progressively discloses its secondary tools. Today distinguishes no-plan, next-scheduled-workout, and active-workout states; Train distinguishes no-plan, empty-selected-day, scheduled-workout, and active-workout states. Progress renders explicit loading, error, empty, and populated states. One expandable guide defines the three scores without duplicating explanations across the interface.

## Deployment requirements

Deploy the Node server and matching public assets together. Build 7.8.3 advances the service-worker cache and managed asset versions. Existing network-only behavior for private pages and account APIs is preserved. No database migration, new secret, provider configuration, payment-catalog change, auth change, or API-contract change is needed.

Rollback redeploys the previous application and its matching assets; saved workouts retain the existing format.

See the [7.8.3 release guide](release-7.8.3.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.2 release guide](release-7.8.2.md) records the previous release and its separate validation.
