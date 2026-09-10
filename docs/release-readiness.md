# STRATA 7.7.1 readiness

Status: the complete local release gate and responsive UI audit passed. Promotion still requires the exact commit to pass the required Node 24 Linux GitHub Actions check before the tag and GitHub release are created. Live provider and deployed-runtime checks remain separate.

## Current verification

The final local checks ran on Darwin arm64 with Node.js 24.19.0 and npm 11.11.1. Provider-dependent tests use controlled fakes and isolated temporary data; they do not contact production services or modify production data.

| Check | Observed result |
| --- | --- |
| Complete release gate | Passed with `npm run check` |
| Node regression suite | 583 passed; zero failures, skips, or cancellations |
| Coverage | 94.19% lines; 80.15% branches; 90.48% functions; enforced 90% / 78% / 85% floors passed |
| Runtime smoke checks | Account, Discover, planner, workout, and PWA checks passed |
| Architecture | 38 modules; zero cycles; zero policy violations |
| Boundary type checking and lint | Passed |
| Managed release references | Aligned at 7.7.1 across 32 allowlisted files |
| Browser E2E | 30 passed in Chromium and WebKit |
| Responsive UI audit | 18 routes at eight widths from 320–768 px, plus planner geometry through 1440 px and direct Pricing geometry at 1252 px; zero overflow, text, dialog, focus-navigation, or console failures |
| Performance budgets | Passed |
| Linux Firefox and 100-user profiles | Required in GitHub Actions before promotion |
| Live Paddle, Resend, Turso and hosted runtime | Not verified locally |

The new required browser regression renders the real Pricing benefit markup with production styles at 320, 430, 768, 980, 981, 1252, and 1440 px. It verifies that every description begins in the heading's content column, receives useful line width, stays within a reasonable row height, and creates no horizontal overflow. At the reported 1252 px viewport, all four rows were 598 px wide, description lines were 424–526 px wide, and row heights were 74–96 px; the broken layout had constrained the description to about 23 px and made the first row over 600 px tall.

SQLite and the SQLite-backed Turso transport fixture check commit-time owner elevation, grant and hold revision conflicts, audit rollback, primary-owner grants, payment hold enforcement, recording accepted provider work only against a matching durable claim, and explicit administrator-control cleanup during both self-service and administrator deletion when foreign-key enforcement is unavailable. This is adapter-parity evidence, not a live Turso test.

Independent review reproduced the defect at every tested width from 320 through 1440 px. The checkmark pseudo-element, heading, and bare description were three auto-placed items in a two-column grid, so the description fell into the 24 px icon column while technically remaining inside its card. Grouping each row's copy and using a shrink-safe content track fixes the cause without hiding or truncating text. The final release, browser, and documentation reviews found no remaining concrete local blocker.

## Deployment requirements

The app remains a Node web service. This patch changes public Pricing markup and styles, browser QA, release metadata, and documentation only. It introduces no dependency, configuration, database, authentication, access, or payment-catalog change. Deploy the server and public assets together. Build 7.7.1 advances the service-worker cache so installed PWAs replace the broken 7.7.0 Pricing assets after activation.

The $0.99 USD monthly subscription, seven-day no-card trial, grandfathered lifetime access, and 7.7.0 administrator controls are unchanged. Provider-dependent checks remain local fakes; no live purchase, email, or account mutation was performed for this presentation-only patch.

See [the 7.7.1 release guide](release-7.7.1.md) for the repair and [the 7.7.0 release guide](release-7.7.0.md) for the unchanged administrator controls. Historical release records describe their own builds and are not current verification evidence.
