# STRATA 7.8.1 readiness

Status: the complete local release gate and responsive UI audit pass on the frozen source candidate. Promotion still requires this exact commit to pass the required Node 24 Linux GitHub Actions check before the tag and GitHub release are created. Live provider and hosted-runtime acceptance remain separate.

## Current verification

The final local checks ran on Darwin arm64 with Node.js 25.8.2 and npm 11.11.1. Provider-dependent tests use controlled fakes and isolated temporary data; they do not contact production services or modify production data.

| Check | Observed result |
| --- | --- |
| Complete release gate | Passed with `npm run check` |
| Node regression suite | 693 passed; zero failures, skips, or cancellations |
| Coverage | 94.37% lines; 79.38% branches; 89.43% functions; enforced 90% / 78% / 85% floors passed |
| Runtime smoke checks | Account, Strata+, Plan, Train, and PWA checks passed |
| Architecture | 39 server modules and seven page boundaries covering 68 unique browser modules; zero cycles and zero policy violations |
| Boundary type checking and lint | Passed |
| Managed release references | Aligned at 7.8.1 across 32 allowlisted files |
| Browser E2E | 31 high-risk and responsive journeys passed in the maintained local browser matrix |
| Responsive UI audit | 18 routes at eight widths from 320–768 px, plus Plan geometry through 1440 px; zero overflow, text-containment, dialog, focus-navigation, or console failures |
| Performance budgets | Passed for health, status, authenticated Plan read/save, session lookup, Plan lookup, and Plan compare-and-swap |
| Dependency audit | `npm audit` and `npm audit --omit=dev` reported zero vulnerabilities |
| GitHub state | No open pull requests or issues at candidate review time |
| Linux compatibility matrix | Required on the exact commit in GitHub Actions before promotion |
| Live Paddle, Resend, Turso, and hosted runtime | Not verified by the local provider fakes |

The local E2E and responsive checks cover the preview-to-account hand-off, recovery, trial and checkout boundaries, Plan conflicts, first-workout logging, Training Memory, payment entitlement, account deletion, keyboard use, focus behavior, responsive navigation, disclosures, dialogs, long-text containment, and the new chart layouts at 320 px. They are regression evidence for the checked-in application; they do not replace physical-device testing or live-provider acceptance.

The source candidate also revalidates durable identity when Home, Pricing, Account, Admin, Strata+, and Workout return to the foreground or from the back-forward cache. Private training charts are destroyed and their canvas, generated accessibility DOM, controls, status, scope, and exact-value rows are blanked synchronously before foreground identity validation; successful same-account validation restores the view without appending another chart root. Account and Admin continue to purge private DOM before revalidation and discard delayed reads or mutations after invalidation. Pricing binds trial and checkout completion to the account that initiated the action and closes an open Paddle overlay after a confirmed identity change.

## Product and architecture result

Build 7.8.1 adds three focused visual explanations to existing decisions. Strata+ Training Memory and Workout History compare only completed sessions with the same exercise, measurement, load type, and unit; one point remains an explicit baseline instead of an invented trend. Planner visualizes the top eight exact primary-muscle set counts already produced by Plan analysis, while the existing rows remain the accessible source of truth.

All three adapters depend on one small `StrataParticleChart` render core. It owns the STRATA theme, reduced-motion behavior, bounded particle settings, create/update/resize/destroy lifecycle, and graceful failure. Page adapters own only their existing validated data and exact fallback DOM. The browser architecture policy enforces load order and dependency direction across 68 modules with zero cycles.

The Particle Charts 1.0.0 UMD artifact is pinned byte-for-byte, served from the STRATA origin with SRI, covered by its complete MIT notice, statically allowlisted, and versioned in the public PWA cache. No chart makes a separate network request or persists workout values. Private API responses remain excluded from Cache Storage.

## Deployment requirements

Deploy the Node server and public assets together. Build 7.8.1 advances the service-worker cache and precaches the pinned chart runtime, shared core, and page adapters while continuing to bypass private account, Admin, authentication, billing, and workout API data. There is no database migration, payment-catalog change, authentication change, or new environment variable in this release.

The existing **$0.99 USD monthly** subscription, optional **seven-day no-card trial**, and grandfathered lifetime access remain unchanged. Production owner elevation depends on working Resend delivery and the existing email-security secret. Complete the [Paddle provider acceptance checklist](provider-acceptance.md) against an isolated sandbox before enabling or changing live payment traffic.

See [the 7.8.1 release guide](release-7.8.1.md), [module architecture evidence](module-architecture.md), [test architecture](testing.md), and [performance evidence](performance.md). Historical release records describe their own builds and are not current verification evidence.
