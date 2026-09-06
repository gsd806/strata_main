# STRATA 7.1.3 readiness

Status: reviewable source candidate based on GitHub v7.1.2; **not deployed**. The complete release gate is not green because this workspace has no Playwright Chromium executable.

| Check | Result |
| --- | --- |
| Node regression tests | 403 passed, zero failed; 35 affected account/public-page/CSS tests also passed after the final copy and layout adjustments |
| Coverage | 92.45% lines, 81.38% branches, 87.91% functions; all enforced floors passed |
| Release, architecture, type, lint | Passed; 16 server modules, zero dependency cycles or policy violations |
| Runtime QA | Account, Strata+, planner, and PWA smoke checks passed |
| Endpoint/storage performance | All seven local operation budgets passed; 40 samples after 8 warmups each |
| 100 users, distinct source addresses | Passed: 5,823 requests, zero unexpected HTTP errors, 300 expected conflict responses |
| 100 users sharing one source address | Passed: 5,823 requests, zero unexpected HTTP errors, 300 expected conflict responses |
| Public browser review | Desktop homepage/rankings, policies, account, pricing, and planner inspected; zero document-width overflow on those inspected pages. Pricing text flow and the 118 px weekly chart were checked after fixes. |
| Rest-day browser behavior | Added Saturday rest, refreshed and confirmed persistence, removed rest; button returned to Add rest day |
| Automated Chromium E2E | Blocked before journeys start: all four suite entries fail to launch the missing `chromium_headless_shell-1234` executable |
| Authenticated visual/mobile matrix | Not run in this workspace; required with Chromium before deployment |
| Hosted Turso / real email / real payment | Not exercised |

Evidence is in `docs/verification/`: `coverage-7.1.3.log`, `runtime-7.1.3-final.log`, `performance-7.1.3.log`, `e2e-7.1.3.log`, and both `load-7.1.3-*.json` files. Source provenance is `7.1.2-source.json`. Older evidence files describe earlier builds and must not be treated as verification of 7.1.3.

Local performance p95 was 3.401 ms for health, 3.397 ms for status, 5.321 ms for authenticated plan reads, and 2.798 ms for plan saves. Session lookup, plan lookup, and plan compare-and-swap storage p95 values were 0.023, 0.008, and 0.023 ms respectively. These measurements are regression evidence, not production latency promises.

The Linux load harness used isolated local SQLite and the existing explicit test-only signup verification bypass. It retained network and identity rate limits, exercised real authenticated plan/workout workflows, checked cross-account isolation, competing saves, restart durability, deletion guards, and logout. It contacted no real email or payment provider. Its measured application memory excludes database/proxy/platform infrastructure outside that process.

## Remaining promotion checks

Use Node 24, install the matching Playwright Chromium browser in an isolated test environment, and run `npm run check` plus `npm run qa:ui`. The UI audit creates accounts and modifies plans; never point it at production. Confirm 320/390/700 px layouts, enlarged text, keyboard order, reduced motion, paid/trial workspaces, and PWA refresh/offline behavior. Then complete production-like hosted database capacity, provider sandbox, and backup restoration checks, and obtain deployment approval. See `release-7.1.3.md` and `deployment.md`.
