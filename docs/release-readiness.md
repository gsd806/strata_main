# STRATA 7.8.2 readiness

Local verification uses Darwin arm64 and Node.js 24.20.0 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 728 passed; zero failures, skips, or cancellations |
| Coverage | 94.54% lines; 80.72% branches; 90.06% functions; enforced floors passed |
| Browser suite | 46 passed; zero failures, skips, or cancellations |
| New progression checks | Seven passed, including delayed guidance and unchecked draft isolation |
| Responsive progression UI | Visually verified at 320, 390, and 1440 pixels; no overflow; 44-pixel action targets |
| Runtime smoke | Account, Strata+, Plan, Train, and PWA passed |
| Architecture | 40 server modules; seven page boundaries; 66 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.2 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Completed sessions show exact per-set next targets without requiring a check-in. Two complete comparable sessions at the top of the prescribed range can suggest a small load increase. Otherwise the app builds reps or repeats the recorded targets. Optional effort and check-in feedback can hold progression. The next matching session offers an explicit Apply button, preserving previously recorded results and the weekly plan.

## Deployment requirements

Deploy the Node server and matching public assets together. Build 7.8.2 advances the service-worker cache and managed asset versions. Existing network-only behavior for private pages and account APIs is preserved. No database migration, new secret, provider configuration, or payment-catalog change is needed.

Rollback redeploys the previous application and its matching assets; saved workouts retain the existing format.

See the [7.8.2 release guide](release-7.8.2.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.1 release guide](release-7.8.1.md) records the previous release and its separate validation.
