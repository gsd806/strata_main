# STRATA 7.1.1 readiness

Status: reviewable source candidate; not deployed.

This update keeps the manual planner free, moves workout logging/history and week setup into Strata+, supports independent optional rest days, and refreshes the Strata+ interface. See [release guide](release-7.1.1.md) and [changelog](../CHANGELOG.md).

| Check | Result |
| --- | --- |
| Node regression tests | 390 passed, zero failed |
| Coverage | 92.33% lines; 81.43% branches; 87.68% functions; existing floors passed |
| Release, architecture, type and lint checks | Passed; 15 server modules, zero cycles, reviewed budgets preserved |
| Account, discovery, planner and PWA runtime checks | Passed |
| Endpoint and storage performance budgets | Passed |
| Paid/trial/free/expired access | API and private-page regression tests passed, including signed fake-Paddle grant/refund events |
| 100 concurrent accounts sharing one IP | 5,823 requests, zero unexpected HTTP errors; 300 expected conflicts; all latency budgets passed |
| Scoped free-planner browser check | Passed rest removal, independent additions and refresh persistence |
| Automated Chromium E2E | Blocked before assertions: browser executable missing |
| Authenticated visual matrix and hosted providers | Not verified on this runner |

The complete `npm run check` exits nonzero at its final Chromium stage. All preceding stages passed. [Full release log](verification/7.1.1-release-check.log) and [shared-network load report](verification/7.1.1-load-shared.json) contain the reproducible evidence. After the documentation and load-fixture update, release alignment and lint were checked again successfully.

The shared-network run explicitly activated a trial for each synthetic account before logging workouts. Earlier free plan operations stayed free. Local p95 plan saves were 72.37 ms, workout saves 71.93 ms and workout completion 60.43 ms. These are local SQLite regression results, not hosted capacity measurements. Reports prefixed 7.1.0 are historical evidence for that candidate, not measurements of 7.1.1.

The browser check on this runner exercised the free planner: removed its Sunday rest marker, independently added Tuesday and Thursday, refreshed and verified both persisted. Existing scheduled exercises stayed visible. A direct `/workout.html?guest=1&day=Monday` navigation redirected to sign-in with Monday preserved. No production account, purchase, email or deployment was used.

The Strata+ interface was reviewed in source for responsive layout, contrast tokens, control readability and reduced-motion behavior. The authenticated Strata+ visual matrix still requires a browser session in the full end-to-end suite. Hosted Turso, real Resend and real Paddle sandbox transactions were not exercised. The existing deployment and provider checks in release-7.1.0.md remain applicable.
