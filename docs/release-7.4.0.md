# STRATA 7.4.0 — A calmer, guided training loop

This candidate updates the delivered 7.3.0 source. It has not been deployed and does not change production credentials, provider configuration, payment pricing, account authorization, existing workout records, or the editorial FitScore catalog.

## Today, Plan, Progress, and Explore

Strata+ now opens on **Today**, with one primary Start or Resume action, estimated duration or elapsed time, relevant equipment, and the latest comparable result in the loaded 100-session history window when one exists. **Plan** keeps the editable weekly plan and optional 4–8 week block together. **Progress** reports only completed, loaded workout data and separates adherence, consistency, external-load volume, like-for-like improvements, and personal bests. **Explore** contains the larger library, recommendation, comparison, session, community, and profile tools so they do not compete with the next workout.

The loaded-history window is stated wherever a total may be partial. Kilograms and pounds are not combined, bodyweight and assistance are not presented as external-load volume, and records compare the same exercise, measurement, load type, and unit. These summaries describe recorded work; they do not claim to measure recovery, readiness, pain, technique, injury risk, or future results.

## First session and exercise guidance

A fresh Strata+ account receives a deterministic beginner quick start: a balanced Monday/Wednesday/Friday profile, one explicit equipment choice, a generated-week preview, and a direct action to begin the first scheduled workout after saving. Members can adjust every setup choice before saving and edit individual movements in Plan immediately afterward.

Exercise guidance now uses the existing reviewed catalog across the homepage, weekly Plan, and workout room. A compact dialog shows a catalog-backed setup cue, two additional technique cues, a caution or common mistake, purpose, prescription, and a same-target alternative using different equipment when available. Keyboard focus returns to the exact trigger after the dialog closes, controls retain touch-sized targets, and reduced-motion behavior remains supported.

## Check-ins and conservative progression

After completing a workout, a member may submit four explicit 1–5 answers for difficulty, energy, comfort, and enjoyment. The first comparable result is a baseline. STRATA suggests an increase only when a later completed result matches or improves the prior comparable exercise/measurement/load/unit and the member supplied an acceptable check-in. A missing check-in, low comfort or energy, maximum difficulty, or under-target performance keeps the recommendation at repeat/hold.

Progression output is advice only and never changes a workout or Plan. A low-comfort, low-energy, or maximum-difficulty answer may create a single proposal to reduce one planned set. The member must separately approve that exact proposal. Acceptance atomically verifies both the check-in and Plan revisions before changing the Plan; dismissal leaves the Plan untouched. Stale, resolved, cross-account, or replayed proposals fail closed.

An optional training block records 4–8 weeks, the current week, goal, milestones, progression rule, status, and an optional lighter week. It organizes the member's intent and does not silently rewrite the weekly Plan.

## Storage compatibility

This release adds three user-owned tables: `workout_check_ins`, `training_blocks`, and `training_adaptations`. The schema is additive. SQLite and Turso use the same parameterized statements and observable contract for owner scoping, completed-workout checks, exact block revisions, pending-proposal lookup, atomic Plan/proposal acceptance, replay resistance, and account deletion.

Do not deploy the pristine v7.3.0 binary after v7.4.0 has initialized these tables. Turso foreign-key enforcement is connection-scoped, and v7.3.0 cannot guarantee removal of retained check-in, block, or proposal rows during account or workout deletion. Keep the additive tables, and prepare a designated v7.4-compatible rollback build that retains this schema and its explicit cleanup. Account deletion in 7.4.0 removes all three record types.

## Deployment

1. Use Node 24 and the existing Turso, Paddle, and Resend configuration.
2. Run `npm ci`, `npm run check`, and `npm run qa:ui` with the isolated test configuration documented in `qa/README.md`.
3. Back up the production database, then deploy the complete 7.4.0 server, HTML, styles, scripts, manifest, and service worker together so the additive schema and versioned public cache activate consistently.
4. Verify a fresh Strata+ quick start, guide-dialog keyboard behavior, Today Start/Resume, loaded-history Progress labels, block revisions, check-in save/update, conservative progression, proposal dismissal/approval, Plan conflict recovery, account deletion, reduced motion, offline public pages, and 320 px layouts.

## Rollback

If an application or browser regression requires rollback, use only a designated v7.4-compatible rollback build that retains the additive schema and explicit training-loop deletion cleanup. If no such artifact is available, take writes offline and restore the verified pre-v7.4 backup, reconciling any later accepted writes before reopening the service. Preserve the 7.4 tables unless restoring that complete backup, and verify that no training-loop row lacks its owning user or workout before writes resume. Do not treat the pristine v7.3.0 binary as a safe rollback target after 7.4 data exists.

## Validation limits

Local and CI checks do not prove hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, production deployment health, third-party font/image availability, exercise suitability for an individual, or every physical PWA device. Check-in values are member-entered and progression rules are deterministic guidance, not health measurements. No production account, provider setting, payment, email, GitHub release, tag, or deployment is changed by this source candidate.
