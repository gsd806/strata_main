# STRATA 7.10.0 readiness

Local verification used Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion also requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including both 100-user load profiles, all configured browser engines, and storage-contract fixtures. The load harness intentionally refuses to run on macOS because its resource measurements require Linux `/proc`; no local load result is claimed here.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 835 passed in 39.47 seconds; zero failures, skips, or cancellations |
| Coverage | 95.00% lines; 81.59% branches; 91.07% functions; enforced floors passed |
| Energy engine coverage | 100.00% lines and functions; 90.53% branches |
| Browser suite | 53 passed in 104.71 seconds; zero failures, skips, or cancellations |
| Independent energy sweep | 40,320 version-3 adult/profile combinations exercised; 35,535 valid outputs and 4,785 intended review failures, plus exact legacy comparisons; zero invariant mismatches |
| Energy boundaries | All eight adult EER coefficient branches, both legacy resting-energy paths, calorie-goal direction, weekly distribution, macro direction, calibration sign, cap, shrinkage, and evidence thresholds passed |
| Calibration behavior | Requires 18 complete calorie days and 12 usable morning weights spanning at least 14 days in the prior 21-day window; incomplete, current-week, stale, contradictory, and implausible evidence cannot move the estimate |
| Compatibility | Stored profile versions 1 and 2 reproduce the exact prior resting-energy × legacy activity factor, receive no calibration, and upgrade only after an explicit review/save |
| Private boundary | Authentication, active Strata+ access, current-week dates, account/session binding, `no-store`, logout/account-switch clearing, export, and deletion passed |
| SQLite/Turso contract | Coaching profiles, weekly snapshots, optional morning weights, completion states, revisions, exports, and deletion matched through the local adapters and Turso transport fixture |
| Runtime smoke | Account, Strata+, Coaching, Progress, Plan, Train, and PWA passed |
| Architecture | 48 server modules and 72 browser modules across seven page boundaries; zero cycles or policy violations |
| Boundary types and lint | Passed with zero warnings |
| Managed versions | 7.10.0 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed across 40 measured samples after eight warmups each; slowest measured p95 was 1.208 ms locally |
| Linux load gate | Required on the exact release commit in GitHub Actions: 100 distinct-source sessions and 100 shared-source sessions |

## Product behavior

Build 7.10.0 gives newly created or deliberately reviewed coaching profiles a whole-day energy model based on the sex-specific 2023 adult Dietary Reference Intake Estimated Energy Requirement equations. Mifflin–St Jeor resting energy and optional Cunningham lean-mass energy remain visible cross-checks. The interface identifies the equation, activity semantics, starting estimate, planning band, and evidence state instead of presenting one unexplained calorie number.

Members can optionally record a morning weight and explicitly mark a day's intake complete. A version-3 weekly plan stays on its starting estimate until enough prior evidence exists. It then uses a robust weight trend and mean complete intake to estimate observed maintenance, shrinks the difference heavily toward the published baseline, rounds to 25 kcal, and caps the correction at 150 kcal per day. The current week's target remains fixed when diary entries change; eligible evidence is considered at the next weekly generation. The thresholds, trend filtering, `7,700 kcal/kg` conversion, shrinkage, cap, warning band, goal adjustments, macro rules, and projections are disclosed STRATA product heuristics—not clinical validation or a promise of an exact result.

Existing profile versions 1 and 2 keep their exact Build 7.9 target calculation and activity semantics and are labeled Legacy profile; the display now adds a broader warning band around that unchanged baseline. A read, deployment, or week rollover cannot silently reinterpret their old activity answers. Only an explicit member review/save creates version 3 and adopts the new whole-day activity meaning.

The public Strata+ offer remains $2.99 USD per month. Checkout, the seven-day no-card trial, grandfathered recurring access, prior lifetime access, and constraint-aware food options are unchanged.

## Deployment requirements

Deploy the server, migration, and matching versioned public assets from the same commit. Startup applies additive migration `005-coaching-calibration` idempotently in SQLite or Turso, adding nullable `morning_weight_kg` and `intake_complete` fields. The existing `(user_id, log_date)` primary key covers the bounded evidence lookup, so no new index is introduced. No Paddle, Resend, FoodData Central, or new secret configuration is required.

After deployment, verify an existing version-1/version-2 profile remains readable and reproduces its pre-deployment target. Then, with an isolated Strata+ account, explicitly review/save the profile, confirm it becomes version 3, and confirm the generated week identifies the EER model. Save and reload both an incomplete and complete intake day with a morning weight; confirm neither diary edit changes the already-persisted current-week target.

## Rollback

The migration is additive and nullable, but older log upserts do not know the new fields and cannot promise to preserve them. A version-3 profile is also a semantic compatibility boundary. Use a compatibility rollback that retains the Build 7.10 profile dispatcher, daily-log columns, and field mapping while disabling the new presentation. Do not drop calibration columns, downgrade profile versions, reinterpret whole-day activity as a legacy multiplier, or silently rewrite private evidence.

See the [7.10.0 release guide](release-7.10.0.md), [coaching methodology](coaching-methodology.md), [module architecture](module-architecture.md), and [test architecture](testing.md).
