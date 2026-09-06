# STRATA 7.2.0 — Connected training-system relaunch

This candidate updates the delivered 7.1.3 source. It has not been deployed and does not change production credentials, provider configuration, database schema, payment pricing, account authorization, or stored training records.

## Product direction

The public site now explains STRATA as one connected Rank → Plan → Train → Refine system. Rankings remain the free, evidence-informed entry point; the weekly planner remains usable without an account; Strata+ remains an optional 10-day no-card trial followed by a $5.99 USD one-time purchase with no subscription. Original layered artwork supports an explicitly labeled illustrative workspace while the existing athlete and editorial photography remain in place.

Pricing, support, public policies, and the founder section use the same visual language with less repetition. The facts behind FitScore, health limitations, trial behavior, payment handling, refunds, privacy, and support remain explicit.

## Training experience

Strata+ now opens with a live summary of the saved week and shows the active rules behind personal matches. A new decision board saves up to four real catalog exercise IDs in account-keyed browser storage, survives reloads where local storage is available, and hands the selection to the existing comparison view. It creates no new API or server record and is labeled as private to the device.

Weekly setup exposes live training days, recovery days, and session duration before generating anything, then summarizes movements and working sets in the preview. Plan collapses first-use guidance when it is not needed and derives one contextual next action from the current week. Train summarizes the selected day, highlights the next incomplete set, reports per-exercise progress, and remembers optional rest-timer preferences on the device. Existing account saves, atomic setup, conflict recovery, draft ownership, workout history, and entitlement enforcement are unchanged.

The Account page gives signed-in members a concise plan, access, and membership overview with a contextual route back into training. Install adds device navigation and plain-language assurances; Offline links only to explicitly cached public/planner routes; the manifest adds direct Strata+, Plan, Train, and Rankings shortcuts. A public generated JPEG is included in the static allowlist and normal HTTP caching, but stays out of the install precache so its lazy loading still avoids an eager download. Private HTML, APIs, account records, and bearer-link pages remain network-only.

## Compatibility and storage

There is no database migration. SQLite and Turso contracts, sessions, saved weekly/monthly plans, workout records, ratings, community plans, Paddle purchases, trials, Resend flows, and owner authorization are unchanged. The decision board and rest preferences are optional browser-local enhancements; a storage failure falls back to the current visit or the visible defaults without blocking core account saves. These records remain in that browser after sign-out or account deletion until the user clears the board or the site's browser data, as documented in the Privacy Policy.

## Deployment

1. Use Node 24 and the existing Turso, Paddle, and Resend configuration.
2. Run `npm ci`, `npm run check`, and `npm run qa:ui` using the isolated test configuration documented in `qa/README.md`.
3. Deploy the complete 7.2.0 server, HTML, styles, scripts, image, manifest, and service worker together so the new cache activates atomically.
4. Verify the public Rank → Plan → Train → Refine story, image delivery, no-card trial state, decision-board persistence/comparison, setup preview, plan readiness, workout next-set/rest controls, account overview, support form, offline behavior, focus states, reduced motion, and 320 px layouts.

## Rollback

No data rollback is required. If a presentation or browser regression requires rollback, deploy the complete 7.1.3 asset set and service worker together, confirm that its cache activates, and refresh open clients before editing plans or workouts. Browser-local 7.2.0 decision-board/rest-preference keys are harmless if an older build ignores them.

## Validation limits

Local and CI checks do not prove hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, production deployment health, third-party font/image availability, or the behavior of every physical PWA device. No production account, provider setting, payment, email, GitHub release, or deployment is changed by this source candidate.
