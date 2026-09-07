# STRATA 7.5.0 — Training Memory and operational trust

Build 7.5.0 turns the guided training loop into a clearer record of what a member planned, did, learned, and deliberately changed. It also changes new Strata+ sales to a $0.99 USD monthly subscription, replaces the former multi-day trial with one free 30-minute app trial, and strengthens the deployment and browser-compatibility boundaries around that product change.

This guide describes the source and its safe promotion path. It does not claim that production was deployed or that live Turso, Resend, or Paddle credentials were exercised. Current automated results and remaining limits belong in [release readiness](release-readiness.md).

## Product changes

### Activation continuity

The homepage can generate and display a complete seven-day week before login. Its validated profile and Plan stay on that browser while the visitor creates an account, verifies email, or moves through onboarding. Authentication alone performs no Plan write. After sign-in, the planner compares the device week with the current account Plan and requires an explicit choice to inspect and claim the device copy or keep the account copy. A claim still carries the current account identity and Plan revision through the normal CSRF-protected compare-and-swap endpoint, so a newer write in another tab or device wins safely instead of being overwritten.

### Training Memory

The workout logger now searches saved history in bounded pages and shows the exact last comparable sets and date for the same exercise, measurement, load type, and unit. A member can review and apply those values as today's target, then add, duplicate, or remove sets; record private notes and optional RIR or RPE; calculate warm-up sets and per-side plates; and label deliberate superset groups. Suggestions remain separate from actual logged work and do not guess a load when no comparable evidence exists.

Exercise replacement is explicit. The dialog shows target, equipment, FitScore, and stability trade-offs. One action changes only the active workout. A separate action prepares a reviewed Plan proposal tied to the current saved Plan revision. Neither path silently rewrites the weekly Plan.

### Offline continuation

An already-open, online-authorized workout can continue in the installable app's generic offline shell. The shell itself is public and contains no cached account response. It can open only the matching account-scoped device draft and only within its saved authorization boundary. A trial cannot outlive its exact server expiry; grandfathered lifetime access lasts offline for at most 24 hours; and recurring paid access also requires a verified future period and stops at the earliest of 24 hours, that period end, or a scheduled cancellation/pause effective time. Offline changes stay `Sync pending`. Reconnection verifies the same account, current Strata+ access, and the latest server revision before returning to the normal sync path. A conflict is presented for review and never overwritten automatically.

The service worker still bypasses every API, auth, liveness/readiness, cross-origin, non-GET, and unlisted non-navigation request. Private-page navigations remain network-first and may receive only a generic public fallback when the network is unavailable; the worker never caches personalized HTML or serves it from Cache Storage or as offline account content. It does not put the workout draft, account payload, session, subscription state, or private HTML in Cache Storage.

### Planner and training blocks

Plan now explains observable balance across muscles, movement patterns, and equipment, shows bounded alerts, and offers one next action. Copy-day changes have a review step that distinguishes merge from replace, previews destination counts, creates fresh exercise instance identities, requires confirmation, and refuses a stale account Plan revision.

Training-block review derives the week from the saved start date. It compares planned and completed workouts and sets, shows muscle coverage, and reports only records, repeat improvements, explicit skips, or replacements supported by loaded saved workouts. The review gives one next decision and makes carry, lighter-week, and finish actions explicit; those actions change the block record, not the weekly Plan.

### Account control and export

Account now lists each active session using only an opaque public identifier, current-session label, and creation/expiry times. A member can sign out one other session or all other sessions; selective revocation protects the current session and atomically rechecks account ownership. Raw token hashes, IP addresses, user agents, and device fingerprints are never exposed.

The member can also download a versioned JSON export of their profile, weekly and monthly plans, any community-plan listing they own, preferences, ratings, workouts and summaries, check-ins, training blocks and adaptations, trial and safe billing state, and support tickets. The authenticated endpoint requires CSRF, is rate-limited, and uses private `no-store` attachment headers. Workout history is streamed in stable keyset pages without buffering the entire collection or silently truncating it. The export avoids a long-lived database transaction while the client downloads, so concurrent account changes can be reflected progressively rather than as one point-in-time snapshot. It deliberately excludes password material, session, CSRF, and one-time tokens, IP and device fingerprints, Paddle customer IDs and temporary checkout/webhook data, internal administrator/support notes, audit records, and aggregate product signals.

## Strata+ commercial contract

- New paid access is **$0.99 USD per month**, quantity one, automatically collected through Paddle.
- Each eligible account may start **one free 30-minute app trial**. It needs no card, ends automatically, cannot be restarted, and never converts into a subscription.
- Subscribing always requires a separate deliberate checkout.
- Qualifying completed, unrevoked purchases from the earlier one-time offer remain grandfathered lifetime access with no monthly renewal.
- Cancellation, refund, and account deletion are different actions. A scheduled cancellation normally keeps access until its verified effective time, never beyond the current-period end; a refund may revoke its linked entitlement, and deleting STRATA data does not itself stop Paddle renewal or create a refund.

Checkout fails closed until the deployment supplies a new recurring `PADDLE_PRICE_ID`. Build 7.5.0 does not invent or embed that catalog ID, and it rejects the retired one-time price. The configured product, price, USD amount, monthly cycle, client token, API key, webhook secret, and Paddle environment must be mutually consistent before `PADDLE_CHECKOUT_ENABLED=true` can make checkout available.

The server creates the initial transaction with stable account and checkout metadata. Signed events and authenticated transaction reconciliation are matched against the locally recorded transaction, account, customer, subscription, product, price, quantity, collection mode, and monthly billing cycle. A completed transaction alone is not durable monthly entitlement: validated signed subscription state must also be `active`, `trialing`, or `past_due` with a verified future current-period end. Missing or expired bounds, `paused`, and `canceled` states deny paid access. A scheduled cancellation or pause stops access at its effective timestamp, never after the current-period end. Duplicate event IDs are idempotent, stale occurrence times cannot regress newer subscription state, and approved full adjustments can revoke access.

Equal-timestamp provider updates may make state stricter but cannot replace a stricter state with a more permissive one. Adjustment identifiers stay bound to their original transaction, and a mismatched adjustment is rejected before any entitlement change. The Account summary and administrator totals apply the same time-bounded entitlement rule, including current-period and scheduled-action cutoffs, so expired cached state is not presented as active.

Account billing actions create a fresh Paddle customer-portal session. Overview, payment-method, and cancellation URLs are restricted to Paddle's portal host, returned with `no-store`, and never written to the database.

## Architecture and operations

Commercial policy moved out of the HTTP composition root into `src/billing.js`, with provider transaction work in `src/payments.js`, monthly validation and portal sessions in `src/paddle-subscriptions.js`, raw webhook trust in `src/paddle-webhooks.js`, and shared SQL plus adapter methods in `src/billing-schema.js` and `src/billing-store.js`. Account session controls and export use their own service, keyset-stream serializer, store-adapter, and schema modules. The HTTP composition root is 732 physical lines, down from 1,185, and the dual database adapter is 1,135, down from 1,315. The enforced [module report](module-architecture.md) inventories 32 modules with zero cycles and zero policy violations and remains the authority for exact sizes and edges.

SQLite and Turso now share an ordered migration ledger. Migration `004-monthly-subscriptions` adds the nullable purchase-to-subscription link, the lean subscription-state table, and the account lookup index while preserving legacy lifetime rows. Adapter-parity tests cover the observable subscription and migration behavior rather than treating the Turso transport fixture as a hosted-service test.

Every request receives a validated incoming or generated `X-Request-ID`. Production request logs are structured JSON and contain the path without query data, response status, duration, and completion state. Sensitive field names are redacted, request bodies are omitted, and test logging is quiet. Redaction also removes credentials, bearer values, codes, and email addresses when they appear inside otherwise ordinary text. Production preflight calls the same email and Paddle configuration validators used by the running service, so deployment checks do not drift into a second, weaker interpretation.

Operational checks are now distinct:

- `/livez` confirms only that the process can answer;
- `/readyz` probes storage before reporting ready;
- `/healthz` remains a compatibility alias for readiness; and
- `/api/status` exposes the public build and provider-readiness booleans without secrets.

`npm run preflight:production` validates the intended production environment before deployment. `npm run smoke:deploy` performs a read-only post-deploy check of build/provider flags, durable-storage reporting, readiness, the public home and manifest, security headers, and signed-out private-route behavior. Neither command proves that provider credentials work; authorized hosted Turso, Resend-delivery, Paddle transaction/subscription/webhook/portal, and backup/restore smoke remain separate release-owner responsibilities.

The interface fonts and two homepage photographs are now served from the STRATA origin. Their copyright, license, and attribution record is in [third-party-assets.md](third-party-assets.md). The normal page load no longer sends font or image requests to Google Fonts or Unsplash.

## Deployment sequence

1. Back up the production Turso database and verify that the backup can be restored to an isolated database.
2. In Paddle, create or verify the real $0.99 USD monthly recurring price under the intended product. Keep the retired one-time price separate.
3. Set the new recurring `PADDLE_PRICE_ID` and matching live credentials in the deployment environment. Keep checkout disabled while configuration or provider verification is incomplete.
4. Run `npm ci`, install Chromium, Firefox, and WebKit, then run `npm run check`, `npm audit --omit=dev`, and the production preflight against the intended launch environment.
5. Deploy the complete application and asset set together. Confirm the migration ledger through normal startup, then check status, liveness, readiness, cache headers, and installed-PWA update behavior.
6. Run the read-only deployment smoke with `STRATA_SMOKE_BASE_URL` and `STRATA_EXPECTED_BUILD=7.5.0`.
7. In an authorized non-production or controlled live account, verify Resend delivery and the complete Paddle transaction → subscription → entitlement sequence, portal creation, scheduled cancellation, eventual canceled denial, duplicate delivery, and the intended adjustment/refund behavior.
8. Verify an existing qualifying lifetime account remains active without a subscription row and a new account receives only one 30-minute no-card trial.
9. Enable checkout only after the catalog, webhook destination, event subscriptions, provider credentials, and account-bound result all agree. Keep the launch switch available for immediate containment of new checkout problems.
10. Confirm GitHub Actions and post-deploy observation are green before announcing the release.

## Rollback

The schema addition is non-destructive, but a blind application rollback is not safe after the first monthly transaction is recorded. Build 7.4.1 understood any completed, unrevoked purchase as lifetime access and does not understand the new subscription-state requirement. Running it against a database containing monthly purchases could over-grant access after cancellation.

If a problem appears before any monthly checkout was enabled or recorded, disable checkout and roll the complete application/assets back only after confirming the database contains no new monthly purchase or subscription state. Once monthly billing data exists, prefer keeping 7.5.0 running with checkout disabled and shipping a forward fix. Restoring a pre-7.5 backup or transforming billing rows can lose or alter real account/payment state and requires an explicit, reviewed incident plan plus provider reconciliation; do not improvise it during rollback.

Browser-local activation and offline-workout data are versioned and fail closed when a compatible reader or matching account/access context is unavailable. Rolling back the public assets removes the new UI but must not be used to reinterpret or erase server billing state.

## Validation limits

Automated tests use isolated SQLite databases, a Turso-compatible transport fixture, and local provider fakes. This Darwin run exercised Chromium plus the focused WebKit accessibility, keyboard, planner, and 200% text matrix. Firefox remains configured and required in Node 24 Linux CI but was not exercised locally because its headless compositor cannot run in the current macOS app sandbox. Browser automation does not replace physical-device, localization, assistive-technology, slow-network, or installed-PWA review. Local performance budgets detect regressions in selected endpoint and SQLite operations; they are not hosted Turso latency, provider latency, production capacity, or service-level objectives.

No credential, provider catalog, webhook destination, production database, DNS record, deployment, subscription, refund, or customer portal is changed merely by this source release.
