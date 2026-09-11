# STRATA 7.8.4 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 729 passed; zero failures, skips, or cancellations |
| Coverage | 94.34% lines; 80.93% branches; 89.83% functions; enforced floors passed |
| Browser suite | 50 passed; zero failures, skips, or cancellations |
| Simplified Admin flow | Bound-owner direct entry, non-owner denial, one-click review, minimal payload, CSRF transport, and foreground private-data purge passed |
| Full responsive UI audit | 18 routes passed at 320, 339, 360, 390, 430, 600, 700, and 768 pixels with zero overflow or text-layout findings |
| Runtime smoke | Account, Strata+, Plan, Train, and PWA passed |
| Architecture | 40 server modules; seven page boundaries; 67 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.4 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Build 7.8.4 lets the one verified, permanently bound primary owner open Admin with the normal live account session. It removes the separate Admin password and email-code step-up, typed action commands, and operator-entered audit reasons. Every account action retains one explicit review dialog; the server generates the audit reason and continues to enforce the owner binding, current session and auth version, Origin, CSRF, JSON, rate, revision, self-protection, billing, and atomic deletion boundaries. The restored 7.8.3 presentation and 7.8.2 progression model remain intact.

## Deployment requirements

Deploy the Node server and matching public assets together because the private Admin client and its API behavior change as one unit. Build 7.8.4 advances the service-worker cache and managed asset versions while preserving network-only behavior for private pages and account APIs. No database migration, new secret, provider configuration, payment-catalog change, or member-data format change is needed.

Rollback redeploys the previous application and its matching assets; saved workouts retain the existing format.

See the [7.8.4 release guide](release-7.8.4.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.3 release guide](release-7.8.3.md) records the previous release and its separate validation.
