# STRATA 7.2.0 readiness

Status: reviewable source candidate; not deployed.

This release presents STRATA as one connected Rank → Plan → Train → Refine system, adds a device-private movement Decision Board and more useful training guidance, and refines every public and account journey without changing production credentials, provider configuration, authorization, payment behavior, database schema, or stored records. See the [release guide](release-7.2.0.md) and [changelog](../CHANGELOG.md).

| Check | Result |
| --- | --- |
| Node regression tests | 410 passed, zero failed |
| Coverage | 92.51% lines; 81.17% branches; 88.06% functions; enforced floors passed |
| Release, architecture, type, and lint checks | Passed; 16 server modules, zero cycles, zero policy violations |
| Runtime QA | Account, Strata+, planner, and PWA checks passed |
| Endpoint and storage performance | Passed 40 measured samples after 8 warmups per operation |
| Security and entitlement regressions | Passed auth recovery/session revocation, plan conflicts, signed Paddle entitlement, account deletion, and free/trial/paid boundaries |
| Automated Chromium E2E | 15 passed, zero failed across high-risk and training journeys |
| Authenticated visual matrix | Passed at 1440, 700, 390, and 320 px widths; zero first-party browser errors and zero horizontal overflow on all 15 audited routes |
| Manual visual/cascade review | Passed the connected-system artwork, account dashboard, install states, Decision Board, setup, Plan, Train, public policies, print output, focus treatments, and reduced-motion behavior |

The complete `npm run check` gate passes on Node 24. The authenticated `npm run qa:ui` pass creates an isolated test account, verifies the trial/free boundary, checks account action visibility, contrast and dialog focus, saves and reloads the four-slot Decision Board, hands two choices to comparison, exercises explicit session creation and plan saving, and audits every main route at 320 px. Rankings, Strata+, Plan, Train, Account, public information, and Install navigation remains reachable with touch-sized controls.

The original layered artwork is served as a bounded public JPEG with explicit dimensions and lazy decoding, while remaining outside the PWA precache so it is not eagerly downloaded. The manifest shortcuts, offline public/planner routes, old-cache cleanup, private-route exclusions, and install state handling pass their contract and browser checks. Device-storage disclosures cover the account-keyed Decision Board, workout rest preferences, sign-out, account deletion, and browser-data clearing.

Local endpoint p95 latency was 0.548 ms for health, 0.561 ms for status, 0.389 ms for authenticated plan reads, and 0.812 ms for authenticated plan saves. Storage p95 latency was 0.012 ms for session lookup, 0.006 ms for plan lookup, and 0.050 ms for plan compare-and-swap. These are local SQLite regression measurements, not production service-level objectives.

Hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, production deployment, and production account migration were not exercised. The CI load jobs and authorized deployment/provider checks remain required before promoting this candidate.
