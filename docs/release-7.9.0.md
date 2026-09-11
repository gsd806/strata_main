# STRATA 7.9.0 — Constraint-aware daily food options

Build 7.9.0 extends the existing Personal training and calorie counting workspace with remaining-day food options. A member can save dietary, allergy, meal-frequency, favorite-food, and budget preferences alongside the existing coaching profile, then ask the daily intake log for meal ideas shaped by what remains of that day's calorie and optional macro targets.

## Scope

- Add an explicit nested `mealPreferences` profile contract for allergy status, the supported allergen list, an other-or-uncertain-allergy note, dietary pattern, gluten-free or dairy-free requirements, favorite-food categories, 1–6 meals per day, and an optional whole-cent daily USD budget.
- Preserve readable version-1 coaching profiles. Saving the new fields creates a version-2 profile and a new current-week snapshot through the existing profile revision boundary.
- Add authenticated `GET /api/coaching/food-options/:date`, which derives options from the server-owned profile, current weekly target, and saved intake log. The browser does not author the target, owner, or meal catalog.
- Add a focused pure meal-planning module and separate browser normalization/request/rendering boundary instead of moving recipe and filtering policy into the coaching coordinator.
- Return up to three deterministic remaining-day menus with ingredients, portion count, calories, macros, rough USD ingredient cost, target differences, catalog provenance, and limitations.
- Keep the generated menu out of the food log: an option is an idea until the member separately records what they actually consumed.
- Keep storage additive without a database migration. Food preferences live in the existing private coaching-profile JSON and are repeated in the private weekly snapshot as generation evidence.

This release does not add barcode scanning, a live grocery-price feed, automatic food consumption, medical dietary advice, restaurant inventory, branded-product verification, or a guarantee that a meal will meet a target exactly.

## Constraint and safety behavior

Supported allergens, dietary pattern, and gluten-free or dairy-free requirements filter the bundled catalog before ranking. Favorite foods and the optional budget influence ordering only; neither can restore a filtered meal. If no catalog meal satisfies every hard rule, STRATA returns no compatible option. If the member selects another or uncertain allergy, automatic matching stops and the interface asks for manual review rather than interpreting free text.

Three alternatives are marked ready only when each falls within the greater of 100 kcal or 10% of the remaining calorie target. A wider gap stays visible and the response is labeled limited, so a high-calorie remainder cannot be presented as a close catalog match. If a calorie log omits the optional consumed macros, STRATA uses calorie-only matching for that request instead of treating unknown protein, carbohydrate, and fat as zero.

The allergen checklist follows the US Food and Drug Administration's nine major categories, but those categories are not an exhaustive list of possible allergies. A matching ingredient list cannot establish absence of cross-contact or account for a packaged product's current label and facility conditions. STRATA therefore describes suggestions as planning ideas, never “allergy safe,” and keeps the warning visible with the output. Primary guidance: [FDA food allergies](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies) and [FDA consumer label guidance](https://www.fda.gov/consumers/consumer-updates/have-food-allergies-read-label).

Recipe nutrition values are rounded STRATA editorial estimates informed by generic values in [USDA FoodData Central](https://fdc.nal.usda.gov/) and ship in the reviewed application catalog; the production request does not call a live nutrition API. Approximate household ingredient amounts define one base meal and the interface shows its multiplier, but the catalog does not provide an item-by-item FoodData Central audit trail, branded-product values, or verified measurements. Portion, preparation, substitution, and formulation differences can change calories and macros.

Costs are rough US-dollar ingredient estimates, not live store quotes or a budget guarantee. Location, store, brand, season, package size, tax, delivery, waste, and leftovers can materially change actual spending. Budget-aware ordering draws on general principles in the USDA MyPlate guidance for [eating healthy on a budget](https://www.myplate.gov/sites/default/files/2024-06/TipSheet-23-Eat-Healthy-On-A-Budget.pdf) and [planning budget-friendly weekly meals](https://www.myplate.gov/eathealthy/budget/budget-weekly-meals); it does not claim those sources endorse a specific STRATA recipe or price.

See [the coaching methodology](coaching-methodology.md) for the calculation order, limitations, and the boundary between general planning and medical nutrition therapy.

## Privacy and storage

The food preferences are private account data. They are saved once in the canonical coaching profile and repeated in the private current-week snapshot with the other generation inputs. Remaining-day options are derived on request and are not persisted as a separate meal plan or consumption record. Private coaching responses use `no-store`, and `/api/coaching/*` stays outside service-worker caching.

The existing account export includes both the profile and weekly snapshot, so it can contain two private copies of the saved food preferences. Account deletion removes the coaching profile, snapshots, and intake logs through the existing SQLite/Turso cleanup. Build 7.9 adds no new table, provider, cookie, or third-party analytics event.

## Verification record

| Evidence | Release result |
| --- | --- |
| Commit | The immutable commit targeted by annotated tag `v7.9.0` |
| `npm run check` | Passed locally on Node.js 25.8.2 |
| Node tests | 815 passed in 38.89 seconds; zero failures, skips, or cancellations |
| Enforced coverage | 94.93% lines; 81.22% branches; 90.79% functions; all floors passed |
| Architecture check | 47 server modules and 72 unique browser modules across seven page boundaries; zero cycles and zero policy violations |
| Browser E2E | 53 Chromium/WebKit-backed journeys passed in 107.12 seconds; zero failures, skips, or cancellations |
| SQLite/Turso contract | Coaching profiles, week snapshots, logs, revisions, export, and deletion produced matching observable results through SQLite and the Turso transport fixture |

The release gate must include direct evidence for contradictory allergy-state rejection, other-or-uncertain-allergy fail-closed behavior, hard-filter precedence, catalog metadata validation, deterministic replay, calorie-fit status, unknown consumed-macro handling, remaining-intake subtraction, scaled-cost budget ranking, authenticated/date-bounded endpoint behavior, private-state clearing, account export, and account deletion. Provider fakes and the Turso transport fixture are not evidence of live hosted-provider behavior.

## Deployment

1. Back up the production database and record the deploy commit.
2. Deploy the complete 7.9.0 application and versioned public assets together. No schema migration, FoodData Central credential, live grocery API, Paddle change, or Resend change is required.
3. Run the production configuration preflight and liveness/readiness checks before routing normal traffic.
4. With an isolated entitled test account, confirm an existing version-1 profile still loads, save reviewed food preferences, reload the version-2 profile, and request the current day's options.
5. Confirm a supported-allergen combination excludes tagged meals, another-or-uncertain allergy returns no automatic option, and an impossible hard-filter combination is not silently relaxed.
6. Save a daily intake entry and confirm the next request uses the new remaining calories and optional macros. Verify ingredients, provenance, rough-cost wording, target differences, keyboard access, 200% text reflow, and narrow-screen containment.
7. Confirm a guest, free account, expired entitlement, invalid date, and date outside the current coaching week cannot retrieve private options. Confirm logout or account change clears food preferences and rendered suggestions.
8. Verify a private account export contains the saved preferences in the coaching profile and snapshot, then use a disposable account to verify deletion removes both copies.

## Rollback

Build 7.9 adds no database schema to reverse, and existing version-1 profiles remain valid. However, once a member saves food preferences, the stored profile is version 2. Build 7.8.8 does not understand that profile shape and can report it as unreadable even though the JSON remains in storage.

For that reason, prefer a feature rollback that disables or hides food-option presentation while retaining the 7.9 profile parser and private-data behavior. A full binary rollback to 7.8.8 is safe only before version-2 profiles have been saved. After that point, use an audited, backed-up compatibility deployment; do not silently strip allergy or dietary data or overwrite a version-2 profile with defaults. If a fault concerns only the catalog, keep the endpoint fail closed while correcting the reviewed catalog and fingerprint.
