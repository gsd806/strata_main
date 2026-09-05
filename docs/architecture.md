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

The application is intentionally server-rendered and framework-light. Public HTML, CSS, JavaScript, icons, and the exercise catalog live under `public/`; server code and editorial discovery data live under `src/`. `src/server.js` serves only files in its literal static-file map, so placing a file somewhere under `public/` does not automatically make it reachable.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `server.js` | Stable process bootstrap used by npm and Render. |
| `src/server.js` | Composition root, request dispatch, public route aliases, provider orchestration, static serving, startup, and shutdown. It injects store/config/HTTP dependencies into the domain services. |
| `src/auth.js` | Login, signup, email verification, recovery, reset, deletion, cookie/session/CSRF helpers, native auth forms and JSON routes, account-action delivery, and auth-data cleanup. |
| `src/admin.js` | Primary-owner binding, admin identity and elevation, session rotation, permission gates, account actions, redacted admin payloads, and audit helpers/routes. |
| `src/support.js` | Public support validation and durable rate reservations, acknowledgment/notification delivery, admin support workflow and responses, safe payload shaping, and retention cleanup. |
| `src/database.js` | Local SQLite and remote Turso implementations of the same application store contract. |
| `src/store-contract.js` | Explicit method allowlist checked when either store is created; missing and extra methods fail fast. |
| `src/schema.js` | Shared schema and parameterized statements used to keep both adapters behaviorally aligned. |
| `src/http.js` | Security headers, JSON/redirect helpers, body limits and parsing, compression negotiation, and response semantics. |
| `src/email.js` | Browser-safe email configuration plus privately retained Resend credentials, HMAC digests, address masking, and transactional message delivery. |
| `src/payments.js` | Browser-safe Paddle configuration, privately retained server credentials, checkout creation/reconciliation, signature verification, catalog validation, and adjustment interpretation. |
| `src/plans.js` | Plan/preferences/community/monthly validation and sanitization shared by routes and storage. |
| `public/scripts/` | Progressive browser behavior. The pure discovery and monthly-plan cores are also exercised directly by Node tests. |
| `public/service-worker.js` | Explicit public precache, network-first navigation, public offline fallbacks, and versioned cache cleanup. |

Factories receive their dependencies explicitly instead of importing a global server object. That keeps authentication, administration, and support behavior testable at their boundaries and prevents the HTTP composition root from regaining all domain logic.

## Request flow

1. The Node server parses the URL and applies shared request constraints.
2. Authentication form routes and auth JSON routes are offered to the auth service.
3. Admin and support routes are offered to their services. Each service returns whether it handled the request.
4. Remaining application APIs, plans, discovery data, ratings, and payment routes are handled by the composition root and their focused helpers.
5. Static requests are resolved through the explicit URL-to-file map. Unknown paths receive a controlled `404`; user input is never joined directly to the filesystem.
6. Response helpers attach security and cache headers. Account and API responses use `no-store`; public versioned assets may use public caching.

Route ordering matters. A new sensitive route must be placed behind its session/origin/CSRF/elevation guard before any broad public or static handler.

## Trust boundaries

### Browser to server

Every request field is untrusted, including JSON, form values, headers, URL parameters, uploaded plan text, and Paddle values returned by browser code. The server validates sizes, shapes, identifiers, and state transitions. Client-side validation improves feedback but never authorizes an action.

Session tokens are random and stored only as hashes in the database. Cookies are HttpOnly, SameSite=Strict, scoped to `/`, and Secure in production. A session lookup also checks expiry, credential version, suspension, and required verification state. Password reset increments the credential version and revokes all sessions.

State-changing authenticated routes require the session's CSRF value and a trusted same-origin request. Public recovery endpoints use origin checks, generic responses where account enumeration is a concern, durable or in-memory quotas as appropriate, expiry, attempt caps, and one-time tokens.

### Administrator boundary

An email setting is only eligible to claim an empty administrator principal; the durable user ID becomes the authority. Admin reads require the owner session and most require recent password elevation. Mutations additionally require origin and CSRF validation, bounded typed confirmation, and a non-sensitive audit reason.

Elevation rotates the session rather than upgrading a token in place. The primary owner is protected from self-suspension/deletion controls. Admin payloads are allowlisted and must never include password material, raw tokens, verification codes, provider credentials, or full payment data.

### Public support boundary

Anonymous support is intentionally narrow. Input is length-limited and rejects secret- or payment-card-shaped content before persistence. Quotas are durably reserved so restarting the process does not reset abuse protection. Notification email contains a reference rather than copying the complete private message outside the help desk.

### Server to storage

The store contract is the only application-facing database API. Both adapters use parameterized statements and normalized row/result semantics. Multi-record security changes—such as password reset plus session revocation, owner actions plus audit records, and entitlement transitions—belong in guarded database transactions or batches.

The server treats database errors as unavailable state, not permission to continue with a partial mutation. Production never falls back from Turso to local storage.

### Server to Resend

Resend is trusted only to deliver a prepared message. API keys and the independent verification HMAC secret remain in a private configuration side channel and are not enumerable in browser-safe status objects. Verification codes and account-action tokens are stored as purpose-bound digests rather than recoverable plaintext.

Delivery success does not replace database state checks. Challenges and actions still enforce generation, expiry, attempt, one-time use, address binding, and durable state transitions.

### Server to Paddle

The Paddle client token may be sent to the browser; the API key and webhook secret may not. Checkout transactions are created on the server with fixed catalog/account metadata. A redirect or client callback is never proof of payment.

Webhook processing uses the exact raw request bytes for signature verification before JSON parsing. Entitlement is granted only when a locally pending transaction exists and the completed transaction matches its ID, user metadata, product, price, quantity, collection mode, and non-recurring shape. Stored event IDs make duplicate deliveries and replays idempotent. Ordered transaction updates avoid regressing completed state, while approved full refunds or chargebacks can revoke access through recorded adjustments.

## Database flow and parity

`createStore()` selects Turso when `TURSO_DATABASE_URL` is present. Without it, non-production environments use local SQLite; production throws instead of accepting durable-looking data on an ephemeral disk.

Both stores are constructed through `defineStore()`, which checks the complete method set in `src/store-contract.js`. `src/schema.js` centralizes schema and statement definitions. Adapter-specific code is limited to transport, row normalization, transaction mechanics, and affected/returned-row interpretation.

Parity tests should compare observable results rather than private implementation details. Important parity surfaces include:

- nulls, numeric fields, timestamps, and returned rows;
- unique and foreign-key behavior;
- compare-and-swap plan revisions;
- one-time verification and account-action claims;
- session and credential-version revocation;
- admin mutations with their audit record;
- checkout claims, ordered transaction state, webhook replay records, and adjustments; and
- cleanup and cascade behavior.

Add an index only for a demonstrated high-frequency lookup, join, ordering, or cleanup pattern. Keep its definition shared and cover it through behavior/query-plan evidence; speculative indexes slow writes and make adapter parity harder to maintain.

## Paddle lifecycle

1. An authenticated, CSRF-protected request claims one checkout creation for the account.
2. The server asks Paddle to create a one-time transaction using the configured price/product and account metadata.
3. The durable purchase record stores the provider transaction before the browser receives its checkout reference.
4. A signed `transaction.completed` webhook is matched and validated before entitlement is granted.
5. Duplicate webhook event IDs return an idempotent replay outcome.
6. Later ordered transaction events update pending state without overriding a terminal completion.
7. Applicable adjustment events are upserted and may revoke the corresponding entitlement.

Checkout recovery is bounded and validates every provider response, pagination link, and durable account reference. Account deletion reconciles or blocks unsettled checkout work so a late webhook cannot recreate access for a deleted user.

## Resend lifecycle

Signup creates a short-lived pending verification challenge, reserves a send slot, stores a purpose- and generation-bound digest, and then sends the code. The user row and normal session are created together only after the correct code is atomically claimed. Login verification follows the same challenge boundary for accounts that need it.

Password-reset and account-deletion links put the random bearer value in the URL fragment, keeping it out of ordinary server access logs and referrer paths. The browser posts it explicitly to a status or completion endpoint. Tokens expire, are purpose-bound, and are consumed once. Provider errors never silently turn an unverified or incomplete action into success.

## PWA architecture

The manifest supplies the full-scope install metadata, icons, theme, and shortcuts. `public/scripts/pwa.js` registers the worker with `updateViaCache: "none"` and owns the deferred browser install prompt.

The worker cache name includes the application build. Install precaches one literal allowlist; activate deletes older caches with the STRATA prefix while preserving unrelated origin caches, then claims clients. Successful same-origin GETs enter runtime caching only when their complete URL—including an expected build query—is in the public asset allowlist. Unexpected query variants cannot create unbounded cache entries.

Navigation is network-first. When offline, only designated public information/planner pages may use their matching cached HTML; all other navigation falls back to the generic offline page. Paddle transaction-return URLs never use cached pricing. API/auth/health paths, private HTML, cross-origin requests, non-GET requests, and unlisted assets are never intercepted.

Private server responses also carry `no-store`. The service-worker exclusion is one layer, not a substitute for correct HTTP caching headers.

## Quality and change discipline

`npm run check` is the default pre-commit command: release consistency, correctness-focused ESLint, the Node suite, and runtime QA. `npm run coverage` prints an informational application-code baseline without a percentage gate. Real-browser accessibility/layout checks remain available through `npm run qa:ui`.

When adding a module or route:

1. identify its trust boundary and authoritative state;
2. inject dependencies rather than reaching around the composition root;
3. update the explicit store/static/route contract when applicable;
4. test denied, expired, replayed, concurrent, and provider-failure paths;
5. verify SQLite/Turso observable parity;
6. confirm private responses and PWA exclusions; and
7. run `npm run check`, coverage, the UI audit when relevant, and the production dependency audit.
