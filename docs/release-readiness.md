# STRATA 7.9.0 readiness

Local verification uses Darwin arm64 and Node.js 25.8.2 with controlled provider fakes and isolated temporary accounts. Release promotion requires the exact commit to pass the supported Node 24 Linux GitHub Actions gate, including all configured browser engines and storage-contract fixtures.

## Verification

| Check | Result |
| --- | --- |
| Complete local release gate | `npm run check` passed |
| Node regression suite | 815 passed in 38.89 seconds; zero failures, skips, or cancellations |
| Coverage | 94.93% lines; 81.22% branches; 90.79% functions; enforced floors passed |
| Browser suite | 53 passed in 107.12 seconds; zero failures, skips, or cancellations |
| Food-option safety | Contradictory allergy states reject; other-or-uncertain allergies fail closed; allergens and dietary requirements are hard filters; unknown consumed macros stay unknown; calorie-fit limitations remain explicit |
| Food-option behavior | Remaining intake, 1–6 meal preference, favorites, household amounts, scaled rough cost, optional daily USD budget, and deterministic replay passed |
| Private boundary | Authentication, active Strata+ access, current-week dates, account/session binding, `no-store`, logout/account-switch clearing, export, and deletion passed |
| SQLite/Turso contract | Coaching profiles, weekly snapshots, daily logs, revisions, exports, and deletion matched through the local adapters and Turso transport fixture |
| Runtime smoke | Account, Strata+, Coaching, Progress, Plan, Train, and PWA passed |
| Architecture | 47 server modules and 72 unique browser modules across seven page boundaries; zero cycles or policy violations |
| Boundary types and lint | Passed with zero warnings |
| Managed versions | 7.9.0 aligned across 32 allowlisted files |
| Performance | All seven endpoint/storage budgets passed across 40 measured samples after eight warmups each |

## Product behavior

Build 7.9.0 adds private, constraint-aware food options to the existing Personal training and calorie counting workspace. Members can save a dietary pattern, supported allergens, gluten-free or dairy-free requirements, favorite-food categories, their usual 1–6 meals per day, and an optional daily USD food budget. Coaching and Progress then offer up to three deterministic ideas based on the current day’s server-owned calorie target and any optional macro targets, minus intake the member has actually logged.

Allergens and dietary requirements filter first. Favorites and the budget affect ranking only and never override a hard restriction. Another or uncertain allergy disables automatic matching. Options show household ingredient amounts, an explicit base-meal multiplier, estimated calories and macros, rough ingredient cost, and target differences. When the catalog cannot closely fit the remaining calories, the result says it is limited instead of presenting a false close match. Suggestions are not recorded as food consumed.

The bundled values are rounded editorial estimates informed by generic USDA FoodData Central data, not live product measurements. Costs are rough US-dollar estimates rather than store quotes. The interface warns members to verify current ingredient labels and professional guidance for allergy or medical needs.

The public Strata+ offer remains $2.99 USD per month. Checkout, the seven-day no-card trial, grandfathered recurring access, and prior lifetime access are unchanged.

## Deployment requirements

Deploy the Node server and matching versioned public assets together so the HTML, browser modules, food catalog, coaching generator fingerprint, and service-worker cache advance as one unit. Private pages and account APIs remain network-only. Build 7.9 requires no database migration, Paddle change, Resend change, FoodData Central credential, or grocery-price provider.

After deployment, use an isolated active Strata+ account to load an existing version-1 coaching profile, save reviewed food preferences, reload the resulting version-2 profile, log intake, and verify the refreshed current-day options. Confirm an allergy exclusion and the other-or-uncertain fail-closed path before normal traffic is routed.

## Rollback

Stored version-1 profiles remain readable, but saving the new preferences writes profile version 2. Build 7.8.8 does not understand that shape. After any version-2 profile has been saved, prefer a compatibility rollback that keeps the 7.9 profile parser and private-data handling while disabling food-option presentation. Do not overwrite or silently strip dietary and allergy data. No database schema rollback is required.

See the [7.9.0 release guide](release-7.9.0.md), [coaching methodology](coaching-methodology.md), [module architecture](module-architecture.md), and [test architecture](testing.md).
