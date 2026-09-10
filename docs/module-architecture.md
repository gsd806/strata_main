# Module architecture evidence

Build 7.7.1 keeps extraction as an enforceable boundary, not a file-count exercise. `npm run architecture:check` recursively inventories server JavaScript and reports physical lines, nonblank lines, bytes, reviewed line budgets, and every statically analyzable local dependency. It fails when a module exceeds its budget, gains an unapproved dependency, is omitted from the policy, references a missing local module, introduces a dependency cycle, or uses module loading that cannot be audited.

The policy lives in `architecture-policy.json`; it should change only with an intentional architecture review. A larger line budget is not the default response to a failure: first decide whether the module has accumulated another responsibility.

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
          ├── admin/support/setup/training services
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

## Current 7.7.1 boundary

The 7.5.0 extraction remains intact: the current composition root is 735 physical lines after trial, checkout, webhook, entitlement, subscription, portal, and reconciliation policy moved into focused billing modules. The dual adapter is now 1,189 lines after adding atomic SQLite/Turso administrator-control cleanup, still below its reviewed 1,200-line ceiling; recurring billing, administrator controls, and account self-service storage remain in dedicated parity modules. `src/payments.js` owns provider transactions and points only to focused subscription/portal and webhook-trust leaves, while `src/legacy-checkout.js` isolates the exact Build 7.4 catalog exception and its atomic migration rules.

Account session/export work is not hidden inside the HTTP root: `src/auth.js` constructs a narrow injected account-self-service service, `src/account-export.js` owns bounded serialization and workout keyset streaming, and the database adapter delegates its queries and mutations to `src/account-self-service-store.js`. `src/migrations.js` owns ordered schema evolution instead of leaving version checks scattered across startup code. `src/observability.js` remains an independent transport-safe leaf.

The result is 38 inventoried modules, zero dependency cycles, and zero policy violations. Several files remain substantial—especially authentication, billing, the database adapter, and the composition root—but each has an explicit responsibility, allowed edge set, and reviewed ceiling.

The 7.7.0 account controls live in focused grant state, schema, and storage modules. Administrator mutations and checkout reconciliation are extracted into their own modules so existing administrator and billing size ceilings remain unchanged.

## Browser boundaries

The server inventory deliberately covers the process bootstrap and `src/**/*.js`; it does not misrepresent browser entry scripts as server modules. Browser boundaries are tested separately:

- `activation-core.js` validates and fingerprints the browser-local preview, scopes remembered decisions to the account and both Plan copies, and keeps claim/compare/keep separate from the server write.
- `plan-insights-core.js` derives explainable muscle, pattern, and equipment signals and creates reviewable copy-day merge/replace proposals without mutating its input.
- `workout-core.js` owns Training Memory comparisons, target application, set operations, warm-up and plate calculations, superset data, and workout/Plan swap proposals.
- `training-block-core.js` derives block week, planned/completed evidence, records/improvements/skips/replacements, and explicit block-only actions.
- `workout-offline.js` is a public-shell controller that accepts only a matching unexpired account-scoped device context and returns to the online revision check for sync.
- DOM entry scripts keep account identity, CSRF, revision, focus, save-state, and no-silent-write decisions visible at the user boundary.

## Resulting module sizes

The command-generated table below is the Build 7.7.1 snapshot. CI generates the same table on every architecture check, while the policy enforces budgets and edges against the live sources.

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
| `src/admin-user-actions.js` | Audited administrator account and payment actions | 86 | 85 | 9.2 KiB | 160 | `src/access-controls.js`, `src/plans.js` |
| `src/admin.js` | Administrative authorization and actions | 222 | 207 | 13.8 KiB | 280 | `src/access-controls.js`, `src/admin-user-actions.js`, `src/plans.js` |
| `src/auth.js` | Authentication and account lifecycle | 812 | 769 | 53.4 KiB | 840 | `src/account-self-service.js`, `src/email.js`, `src/plans.js` |
| `src/billing-schema.js` | Commercial entitlement and recurring-subscription schema | 121 | 115 | 15.4 KiB | 140 | — |
| `src/billing-store.js` | SQLite and Turso commercial storage parity | 210 | 202 | 19.7 KiB | 240 | `src/access-controls-schema.js`, `src/billing-schema.js` |
| `src/billing.js` | Commercial entitlement, checkout, trial, webhook, and reconciliation service | 662 | 635 | 39.7 KiB | 720 | `src/access-controls.js`, `src/checkout-reconciliation.js`, `src/http.js`, `src/legacy-checkout.js`, `src/payments.js`, `src/plans.js` |
| `src/checkout-reconciliation.js` | Validated checkout closure and settlement reconciliation | 86 | 85 | 6.8 KiB | 130 | `src/legacy-checkout.js`, `src/payments.js`, `src/plans.js` |
| `src/database.js` | SQLite and Turso store adapters | 1189 | 1162 | 63.3 KiB | 1200 | `src/access-controls-store.js`, `src/account-self-service-store.js`, `src/billing-store.js`, `src/migrations.js`, `src/schema.js`, `src/store-contract.js`, `src/training-loop-store.js` |
| `src/email.js` | Resend integration and email security | 387 | 354 | 19.9 KiB | 400 | — |
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
| `src/schema.js` | Shared storage schema and statements | 359 | 353 | 43.3 KiB | 390 | `src/access-controls-schema.js`, `src/account-self-service-schema.js`, `src/billing-schema.js`, `src/product-signals-schema.js`, `src/training-loop-schema.js` |
| `src/server.js` | HTTP composition root | 735 | 710 | 38.7 KiB | 800 | `src/access-controls.js`, `src/admin.js`, `src/auth.js`, `src/billing.js`, `src/database.js`, `src/email.js`, `src/http.js`, `src/observability.js`, `src/payments.js`, `src/plans.js`, `src/product-signals.js`, `src/service-composition.js`, `src/setup.js`, `src/static-assets.js`, `src/support.js`, `src/training.js`, `src/workouts.js` |
| `src/service-composition.js` | Typed auth/admin/support composition | 40 | 38 | 1.8 KiB | 60 | — |
| `src/setup.js` | Atomic weekly-plan and preference setup | 84 | 77 | 4.9 KiB | 105 | `src/plans.js` |
| `src/static-assets.js` | Bounded public asset representations | 46 | 41 | 1.9 KiB | 65 | `src/http.js` |
| `src/store-contract.js` | Storage boundary contract | 168 | 165 | 4.4 KiB | 175 | — |
| `src/support.js` | Public and administrative support workflow | 137 | 129 | 10.0 KiB | 160 | `src/email.js`, `src/plans.js` |
| `src/training-loop-schema.js` | Check-in, training-block, and adaptation storage schema | 57 | 54 | 6.4 KiB | 70 | — |
| `src/training-loop-store.js` | SQLite and Turso training-loop adapter parity | 136 | 133 | 7.1 KiB | 140 | `src/training-loop-schema.js` |
| `src/training.js` | Check-ins, deterministic progression, blocks, and approved adaptations | 448 | 433 | 29.8 KiB | 450 | `src/plans.js`, `src/workouts.js` |
| `src/workouts.js` | Workout validation, history summaries, and authenticated lifecycle | 214 | 208 | 14.3 KiB | 230 | `src/plans.js` |

Snapshot result: 38 modules, zero dependency cycles, and zero policy violations.

## Static boundary types

`tsconfig.boundaries.json` runs TypeScript in strict `allowJs` plus `checkJs` mode with no output. The enforced slice covers HTTP transport, Paddle transaction/subscription/webhook validation, billing policy, account self-service and its two store implementations, store registration, setup, product signals, the training loop, workouts, and the production service composition. Shared declarations in `src/domain-types.d.ts`, `src/plans.d.ts`, and `src/workouts.d.ts` keep untrusted payloads unknown until validation narrows them and keep injected capabilities smaller than the full application store.

This is an incremental boundary strategy rather than a cosmetic file-extension migration. It does not claim that every browser DOM controller or every legacy service implementation is fully typed. Runtime guards, focused tests, and the architecture edge policy remain necessary alongside static checking.

## Interpreting the result

Line counts are a maintenance signal, not a quality score. They matter here because they are paired with dependency direction and a cycle gate: a small cyclic module or a thin pass-through split would not be an improvement. Future additions to authentication, billing, the dual adapter, or the composition root should first ask whether the responsibility belongs in an existing leaf or a new independently testable boundary rather than automatically increasing a ceiling.
