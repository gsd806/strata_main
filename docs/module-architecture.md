# Module architecture evidence

Build 7.8.1 keeps extraction as an enforceable boundary, not a file-count exercise. `npm run architecture:check` inventories both server JavaScript and the seven largest interactive browser surfaces. It reports physical lines, nonblank lines, bytes, reviewed line budgets, and every statically analyzable local dependency. It fails when a module exceeds its budget, gains an unapproved dependency, is omitted from the relevant policy, loads out of dependency order, references a missing local module, introduces a dependency cycle, or uses server module loading that cannot be audited.

The policies live in `architecture-policy.json` and `frontend-architecture-policy.json`; they should change only with an intentional architecture review. A larger line budget is not the default response to a failure: first decide whether the module has accumulated another responsibility.

## Dependency direction

```text
root bootstrap
    └── HTTP composition root
          ├── auth service ─────────────┬── account self-service ── account-export serializer
          │                             │     └── injected store/HTTP/session guards
          │                             ├── email boundary
          │                             └── plan domain
          ├── billing service ──────────┬── HTTP helpers
          │                             ├── plan-domain text bounds
          │                             ├── retired-checkout policy ─── Paddle transaction boundary
          │                             └── Paddle transaction boundary
          │                                   ├── subscription/portal validation
          │                                   └── signature/source validation
          ├── admin service ──────────── email boundary ── admin MFA delivery leaf
          ├── support/setup/training services
          ├── product-signal boundary
          ├── database adapter ─────────┬── account self-service store ── account query catalog
          │                             ├── billing store ─────────────── billing schema
          │                             ├── migration ledger ─────────── billing schema
          │                             ├── shared schema ─────────────── focused schema leaves
          │                             ├── training-loop store ───────── training-loop schema
          │                             └── store contract
          ├── structured observability
          └── static and HTTP helpers
```

The HTTP root supplies services and adapters through explicit factories. Domain services do not import the composition root or instantiate storage. The billing service points down to HTTP, provider, bounded text-validation, and a focused retired-checkout policy; the latter points only to the Paddle transaction boundary and cannot reach upward into billing. The database adapter delegates account, billing, and training-loop behavior to focused parity modules. Schema leaves have no upward dependencies.

## Current 7.8.1 server boundary

The 7.5.0 extraction remains intact: the current composition root is 784 physical lines after trial, checkout, webhook, entitlement, subscription, portal, and reconciliation policy moved into focused billing modules. Its explicit public-file allowlist grew with the new browser leaves but remains below its reviewed 800-line ceiling. The dual adapter is now 1,189 lines after adding atomic SQLite/Turso administrator-control cleanup, still below its reviewed 1,200-line ceiling; recurring billing, administrator controls, and account self-service storage remain in dedicated parity modules. `src/payments.js` owns provider transactions and points only to focused subscription/portal and webhook-trust leaves, while `src/legacy-checkout.js` isolates the exact Build 7.4 catalog exception and its atomic migration rules.

Account session/export work is not hidden inside the HTTP root: `src/auth.js` constructs a narrow injected account-self-service service, `src/account-export.js` owns bounded serialization and workout keyset streaming, and the database adapter delegates its queries and mutations to `src/account-self-service-store.js`. `src/migrations.js` owns ordered schema evolution instead of leaving version checks scattered across startup code. `src/observability.js` remains an independent transport-safe leaf.

The result is 39 inventoried server modules, zero dependency cycles, and zero policy violations. The new administrator MFA leaf owns session-bound code derivation and email delivery, while the Admin service retains authorization and elevation orchestration. Several files remain substantial—especially authentication, billing, the database adapter, and the composition root—but each has an explicit responsibility, allowed edge set, and reviewed ceiling.

The 7.7.0 account controls remain in focused grant state, schema, and storage modules. Administrator mutations and checkout reconciliation stay extracted into their own modules; Build 7.8.0 adds the separate MFA boundary without widening those responsibilities.

## Browser boundaries

Build 7.8.1 adds `session-selection-core.js` as a pure selection leaf before `discovery-core.js` on Strata+. It owns the four explicit selection modes and history evidence. The existing default session builder remains available to onboarding and other callers. Session form events stay in `discover-session.js`, and the existing module budgets are unchanged.

`frontend-architecture-policy.json` now enforces a one-way, page-local boundary for Home, Strata+, Plan, Train, Pricing, Account, and Admin. Each page must provide pure/domain logic, mutable state, same-origin API access, rendering, event binding, and exactly one final coordinator. Shared domain cores load first; state, API, rendering, and event leaves may depend only on modules loaded before them; the coordinator loads last. The report resolves both CommonJS imports and published `Strata*` globals, fails cycles and reversed edges, and verifies the actual HTML script order.

The extraction is deliberately incremental. It preserves the current HTML/CSS application and public URLs instead of replacing it with a framework rewrite. DOM-heavy coordinators still own page composition, account/revision checks, and orchestration; reusable calculations, transport, state construction, rendering helpers, and listener registration now have separately testable homes.

```text
shared domain logic
    → page logic
    → page state
    → same-origin API
    → rendering
    → event binding
    → page coordinator
```

The enforced load graph is page-specific rather than a license for leaves to call sideways into unrelated pages. Shared modules such as `discovery-core.js`, `activation-core.js`, and `workout-core.js` stay dependency-light and appear before each consumer.

### Browser size result

The largest coordinator reductions and their extracted leaves are:

| Page | Coordinator before → after | Extracted modules (physical lines) |
| --- | ---: | --- |
| Home | `app.js` 626 → 132 | logic 110; state 25; API 24; render 129; events 63 |
| Strata+ | `discover.js` 1,364 → 699 | state 52; API 45; navigation 98; progress logic 74; base render 36; catalog 86; detail 54; community 52; session 60; selection logic 158; sharing 31; events 64 |
| Plan | `planner.js` 1,233 → 638 | logic 82; state 35; API 36; render 66; conflicts 106; templates 82; sharing 120; activation 96; events 140 |
| Train | `workout.js` 784 → 420 | state 57; API 52; calendar logic 29; base render 61; guidance 107; history 110; events 96 |
| Pricing | `pricing.js` 414 → 213 | logic 56; state 17; API 30; render 109; events 22 |
| Account | `account.js` 835 → 271 | logic 238; state 31; API 68; render 186; events 44 |
| Admin | `admin.js` 848 → 244 | state 55; logic 97; API 47; render 190; session 54; events 55 |

These totals are not presented as deleted functionality: much of the former coordinator code moved into named leaves, and new user-facing behavior was added. The evidence of improvement is the enforced direction, independent tests, smaller orchestration roots, and zero-cycle report—not a lower aggregate line count. `node scripts/frontend-architecture-report.js` prints the exact live line/nonblank/byte table and every resolved dependency for all 69 policy entries covering 65 unique browser modules.

## Resulting module sizes

The command-generated table below is the Build 7.8.1 server snapshot. CI generates the same table on every architecture check, while the policy enforces budgets and edges against the live sources.

| Module | Responsibility | Lines | Nonblank | Size | Line budget | Local dependencies |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `server.js` | Process bootstrap | 4 | 3 | 113 B | 20 | `src/server.js` |
| `src/access-controls-schema.js` | Admin grant and checkout hold schema and authorization guards | 22 | 22 | 2.4 KiB | 55 | — |
| `src/access-controls-store.js` | Atomic audited account controls for SQLite and Turso | 34 | 34 | 2.2 KiB | 65 | `src/access-controls-schema.js` |
| `src/access-controls.js` | Complimentary access state and duration validation | 35 | 34 | 2.1 KiB | 65 | — |
| `src/account-export.js` | Bounded streaming account export serialization | 82 | 76 | 7.4 KiB | 120 | — |
| `src/account-self-service-schema.js` | Account self-service query catalog | 34 | 32 | 4.3 KiB | 55 | — |
| `src/account-self-service-store.js` | SQLite and Turso account self-service storage parity | 72 | 67 | 4.2 KiB | 95 | `src/account-self-service-schema.js` |
| `src/account-self-service.js` | Authenticated session inventory, revocation, and privacy-safe data export | 84 | 80 | 6.2 KiB | 150 | `src/account-export.js` |
| `src/admin-mfa.js` | Session-bound administrator email MFA challenge and delivery | 62 | 55 | 4.6 KiB | 100 | — |
| `src/admin-user-actions.js` | Audited administrator account and payment actions | 86 | 85 | 9.2 KiB | 160 | `src/access-controls.js`, `src/plans.js` |
| `src/admin.js` | Administrative authorization and actions | 276 | 257 | 18.4 KiB | 280 | `src/access-controls.js`, `src/admin-user-actions.js`, `src/email.js`, `src/plans.js` |
| `src/auth.js` | Authentication and account lifecycle | 812 | 769 | 53.4 KiB | 840 | `src/account-self-service.js`, `src/email.js`, `src/plans.js` |
| `src/billing-schema.js` | Commercial entitlement and recurring-subscription schema | 121 | 115 | 15.4 KiB | 140 | — |
| `src/billing-store.js` | SQLite and Turso commercial storage parity | 210 | 202 | 19.7 KiB | 240 | `src/access-controls-schema.js`, `src/billing-schema.js` |
| `src/billing.js` | Commercial entitlement, checkout, trial, webhook, and reconciliation service | 662 | 635 | 39.7 KiB | 720 | `src/access-controls.js`, `src/checkout-reconciliation.js`, `src/http.js`, `src/legacy-checkout.js`, `src/payments.js`, `src/plans.js` |
| `src/checkout-reconciliation.js` | Validated checkout closure and settlement reconciliation | 86 | 85 | 6.8 KiB | 130 | `src/legacy-checkout.js`, `src/payments.js`, `src/plans.js` |
| `src/database.js` | SQLite and Turso store adapters | 1189 | 1162 | 63.3 KiB | 1200 | `src/access-controls-store.js`, `src/account-self-service-store.js`, `src/billing-store.js`, `src/migrations.js`, `src/schema.js`, `src/store-contract.js`, `src/training-loop-store.js` |
| `src/email.js` | Resend integration and email security | 388 | 355 | 19.9 KiB | 400 | `src/admin-mfa.js` |
| `src/http.js` | HTTP transport helpers | 170 | 155 | 5.9 KiB | 180 | — |
| `src/legacy-checkout.js` | Strict retired-checkout migration and completion policy | 54 | 49 | 6.3 KiB | 75 | `src/payments.js` |
| `src/migrations.js` | Ordered, idempotent SQLite and Turso schema migration ledger | 133 | 120 | 7.0 KiB | 145 | `src/billing-schema.js` |
| `src/observability.js` | Structured request tracing and redacted operational logging | 81 | 72 | 4.0 KiB | 90 | — |
| `src/paddle-subscriptions.js` | Recurring subscription validation and temporary customer-portal links | 135 | 128 | 8.1 KiB | 165 | — |
| `src/paddle-webhooks.js` | Paddle signature and webhook source verification | 118 | 108 | 4.6 KiB | 150 | — |
| `src/payments.js` | Paddle integration boundary | 416 | 394 | 21.0 KiB | 430 | `src/paddle-subscriptions.js`, `src/paddle-webhooks.js` |
| `src/plans.js` | Plan domain validation | 355 | 321 | 18.5 KiB | 380 | — |
| `src/product-signals-schema.js` | Aggregate product-activity schema and statements | 23 | 20 | 1.4 KiB | 35 | — |
| `src/product-signals.js` | Consent-gated aggregate product-activity boundary | 135 | 122 | 5.5 KiB | 140 | — |
| `src/schema.js` | Shared storage schema and statements | 361 | 355 | 44.3 KiB | 390 | `src/access-controls-schema.js`, `src/account-self-service-schema.js`, `src/billing-schema.js`, `src/product-signals-schema.js`, `src/training-loop-schema.js` |
| `src/server.js` | HTTP composition root | 784 | 759 | 41.2 KiB | 800 | `src/access-controls.js`, `src/admin.js`, `src/auth.js`, `src/billing.js`, `src/database.js`, `src/email.js`, `src/http.js`, `src/observability.js`, `src/payments.js`, `src/plans.js`, `src/product-signals.js`, `src/service-composition.js`, `src/setup.js`, `src/static-assets.js`, `src/support.js`, `src/training.js`, `src/workouts.js` |
| `src/service-composition.js` | Typed auth/admin/support composition | 40 | 38 | 1.8 KiB | 60 | — |
| `src/setup.js` | Atomic weekly-plan and preference setup | 84 | 77 | 4.9 KiB | 105 | `src/plans.js` |
| `src/static-assets.js` | Bounded public asset representations | 46 | 41 | 1.9 KiB | 65 | `src/http.js` |
| `src/store-contract.js` | Storage boundary contract | 168 | 165 | 4.4 KiB | 175 | — |
| `src/support.js` | Public and administrative support workflow | 137 | 129 | 10.0 KiB | 160 | `src/email.js`, `src/plans.js` |
| `src/training-loop-schema.js` | Check-in, training-block, and adaptation storage schema | 57 | 54 | 6.4 KiB | 70 | — |
| `src/training-loop-store.js` | SQLite and Turso training-loop adapter parity | 136 | 133 | 7.1 KiB | 140 | `src/training-loop-schema.js` |
| `src/training.js` | Check-ins, deterministic progression, blocks, and approved adaptations | 448 | 433 | 29.8 KiB | 450 | `src/plans.js`, `src/workouts.js` |
| `src/workouts.js` | Workout validation, history summaries, and authenticated lifecycle | 214 | 208 | 14.3 KiB | 230 | `src/plans.js` |

Snapshot result: 39 server modules, zero dependency cycles, and zero policy violations. The separate browser report covers seven page boundaries, 69 policy entries, and 65 unique browser modules with zero cycles and zero violations.

## Static boundary types

`tsconfig.boundaries.json` runs TypeScript in strict `allowJs` plus `checkJs` mode with no output. The enforced slice covers HTTP transport, Paddle transaction/subscription/webhook validation, billing policy, account self-service and its two store implementations, store registration, setup, product signals, the training loop, workouts, and the production service composition. Shared declarations in `src/domain-types.d.ts`, `src/plans.d.ts`, and `src/workouts.d.ts` keep untrusted payloads unknown until validation narrows them and keep injected capabilities smaller than the full application store.

This is an incremental boundary strategy rather than a cosmetic file-extension migration. It does not claim that every browser DOM controller or every legacy service implementation is fully typed. Runtime guards, focused tests, and the architecture edge policy remain necessary alongside static checking.

## Interpreting the result

Line counts are a maintenance signal, not a quality score. They matter here because they are paired with dependency direction and a cycle gate: a small cyclic module or a thin pass-through split would not be an improvement. Future additions to authentication, billing, the dual adapter, or the composition root should first ask whether the responsibility belongs in an existing leaf or a new independently testable boundary rather than automatically increasing a ceiling.
