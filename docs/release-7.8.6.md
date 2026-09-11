# STRATA 7.8.6 — Clear plans and protected comparisons

Build 7.8.6 refines two boundaries without redesigning the product: Plan starts quieter and gains a safe whole-week reset, while exercise comparison outside the private Strata+ workspace is available only after current Strata+ access is confirmed.

## What changed

- **Plan evidence starts closed.** The balance, duration, repeat, and copy-day evidence panel remains one click away but no longer opens over the editable week by default.
- **Strata+ guidance stays with Strata+.** The next-move / train-ready Plan card is omitted for guest and free accounts. Current Strata+ members retain its empty-week, recovery-conflict, and next-workout states.
- **Reset the editable week.** A visible Reset week action opens a native review dialog, reports the number of movements and recovery markers affected, and refuses a stale confirmation if the plan changed while the dialog was open.
- **Existing save safety is reused.** Confirmation replaces the editable plan with STRATA's canonical empty week, restores Sunday recovery and Monday as the add destination, then uses the normal autosave path. Account plans retain revision/account compare-and-swap and conflict recovery; guest plans retain exact local-copy comparison under the browser lock.
- **Other records remain.** Reset does not delete completed workouts, Training Memory, saved week templates, the 31-day plan, training blocks, or published community-plan copies.
- **Homepage comparison is Plus-only.** Row and detail comparison controls are omitted until `/api/me` confirms active Strata+ access. Access is refreshed at least every 30 seconds while the page remains active; controls and an open comparison fail closed during revalidation, logout, API uncertainty, or entitlement loss. Selections return only when the same account is reconfirmed as active and are cleared for every other outcome.
- **Open Plan tabs stay current.** Plus-only guidance fails closed during foreground checks, rechecks at known trial, grant, and subscription boundaries, and refreshes at least every 15 minutes for boundaryless access. Temporary network failures retry with bounded backoff without touching the editable week.
- **Safety comparisons remain free.** Plan activation and save-conflict comparisons still show both week copies when needed to prevent a silent overwrite. They are ownership recovery, not exercise or workout analysis.

## Architecture and security

No server route, database schema, provider call, secret, or entitlement rule changed. The homepage gate consumes the existing server-derived `user.discovery.active` value and fails closed unless account state is authenticated. Strata+ and Train remain protected by their existing server page and API access checks.

The Plan reset composes the existing `emptyPlan`, selected-day, draft, autosave, identity, and optimistic-revision boundaries. It cannot bypass unresolved Plan conflicts or an account change, and it does not write directly to storage.

The enforced browser graph remains at 67 unique modules with no new dependency edge or cycle. Home is 146 physical coordinator lines with focused logic (117), state (36), API (24), rendering (154), and events (63). Plan is 679 coordinator lines with logic (83), state (60), API (36), rendering (75), conflicts (106), templates (82), sharing (120), activation (96), and events (147), all within reviewed budgets.

## Verification

The versioned release candidate passes 759 Node tests and 51 browser tests with enforced coverage at 94.35% lines, 81.16% branches, and 89.93% functions. The focused pure-logic, VM runtime, and real Chromium checks cover guest, free, active, rechecking, revoked, stale, and unavailable comparison states; collapsed evidence; Reset cancel and focus; stale reset rejection; guest persistence; and account-bound save payloads. Full release-gate results are recorded in [release readiness](release-readiness.md).

## Deployment and rollback

Deploy the server and versioned public assets from the same commit so HTML, browser modules, and the service-worker cache advance together. No migration, secret, Paddle/Resend configuration, or catalog change is required.

Rollback is a redeploy of Build 7.8.5 and its matching assets. Plans written by 7.8.6 use the unchanged plan format and remain compatible. A reset already saved before rollback remains an intentionally empty editable week; unrelated workout, template, monthly-plan, and community records remain untouched.
