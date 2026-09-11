# STRATA 7.8.8 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 798 passed; zero failures, skips, or cancellations |
| Coverage | 94.83% lines; 81.07% branches; 90.49% functions; enforced floors passed |
| Browser suite | 53 passed; zero failures, skips, or cancellations |
| Weekly reset | Guest and account saves, stale confirmation, exact account/revision binding, Cancel focus, and canonical empty-week restoration passed |
| Comparison entitlement | Guest and free controls are absent; active-member controls remain; stale, rechecking, revoked, switched-account, logout, and network-uncertain states fail closed |
| Coaching | Profile, weekly rotation, calorie targets, Progress logging, stale-write recovery, account isolation, export, deletion, and SQLite/Turso parity passed |
| Exercise catalog | 320 movements; unique IDs and names; complete scoring, prescriptions, guidance, cautions, and guide links passed |
| Runtime smoke | Account, Strata+, Coaching, Progress, Plan, Train, and PWA passed |
| Architecture | 46 server modules; seven page boundaries; 70 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.8 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Build 7.8.8 retains the complete 7.8.7 coaching model while presenting its one-time profile as four distinct Body, Training, Experience, and Nutrition cards. Desktop members get a compact section map; narrow screens avoid the repeated pitch and reach the first inputs in the initial viewport. Known-exercise rows keep visible labels on mobile, the empty state explains that capabilities are optional, and the setup is exercised at 1440, 768, 390, and 320 pixels plus 200% text size.

The public Strata+ offer is $2.99 USD per month. New checkout uses only the current configured Paddle price and fails closed unless the returned transaction proves a 299-cent USD base price, the configured product, one-month cycle, quantity one, automatic collection, and durable account metadata. Earlier recurring prices may remain entitled only through the private explicit allowlist; wrong products and annual or unlisted prices remain denied. The seven-day no-card trial and prior lifetime access are unchanged.

## Deployment requirements

Deploy the Node server and matching versioned public assets together so the HTML, browser modules, exercise catalog, and service-worker cache advance as one unit. Private pages and account APIs remain network-only. No database migration is required. Before enabling checkout, configure Paddle's current monthly price as exactly USD 2.99 and, when changing IDs, place the previous recurring ID in `PADDLE_LEGACY_RECURRING_PRICE_IDS`. Validate one new checkout and one existing subscriber before enabling payments.

Disable checkout before rollback. Build 7.8.7 advertises the former price and does not understand the recurring-price allowlist, so its deployed Paddle catalog and environment must be restored to a matching safe state before checkout is enabled again. Stored plans, workouts, coaching records, subscriptions, and account data require no schema rollback.

See the [7.8.8 release guide](release-7.8.8.md), [coaching methodology](coaching-methodology.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.7 release guide](release-7.8.7.md) records the previous release and its separate validation.
