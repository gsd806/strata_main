# STRATA 7.8.5 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 753 passed; zero failures, skips, or cancellations |
| Coverage | 94.33% lines; 81.14% branches; 89.86% functions; enforced floors passed |
| Browser suite | 50 passed; zero failures, skips, or cancellations |
| Interrupted-checkout deletion | Admin close, session revocation, deletion, earlier monthly catalogs, provider failure, and interrupted-cleanup retry passed |
| Runtime smoke | Account, Strata+, Plan, Train, and PWA passed |
| Architecture | 41 server modules; seven page boundaries; 67 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.5 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Build 7.8.5 makes an exactly matched abandoned Paddle draft non-payable before account deletion by switching it to manual collection with checkout disabled and STRATA checkout metadata cleared. It handles drafts recorded under an earlier monthly catalog, safely resumes partial cleanup, and never treats the retained Paddle record as deleted or canceled. Active subscriptions, completed payment state awaiting a subscription link, provider failures, and identity/catalog mismatches continue to block removal.

The Admin action to block new checkout creation remains separate from revoking STRATA login sessions. Admin now explains that distinction and reports checkout-creation, payment/subscription-link, provider-availability, and unsafe-match failures separately. The direct sole-owner authorization behavior from Build 7.8.4 remains unchanged.

## Deployment requirements

Deploy the Node server and matching public/Admin assets together because provider cleanup behavior and its UI copy change as one unit. Build 7.8.5 advances the service-worker cache and managed asset versions while preserving network-only behavior for private pages and account APIs. No database migration, new secret, provider configuration, payment-catalog change, or member-data format change is needed.

Rollback redeploys Build 7.8.4 and its matching assets. Saved workouts remain compatible; a provider draft already retired by 7.8.5 remains non-payable but should be reconciled by 7.8.5 before deletion.

See the [7.8.5 release guide](release-7.8.5.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.4 release guide](release-7.8.4.md) records the previous release and its separate validation.
