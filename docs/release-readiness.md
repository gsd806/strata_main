# STRATA 7.4.0 readiness

Status: reviewable source candidate; not deployed.

Build 7.4.0 turns Strata+ into a connected, review-first training loop around Today, Plan, Progress, and Explore. It adds guided setup, catalog-backed exercise help, optional check-ins, deterministic progression, and approval-only Plan adaptations without changing production credentials, provider configuration, payment pricing, account authorization, the editorial FitScore catalog, or existing workout records. See the [release guide](release-7.4.0.md) and [changelog](../CHANGELOG.md).

| Check | Verified result |
| --- | --- |
| Complete release gate | `npm run check` passed locally |
| Node regression tests | 471 passed, zero failed |
| Coverage | 93.13% lines; 81.06% branches; 89.26% functions; enforced 90% / 78% / 85% floors passed |
| Release, architecture, type, and lint checks | Passed; 21 server modules, zero dependency cycles, zero policy violations |
| Runtime QA | Account, Strata+, planner, and PWA runtime checks passed as part of the release gate |
| Endpoint and storage performance | Passed 40 measured samples after 8 warmups per operation |
| Automated Chromium E2E | 17 passed, zero failed, including security-sensitive and training journeys |
| Authenticated visual matrix | `npm run qa:ui` passed at 1440, 700, 390, and 320 px, including all 15 routes in the 320 px sweep; zero unexpected first-party browser errors, horizontal overflow, or fixed-navigation focus overlap |
| 100-user load profiles | Not executable on this Darwin host because the harness deliberately requires Linux loopback and `/proc`; both profiles remain required in Linux CI |

The complete local gate ran under Node 25.8.2. STRATA's supported runtime and CI target remain Node 24, so the local result does not replace a green Node 24 CI run. E2E and visual checks used isolated local accounts, provider fakes, and a temporary SQLite database; they did not contact production services or modify production data.

## Product and privacy evidence

Strata+ now opens on one clear Start or Resume action. The Today brief distinguishes estimated planned time from elapsed active-workout time, summarizes all relevant equipment without silently dropping additional types, and limits comparable-performance claims to the loaded 100-session window. Progress keeps completed sessions, external-load volume, kilograms and pounds, bodyweight, assistance, timed work, improvements, and performance highs in their correct comparison groups. When older history exists, labels explicitly say that the summary is partial.

Fresh accounts can preview a deterministic balanced Monday/Wednesday/Friday week after choosing bodyweight, dumbbells plus bodyweight, or full-gym access. The preview remains unsaved until confirmation; setup choices can be changed before saving and individual movements can be edited in Plan afterward. Catalog-backed guidance exposes one setup cue, two additional technique cues, a caution or common mistake, purpose, working range, and same-target alternatives. Dialog focus returns to the exact trigger and the changed controls retain keyboard, touch-target, contrast, and reduced-motion coverage.

Optional 1–5 difficulty, energy, comfort, and enjoyment check-ins are user-entered training notes, not recovery, readiness, pain, technique, or injury measurements. Progression is deterministic and like-for-like: a first result stays a baseline, and missing or difficult feedback holds the target. A difficult check-in may create one narrow set-reduction proposal. It stores no weekly-Plan snapshot and cannot change Plan until the member separately approves it. Approval reconstructs only the disclosed edit and atomically verifies the Plan revision, pending proposal, owned completed source workout, and exact current check-in. Replays, stale check-ins, deleted workouts, cross-account requests, inconsistent edits, and absent or foreign origins fail closed.

The additive `workout_check_ins`, `training_blocks`, and `training_adaptations` schema is shared by SQLite and the Turso adapter contract. Workout and account deletion explicitly clear the new rows even when foreign-key enforcement is unavailable. Existing pre-release proposal snapshots are stripped during migration. The PWA continues to bypass all `/api` traffic and keeps private pages and account data out of public caches. Public Terms, Privacy, Policies, architecture, testing, deployment, and rollback guidance describe the new state and its limits.

## Performance evidence

Local SQLite regression p95 latency was 0.562 ms for health, 0.971 ms for status, 0.443 ms for authenticated Plan reads, and 0.641 ms for authenticated Plan saves. Storage p95 latency was 0.011 ms for session lookup, 0.006 ms for Plan lookup, and 0.053 ms for Plan compare-and-swap. These measurements passed the checked-in budgets, but they are local regression evidence rather than production service-level objectives or hosted Turso latency claims.

## Promotion limits

Hosted Turso behavior and capacity, real Resend delivery, real Paddle sandbox or live transactions, production deployment, production data migration, third-party font/image availability, and physical-device PWA behavior were not exercised by this local gate. Before promotion, require the complete gate and both 100-user load profiles on Node 24 Linux CI, plus authorized deployment, hosted-provider, migration, and post-deploy smoke checks.

Do not deploy the pristine v7.3.0 binary after 7.4.0 has initialized training-loop tables. Use a designated v7.4-compatible rollback build retaining the additive schema and explicit deletion cleanup, or take writes offline and restore the verified pre-7.4 backup with reconciliation of later accepted writes. No GitHub release, tag, provider setting, production account, or deployment is created by this source-readiness result.
