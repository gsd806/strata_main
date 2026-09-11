# STRATA 7.8.7 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 786 passed; zero failures, skips, or cancellations |
| Coverage | 94.67% lines; 80.89% branches; 90.34% functions; enforced floors passed |
| Browser suite | 53 passed; zero failures, skips, or cancellations |
| Weekly reset | Guest and account saves, stale confirmation, exact account/revision binding, Cancel focus, and canonical empty-week restoration passed |
| Comparison entitlement | Guest and free controls are absent; active-member controls remain; stale, rechecking, revoked, switched-account, logout, and network-uncertain states fail closed |
| Coaching | Profile, weekly rotation, calorie targets, Progress logging, stale-write recovery, account isolation, export, deletion, and SQLite/Turso parity passed |
| Exercise catalog | 320 movements; unique IDs and names; complete scoring, prescriptions, guidance, cautions, and guide links passed |
| Runtime smoke | Account, Strata+, Coaching, Progress, Plan, Train, and PWA passed |
| Architecture | 45 server modules; seven page boundaries; 70 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.7 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Build 7.8.7 retains the Plan disclosure, reset, and fail-closed comparison boundaries from 7.8.6. It expands the catalog from 200 to 320 movements and adds a fifth private Strata+ destination for personal training and calorie counting. Members can save body and activity inputs, optional known-lift capabilities and macros, then inspect a stable current-week training and nutrition plan that rotates on the next local Monday.

Calorie results expose the equation, maintenance range, weekly budget, daily distribution, and safety fallbacks. Weight displays remain broad 4-, 8-, and 12-week scenarios rather than promises. Coaching records are account-owned, entitlement-gated, revision-safe, included in private export, and removed by the existing account-deletion lifecycle. Nutrition logging is limited to the active coaching week and is available from both Coaching and Progress.

## Deployment requirements

Deploy the Node server and matching versioned public assets together so the HTML, browser modules, exercise catalog, and service-worker cache advance as one unit. Private pages and account APIs remain network-only. Existing databases receive three additive coaching tables through normal schema initialization. No new secret, provider configuration, or payment-catalog change is needed.

Rollback redeploys Build 7.8.6 and its matching assets. The older application safely ignores the additive coaching tables, preserving those records for a later compatible deployment. Existing plans, workouts, subscriptions, and reset/comparison behavior retain their prior formats.

See the [7.8.7 release guide](release-7.8.7.md), [coaching methodology](coaching-methodology.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.6 release guide](release-7.8.6.md) records the previous release and its separate validation.
