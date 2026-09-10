# STRATA 7.8.0 readiness

Status: the complete local release gate and responsive UI audit pass on the frozen source candidate. Promotion still requires this exact commit to pass the required Node 24 Linux GitHub Actions check before the tag and GitHub release are created. Live provider and hosted-runtime acceptance remain separate.

## Current verification

The final local checks ran on Darwin arm64 with Node.js 25.8.2 and npm 11.11.1. Provider-dependent tests use controlled fakes and isolated temporary data; they do not contact production services or modify production data.

| Check | Observed result |
| --- | --- |
| Complete release gate | Passed with `npm run check` |
| Node regression suite | 671 passed; zero failures, skips, or cancellations |
| Coverage | 94.35% lines; 79.29% branches; 89.26% functions; enforced 90% / 78% / 85% floors passed |
| Runtime smoke checks | Account, Strata+, Plan, Train, and PWA checks passed |
| Architecture | 39 server modules and seven page boundaries covering 64 unique browser modules; zero cycles and zero policy violations |
| Boundary type checking and lint | Passed |
| Managed release references | Aligned at 7.8.0 across 32 allowlisted files |
| Browser E2E | 31 high-risk and responsive journeys passed in the maintained local browser matrix |
| Responsive UI audit | 18 routes at eight widths from 320–768 px, plus Plan geometry through 1440 px; zero overflow, text-containment, dialog, focus-navigation, or console failures |
| Performance budgets | Passed for health, status, authenticated Plan read/save, session lookup, Plan lookup, and Plan compare-and-swap |
| Dependency audit | `npm audit` and `npm audit --omit=dev` reported zero vulnerabilities |
| GitHub state | No open pull requests or issues at candidate review time |
| Linux compatibility matrix | Required on the exact commit in GitHub Actions before promotion |
| Live Paddle, Resend, Turso, and hosted runtime | Not verified locally |

The local E2E and responsive checks cover the preview-to-account hand-off, recovery, trial and checkout boundaries, Plan conflicts, first-workout logging, Training Memory, payment entitlement, account deletion, keyboard use, focus behavior, responsive navigation, disclosures, dialogs, and long-text containment. They are regression evidence for the checked-in application; they do not replace physical-device testing or live-provider acceptance.

The source candidate also revalidates durable identity when Home, Pricing, Account, and Admin return to the foreground or from the back-forward cache. Account and Admin purge private DOM before revalidation, supersede delayed initial identity responses, and discard delayed reads or mutations after identity invalidation. Pricing binds trial and checkout completion to the account that initiated the action and closes an open Paddle overlay after a confirmed identity change so another account cannot continue or inherit a stale checkout.

## Product and architecture result

Build 7.8.0 establishes one primary path from a useful guest preview through account verification, an explicit seven-day no-card trial, Plan review, training, and evidence from completed work. Generated multi-day plans repeat compatible anchors so Training Memory can provide value during the first trial week. Plan conflict recovery, selected-day continuity, essential-first workout logging, honest Progress empty states, consistent primary navigation, and compact layouts remove duplicate or unclear actions.

The existing HTML/CSS application remains intact. Home, Strata+, Plan, Train, Pricing, Account, and Admin are incrementally split into reviewed pure-logic, state, same-origin API, rendering, event, and coordinator boundaries. The checked-in browser architecture policy enforces module presence, size budgets, dependency direction, actual HTML load order, and zero cycles. The largest page coordinators fell from 414–1,364 lines to 132–699 lines while focused tests protect their extracted behavior.

Production Admin elevation now requires the owner's password followed by a session-bound six-digit code delivered to the registered address. The code expires after ten minutes; successful verification rotates the session before the existing 30-minute elevation begins. Production fails closed if delivery is unavailable. Aggregate owner metrics expose coarse activation milestones only, never workout contents, account identities, or connected user journeys.

## Deployment requirements

Deploy the Node server and public assets together. Build 7.8.0 advances the service-worker cache and precaches the new public browser modules while continuing to bypass private account, Admin, authentication, billing, and API data. There is no database migration or payment-catalog change in this release.

The existing **$0.99 USD monthly** subscription, optional **seven-day no-card trial**, and grandfathered lifetime access remain unchanged. Production owner elevation depends on working Resend delivery and the existing email-security secret. Complete the [Paddle provider acceptance checklist](provider-acceptance.md) against an isolated sandbox before enabling or changing live payment traffic.

See [the 7.8.0 release guide](release-7.8.0.md), [module architecture evidence](module-architecture.md), [test architecture](testing.md), and [performance evidence](performance.md). Historical release records describe their own builds and are not current verification evidence.
