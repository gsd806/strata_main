# STRATA 7.8.7 — Personal training and calorie planning

Build 7.8.7 expands the public exercise library and adds Personal training and calorie counting as the fifth destination inside the private Strata+ workspace. The coaching result is deterministic and inspectable: members can see the profile inputs, energy equation, planning assumptions, weekly training prescriptions, daily calorie distribution, and uncertainty around weight scenarios instead of receiving an unexplained score or promise.

## What changed

- **A larger exercise library.** The catalog grows by 120 movements, from 200 to 320. It now contains 71 bodyweight options across the existing 8 muscle groups and 26 sub-muscle targets. Automated catalog checks retain unique IDs and names plus complete scoring, prescription, cue, caution, and YouTube guide metadata.
- **A fifth Strata+ destination.** Today, Plan, Progress, Explore, and Personal training & calories remain separate, keyboard-focusable workspaces. Coaching is available only to a signed-in member with current Strata+ access.
- **A profile with relevant context.** Members can enter metric or imperial height and weight, age, optional body-fat percentage, the published equation input when body fat is absent, typical total activity, goal and pace, training experience, one to six workout days, session duration, and optional known exercises with sets, repetitions, and load. Exercise choice also respects saved equipment and movement limitations.
- **A stable, rotating training week.** A profile save creates a seven-day snapshot with sessions on the selected days. The same profile revision and Monday date reproduce the same plan throughout that week; the next local Monday creates a new rotation, while editing the profile creates a new current-week plan immediately. Known exercise capabilities can inform conservative first-week ceilings but are never treated as tested one-repetition maximums.
- **Transparent calorie planning.** The dashboard shows resting energy, a maintenance range, and all three deficit, maintenance, and building estimates. The selected goal is distributed over seven days as steady intake, a training-day zigzag, or one flexible day while preserving the weekly calorie budget. A 1,200 kcal floor, BMI review boundary, bounded deficit or surplus, and steady-pattern fallback prevent unsafe automatic output.
- **Optional macros and daily progress.** Members may enable protein, fat, and carbohydrate targets, then save the current week's calorie and optional macro totals from either Coaching or Progress. Each entry shows the matching day target and keeps remaining calories separate from an over-target amount.
- **Weight scenarios, not promises.** The 4-, 8-, and 12-week display uses broad ranges and persistent uncertainty language. It is a simplified population-based planning scenario, not a clinical measurement or guaranteed result.

The formulas, source links, progression rules, limitations, and safety language are documented in [Personal training and calorie counting methodology](coaching-methodology.md).

## Data, security, and architecture

Coaching adds three account-owned record types: one versioned profile, stable weekly snapshots keyed by Monday, and versioned daily nutrition logs. SQLite and Turso expose the same storage contract. The private account export includes all three collections, and account deletion removes them through the existing account lifecycle.

Every coaching API first requires an authenticated, currently entitled Strata+ session. Writes additionally require a trusted origin, the live session's CSRF token, JSON content, rate limits, and optimistic revisions; the browser also sends the durable account ID so an account change fails closed. Logs are limited to the active coaching week. Expired access denies reads and writes without deleting the stored profile or log, and the browser clears previously rendered health and intake data before it revalidates a changed account.

The reviewed dependency graph contains 45 server modules and 70 browser modules across 7 page boundaries, with zero cycles and zero policy violations. Coaching responsibilities remain split across four server modules—validation/generation, schema, storage parity, and HTTP service—and three focused browser modules for pure UI logic, rendering, and events. The largest new server module is 210 physical lines; the new browser modules are 199, 83, and 66 lines.

## Verification evidence

Focused pre-release verification on 11 September 2026 passed:

- `npm run architecture:check`: 45 server modules and 70 browser modules; 0 cycles and 0 policy violations.
- `node --test test/coaching-core.test.js test/database-coaching.test.js test/personal-training-ui-core.test.js test/server-coaching.test.js test/discover-feature-navigation.test.js test/discovery-core.test.js test/pwa.test.js qa/e2e/coaching-flow.js`: 75 tests passed, 0 failed.
- The real Chromium journey signs up a member, activates Strata+, opens the fifth destination, saves a known-lift profile, verifies three training sessions and seven varied calorie targets, logs calories and macros, reloads persisted data, recovers from a stale-write conflict, and confirms private DOM data is purged before an account change loads.
- Unit, integration, and contract coverage exercises equation selection, calorie floors and fallbacks, deterministic Monday rotation, hard equipment and movement constraints, conservative capability use, authenticated/entitled API boundaries, CSRF and account binding, current-week logs, concurrent compare-and-swap writes, SQLite/Turso parity, export, and deletion.

The final version-aligned `npm run check` also passed; [release readiness](release-readiness.md) records the complete unit, integration, contract, E2E, coverage, architecture, runtime, and performance results.

## Deployment and rollback

Deploy the server, public HTML, browser modules, catalog, and service worker from the same commit. Existing databases receive three additive coaching tables through normal schema initialization. No Paddle product, price, webhook, Resend, or secret configuration changes are required.

Rollback is a redeploy of Build 7.8.6 and its matching public assets. The older application ignores the additive coaching tables, so saved coaching profiles, weeks, and logs remain stored but unavailable until 7.8.7 or a compatible later build returns. Existing plans, workouts, subscriptions, and the 7.8.6 reset/comparison behavior retain their prior formats. Do not drop the coaching tables as part of an application rollback.
