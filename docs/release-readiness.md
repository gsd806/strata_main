# STRATA 7.8.6 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all three browser engines and both 100-account load scenarios.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 759 passed; zero failures, skips, or cancellations |
| Coverage | 94.35% lines; 81.16% branches; 89.93% functions; enforced floors passed |
| Browser suite | 51 passed; zero failures, skips, or cancellations |
| Weekly reset | Guest and account saves, stale confirmation, exact account/revision binding, Cancel focus, and canonical empty-week restoration passed |
| Comparison entitlement | Guest and free controls are absent; active-member controls remain; stale, rechecking, revoked, switched-account, logout, and network-uncertain states fail closed |
| Runtime smoke | Account, Strata+, Plan, Train, and PWA passed |
| Architecture | 41 server modules; seven page boundaries; 67 unique browser modules; no policy violations or cycles |
| Boundary types and lint | Passed |
| Managed versions | 7.8.6 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed |

## Product behavior

Build 7.8.6 keeps Plan evidence collapsed by default and removes Plus-only next-move guidance from guest and free Plan views. Reset week clears the editable seven-day schedule, restores Sunday as the default recovery day, and uses the existing guest exact-copy or authenticated compare-and-swap save boundary. It leaves workout history, saved templates, monthly plans, and published community copies unchanged.

Homepage exercise comparison requires active Strata+ plus a recent server confirmation. It fails closed during rechecks and network uncertainty, revalidates on a bounded timer, preserves selections only for the same reconfirmed entitled account, and clears them on every loss or identity change. Plan guidance similarly fails closed while checking and refreshes on foreground, known expiry boundaries, and a periodic timer with bounded retry. Free Plan ownership/conflict comparisons remain because they prevent silent overwrites rather than analyze exercises or workouts.

## Deployment requirements

Deploy the Node server and matching versioned public assets together so the HTML, browser modules, and service-worker cache advance as one unit. Private pages and account APIs remain network-only. No database migration, new secret, provider configuration, payment-catalog change, or member-data format change is needed.

Rollback redeploys Build 7.8.5 and its matching assets. Weekly plans use the unchanged data format and remain compatible; a reset already saved by 7.8.6 remains an intentionally empty editable week.

See the [7.8.6 release guide](release-7.8.6.md), [module architecture](module-architecture.md), and [test architecture](testing.md). The [7.8.5 release guide](release-7.8.5.md) records the previous release and its separate validation.
