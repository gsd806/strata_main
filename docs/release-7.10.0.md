# STRATA 7.10.0 — Trend-informed energy planning

Build 7.10.0 adds an explicitly versioned calorie model to Personal training and calorie counting: newly created or deliberately reviewed-and-saved profiles use a stronger starting equation, explicit uncertainty, and conservative feedback from the member's own complete intake and morning-weight history. Existing profiles keep their previous calculation until that deliberate review. STRATA does not diagnose metabolism, prescribe medical nutrition therapy, or claim that a calculated target is exact.

## What changed

- Add coaching profile schema version 3, which uses the sex-specific 2023 adult Dietary Reference Intake Estimated Energy Requirement equations. Mifflin–St Jeor and the optional Cunningham lean-mass value remain visible cross-checks rather than competing target engines.
- Keep stored schema-version-1 and version-2 profiles on the exact prior resting-energy × legacy activity-factor path until the member explicitly reviews and saves the profile. They are labeled Legacy profile, and calibration evidence cannot adjust their target, preventing a deployment from silently changing an existing target.
- Rewrite version-3 activity choices around the published whole-day PAL categories so work, walking, transport, chores, and training are considered once. New profiles default to inactive, and generated workout calories are not added again. Stored version-1/version-2 activity answers retain their original factor semantics instead of being reinterpreted as PAL categories.
- Add an optional morning weight and an explicit complete-day control to both intake-log surfaces. Incomplete diary entries remain useful to the member but cannot influence calibration.
- Add Legacy profile, Starting estimate, Calibrating, and Trend-informed states with the model identity, exact evidence counts, cutoff, adjustment, explanation, and limitations behind the current week.
- For version 3, require 18 complete intake days, 12 morning-weight observations, and at least 14 calendar days between the first and last usable weight inside the 21-day lookback before the week. Use a robust trend over the qualifying observations, heavy shrinkage toward the published EER baseline, 25-kcal rounding, and a maximum 150-kcal correction.
- Reject implausible or contradictory evidence instead of forcing a correction. Diary edits do not move the persisted current-week target; new eligible evidence is considered for the next generated week. A deliberate profile edit is the exception: it regenerates the current week immediately.
- Restore a real optional macro preference choice so balanced and higher-protein selections round-trip rather than collapsing to one mode.
- Keep all existing version-1/version-2 profiles—including age-18 or coefficient-free records—readable and regenerable through the unchanged legacy calculation. Explicit review/save requires the version-3 age and coefficient boundary before changing model semantics.
- Persist nullable morning-weight and intake-completeness evidence identically in SQLite and Turso, include it in private account export, and remove it through the existing account-deletion boundary.
- Identify the implementation as `energy-planning-v2` independently of profile schema version 3. The model identifier invalidates incompatible generated snapshots; it never opts a legacy profile into new activity semantics.

## Accuracy boundaries

The version-3 baseline follows the [2023 adult EER equations](https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/dietary-reference-intakes/tables/equations-estimate-energy-requirement.html), which estimate total expenditure from population data. The planning range is a conservative STRATA warning band, not a confidence interval. A member's activity answer can still be wrong, wearable calorie numbers are not imported, and optional body-fat readings can carry substantial measurement error.

Profile version is a calculation boundary, not display metadata. Version 1 and version 2 retain the Build 7.9 calculation: the stored resting-energy method is multiplied by the exact legacy activity factor, and no trend correction is applied. Reading, week rollover, or deployment does not upgrade them. Only an explicit member profile save writes version 3 and opts into the new EER/whole-day-activity meaning; that save deliberately regenerates the current week and shows the new model's result.

The feedback signal combines a robust trend over qualifying weight observations spanning at least 14 days inside a 21-day lookback with explicitly complete self-reported intake. It is deliberately shrunk and bounded because food logs can under-report intake and scale weight is noisy. The lookback, observation counts, minimum span, trend and outlier handling, `7,700 kcal/kg` conversion, shrinkage, rounding, correction cap, and every rejection threshold are unvalidated STRATA product heuristics; the cited repeated-weight research does not validate this implementation. “Trend-informed” means the estimate passed those product rules, not that it was measured, clinically validated, or guaranteed. See the full [coaching methodology](coaching-methodology.md).

## Storage and privacy

Migration `005-coaching-calibration` adds nullable `morning_weight_kg` and `intake_complete` fields to the existing private daily-log table. A legacy row therefore remains distinguishable from a day the member explicitly marked incomplete. The existing `(user_id, log_date)` primary key already supports the bounded date-range lookup, so this release adds no speculative index.

Only authenticated members with current Strata+ access can read or write this evidence. Browser-entered profile answers influence the estimate, but the browser cannot directly submit or override the computed baseline or adjustment, evidence owner, calibration window, or current-week dates. Private API responses remain `no-store`; the service worker does not cache coaching data. Account export includes the new fields, and account deletion removes them with the rest of the coaching rows.

## Deployment

Deploy the server, migration, and versioned public assets from the same commit. Startup applies migration `005` idempotently in local SQLite or Turso before the application accepts requests. No Paddle, Resend, FoodData Central, or new secret configuration is required.

After deployment, verify an existing version-1/version-2 coaching profile remains readable and reproduces its pre-deployment calorie calculation without using saved calibration evidence. Then explicitly review and save it, confirm it becomes version 3, and confirm the regenerated week identifies the EER path. Save one incomplete and one complete diary day with a morning weight, reload both intake surfaces, and confirm later diary edits do not move the persisted current-week target. A full Trend-informed state requires historical qualifying evidence and should be tested with an isolated non-production account rather than fabricated data in a real member account.

## Rollback

The migration is additive and nullable. Older code ignores the two columns, but it cannot preserve their values when updating a log because its upsert does not know them. A saved version-3 profile is also a semantic compatibility boundary: do not deploy a rollback that rejects or silently interprets it as version 1 or 2. Prefer a compatibility rollback that retains the Build 7.10 profile-version dispatcher, daily-log schema, and field mapping while disabling the new presentation. Do not drop calibration columns, downgrade profile versions, or rewrite a member's private evidence.

Release-gate results are recorded in [release readiness](release-readiness.md).
