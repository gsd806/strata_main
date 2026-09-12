# Build 8.0.1 — Individualized activity and deficit model

Build 8.0.1 changes only Strata+ Personal training and calorie counting. It replaces one broad activity assumption with a component calculation that can explain how each relevant answer affects the result. The output remains a starting estimate—not measured metabolism, a medical prescription, or a guarantee of weight change.

## Changes

- New profile version 4 asks for ordinary daily movement outside workouts, then separately asks for optional weekly minutes and intensity from cardio, sport, active travel, or other activity outside the generated STRATA plan.
- Maintenance starts with Mifflin–St Jeor resting energy. It adds a conservative non-workout movement allowance, net energy from each usable generated session's actual planned duration, and separately entered activity. An unavailable session adds zero; a partial session contributes only its generated minutes.
- Workout frequency, selected days, duration, experience, equipment, movement limitations, training goal, and known exercise context now affect the feasible training week before its exercise contribution is calculated. Entered load is not treated as a calorie meter or a verified one-repetition maximum.
- Gentle and moderate fat-loss options request 0.25% and 0.50% of planning weight per week. The calorie equivalent is rounded down to the next 25 kcal and is additionally capped at 20% of maintenance and 500 kcal/day, so rounding cannot make the deficit more aggressive than a declared cap.
- Optional body-fat input remains a noisy Cunningham resting-energy cross-check. It can restrict or block a deficit through a labeled fat-free-mass energy-availability screen; when that cross-check materially disagrees with Mifflin, it also widens the visible planning range used by the lower-scenario guard. It never raises maintenance or permits a larger deficit. Ordinary recent-weight drift within 2% retains those guards, while a larger mismatch requires profile review instead of silently removing them.
- The dashboard now shows ordinary-movement calories, generated session count and minutes, generated-session calories, other-activity calories, requested pace, actual deficit and implied pace, the optional composition floor and cross-check difference, and whether the lower sensitivity scenario requires review.
- Training-day calorie variation follows the generated energy contribution on each usable session day while preserving the exact seven-day calorie budget.

## Compatibility and privacy

Stored profile versions 1–2 retain their original resting-energy × activity-multiplier behavior. Version 3 retains its whole-day 2023 DRI EER behavior and does not add workout calories again. A compatible version-3 calibration is also carried through the model-label transition so a Monday rollover cannot bypass the existing 150-kcal weekly change limit. STRATA does not guess how an old whole-day answer maps to the new non-workout question: an existing member can still view the saved dashboard, but must explicitly review and save the new fields before creating profile version 4.

Profiles are versioned JSON, so no database migration is required. Existing saved weeks and historical daily targets are not rewritten. A deliberate profile save creates a new revision and regenerates the current week; raw eligible intake and morning-weight observations can still inform the bounded calibration, but an older energy-model snapshot cannot masquerade as a version-4 prior.

The new movement and activity answers stay within the existing private coaching profile and snapshot boundaries. Authentication, active Strata+ entitlement, trusted origin, CSRF, account identity, optimistic revision, account export/deletion, SQLite/Turso parity, and no-store/service-worker exclusions are unchanged.

## Evidence and limits

Mifflin–St Jeor supplies the resting estimate. Activity energy uses published Adult and Older Adult Compendium reference conventions, with transparent STRATA movement anchors informed by the 2023 Dietary Reference Intake activity descriptions. The official adult EER remains visible as a population cross-check with its published reference error rather than overriding the component estimate.

There is no reliable questionnaire that measures one person's true total daily expenditure exactly. Self-reported movement, exercise duration, intake, body fat, and body weight can all be wrong or incomplete. STRATA therefore keeps a visible planning band, conservative deficit limits, dynamic sensitivity scenarios, and bounded calibration from sufficiently complete intake and morning-weight history. The body-weight calorie conversion, movement anchors, composition screen, and update thresholds are disclosed engineering rules rather than clinically validated individual prescriptions.

Exact formulas, sources, fallback behavior, and limits are in the [coaching methodology](coaching-methodology.md). Release-gate results are recorded in [release readiness](release-readiness.md).
