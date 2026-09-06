# STRATA test architecture

STRATA uses four test layers. Each layer owns a different kind of confidence; a browser test should not replace a focused unit test, and a mocked unit test should not be presented as proof that two storage adapters agree.

| Layer | Scope and boundary | Naming/location | Command |
| --- | --- | --- | --- |
| Unit | One module or browser script with controlled collaborators. No real HTTP server or persistent database. | `test/*.test.js`, excluding the integration/contract prefixes below | `npm run test:unit` |
| Integration | The composed Node application, real HTTP behavior, auth/session middleware, and provider orchestration. External providers stay local or fake. | `test/server*.test.js` | `npm run test:integration` |
| Contract | Observable storage behavior, migrations, indexes, concurrency, SQLite/Turso parity, and enforced module/deployment structure. | `test/database*.test.js`, `test/architecture-*.test.js`, and `test/project-structure.test.js` | `npm run test:contract` |
| E2E | A real Chromium browser driving the running application through user-visible, high-risk flows. | `qa/e2e/*.js` | `npm run test:e2e` |

`scripts/run-test-layer.js` enforces this mapping from filenames to test layers. New Node tests must use the `server` prefix when they cross the HTTP composition boundary, the `database` prefix when they define storage behavior, and the `architecture-` prefix when they enforce dependency contracts. The legacy `project-structure` suite is also an architectural contract. Everything else is a focused unit test. Browser journeys belong only in `qa/e2e/`.

## Normal verification

`npm test` remains the fast, complete Node test suite. `npm run check` is the release gate and runs release consistency, architecture constraints, static boundary typing, lint, the Node suite with coverage thresholds, runtime QA, performance checks, and the high-risk E2E suite. The layer commands are useful while developing or diagnosing a failure.

The E2E suite owns a deliberately small set of costly journeys: login and recovery, plan conflict resolution, payment entitlement, and account deletion. It starts an isolated application plus local provider fakes, so it never contacts production services or modifies developer data.

## Coverage policy

`npm run coverage` fails below these application-code floors:

- lines: 90%
- branches: 78%
- functions: 85%

The integrated Build 6.9.9.007 run on the supported Node 24.20.0 runtime measured 91.33% lines, 78.91% branches, and 85.47% functions. Coverage runs files sequentially to keep that baseline and denominator repeatable. The thresholds are rounded down to preserve a narrow refactoring buffer rather than claiming every line has equal risk. Raise a floor when sustained useful tests create room; lower one only with an explicit review that explains the lost behavior. Security and state-transition boundaries still need direct assertions even when aggregate coverage passes.

Coverage includes the process entry point, `src/**/*.js`, and the pure browser-domain modules `public/scripts/discovery-core.js` and `public/scripts/monthly-plan-core.js`. DOM entry scripts are exercised by focused VM/runtime tests and the real-browser E2E journeys, but Node's built-in collector does not instrument those separate VM/browser realms, so they are explicitly outside this aggregate denominator. Generated assets, tests, QA drivers, data, and third-party modules are also excluded.

## Test ownership rules

1. A regression test lives at the lowest layer that can reproduce the bug faithfully.
2. Authentication, authorization, replay, expiry, and compare-and-swap tests include both the allowed and denied transition.
3. Contract tests compare observable values and failure semantics, not adapter internals.
4. E2E tests assert what a user can see or do; lower layers cover exhaustive input combinations.
5. Tests use isolated temporary data and local fakes. No release check depends on a live Paddle, Resend, or Turso account.

## Build 7.1.0 additions

Workout validation and browser-core tests use real catalog data. Storage tests cover both adapters through the existing SQLite-backed transport fixture, additive migration, owner isolation, caps, CAS and online backup restoration. The Turso fixture does not exercise a hosted service. Onboarding and planner runtime checks cover failed writes, stale tabs, account switches and recovery. `qa/e2e/training-flows.js` adds real browser training journeys; retain it in `npm run check` even when the local browser binary is unavailable. Current results and limitations live in [release readiness](release-readiness.md).
