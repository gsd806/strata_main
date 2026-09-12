# Build 8.0.0 — Personal training and calorie calculation refinement

Build 8.0.0 corrects calorie evidence alignment, makes training prescriptions depend on comparable recorded work, and makes food portions and nutrition gaps reviewable. The implementation improves specific calculations; it does not claim measured metabolism or clinical accuracy.

## Changes

- Calibrate version-3 energy estimates from complete morning-to-morning intake intervals within 42 prior days. Variable intake is accumulated over the same interval as weight, missing days break intervals, and inconsistent scale evidence can withhold an update.
- Recompute each estimate from the equation and raw evidence. Weekly changes remain limited to 150 kcal/day while sustained evidence can move beyond the former permanent baseline cap. Saved targets retain provenance, stale evidence expires, and changing baseline bounds reconcile gradually instead of abruptly discarding a prior target.
- Use a documented recent-weight anchor when observations are sufficiently consistent; require review for substantial disagreement or credible low weight. Do not combine an old body-fat percentage with a changed weight.
- Preserve exact seven-day calorie totals and integer macro energy under the 4/4/9 convention. Replace version-3 weight bands with explicit maintenance, tissue-density, and expenditure-response sensitivity scenarios; check raw and displayed lower bounds before allowing a deficit.
- Preserve calorie and diary access for existing equipment-limited profiles; label incomplete training coverage as partial or unavailable without inventing compatible movements.
- Separate strength, hypertrophy, and balanced training goals from nutrition goals. Preserve compatible main exercises, fit sets/rests to the selected duration, show direct-muscle coverage, and use complete comparable workout history for optional per-set targets. Capability entries are references, not tested maximums.
- Scale actual listed recipe quantities with portions. Compare whole meal menus against remaining calories and all known macros; label partial fits and preserve allergy/diet filters. Recipe nutrition and USD costs remain approximate editorial estimates.
- Extend the actual-intake diary to today and the preceding 42 dates. Historical comparisons use the original saved target or show no target; future observation writes are rejected.

## Compatibility and deployment

A valid saved current week remains fixed through deployment, diary changes, and workout completion. New model identifiers apply on the next generated week or after explicit profile review/save. Profile versions 1–2 retain their original resting-energy/activity-factor calorie calculation and receive no trend adjustment. Version 3 retains whole-day EER semantics. The new optional training goal defaults to balanced; profile conversion is not required.

Deploy server and versioned public assets together. No database migration, new secret, or external food/pricing service is required; existing SQLite/Turso storage and privacy boundaries are reused. Do not rewrite stored snapshots, downgrade profile versions, or delete historical evidence during rollback. A compatibility rollback should preserve current-week snapshot continuity and the existing nullable diary fields. Verify an existing week, a new-week generation, explicit profile save, diary date boundaries, and limited food/training states after deployment.

## Evidence and limitations

The [methodology](coaching-methodology.md) records the published equations, primary research, exact implementation rules, and unvalidated heuristics. The [numerical benchmark](../qa/calibration-benchmark.js) compares against 7.10.0 with fixed synthetic data and reports raw estimates, planned targets, and rejected cases separately. It fixes the demonstrated intake-alignment error and allows gradual correction of sustained equation bias. Its generator often shares the engine's 7700 kcal/kg assumption; passing it does not validate human physiology.

Adverse cases remain explicit. Incomplete-data rejection can retain a larger equation error. A 400 kcal/day systematic food omission produces a sixth-week target error of −300 kcal with 8.0 versus −150 with 7.10; stronger adaptation can magnify biased logs. The same recorded data can come from an accurately logged person with lower expenditure, so hidden food is not identifiable from these inputs. Scenario ranges are assumption envelopes, not probabilities, and food quantities are not verified nutritional measurements.

Focused numerical tests and benchmark assertions cover alignment, missing dates, outliers, fluid changes, repeat-window stability, stale priors, changing-baseline continuity, legacy profiles, and input immutability. The complete release-gate results are recorded in [release readiness](release-readiness.md).
