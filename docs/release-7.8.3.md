# STRATA 7.8.3 — One application, one weekly Plan

STRATA now follows one workflow: choose exercises, build a weekly plan, train, and review completed logs. Optional tools stay available within that workflow. This release builds on 7.8.2 and retains weight progression.

## Information architecture

| Before | After |
| --- | --- |
| Rankings; Strata+ with Today, Plan, Progress, Explore; separate global Plan and Train | Exercises, Plan, Train, Progress, Account |
| Weekly planner plus a second Plan overview in Strata+ | One weekly Plan hub at `/planner.html` |
| Session builder, 4–8 week block, 31-day block and community discovery scattered across workspaces | Optional Planning tools: Workout builder, Generate a week, Training block, Monthly schedule, Templates, Import/export, Shared plans |
| Today and Train both described the next workout | Train owns today's workout, empty days, active workouts and history |
| Recommendations and library hidden behind Explore | Exercise tools directly connect rankings, recommendations, library, comparison, preferences and saved exercises |

The existing controllers remain separate subordinate pages beneath Plan. Loading two plan coordinators together would duplicate ownership and threaten revision-safe saves. The hub instead links to each tool, whose breadcrumb and active global navigation identify Plan as its parent.

## Product and copy decisions

- The exercise library opens first. The working starter-week preview remains keyboard-accessible in an optional disclosure.
- Plan puts the week before its library on mobile. One main action says Build your first week or Edit week. Planning tools start collapsed, and the optional adjustment link appears only when a proposal exists.
- Train distinguishes no weekly plan, no workout on the selected day, a scheduled workout and an active workout. It shows exercise/set counts, estimated duration, equipment and previous results. Alternate creation appears only when there is something to replace. History load failure exposes Retry instead of pretending history is empty.
- Progress separately handles loading, failed, empty and populated history. Empty states point to building a week, starting a workout or resuming an existing workout as appropriate. Recorded highs are labelled New logged highs and Best logged values: different rep counts do not establish a strength improvement.
- A Training block repeats and reviews a weekly plan over four to eight weeks. A Monthly schedule places workouts on 31 actual dates. Neither is another weekly-plan editor.
- FitScore is fixed and editorial. Match for you ranks according to goals and preferences while equipment/limitations control eligibility. Community rating is the average overall member rating out of five, matching the rating form. Alternative exercise percentages are explicitly Similarity. Metric definitions and practicality weights appear at the point of use.
- FitScore numbers, factor weights and selection rules are unchanged. Both exercise detail views display the rounded weighted baseline and the difference to the published score. This resolves an inconsistent display convention without changing ranking calculations.
- Access and billing stay in Account. Existing initial server paywalls remain; revoked access during use clears private views and offers Account access management. Dashboard reads revalidate identity and entitlement before rendering results.
- Replacement and adjustment confirmations keep their existing revision checks. Copy states the persistent effect on the saved weekly plan.

## Route compatibility

| URL or hash | Behavior |
| --- | --- |
| `/`, `/#rankings`, `/#preview`, `/#method`, `/#sources` | Preserved; preview is now optional |
| `/planner.html`, `?add=exerciseId`, existing planner control anchors | Same weekly plan and save contract |
| `/workout.html?day=Monday`, `#resume=workoutId`, `#historySection` | Preserved with focus and recovery handling |
| `/discover.html#today`, `#todayWorkspace` | Redirect to Train |
| `/discover.html#plan`, `#planWorkspace` | Redirect to the weekly Plan hub |
| `/discover.html#explore`, `#exploreWorkspace` | Open the exercise library |
| `#recommendations`, `#exerciseExplorer`, `#battle`, `#profile` | Preserved exercise tools |
| `#sessionBuilder`, `#monthlyPlan`, `#communityPlans` | Preserved, presented beneath Plan |
| `#trainingBlockWorkspace`, `#savedExercises` | New explicit child destinations |
| `#progressWorkspace` | Existing Progress route, now in global navigation |

Recognized tool destinations survive sign-in, verification and account recovery. Unknown destinations remain rejected by the safe return-path allowlist.

## Technical scope

Two small leaves, `app-navigation.js` and `workout-context.js`, own route context and Train summary rendering. Existing module size budgets are unchanged. Static asset allowlists, script order and PWA precache include the new leaves. Private HTML and API responses remain network-only. No framework, database migration, new endpoint, provider setting, payment catalog change, or saved-data format change is required.

Deploy server and matching 7.8.3 assets together. Rollback redeploys 7.8.2 and its matching assets; existing plans and logs remain compatible.

## Validation

Final release verification is recorded in [release readiness](release-readiness.md). Browser checks cover new and populated weeks, empty days, active and completed workouts, history loading/errors/retry, blocks, monthly schedules, shared-plan confirmation, free/active/revoked access, keyboard navigation, reduced motion, 200% text, narrow screens, and account/concurrency/offline boundaries.

Screenshots and visual inspection cover 320, 390 and 1440 pixels. Automated child-tool accessibility checks cover all ten views at 390 and 1440 pixels. Initial real-provider billing/email behavior remains governed by existing server tests and deployment smoke; this UX release does not claim a new live payment transaction or email-provider test.

## Intentionally retained limits

- Planning tools retain their existing URLs and controllers rather than introducing a new router or migration.
- The monthly schedule remains exactly 31 dated days; it is not necessarily a calendar month.
- Saved exercise comparisons remain account-keyed on the current device and limited to four.
- Progress summaries use the 100 most recent loaded workouts and disclose that window when truncated. Full history remains available in Train.
- Existing editorial scores and default workout-generation rules retain their original limitations; clearer labels do not make them measured physiological outcomes.

## Changed files

This inventory includes functional changes, focused regression tests, and the managed version/cache updates.

- `CHANGELOG.md`
- `README.md`
- `docs/module-architecture.md`
- `docs/release-7.8.3.md`
- `docs/release-readiness.md`
- `frontend-architecture-policy.json`
- `package-lock.json`
- `package.json`
- `public/pages/account.html`
- `public/pages/admin.html`
- `public/pages/contact.html`
- `public/pages/delete-account.html`
- `public/pages/discover.html`
- `public/pages/forgot-password.html`
- `public/pages/index.html`
- `public/pages/install.html`
- `public/pages/offline.html`
- `public/pages/onboarding.html`
- `public/pages/planner.html`
- `public/pages/policies.html`
- `public/pages/pricing.html`
- `public/pages/privacy.html`
- `public/pages/refunds.html`
- `public/pages/reset-password.html`
- `public/pages/terms.html`
- `public/pages/verify-email.html`
- `public/pages/workout-offline.html`
- `public/pages/workout.html`
- `public/scripts/account-logic.js`
- `public/scripts/account-render.js`
- `public/scripts/account.js`
- `public/scripts/activation-home.js`
- `public/scripts/app-navigation.js`
- `public/scripts/app.js`
- `public/scripts/discover-api.js`
- `public/scripts/discover-catalog.js`
- `public/scripts/discover-detail.js`
- `public/scripts/discover-events.js`
- `public/scripts/discover-navigation.js`
- `public/scripts/discover-progress.js`
- `public/scripts/discover-render.js`
- `public/scripts/discover-session.js`
- `public/scripts/discover-sharing.js`
- `public/scripts/discover-state.js`
- `public/scripts/discover.js`
- `public/scripts/discovery-core.js`
- `public/scripts/home-logic.js`
- `public/scripts/home-render.js`
- `public/scripts/monthly-plan-core.js`
- `public/scripts/onboarding-core.js`
- `public/scripts/onboarding.js`
- `public/scripts/plan-insights-core.js`
- `public/scripts/planner-activation.js`
- `public/scripts/planner-conflicts.js`
- `public/scripts/planner-events.js`
- `public/scripts/planner-logic.js`
- `public/scripts/planner-render.js`
- `public/scripts/planner-sharing.js`
- `public/scripts/planner.js`
- `public/scripts/session-selection-core.js`
- `public/scripts/verify-email.js`
- `public/scripts/workout-calendar.js`
- `public/scripts/workout-context.js`
- `public/scripts/workout-events.js`
- `public/scripts/workout-guidance.js`
- `public/scripts/workout-history.js`
- `public/scripts/workout-offline.js`
- `public/scripts/workout-progression.js`
- `public/scripts/workout-render.js`
- `public/scripts/workout-state.js`
- `public/scripts/workout.js`
- `public/service-worker.js`
- `public/styles/account.css`
- `public/styles/discover.css`
- `public/styles/experience.css`
- `public/styles/install.css`
- `public/styles/onboarding.css`
- `public/styles/planner.css`
- `public/styles/product-nav.css`
- `public/styles/site-info.css`
- `public/styles/workout-offline.css`
- `public/styles/workout.css`
- `qa/discover-runtime-smoke.js`
- `qa/e2e/accessibility-matrix.js`
- `qa/e2e/activation-continuity.js`
- `qa/e2e/high-risk-flows.js`
- `qa/e2e/navigation-layout.js`
- `qa/e2e/responsive-content.js`
- `qa/e2e/session-selection.js`
- `qa/e2e/training-block-review.js`
- `qa/e2e/training-flows.js`
- `qa/e2e/ux-app.js`
- `qa/e2e/ux-train.js`
- `qa/planner-runtime-smoke.js`
- `qa/pwa-runtime-smoke.js`
- `qa/ui-audit.js`
- `qa/workout-runtime-smoke.js`
- `src/auth.js`
- `src/progression.js`
- `src/server.js`
- `src/training.js`
- `test/account-client.test.js`
- `test/app-navigation.test.js`
- `test/discover-feature-navigation.test.js`
- `test/discover-modules.test.js`
- `test/discovery-core.test.js`
- `test/email-verification-client.test.js`
- `test/frontend-boundary-coverage.test.js`
- `test/homepage-client.test.js`
- `test/monthly-plan-core.test.js`
- `test/plan-insights-core.test.js`
- `test/planner-modules.test.js`
- `test/progression.test.js`
- `test/public-info.test.js`
- `test/pwa.test.js`
- `test/self-hosted-assets.test.js`
- `test/server-auth-destinations.test.js`
- `test/server.test.js`
- `test/session-selection.test.js`
- `test/static-accessibility-css.test.js`
- `test/training.test.js`
- `test/workout-modules.test.js`
- `test/workout-offline.test.js`
