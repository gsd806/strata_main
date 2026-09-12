# STRATA 8.0.0 readiness

Verification uses Darwin arm64 with supported Node.js 24.20.0, isolated temporary accounts, controlled provider fixtures, and Chromium. Promotion also requires the exact release commit to pass the Node 24 Linux GitHub Actions gate, including configured browser engines and both 100-account load profiles. Linux resource measurements are not claimed from a macOS run.

## Verification

| Check | Result |
| --- | --- |
| Node regression suite | 920 passed; no failures, skips, or cancellations |
| Coverage | 95.09% lines, 83.25% branches, 91.59% functions; unchanged 90/78/85 floors passed |
| Energy and training leaves | 100% line coverage for calorie calibration and energy planning; 99.07% for training composition |
| Numerical benchmark | Fixed-seed alignment, noise, missing-intake, fluid-step, density, repeated-week, and under-reporting assertions passed; adverse outcomes retained |
| Storage and service integration | 14 coaching database/HTTP tests passed, including SQLite/Turso parity, snapshot continuity, historical dates, and account/revision isolation |
| Complete local release gate | `npm run check` passed |
| Browser journeys | 54 passed; no failures, skips, or cancellations |
| Responsive UI audit | 18 routes × 8 widths; zero horizontal overflow, text-containment issues, navigation-focus overlap, or unexpected browser errors |
| Runtime and performance | All runtime surfaces and seven endpoint/storage budgets passed; 40 measured samples after eight warmups per operation |
| Architecture | 53 server modules, 73 browser modules, seven browser boundaries; zero cycles or policy violations |
| Types, lint, managed versions | Passed; 8.0.0 aligned across 32 managed files |
| Linux release gate | Required on the exact GitHub head, including both 100-account load profiles |

Focused verification includes exact weekly budgets, integer macro accounting, raw/displayed scenario guards, credible recent weights, recorded training targets, food quantity scaling, partial nutrition fits, historical targets, and delayed-save draft preservation. The benchmark is mathematical regression evidence, not clinical validation.

## Behavior and limitations

Version-3 calorie estimates use complete intake aligned with actual morning-weight intervals within the prior 42 dates. Quality checks can withhold an adjustment. Accepted evidence gradually informs a new weekly target, with explicit stale-evidence handling and sensitivity ranges. Credible recent weights inform the equation, macros, BMI guard, and scenario starting point. The published EER coefficients and legacy version-1/version-2 semantics remain unchanged.

Balanced, strength, and hypertrophy training goals control repeatable prescriptions that respect equipment, actual experience, movement constraints, and the selected duration. Direct-muscle coverage and recorded per-set targets are reviewable. Missing required movements produce partial or unavailable sessions; valid equipment-limited profiles keep access to calories and the diary without claiming more equipment or a different experience level. Food quantities scale with servings, and menus disclose calorie or known-macro shortfalls.

Saved current weeks remain fixed through deployment and diary edits. Concurrent generation at the same profile revision keeps the first stored snapshot. Today and the preceding 42 diary dates accept corrections, and old dates use their original saved target or show none. Explicit profile review/save or the next generated week adopts the new model.

The synthetic benchmark demonstrates corrected interval alignment and greater adaptation to sustained equation bias. It also documents worse outcomes with missing intake, some noise/density cases, and systematic under-reporting. The method cannot distinguish omitted food from lower expenditure using these observations alone. Calculations and heuristics are not clinically validated; food nutrition and prices remain editorial estimates.

## Deployment and rollback

Deploy the server and versioned public assets from the same commit. This release requires no database migration, new secret, or food/pricing provider. Existing nullable evidence columns, authenticated Strata+ access, CSRF/origin guards, account-bound requests, optimistic revisions, private export/deletion, and network-only private responses remain in use.

Use a compatibility rollback that preserves profile semantics, saved-week continuity, and all existing diary fields. Do not downgrade profiles, rewrite private evidence, or drop calibration columns. Keep the current-week first-writer rule so a rollback cannot silently replace a saved target.

See the [release guide](release-8.0.0.md), [methodology](coaching-methodology.md), [module architecture](module-architecture.md), and [test architecture](testing.md).
