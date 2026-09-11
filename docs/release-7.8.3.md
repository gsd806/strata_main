# STRATA 7.8.3 — Restored identity and clearer Strata+ states

Build 7.8.3 repairs the presentation regression from the removed candidate while keeping the working 7.8.2 product underneath it. Build 7.8.1 is the visual and information-architecture reference: its homepage, photography, global `Rankings · Strata+ · Plan · Train` navigation, four-tab Strata+ workspace, and established Plan, Train, Account, and Pricing presentation remain recognizable.

## What changed

- **Plan has one clear center.** The saved weekly plan is the primary surface. Workout Builder, Plan Ahead, and Reuse a Week remain available through compact disclosures that explain their purpose before opening their controls.
- **Today tells the truth.** A member without a weekly plan is sent to build one. When a plan exists, Today selects the next scheduled workout and offers Start. An active workout offers Resume without a competing Start action.
- **Train handles the selected day explicitly.** No-plan, empty-selected-day, scheduled, and active-session states have distinct copy and actions. History must be verified before an account workout action is enabled.
- **Progress does not fake certainty.** Loading, failure with Retry, no completed history, and populated metrics are separate states. Blank statistics are never rendered as results.
- **Scores have one explanation.** One expandable guide defines FitScore as the exercise-quality score, Match as personalization for the current member, and Community as member ratings.
- **The interface remains resilient.** The repaired states preserve keyboard focus, visible focus styles, reduced-motion behavior, narrow-screen layout, and the 31-day monthly flow.

The 7.8.2 per-set progression model remains intact, including evidence-based targets and explicit Apply behavior. Authentication, account lifecycle, billing, Paddle validation, storage, database schema, API contracts, trial rules, and provider configuration are unchanged.

## Architecture

The product change touches 11 source files across Strata+ and Train. Train adds one focused `workout-context.js` rendering leaf so the coordinator stays below its enforced budget. The checked dependency graph contains 40 server modules and 67 unique browser modules with no cycles or policy violations.

## Verification

The complete local release gate passed on the release tree:

- 732 Node unit, integration, contract, security, and rendering tests passed with no failures, skips, or cancellations.
- Enforced coverage passed at 94.54% lines, 80.74% branches, and 90.06% functions.
- 49 isolated browser journeys passed, including login and recovery, Plan conflict resolution, payment entitlement, account deletion, workout continuity, the repaired Strata+ state matrix, responsive layouts, and accessibility behavior.
- Focused accessibility, keyboard, and 200% text checks passed in Chromium and WebKit.
- The full UI audit passed across 18 routes at widths from 320 through 768 pixels with zero horizontal overflow or text-layout findings.
- Runtime smoke, PWA checks, boundary type checking, correctness-focused lint, and all seven performance budgets passed.
- Managed public version references are aligned at 7.8.3 across the 32-file release manifest.

## Deployment and rollback

Deploy the server and public assets from the same commit so the service worker and HTML use the matching cache version. No migration, secret, or provider change is required. After deployment, verify the public build/status endpoint and run the required deployment smoke check.

Rollback is a redeploy of the 7.8.2 application and its matching assets. Workouts and plans remain compatible because this release does not change their stored format.
