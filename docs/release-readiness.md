# STRATA 7.1.2 readiness

Status: reviewable source candidate; not deployed.

This patch repairs the Strata+ recommendation, setup, planner, and workout journeys without changing production credentials or provider configuration. See the [release guide](release-7.1.2.md) and [changelog](../CHANGELOG.md).

| Check | Result |
| --- | --- |
| Node regression tests | 402 passed, zero failed |
| Coverage | 92.44% lines; 81.38% branches; 87.91% functions; enforced floors passed |
| Release, architecture, type, and lint checks | Passed; 16 server modules, zero cycles, zero policy violations |
| Runtime QA | Account, Strata+, planner, and PWA checks passed |
| Endpoint and storage performance | Passed 40 measured samples after 8 warmups per operation |
| Security and entitlement regressions | Passed auth/session revocation, setup revisions, active-workout isolation, signed fake-Paddle events, and free/trial/paid boundaries |
| Automated Chromium E2E | 15 passed, zero failed across auth recovery, plan conflicts, payment entitlement, account deletion, responsive navigation, and training journeys |
| Authenticated visual matrix | Passed at desktop and 700/390/320 px mobile widths; zero first-party browser errors and zero horizontal overflow on every audited route |
| 100-account Linux load checks | Kept as CI gates; the local macOS runner correctly refused the Linux loopback-only harness before sending requests |

The complete `npm run check` gate passes on Node 24. The authenticated UI audit creates an isolated test account, verifies the trial/free boundary, checks contrast and keyboard behavior, exercises explicit session creation and plan saving, and captures the Strata+, Plan, and Train layouts. It also verifies that a long member name cannot replace or obscure `BEST EXERCISES FOR YOU.` and that the mobile product header remains visible and unobscured while using a tool.

Local endpoint p95 latency was 2.23 ms for health, 2.18 ms for status, 2.75 ms for authenticated plan reads, and 2.78 ms for authenticated plan saves. Storage p95 latency was 0.008 ms for session lookup, 0.004 ms for plan lookup, and 0.055 ms for plan compare-and-swap. These are local SQLite regression measurements, not production service-level objectives.

The workout database tests verify the partial unique active-session index with `EXPLAIN`, concurrent starts through two independent SQLite connections, and equivalent mocked-Turso behavior. Legacy duplicate active rows are reconciled without deleting their workout history.

Hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, production deployment, and production account migration were not exercised. The CI load jobs and authorized deployment/provider checks remain required before promoting this candidate.
