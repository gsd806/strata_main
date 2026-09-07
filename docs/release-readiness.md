# STRATA 7.4.1 readiness

Status: reviewable source candidate; not deployed.

Build 7.4.1 is a responsive-integrity patch for the connected Today, Plan, Progress, and Explore training loop. It fixes clipped, colliding, or hidden content across planner, Strata+, workout, setup, account, public, install, and admin surfaces without changing the database schema, HTTP APIs, production credentials, provider configuration, payment pricing, account authorization, exercise catalog, or saved workout records. See the [release guide](release-7.4.1.md) and [changelog](../CHANGELOG.md).

| Check | Verified result |
| --- | --- |
| Complete release gate | `npm run check` passed locally |
| Node regression tests | 475 passed, zero failed |
| Coverage | 93.13% lines; 81.06% branches; 89.26% functions; enforced 90% / 78% / 85% floors passed |
| Release, architecture, type, and lint checks | Passed; 21 server modules, zero dependency cycles, zero policy violations |
| Runtime QA | Account, Strata+, planner, and PWA runtime checks passed as part of the release gate |
| Endpoint and storage performance | Passed 40 measured samples after 8 warmups per operation |
| Automated Chromium E2E | 21 passed, zero failed, including security-sensitive, training, card-containment, and responsive-content journeys |
| Authenticated visual matrix | `npm run qa:ui` passed 18 routes at each of 320, 339, 360, 390, 430, 600, 700, and 768 px, plus planner checks through 1440 px; zero unexpected first-party browser errors, card-text escapes, horizontal overflow, or fixed-navigation focus overlap |
| 100-user load profiles | Not executable on this Darwin host because the harness deliberately requires Linux loopback and `/proc`; both profiles remain required in Linux CI |

The complete local gate ran under Node 25.8.2. STRATA's supported runtime and CI target remain Node 24, so the local result does not replace a green Node 24 CI run. E2E and visual checks used isolated local accounts, provider fakes, and a temporary SQLite database; they did not contact production services or modify production data.

## Product, responsive, and privacy evidence

Strata+ now opens on one clear Start or Resume action. The Today brief distinguishes estimated planned time from elapsed active-workout time, summarizes all relevant equipment without silently dropping additional types, and limits comparable-performance claims to the loaded 100-session window. Progress keeps completed sessions, external-load volume, kilograms and pounds, bodyweight, assistance, timed work, improvements, and performance highs in their correct comparison groups. When older history exists, labels explicitly say that the summary is partial.

Fresh accounts can preview a deterministic balanced Monday/Wednesday/Friday week after choosing bodyweight, dumbbells plus bodyweight, or full-gym access. The preview remains unsaved until confirmation; setup choices can be changed before saving and individual movements can be edited in Plan afterward. Catalog-backed guidance exposes one setup cue, two additional technique cues, a caution or common mistake, purpose, working range, and same-target alternatives. Dialog focus returns to the exact trigger and the changed controls retain keyboard, touch-target, contrast, and reduced-motion coverage.

Optional 1–5 difficulty, energy, comfort, and enjoyment check-ins are user-entered training notes, not recovery, readiness, pain, technique, or injury measurements. Progression is deterministic and like-for-like: a first result stays a baseline, and missing or difficult feedback holds the target. A difficult check-in may create one narrow set-reduction proposal. It stores no weekly-Plan snapshot and cannot change Plan until the member separately approves it. Approval reconstructs only the disclosed edit and atomically verifies the Plan revision, pending proposal, owned completed source workout, and exact current check-in. Replays, stale check-ins, deleted workouts, cross-account requests, inconsistent edits, and absent or foreign origins fail closed.

The additive `workout_check_ins`, `training_blocks`, and `training_adaptations` schema is shared by SQLite and the Turso adapter contract. Workout and account deletion explicitly clear the new rows even when foreign-key enforcement is unavailable. Existing pre-release proposal snapshots are stripped during migration. The PWA continues to bypass all `/api` traffic and keeps private pages and account data out of public caches. Public Terms, Privacy, Policies, architecture, testing, deployment, and rollback guidance describe the new state and its limits.

Planner result cards now grow with their names and metadata, place actions in a separate track where horizontal room is limited, and retain at least 44 px controls. Scheduled cards, day destinations, save failures, filters, Strata+ comparison and detail surfaces, workout logging controls, weekly-setup navigation, and dynamic public/account/admin copy have explicit shrink and wrapping behavior. Compact sticky headers are opaque where backdrop blur is disabled. The exact 339 px reproduction and every maintained compact breakpoint passed rendered text-containment checks rather than relying only on hidden document overflow.

## Performance evidence

Local SQLite regression p95 latency was 0.432 ms for health, 0.385 ms for status, 0.358 ms for authenticated Plan reads, and 0.841 ms for authenticated Plan saves. Storage p95 latency was 0.009 ms for session lookup, 0.006 ms for Plan lookup, and 0.052 ms for Plan compare-and-swap. These measurements passed the checked-in budgets, but they are local regression evidence rather than production service-level objectives or hosted Turso latency claims.

## Promotion limits

Hosted Turso behavior and capacity, real Resend delivery, real Paddle sandbox or live transactions, production deployment, production data migration, third-party font/image availability, and physical-device PWA behavior were not exercised by this local gate. Before promotion, require the complete gate and both 100-user load profiles on Node 24 Linux CI, plus authorized deployment, hosted-provider, migration, and post-deploy smoke checks.

Build 7.4.1 adds no schema or data migration, so the tagged v7.4.0 application is the direct schema-compatible rollback target for this presentation patch. Do not roll back farther to the pristine v7.3.0 binary after any v7.4 build has initialized training-loop tables. No GitHub release, tag, provider setting, production account, or deployment is created by this source-readiness result.
