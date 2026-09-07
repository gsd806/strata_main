# STRATA test architecture

STRATA uses four test layers. Each layer owns a different kind of confidence; a browser test should not replace a focused unit test, and a mocked unit test should not be presented as proof that two storage adapters agree.

| Layer | Scope and boundary | Naming/location | Command |
| --- | --- | --- | --- |
| Unit | One module or browser script with controlled collaborators. No real HTTP server or persistent database. | `test/*.test.js`, excluding the integration/contract prefixes below | `npm run test:unit` |
| Integration | The composed Node application, real HTTP behavior, auth/session middleware, and provider orchestration. External providers stay local or fake. | `test/server*.test.js` | `npm run test:integration` |
| Contract | Observable storage behavior, migrations, indexes, concurrency, SQLite/Turso parity, and enforced module/deployment structure. | `test/database*.test.js`, `test/architecture-*.test.js`, and `test/project-structure.test.js` | `npm run test:contract` |
| E2E | Real browsers driving running-app journeys plus isolated navigation/layout fixtures for user-visible, high-risk behavior. Most focused journeys use Chromium; the compatibility matrix also uses Firefox and WebKit. | `qa/e2e/*.js` | `npm run test:e2e` |

`scripts/run-test-layer.js` enforces this mapping from filenames to test layers. New Node tests must use the `server` prefix when they cross the HTTP composition boundary, the `database` prefix when they define storage behavior, and the `architecture-` prefix when they enforce dependency contracts. The legacy `project-structure` suite is also an architectural contract. Everything else is a focused unit test. Browser journeys belong only in `qa/e2e/`.

## Normal verification

`npm test` remains the fast, complete Node test suite. `npm run check` is the release gate and runs release consistency, architecture constraints, static boundary typing, lint, the Node suite with coverage thresholds, runtime QA, performance checks, and the high-risk E2E suite. The layer commands are useful while developing or diagnosing a failure.

The E2E suite owns a deliberately small set of costly journeys. Its security-critical core covers login and recovery, plan conflict resolution, payment entitlement, and account deletion; focused browser journeys also cover activation continuity, account boundaries, training, setup, planner recovery, offline-workout continuation, weekly review, accessibility, and responsive navigation where browser behavior matters. It starts an isolated application plus local provider fakes, so it never contacts production services or modifies developer data.

## Coverage policy

`npm run coverage` fails below these application-code floors:

- lines: 90%
- branches: 78%
- functions: 85%

The integrated Build 7.5.0 local run measured 93.74% lines, 79.98% branches, and 89.46% functions across 553 passing Node tests. It ran under Node 25.8.2; the supported runtime and CI target remain Node 24, so promotion still requires a green Node 24 CI run. Coverage runs files sequentially to keep the denominator repeatable. The thresholds are rounded down to preserve a narrow refactoring buffer rather than claiming every line has equal risk. Raise a floor when sustained useful tests create room; lower one only with an explicit review that explains the lost behavior. Security and state-transition boundaries still need direct assertions even when aggregate coverage passes.

Coverage includes the process entry point, `src/**/*.js`, and the pure browser-domain modules `public/scripts/discovery-core.js`, `public/scripts/monthly-plan-core.js`, `public/scripts/workout-core.js`, `public/scripts/onboarding-core.js`, `public/scripts/preview-core.js`, `public/scripts/activation-core.js`, `public/scripts/plan-insights-core.js`, and `public/scripts/training-block-core.js`. DOM entry scripts are exercised by focused VM/runtime tests and the real-browser E2E journeys, but Node's built-in collector does not instrument those separate VM/browser realms, so they are explicitly outside this aggregate denominator. Generated assets, tests, QA drivers, data, and third-party modules are also excluded.

## Test ownership rules

1. A regression test lives at the lowest layer that can reproduce the bug faithfully.
2. Authentication, authorization, replay, expiry, and compare-and-swap tests include both the allowed and denied transition.
3. Contract tests compare observable values and failure semantics, not adapter internals.
4. E2E tests assert what a user can see or do; lower layers cover exhaustive input combinations.
5. Tests use isolated temporary data and local fakes. No release check depends on a live Paddle, Resend, or Turso account.

## Build 7.1.0 additions

Workout validation and browser-core tests use real catalog data. Storage tests cover both adapters through the existing SQLite-backed transport fixture, additive migration, owner isolation, caps, CAS and online backup restoration. The Turso fixture does not exercise a hosted service. Onboarding and planner runtime checks cover failed writes, stale tabs, account switches and recovery. `qa/e2e/training-flows.js` adds real browser training journeys; retain it in `npm run check` even when the local browser binary is unavailable. Current results and limitations live in [release readiness](release-readiness.md).

## Build 7.3.0 additions

The guest-preview core is tested against the real 200-exercise catalog for deterministic ranking, factor explanations, trade-offs, every offered muscle/equipment pair, and invalid combinations. A 320 px Chromium journey proves that a signed-out visitor can generate the preview without saving the selected goal or equipment. Account tests cover next-workout selection, unique planned-day completion, comparable saved-history records, partial-history labels, unavailable history, free accounts, and account changes.

Product-signal tests own the privacy and storage boundary: only allowlisted event names may cross the public endpoint, arbitrary payload fields are rejected, browser requests omit account credentials, network rate keys remain transient, daily rows contain counts only, retention is 90 days, and the aggregate readout requires an elevated owner session. Storage-contract tests keep the new count/increment/delete behavior aligned between local SQLite and the Turso transport fixture. These action totals are deliberately tested and documented as counts, not unique people or connected funnel journeys.

## Build 7.4.0 additions

Training-loop unit tests keep progression and plan-adaptation logic deterministic. They cover first-session baselines, missing check-ins, low comfort or energy, maximum difficulty, under-target repeated work, valid like-for-like progression, measurement/load/unit separation, bounded check-in fields, block validation, and proposals that cannot mutate their input plan.

Integration tests exercise the composed authenticated APIs for entitlement, origin/CSRF/JSON checks, owner isolation, completed-workout requirements, check-in updates, workout-scoped proposals, block revision conflicts, changed check-ins, stale plans, explicit acceptance, dismissal, and replay rejection. Contract tests run the check-in, block, proposal, atomic plan compare-and-swap, replay, and deletion behavior through both the local SQLite adapter and the Turso transport fixture.

The maintained Chromium training journey covers the fresh-member quick start, explicit equipment choice, week preview and save, guide-dialog focus restoration, completed-workout check-in, visible next-session guidance, and approval-only plan adaptation. Strata+ workspace and layout audits cover Today/Plan/Progress/Explore navigation, loaded-history labels, save/error states, keyboard focus, reduced motion, and the 1440/700/390/320 px matrix. These local browser checks use isolated accounts and provider fakes; they do not establish hosted Turso latency or physical-device behavior.

## Build 7.4.1 additions

Responsive regressions use real Chromium rather than stylesheet-string checks alone. Planner library and scheduled cards are measured for content containment, control size, sibling collisions, heading collisions, and horizontal overflow at 13 widths from 320 through 1440 px, including the 339 px reproduction case and the 761–880 px save-error boundary. Strata+, workout, and weekly setup fixtures test long movement names, persistent trays and navigation, dialog controls, logging formats, timers, save actions, check-ins, adaptations, equal-width navigation cells, and opaque sticky headers at seven compact widths.

The authenticated `npm run qa:ui` matrix visits 18 routes at each of 320, 339, 360, 390, 430, 600, 700, and 768 px. It measures document overflow and the rendered rectangles of text inside content cards, while a separate planner matrix repeats card geometry through 1440 px. Public CSS unit coverage also protects long dynamic identities, server messages, identifiers, links, and multi-line actions. These checks complement physical-device review; they do not claim to cover every font renderer, localization, browser zoom level, or future user-provided string.

## Build 7.5.0 additions

Activation tests keep a full generated week browser-local through account and verification pages, prove that merely signing in performs no Plan write, cover explicit claim/compare/keep choices, preserve device recovery copies, bind remembered decisions to the authenticated account and both Plan fingerprints, and reject stale-revision claims.

Training Memory unit and browser tests cover exact comparable-set/date selection, saved-target application, set add/copy/remove behavior, note and RIR/RPE validation, warm-up and plate calculations, superset grouping, workout-only replacements, and revision-checked Plan proposals. The offline journey proves that only an already-authorized active workout can be continued, a mismatched or expired account/access context is rejected, private pages and API responses do not enter Cache Storage, device changes remain pending, and reconnecting requires identity, entitlement, and revision checks before normal sync.

Planner and weekly-review tests exercise deterministic balance signals, observable muscle/pattern/equipment gaps, one reviewable next action, copy-day merge/replace previews, fresh instance identities, confirmation, stale Plan revisions, date-derived block weeks, planned-versus-completed sets, evidence-only records/improvements/skips/replacements, and explicit carry/lighter/finish actions that leave Plan unchanged.

Recurring-billing tests cover the one-use 30-minute trial boundary, explicitly configured monthly catalog, completed transaction plus linked subscription, account/customer/product/price/quantity/cycle mismatches, unexpired current-period enforcement, `active`/`trialing`/`past_due` access, missing or expired bound and `paused`/`canceled` denial, scheduled cancellation/pause cutoffs, duplicate and stale events, failed or invalid signatures, adjustments, interrupted checkout reconciliation, legacy lifetime access, and temporary portal-link validation. Provider calls use controlled local fakes; they do not prove that live Paddle credentials, webhooks, or catalog settings are correct.

Account self-service tests cover the allowlisted session payload, opaque identifiers, current-session protection, foreign and stale targets, all-other revocation, CSRF and authentication failures, rate limits, private download headers, export schema and secret exclusions, bounded streaming/backpressure behavior, stable workout keyset pages, accessible browser controls, and observable SQLite/Turso parity for the export reads and atomic session mutations.

The compatibility E2E matrix runs focused axe serious/critical checks, a keyboard skip-link journey, the planner copy-day path, and 200% root-text reflow. Linux CI installs and runs Chromium, Firefox, and WebKit. Local Darwin runs default to Chromium and WebKit because Playwright Firefox cannot use its headless framebuffer in the Codex app sandbox; `STRATA_E2E_ENGINE=firefox npm run test:e2e` selects the Firefox diagnostic explicitly. Self-hosted-asset tests additionally ensure normal first-party pages do not depend on Google Fonts or Unsplash requests.
