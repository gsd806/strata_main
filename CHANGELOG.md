# Changelog

## 7.4.0 — A calmer, guided training loop

- Reorganized Strata+ around four clear destinations—Today, Plan, Progress, and Explore—so the next workout remains primary while advanced tools stay available without dashboard clutter.
- Added a Today brief with one Start or Resume action, estimated duration or elapsed time, relevant equipment, and the latest comparable result in the loaded 100-session window; replaced day-specific command copy with the stable “Start working out” action.
- Added honest log-derived adherence, external-load volume, four-week consistency, repeat improvements, and personal bests while keeping partial history, measurement formats, assistance, bodyweight, kilograms, and pounds explicitly separate.
- Added an optional 4–8 week training-block record with revision-safe updates, milestones, current-week state, and an optional lighter week without automatically rewriting the weekly Plan.
- Added catalog-backed exercise guidance across Rankings, Plan, and Train, including one setup cue, two additional technique cues, a caution or common mistake, purpose, prescription, and a same-target different-equipment alternative where available.
- Streamlined first-use setup with a deterministic three-day beginner profile, one explicit equipment choice, a visible week preview, and a direct first-workout hand-off after saving.
- Added an optional four-answer post-workout check-in plus conservative, deterministic next-session guidance: first results stay baselines and increases require a comparable repeated result and an explicit acceptable check-in.
- Added explicit, revision-bound plan-adjustment proposals for difficult check-ins. Suggestions never change a plan silently; acceptance atomically verifies the workout check-in and current Plan, while dismissal and replays cannot mutate it.
- Added owner-scoped SQLite/Turso storage parity, account-deletion cleanup, strict checkJs boundaries, unit/integration/contract/browser coverage, private-cache exclusions, and public privacy/fitness disclosures for the complete training loop.
- Improved responsive layout, touch targets, dialog focus restoration, reduced-motion behavior, validation errors, and consistent Saving… / Saved / Couldn't save — Retry states across the changed journeys.

## 7.3.0 — Product proof and returning-member clarity

- Added a no-account homepage preview that ranks three real catalog movements from a visitor’s goal, muscle group, equipment, and experience while explaining the personal match, immutable editorial FitScore, strongest decision factors, and clearest trade-off.
- Clarified the free-versus-Strata+ boundary across the homepage, weekly planner, setup, workout room, and pricing without removing free rankings or browser-local weekly planning.
- Rebuilt the signed-in Account view around one useful next action, scheduled-day progress, recent saved activity, comparable progress records, honest partial-history labels, and conservative adaptation cues.
- Made an open workout directly resumable from Account while preserving dirty-draft recovery, account isolation, one-active-session enforcement, and saved-history behavior.
- Added public recommendation methodology that keeps editorial FitScore, personal match, community ratings, recommendation feedback, and product activity counts distinct and appropriately limited.
- Added optional, inspectable device product insights and an explicit aggregate-sharing choice. The server stores only UTC-day plus allowlisted-action counts for 90 days, never raw events, cookies, accounts, URLs, exercises, plans, workouts, or recommendation payloads.
- Added an elevated owner readout for directional activity counts and labeled repeated actions, automated traffic, non-unique people, and the absence of connected cohorts so the numbers cannot be mistaken for audited conversion analytics.
- Kept SQLite and Turso aligned through a shared additive aggregate schema, narrow store methods, retention behavior, query-plan evidence, and real composed-server, adapter-parity, client-privacy, and owner-elevation tests.
- Improved first-session language, validation and conflict announcements, focus targets, touch sizing, fixed-navigation spacing, mobile headers, and narrow-screen layouts across setup, Plan, Train, pricing, and the consent surface.

## 7.2.0 — Connected training system and founder-led relaunch

- Reframed the public experience around one Rank → Plan → Train → Refine workflow while preserving the complete 200-exercise index, scoring boundaries, licensed photography, founder story, and purchase facts.
- Added original layered STRATA artwork, a clearly labeled illustrative training workspace, a calmer pricing path, secure support guidance, and refined policy/founder presentation.
- Turned Strata+ into a more useful training studio with a live weekly brief, visible ranking lens, and an account-keyed, device-private four-movement decision board that can feed the existing comparison tool.
- Made weekly setup more legible with live training/recovery/session facts and a generated-week summary; added contextual plan readiness and a compact weekly distribution graphic without adding server-side state.
- Improved the workout room with selected-session facts, next-set guidance, per-exercise progress, remembered rest preferences, and clearer mobile states while preserving the existing save, recovery, conflict, and entitlement boundaries.
- Added a signed-in account command center, clearer install/offline routes, useful PWA shortcuts, and a reduced-motion-aware page progress indicator.
- Closed final accessibility and presentation gaps around excluded-movement labels, detail-dialog focus, context-dependent hidden actions, device-storage disclosure, and clean print output.
- Kept the release additive and presentation-focused: no database migration, pricing change, authentication change, new payment contract, or production deployment.

## 7.1.3 — Unified visual system and clearer public journeys

- Applied the clean Strata+ design language across Rankings, Plan, Train, weekly setup, accounts, public information, installation, and private administration while retaining the existing photography and product imagery.
- Standardized Manrope and DM Mono typography, dark navigation, softer lime accents, card/control geometry, hover feedback, focus treatments, and reduced-motion behavior.
- Rebuilt reveal motion to stage before first paint, preventing content from flashing backward while preserving a fully visible no-JavaScript fallback.
- Removed repeated promotions and legal-link clusters, simplified pricing and support copy, and standardized four-destination mobile product navigation.
- Moved the founder biography out of the homepage into a new public `/policies` directory that links Terms, Privacy, Refunds, support, and founder information.
- Added responsive regressions for policy routing, footer consolidation, narrow layouts, navigation order, and the updated Strata+ card grid.

## 7.1.2 — Coherent Strata+ journeys and responsive UI

- Replaced display-name-driven recommendation headings with stable, readable copy and kept long member names contained in account chrome.
- Reworked Strata+ into a clear dashboard: one primary workout action, one weekly-plan action, seven equally weighted tools, and explicit session generation before anything can be added to a plan.
- Standardized Rankings, Strata+, Plan, and Train navigation; added durable mobile bottom bars, touch-sized controls, clearer focus states, and corrected light/dark panel contrast.
- Made empty and recovery workout days actionable, removed duplicate recovery/history surfaces, and ensured repeated or concurrent starts resume the one active account workout.
- Saved weekly setup and its matching recommendation profile atomically with SQLite/Turso parity and both revision boundaries, including a safe recovery-day default for legacy seven-day plans.
- Added strict setup-boundary typing and expanded unit, integration, browser, runtime, accessibility, breakpoint, and concurrency regressions.
- See docs/release-7.1.2.md for deployment and rollback notes, and docs/release-readiness.md for verified results.

## 7.1.1 — Focused free planning and Strata+ training

- Moved workout starts and Set up my week into Strata+. Logging, history and setup now require paid or active trial access; API reads/writes and direct training pages enforce the entitlement.
- Kept manual planning, exercise editing, undo, templates, export and sharing available in the free planner.
- Added independent rest-day toggles, including removing the last rest day. Removed rest recommendations and automatic rest relocation.
- Preserved old plans and exports with an additive restDays field. Repair keeps every scheduled exercise, including weeks with training on all seven days.
- Restyled the Strata+ workspace with setup-inspired dark panels, softer lime, readable controls, responsive layouts and reduced-motion support.
- Preserved workout-day destinations through sign-in; closed private workout views on session expiry; retained stored sessions when Plus access ends.
- Updated pricing, offline cache rules, regression tests and the 100-user harness for the new feature boundary.
- See docs/release-7.1.1.md for migration and rollback limits, and docs/verification/7.1.1-load-shared.json for that release's measured load record.

## 7.1.0 — Training workflows and account safety

- Added a free workout room with actual loads/reps/timed sets, completion controls, absolute rest timer, save/close, interrupted-session recovery and account synchronization.
- Added owner-scoped workout storage, strict validation, idempotent creation, atomic revision conflicts, bounded summary history and account-deletion cleanup.
- Added history/details, previous results, recorded bests and accessible progress charts grouped by exercise, logging format and unit. Bodyweight, assistance and timed work have explicit measurement semantics.
- Added first-week onboarding for goals, experience, equipment, movement filters and availability, with editable preview and deliberate replacement of existing weeks.
- Added undo, searchable exercise replacement, local reusable week templates, JSON import/export and recoverable per-tab/account drafts.
- Fixed the administrator password-reset login race, cross-account planner token adoption, stale guest saves, onboarding storage retry and missing auth return destinations.
- Added isolated Paddle sandbox configuration without altering live checkout defaults; matching credentials and a separate catalog are required.
- Added responsive black/lime screens, purposeful motion, clear save/error states, keyboard controls and reduced-motion styling; updated factual storage disclosures.
- Extended 100-user workloads to workout lifecycle, conflicts, isolation and resource measurements; added migration, online backup/restore and full browser journey regressions.
- Source is based on the actual 7.0.0 tag. Production deployment, provider transactions and full Chromium verification remained pending; see docs/release-7.1.0.md and docs/verification/7.1.0-load-distinct.json for that release's records.

## 7.0.0 — Pilot readiness and interface update

- Added 100-user workloads for separate IPs and one shared network, covering private-plan isolation, concurrent writes, stale-edit rejection, restart persistence, and auth limits.
- Replaced the shared ten-attempt login/signup bottleneck with bounded network and hashed-identity limits. Verification limits follow the challenge; durable email restrictions remain enforced.
- Reject non-object JSON with HTTP 400. Preload/precompress allowlisted public assets within 16 MiB; private HTML remains dynamic.
- Added HTTP timeouts and a ten-second graceful shutdown deadline.
- Added atomic monthly plan revision checks for both storage adapters, conflict guidance, and recovery of corrupt monthly records.
- Prevent new weekly plans exceeding 30 exercises/day or 140/week; preserve older oversized guest drafts and offer explicit offline guest access.
- Enforce equipment and movement constraints on imported monthly exercises; reject eligibility calculation errors.
- Correct logout failures, rating/monthly save races, comparison focus, and mobile Account access.
- Added coordinated styling, score indicators, a weekly distribution chart, and finite animations with reduced-motion support.
- Updated the deployment blueprint to an always-on 1 CPU / 2 GB baseline, deterministic npm installation, and optional local .env loading. No hosted services are changed by this source update.


## v6.9.9.007 — 2026-09-06

Build 6.9.9.007 turns the previous quality measurements into enforceable release boundaries.

- Added an explicit server-module policy with reviewed size budgets, allowed dependency edges, cycle detection, and a generated dependency/size report.
- Added strict `checkJs` type checking for HTTP, Paddle, storage registration, and production service wiring, with declared dependency interfaces for the extracted authentication, administration, and support modules.
- Enforced calibrated 90% line, 78% branch, and 85% function coverage floors while keeping risk-focused tests more important than a 100% headline.
- Separated unit, integration, contract, and E2E test entry points and documented where each class belongs.
- Added isolated Chromium journeys for login and recovery, concurrent plan-conflict resolution, signed Paddle entitlement and replay handling, and emailed account deletion.
- Added reproducible median/p95 evidence and conservative regression budgets for health, status, authenticated-plan, session lookup, plan lookup, and compare-and-swap operations.
- Expanded `npm run check` and GitHub Actions so architecture, types, lint, coverage, runtime QA, performance, and browser E2E all gate the release.

## v6.9.9 — 2026-09-06

Build 6.9.9 is a focused maintenance and security release with no major feature expansion.

- Split authentication, session, administrator, audit, and support responsibilities out of the HTTP composition root.
- Added correctness-focused ESLint, a single `npm run check` release gate, and informational test coverage reporting.
- Expanded trust-boundary tests for authentication, CSRF, administrator permissions, session revocation, storage parity, and Paddle webhook replay and mismatch cases.
- Documented the architecture and security-reporting process, tightened PWA maintenance checks, and removed speculative database indexes.
- Improved dialog keyboard behavior, accessible status announcements, actionable validation/conflict errors, and consistent `Saving…`, `Saved`, and `Couldn't save — Retry` states.
