# STRATA 7.8.2 — Weight progression in Train

Train turns completed performance into a specific target for the next comparable exercise. Guidance appears immediately after finishing a session, even without a check-in, and appears beside the logging controls the next time that exercise is trained. Members explicitly apply it; recorded results and weekly plans are never changed by a recommendation.

## Progression behavior

- **Build reps, then load.** Compare every working set with the latest earlier session using the same exercise, measurement, load type, unit, prescription, set count, and load. Both sessions must be complete. Before the top of the prescribed range, add one rep to the weakest set while keeping the remaining sets unchanged.
- **Increase when ready.** Two complete comparable sessions at the top of the range can suggest +2.5 kg or +5 lb, only when the step is at most 10% of the recorded load. Return to the bottom of the rep range after increasing. For example, two sessions of 3 × 12 at 40 kg for an 8–12 plan produce a suggested 3 × 8 at 42.5 kg. A smaller available increment is needed when the default step is too large; the app does not invent equipment sizes.
- **Hold when evidence warrants it.** Missing or incomplete history, unchecked sets, mixed loads, changed prescriptions, worsening set performance, high recorded effort (RPE above 8 or RIR below 2), adverse check-in feedback, or a selected lighter week prevent an increase. Unchecked draft values are never used as completed performance.
- **Allow recovery and returning sessions.** Targets apply the next time the exercise is trained, without imposing a weekly deadline. A gap exceeding 28 calendar days establishes a fresh baseline. This cutoff is a conservative app rule, not a physiological threshold.
- **Respect other formats.** Assistance decreases only with sufficient evidence; bodyweight exercises receive rep guidance without fabricated weights. Timed targets increase the weakest hold by up to five seconds within a recognized prescribed range. Active block rules can restrict progression to reps or time.
- **Keep member control.** Optional check-ins can revise the guidance. Missing effort is not treated as known low effort: increase explanations ask whether the reps felt controlled. Apply fills an untouched active exercise without marking sets complete, then uses the existing revision-checked workout save. Changed formats or prescriptions require fresh review.

## Evidence and limits

The implementation is a transparent training heuristic rather than a prediction of strength or readiness. The [2026 ACSM position stand](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/) supports individualized progressive overload through load, repetitions, or volume. The [2009 ACSM progression guidance](https://pubmed.ncbi.nlm.nih.gov/19204579/) described 2–10% load increases after exceeding the target, and the [2023 AHA scientific statement](https://pmc.ncbi.nlm.nih.gov/articles/PMC11209834/) describes repeated successful sessions as a progression signal. STRATA's two complete top-of-range sessions, fixed default increments, effort thresholds, and 28-day baseline reset are explicit product choices, not a verbatim clinical protocol.

Equipment step sizes are not stored, so members must review whether the suggested weight is available. History can establish what was logged; it cannot verify technique, discomfort, or recovery that the member has not reported.

## Data and architecture

`src/progression.js` owns pure per-set progression. The training service retrieves full prior workouts through the existing account-scoped store, paging beyond the first 100 summaries up to a disclosed 5,000-session limit. It uses the newest relevant exposure and does not skip an incompatible intervening session to find an older success.

`workout-progression.js` coalesces reads from existing progression endpoints and checks source identity, chronology, exercise format, prescription, set count, and target bounds before showing an Apply action. Selection changes, account guards, and history refresh invalidate the relevant state. Private pages and account APIs retain their existing network-only behavior.

No database migration, new API endpoint, secret, provider configuration, or payment catalog change is required. Deploy the Node server and matching public assets together; managed versions and the service-worker cache advance to 7.8.2. Rollback redeploys 7.8.1 with its matching assets. Saved workouts retain the existing format.

## Validation

Checks on Darwin arm64 with Node.js 24.20.0 on 2026-09-10:

- 728 Node tests passed with zero failures, skips, or cancellations.
- Coverage: 94.54% lines, 80.72% branches, and 90.06% functions; all enforced floors passed.
- Managed versions, architecture, boundary types, lint, all five runtime smoke checks, and all seven performance budgets passed.
- Seven new progression browser checks passed, including exact 42.5 kg targets beyond 100 unrelated histories, explicit application and revision-checked persistence, unchanged prior workouts/plans, immediate post-completion guidance, adverse feedback, incomplete/changed prescriptions, preservation of focused input during delayed responses, and exclusion of unchecked extreme draft values.
- Layout was visually inspected at 320, 390, and 1440 pixels; no horizontal overflow and at least 44-pixel action targets.

The complete `npm run check` passed, including all 46 browser tests with zero failures, skips, or cancellations. The release commit must pass the required Node 24 Linux GitHub Actions check, including browser compatibility and both 100-account load scenarios, before it is tagged. See [release readiness](release-readiness.md) for the compact verification record.
