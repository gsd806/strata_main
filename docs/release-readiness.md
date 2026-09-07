# STRATA 7.3.0 readiness

Status: reviewable source candidate; not deployed.

Build 7.3.0 adds product proof before signup, a more useful returning-member dashboard, and an optional privacy-bounded product-signal path. It does not change production credentials, provider configuration, payment pricing, account authorization, the editorial FitScore catalog, or existing training records. See the [release guide](release-7.3.0.md) and [changelog](../CHANGELOG.md).

| Check | Verified result |
| --- | --- |
| Complete release gate | `npm run check` passed locally |
| Node regression tests | 441 passed, zero failed |
| Coverage | 92.67% lines; 81.37% branches; 88.57% functions; enforced floors passed |
| Release, architecture, type, and lint checks | Passed; 18 server modules, zero dependency cycles, zero policy violations |
| Runtime QA | Account, Strata+, planner, and PWA runtime checks passed as part of the release gate |
| Endpoint and storage performance | Passed 40 measured samples after 8 warmups per operation |
| Automated Chromium E2E | 16 passed, zero failed across the maintained browser journeys |
| Authenticated visual matrix | Passed at 1440, 700, 390, and 320 px, including all 15 routes in the 320 px sweep; zero unexpected first-party browser errors, horizontal overflow, or fixed-navigation focus overlap |
| 100-user load profiles | Not executable on this Darwin host because the harness deliberately requires Linux loopback and `/proc`; both profiles stopped before issuing requests and remain required in Linux CI |

The complete local gate ran under Node 25.8.2. STRATA's supported runtime and CI target remain Node 24, so the local result does not replace a green Node 24 CI run. The E2E environment uses an isolated local application and provider fakes; it does not contact production services or modify production data.

## Product and privacy evidence

The signed-out homepage preview ranks three exercises from the public catalog using deterministic rules after the visitor chooses a goal, muscle group, equipment, and experience level. It keeps official FitScore separate from the personal match and exposes both a supporting factor and a trade-off. The selected preview inputs remain in the page and are not saved to an account or plan.

The returning Account dashboard reads the authenticated saved week and, for active Strata+ access, bounded workout summaries. It derives the next scheduled action, unique planned-day completion for the current local week, a recent completed session, and like-for-like external-load, bodyweight-repetition, or timed improvements in the browser. Assisted load is excluded from record claims. Incomplete history is labeled as recent history, free accounts do not receive invented completion totals, and the adaptation copy does not claim to measure recovery, readiness, pain, technique, or injury risk.

Coarse product milestones stay reviewable in browser storage and can be disabled and cleared. Global Privacy Control or Do Not Track disables both local collection and sharing. Nothing is sent until the separate aggregate-sharing choice is enabled. Each accepted same-origin request contains one allowlisted event name, omits account credentials, and becomes only a `(UTC day, event name, count)` row. The server stores no browser, account, URL, exercise, plan, workout, recommendation content, name, or contact detail for this feature. Repeated actions increment the count again, so these totals are not unique people, conversion cohorts, or connected journeys. Server counts expire within 90 days; the elevated owner view exposes only bounded aggregates.

The product-signal migration is additive and shared by SQLite and the Turso adapter contract. It does not rewrite existing account, session, plan, workout, rating, community-plan, support, or Paddle records. An older build ignores the added aggregate table and browser-local keys.

## Performance evidence

Local SQLite regression p95 latency was 0.679 ms for health, 0.684 ms for status, 0.319 ms for authenticated plan reads, and 0.619 ms for authenticated plan saves. Storage p95 latency was 0.011 ms for session lookup, 0.006 ms for plan lookup, and 0.054 ms for plan compare-and-swap. These measurements passed the checked-in budgets, but they are local regression evidence rather than production service-level objectives or hosted Turso latency claims.

## Promotion limits

Hosted Turso behavior and capacity, real Resend delivery, real Paddle sandbox or live transactions, production deployment, production data migration, third-party asset availability, and physical-device PWA behavior were not exercised by this local gate. The Linux-only distinct-address and shared-address 100-user workloads were attempted on this Darwin host and correctly refused to run before issuing requests; before promotion, require both green load jobs and the complete gate on Node 24 CI plus the authorized deployment, hosted-provider, migration, and post-deploy smoke checks. No GitHub release, tag, provider setting, production account, or deployment is created by this source-readiness result.
