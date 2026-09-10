# STRATA architecture

This document describes the current application boundaries and the invariants they are intended to preserve. It is an implementation map, not a promise that a provider or deployment is always available.

## System shape

```text
Browser / installed PWA
        |
        | same-origin HTTPS, cookies, CSRF-protected writes
        v
Node HTTP application
   |          |             |
   |          |             +--> Paddle API and signed webhooks
   |          +----------------> Resend transactional email
   +---------------------------> Store contract
                                      |          |
                                      v          v
                                local SQLite    Turso
```

The application is intentionally server-served and framework-light. Public HTML, CSS, JavaScript, icons, and the exercise catalog live under `public/`; server code and editorial discovery data live under `src/`. `src/server.js` serves only files in its literal static-file map, so placing a file somewhere under `public/` does not automatically make it reachable.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `server.js` | Stable process bootstrap used by npm and Render. |
| `src/server.js` | HTTP composition root, request dispatch, public route aliases, static serving, health endpoints, startup, and shutdown. |
| `src/service-composition.js` | Strictly checked composition function for auth, admin, and support factories and their narrow capabilities. |
| `src/auth.js` | Login, signup, email verification, recovery, reset, deletion, cookie/session/CSRF helpers, native auth forms and JSON routes, account-action delivery, account self-service composition, and auth-data cleanup. |
| `src/admin.js` | Primary-owner binding, admin identity and elevation, session rotation, permission gates, redacted admin payloads, audit helpers, and route composition. |
| `src/admin-user-actions.js` | Audited administrator account, complimentary-access, deletion, and payment-session actions. |
| `src/access-controls.js` | Complimentary-access state and duration validation shared by server and administration boundaries. |
| `src/access-controls-schema.js` | Administrator grant and checkout-hold schema, entitlement predicates, and guarded statements. |
| `src/access-controls-store.js` | Atomic audited SQLite and Turso mutations for complimentary access and checkout holds. |
| `src/support.js` | Public support validation and durable rate reservations, acknowledgment/notification delivery, admin support workflow and responses, safe payload shaping, and retention cleanup. |
| `src/account-self-service.js` | Authenticated active-session review/revocation and rate-limited full-account JSON export orchestration. |
| `src/account-export.js` | Allowlisted export serialization and bounded workout-history keyset streaming. |
| `src/account-self-service-store.js` | Local SQLite and Turso implementations of session management, owner-scoped export reads, and stable workout-history keyset pages. |
| `src/account-self-service-schema.js` | Owner-scoped session mutations and explicit export queries shared by both storage adapters. |
| `src/setup.js` | Authenticated weekly setup boundary that validates matching plan/preferences revisions and commits them atomically. |
| `src/training.js` | Authenticated Strata+ boundary for optional workout check-ins, deterministic next-session suggestions, 4–8 week training blocks, and explicitly approved plan adaptations. |
| `src/training-loop-schema.js` | Additive check-in, training-block, and adaptation schema and parameterized statements shared by both storage adapters. |
| `src/training-loop-store.js` | Focused local SQLite and Turso implementations of the training-loop methods, including atomic compare-and-swap adaptation acceptance. |
| `src/product-signals.js` | Anonymous allowlisted product-event intake, transient abuse limiting, UTC-day aggregation, retention, and elevated owner readout. |
| `src/product-signals-schema.js` | Isolated aggregate-count table and statements shared by the two storage adapters. |
| `src/database.js` | Local SQLite and remote Turso implementations of the same application store contract. |
| `src/store-contract.js` | Explicit method allowlist checked when either store is created; missing and extra methods fail fast. |
| `src/schema.js` | Shared schema and parameterized statements used to keep both adapters behaviorally aligned. |
| `src/migrations.js` | Ordered, idempotent SQLite and Turso migration ledger, including security, index, active-workout, and recurring-subscription migrations. |
| `src/http.js` | Security headers, JSON/redirect helpers, body limits and parsing, compression negotiation, and response semantics. |
| `src/observability.js` | Structured JSON request logs, validated or generated request IDs, bounded fields, and defensive redaction. |
| `src/email.js` | Browser-safe email configuration plus privately retained Resend credentials, HMAC digests, address masking, and transactional message delivery. |
| `src/billing.js` | Account trial, checkout, entitlement, subscription, portal, webhook, and reconciliation-service composition. |
| `src/checkout-reconciliation.js` | Validated unfinished-checkout closure, settlement recovery, and deletion-safety reconciliation. |
| `src/payments.js` | Browser-safe Paddle configuration, privately retained server credentials, and provider transaction orchestration. |
| `src/paddle-subscriptions.js` | Monthly transaction/subscription validation and short-lived customer-portal sessions. |
| `src/paddle-webhooks.js` | Raw-body signature verification plus optional Paddle webhook-address validation. |
| `src/billing-schema.js` | Recurring billing tables, entitlement predicates, queries, and statements shared by both storage adapters. |
| `src/billing-store.js` | Focused local SQLite and Turso billing methods, including checkout claims, subscriptions, events, adjustments, and entitlement parity. |
| `src/plans.js` | Plan/preferences/community/monthly validation and sanitization shared by routes and storage. |
| `public/scripts/` | Progressive browser behavior. Activation continuity, planner insights, weekly review, discovery, monthly-plan, workout, onboarding, and guest-preview cores are also exercised directly by Node tests. `product-signals.js` owns the reviewable local summary and credential-free aggregate-event transport. |
| `public/service-worker.js` | Explicit public precache, network-first navigation, a generic account-safe workout-continuation shell, public offline fallbacks, and versioned cache cleanup. |

Factories receive their dependencies explicitly instead of importing a global server object. That keeps authentication, account self-service, administration, support, and billing behavior testable at their boundaries and prevents the HTTP composition root from regaining all domain logic.

## Request flow

1. The Node server parses the URL and dispatches process liveness or storage readiness before application routes.
2. Within `/api/`, the Paddle webhook reaches its raw-body signature boundary first. Other state-changing API requests pass the global same-origin guard before a domain service is offered the request.
3. API services are offered requests in an explicit order: anonymous product signals, support, auth (including account self-service), admin, private training, workouts, atomic setup, then billing. Each service returns whether it handled the request and still applies its own authentication, CSRF, elevation, entitlement, and validation rules as required.
4. Remaining application APIs, plans, discovery data, and ratings are handled by the composition root and their focused helpers.
5. `/auth/` form submissions are delegated to the auth service. Static `GET` and `HEAD` requests are resolved through the explicit URL-to-file map. Unknown paths receive a controlled `404`; user input is never joined directly to the filesystem.
6. Response helpers attach security and cache headers. Account and API responses use `no-store`; public versioned assets may use public caching.

Route ordering matters. A new sensitive route must be placed behind its session/origin/CSRF/elevation guard before any broad public or static handler.

## Trust boundaries

### Browser to server

Every request field is untrusted, including JSON, form values, headers, URL parameters, uploaded plan text, and Paddle values returned by browser code. The server validates sizes, shapes, identifiers, and state transitions. Client-side validation improves feedback but never authorizes an action.

Session tokens are random and stored only as hashes in the database. Cookies are HttpOnly, SameSite=Strict, scoped to `/`, and Secure in production. A session lookup also checks expiry, credential version, suspension, and required verification state. Password reset increments the credential version and revokes all sessions.

State-changing authenticated routes require the session's CSRF value and a trusted same-origin request. Public recovery endpoints use origin checks, generic responses where account enumeration is a concern, durable or in-memory quotas as appropriate, expiry, attempt caps, and one-time tokens.

### Activation and device-state boundary

A guest can build a complete recommendation week before creating an account. That preview remains browser-local through signup, verification, and onboarding. The versioned handoff record contains only the validated profile and Plan copy on that device. After authentication, STRATA compares it with the current account Plan and revision and shows a claim/compare/keep decision; it does not silently replace either copy. A remembered decision is scoped to the authenticated user ID and both Plan fingerprints. The actual account write still uses the normal session, origin, CSRF, account-identity, and Plan compare-and-swap checks.

Browser-local state is not an authorization credential. Anybody with access to the same browser profile may be able to inspect device copies. Clearing site data, using a different browser profile, changing accounts, or encountering an incompatible record version can prevent a handoff even though another device copy may still exist. The activation record is versioned but is not an access token and does not use the workout trial or paid-access expiry boundary.

### Administrator boundary

An email setting is only eligible to claim an empty administrator principal; the durable user ID becomes the authority. Admin reads require the owner session and most require recent elevation. In production, elevation is a two-step password plus registered-email-code flow. The code is derived through the email-security secret, bound to the current session hash and challenge expiry, carried only in Resend mail, and accepted for no more than 10 minutes. Mutations additionally require origin and CSRF validation, bounded typed confirmation, and a non-sensitive audit reason.

Only successful code verification rotates the session and CSRF credential rather than upgrading a token in place. The challenge cookie is HttpOnly, SameSite Strict, scoped to the Admin API, Secure in production, and contains no plaintext code. The primary owner is protected from self-suspension/deletion controls. Admin payloads are allowlisted and must never include password material, raw tokens, verification codes, provider credentials, or full payment data.

The Admin browser clears its rendered private data and invalidates every in-flight private operation before a persisted BFCache page reload or an ordinary foreground recheck. It restores the dashboard only after `/api/me` still identifies the same durable administrator and `/api/admin/session` still confirms current elevation; delayed overview, account, support, audit, and mutation responses cannot repaint the locked view.

Direct administrator deletion is one explicitly confirmed operation. The server first pauses the non-owner target, revokes its sessions, prevents new trials, purchases, or checkout claims, then reconciles earlier Paddle checkout work and rejects active or uncertain recurring billing. A blocker leaves the account paused for an explicit retry or restore. The final parameterized delete rechecks the pause, primary-owner, purchase, and checkout-claim predicates, plus the acting owner's current session, auth version, and unexpired elevation, and records the successful audit event in the same SQLite transaction or Turso batch. It removes STRATA's account mapping—including explicit cleanup of administrator controls when a Turso connection cannot rely on foreign-key state—and may close a stale incomplete checkout during reconciliation; it never cancels a live Paddle subscription or issues a refund.

### Account self-service boundary

An authenticated member can list only their own non-expired sessions. The response exposes a one-way public session identifier, whether it is current, and creation/expiry times; raw token hashes, IP addresses, user agents, and device fingerprints never leave the server. Single-session and all-other-session revocation require trusted origin and CSRF checks. The current session is explicitly protected from the selective route, foreign or stale identifiers look absent, and the store mutation atomically rechecks ownership and current-session existence.

The Account browser likewise purges rendered identity, Plan, workout, session, and billing data before a persisted BFCache reload or foreground identity check. It reopens only for the same durable account ID, and export or Paddle-portal results receive a fresh same-account identity check before the browser consumes a download or temporary provider URL.

The account export is an authenticated, CSRF-protected, rate-limited `POST` returned as a versioned JSON attachment with private `no-store` headers. Its owner-scoped collections are read through the same adapter boundary, while workout history is serialized in stable `(started_at,id)` keyset pages so the server does not buffer an account's complete history or silently truncate it. It deliberately avoids holding a database transaction open for the duration of an HTTP download, so concurrent account changes can be reflected progressively rather than forming one point-in-time snapshot. The allowlist includes profile data, weekly and monthly plans, community-plan listings owned by the member, preferences, the member's ratings, workout records and summaries, check-ins, training blocks and adaptations, trial and safe billing state, and the member's support tickets. It excludes password hashes and salts, all session and CSRF material, verification, recovery, and deletion tokens, network or device fingerprints, Paddle customer identifiers and temporary checkout/webhook state, internal support/admin notes, administrator audit data, and aggregate product signals.

### Public support boundary

Anonymous support is intentionally narrow. Input is length-limited and rejects secret- or payment-card-shaped content before persistence. Quotas are durably reserved so restarting the process does not reset abuse protection. Notification email contains a reference rather than copying the complete private message outside the help desk.

### Anonymous product-signal boundary

Product measurement is optional and deliberately separate from account analytics. The browser accepts only named milestones from a fixed allowlist, keeps a user-reviewable local count summary, discards arbitrary event detail, honors Global Privacy Control and Do Not Track, and exposes disable and clear controls. Its aggregate POST uses `credentials: "omit"`, a same-origin URL, and a one-field JSON body. It never needs a session or CSRF token because it cannot mutate account state.

The server independently requires a trusted same-origin request, JSON content, exactly one allowlisted event name, and bounded network/global rates. It HMACs the request address with a process-random salt only to form an in-memory rate-limit key; neither the address nor hash reaches storage. The accepted event increments one row keyed by UTC day and event name. There are no raw event, visitor, account, session, URL, exercise, recommendation, plan, or workout rows. Counts expire after 90 days.

The read route uses the existing elevated-owner boundary. Its response labels browser-supplied product signals as aggregate action counts: repeated actions increment the count, unique people and connected journeys cannot be derived, and those numbers must not be represented as conversion rates. Separately, the owner overview derives aggregate milestones from existing account, workout, trial, purchase, and subscription rows. Five values count distinct accounts: first completed workout, second completed workout, completed workouts whose start times are at least seven days apart, trial start, and any validated completed Paddle payment record. The sixth counts subscriptions whose current provider period has advanced beyond one 32-day initial-window bound; it is not a distinct-account count or proof that a particular renewal charge succeeded. The overview exposes totals only—not account names or workout contents—and treats them as operational funnel evidence rather than proof of fitness outcomes. Deleting an account removes its underlying rows, so a later overview no longer includes it; the anonymous action-count table still has no account relationship.

### Private training-loop boundary

Workout check-ins, training blocks, calculated progression, and plan-adaptation proposals require an authenticated account with active Strata+ access. Every mutation also requires a trusted same-origin request, JSON content, the current session's CSRF token, a bounded request rate, and server-side input validation. Reads and writes are owner-scoped; a browser response is never accepted as evidence that another account owns a record.

A check-in contains only four explicit 1–5 answers: difficulty, energy, comfort, and enjoyment. STRATA does not infer pain, fatigue, recovery, readiness, technique, or injury risk. A first completed result establishes a baseline. An increase is suggested only after a later completed result matches or improves a comparable entry for the same exercise, measurement, load type, and unit and the member has submitted an acceptable check-in. Missing check-in data, low comfort or energy, maximum difficulty, or a result below the prior comparable target produces a repeat/hold suggestion.

Progression output is advisory and does not mutate a workout or plan. A low-comfort, low-energy, or maximum-difficulty check-in may create one account-private proposal to reduce a planned set. The proposal captures the source workout, check-in revision, and exact plan revision. Accepting it requires a second explicit action and atomically compares and updates the plan while resolving the proposal; dismissing it resolves the proposal without touching the plan. Changed check-ins, stale plans, resolved proposals, cross-account requests, and replays fail closed. Training-block writes similarly use an exact per-account revision.

Training Memory compares only the same exercise, measurement, load type, and unit and shows the exact prior comparable sets and date. Suggested targets are reviewable values, not automatic prescriptions. Notes, RIR/RPE, set edits, warm-up calculations, plate calculations, and superset labels are explicit workout data. An in-session exercise replacement first discloses its target, equipment, FitScore, and stability trade-off. “This workout only” changes the active workout; the Plan path creates a separate reviewed proposal bound to the current Plan revision.

An already-open workout can continue through a dedicated generic offline shell. The normal online workout page records an account ID, access boundary, draft key, and server revision in a bounded local context after access has been confirmed. The shell can read only that matching device draft. Trial authorization never extends beyond the server-issued trial expiry. Grandfathered lifetime access is limited to 24 hours before an online recheck; recurring paid access also requires a verified future current-period end and is bounded to the earliest of 24 hours, that period end, or a scheduled cancellation/pause effective time. Reconnection first requires the same signed-in account and active access, then fetches the latest server revision. A conflict is shown for review and never overwritten automatically. The shell does not make an offline draft authoritative and cannot start a new server workout, authenticate, buy access, or alter Plan while offline.

Training-block review derives its displayed week from the saved start date rather than trusting a manually advanced counter. Planned and completed workout/set counts, muscle coverage, improvements, records, skips, and replacements come only from the loaded Plan and saved workout evidence. When evidence is unavailable, the interface says so instead of inferring progress. Carry, lighter-week, and finish actions each require review and change only the training-block record; the weekly Plan stays unchanged.

### Server to storage

The store contract is the only application-facing database API. Both adapters use parameterized statements and normalized row/result semantics. Multi-record security changes—such as password reset plus session revocation, owner actions plus audit records, and entitlement transitions—belong in guarded database transactions or batches. An ordered migration ledger records each additive or reconciliatory step exactly once for both adapters; startup failure is safer than continuing against an unknown schema.

The server treats database errors as unavailable state, not permission to continue with a partial mutation. Production never falls back from Turso to local storage.

### Server to Resend

Resend is trusted only to deliver a prepared message. API keys and the independent verification HMAC secret remain in a private configuration side channel and are not enumerable in browser-safe status objects. Verification codes and account-action tokens are stored as purpose-bound digests rather than recoverable plaintext.

Delivery success does not replace database state checks. Challenges and actions still enforce generation, expiry, attempt, one-time use, address binding, and durable state transitions.

### Server to Paddle

The Paddle client token may be sent to the browser; the API key and webhook secret may not. Checkout transactions are created on the server for one configured $0.99 USD monthly price, quantity one, automatic collection, and fixed account metadata. A redirect or client callback is never proof of payment. A deployment must supply the recurring price ID explicitly; the retired one-time price is rejected and incomplete configuration keeps checkout disabled.

Webhook processing uses the exact raw request bytes for signature verification before JSON parsing. The completed initial transaction and subscription snapshot must agree with the locally pending transaction, account metadata, customer, product, price, quantity, automatic collection, and monthly billing cycle before paid access exists. Stored event IDs make duplicate deliveries and replays idempotent; event occurrence times reject stale subscription updates. `active`, `trialing`, and `past_due` subscriptions retain access only with a verified future current-period end; a missing or expired bound fails closed, while `paused` and `canceled` do not grant access. A scheduled cancellation or pause stops access at its effective time even if a delayed provider update still reports an otherwise eligible status. Approved full refunds or chargebacks can revoke the associated purchase through recorded adjustments.

The account can request an authenticated, CSRF-protected Paddle customer-portal session. Returned overview, payment-method, and cancellation URLs must belong to Paddle's customer-portal host and match the stored customer/subscription pair. These provider-issued URLs are temporary and are returned with `no-store`; STRATA never persists them.

## Database flow and parity

`createStore()` selects Turso when `TURSO_DATABASE_URL` is present. Without it, non-production environments use local SQLite; production throws instead of accepting durable-looking data on an ephemeral disk.

Both stores are constructed through `defineStore()`, which checks the complete method set in `src/store-contract.js`. `src/schema.js` and focused schema modules centralize statements; `src/migrations.js` orders schema evolution. Adapter-specific code is limited to transport, row normalization, transaction mechanics, and affected/returned-row interpretation.

Parity tests should compare observable results rather than private implementation details. Important parity surfaces include:

- nulls, numeric fields, timestamps, and returned rows;
- unique and foreign-key behavior;
- compare-and-swap plan revisions and atomic plan/preferences setup;
- owner-scoped check-ins and training blocks, exact block revisions, and atomic proposal/plan acceptance;
- one-time verification and account-action claims;
- session and credential-version revocation;
- selective and all-other session revocation plus owner-scoped export selection and stable workout keyset paging;
- admin mutations with their audit record;
- checkout claims, transaction-to-subscription linking, ordered subscription state, grandfathered lifetime access, webhook replay records, and adjustments; and
- cleanup and cascade behavior.

The training-loop and billing-subscription tables are additive. Their indexes match actual owner/workout, pending-proposal, and subscription-by-account reads. Account deletion removes user-owned check-ins, blocks, proposals, and local billing mappings in both adapters. The product-signal table is an intentional exception to user-owned application records: both adapters expose only daily increment, bounded-range count read, and retention delete operations. Its primary key is the actual lookup and update pattern; no speculative secondary index or raw-event table exists.

Add an index only for a demonstrated high-frequency lookup, join, ordering, or cleanup pattern. Keep its definition shared and cover it through behavior/query-plan evidence; speculative indexes slow writes and make adapter parity harder to maintain.

## Paddle lifecycle

1. An authenticated, CSRF-protected request claims one checkout creation for the account.
2. The server asks Paddle to create an automatically collected, quantity-one transaction for the explicitly configured monthly price/product and account metadata.
3. The durable purchase record stores the provider transaction before the browser receives its checkout reference.
4. A signed `transaction.completed` event or an authenticated Paddle recovery read records the completed initial payment and subscription/customer link, but paid access still requires validated signed subscription state.
5. Signed `subscription.created` and `subscription.updated` events validate ownership, customer, monthly billing cycle, catalog, occurrence order, and the current-period boundary. `active`, `trialing`, and `past_due` grant access only before that verified end; `paused` and `canceled` deny it.
6. A scheduled cancellation or pause leaves an otherwise eligible subscription usable only until its effective timestamp, and never beyond the current-period end. The Account page links to a short-lived Paddle portal for management.
7. Duplicate webhook event IDs return an idempotent replay outcome, and stale subscription events cannot regress newer state.
8. Later ordered transaction events update pending state without overriding a terminal completion. Applicable adjustment events are upserted and may revoke the corresponding purchase.

The separate STRATA trial is one server-bounded seven-day app trial per eligible account. It requires no payment method, ends automatically, and cannot convert into a subscription. A previously completed, unrevoked one-time lifetime purchase remains valid without requiring or fabricating a monthly subscription row.

Checkout recovery is bounded and validates every provider response, pagination link, and durable account reference. Account deletion reconciles or blocks unsettled checkout work so a late webhook cannot recreate access for a deleted user.

## Resend lifecycle

Signup creates a short-lived pending verification challenge, reserves a send slot, stores a purpose- and generation-bound digest, and then sends the code. The user row and normal session are created together only after the correct code is atomically claimed. Login verification follows the same challenge boundary for accounts that need it.

Password-reset and account-deletion links put the random bearer value in the URL fragment, keeping it out of ordinary server access logs and referrer paths. The browser posts it explicitly to a status or completion endpoint. Tokens expire, are purpose-bound, and are consumed once. Provider errors never silently turn an unverified or incomplete action into success.

## PWA architecture

The manifest supplies the full-scope install metadata, icons, theme, and shortcuts. `public/scripts/pwa.js` registers the worker with `updateViaCache: "none"` and owns the deferred browser install prompt.

The worker cache name includes the application build. Install precaches one literal allowlist; activate deletes older caches with the STRATA prefix while preserving unrelated origin caches, then claims clients. Successful same-origin GETs enter runtime caching only when their complete URL—including an expected build query—is in the public asset allowlist. Unexpected query variants cannot create unbounded cache entries. Self-hosted fonts and editorial photography are ordinary public assets; normal rendering does not call Google Fonts or Unsplash. The public product-signal script and styles may be cached like other versioned interface assets, while `/api/product-signals` remains network-only under the complete `/api/` exclusion.

Navigation is network-first. When offline, designated public information/planner pages may use their matching cached HTML and `/workout` may use the generic workout-continuation shell described above; all other navigation falls back to the generic offline page. Paddle transaction-return URLs never use cached pricing. API/auth/liveness/readiness paths—including every check-in, progression, block, adaptation, subscription, portal, and account endpoint—cross-origin requests, non-GET requests, and unlisted non-navigation assets bypass the worker. Same-origin private-page navigations may pass through that network-first handler, but the worker never caches personalized HTML or serves it from Cache Storage or as an offline account fallback; a network failure returns only a generic public fallback or the separately guarded workout shell.

Private server responses also carry `no-store`. The service-worker exclusion is one layer, not a substitute for correct HTTP caching headers.

## Quality and change discipline

`npm run check` is the default pre-commit command: release consistency, module-architecture constraints, static boundary typing, correctness-focused ESLint, the coverage-gated Node suite, runtime QA, reproducible performance checks, and the high-risk browser E2E journeys. `docs/testing.md` defines the unit, integration, contract, and E2E layers. `docs/performance.md` records what the local performance evidence can and cannot prove. The CI compatibility matrix adds Chromium, Firefox, WebKit, keyboard navigation, axe serious/critical rules, 200% text sizing, and narrow-to-wide reflow checks. Local Darwin runs default to Chromium and WebKit because Playwright Firefox cannot use its headless framebuffer in the Codex app sandbox; `STRATA_E2E_ENGINE=firefox npm run test:e2e` remains an explicit diagnostic. The broader authenticated layout audit remains available through `npm run qa:ui`.

When adding a module or route:

1. identify its trust boundary and authoritative state;
2. inject dependencies rather than reaching around the composition root;
3. update the explicit store/static/route contract when applicable;
4. test denied, expired, replayed, concurrent, and provider-failure paths;
5. verify SQLite/Turso observable parity;
6. confirm private responses and PWA exclusions; and
7. run `npm run check`, the broader UI audit when relevant, and the production dependency audit.
