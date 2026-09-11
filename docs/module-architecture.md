# Module architecture evidence

Build 7.10.0 keeps extraction as an enforceable boundary, not a file-count exercise. `npm run architecture:check` inventories both server JavaScript and the seven largest interactive browser surfaces. It reports physical lines, nonblank lines, bytes, reviewed line budgets, and every statically analyzable local dependency. It fails when a module exceeds its budget, gains an unapproved dependency, is omitted from the relevant policy, loads out of dependency order, references a missing local module, introduces a dependency cycle, or uses server module loading that cannot be audited.

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
          ├── admin service ──────────── administrator user-action boundary ── access-control rules
          ├── support/setup/training services
          ├── coaching service ─────────┬── coaching core ───────────┬── energy-planning core ── plan catalog
          │                             │                            ├── meal-planning core
          │                             │                            └── plan catalog
          │                             └── meal-planning core (shared downward leaf)
          ├── product-signal boundary
          ├── database adapter ─────────┬── account self-service store ── account query catalog
          │                             ├── billing store ─────────────── billing schema
          │                             ├── coaching store ───────────── coaching schema
          │                             ├── migration ledger ─────────── billing schema
          │                             ├── shared schema ─────────────── focused schema leaves
          │                             ├── training-loop store ───────── training-loop schema
          │                             └── store contract
          ├── structured observability
          └── static and HTTP helpers
```

The HTTP root supplies services and adapters through explicit factories. Domain services do not import the composition root or instantiate storage. The billing service points down to HTTP, provider, bounded text-validation, and a focused retired-checkout policy; the latter points only to the Paddle transaction boundary and cannot reach upward into billing. The coaching service points down to the pure coaching and meal-planning cores. The coaching core composes training, meals, and energy results; it may read the canonical Plan exercise catalog and point down to the energy-planning and meal-planning cores, but none of those cores can reach storage or HTTP. The energy-planning core owns the semantic profile-version dispatch: version 1 and version 2 retain the exact legacy resting-energy × activity calculation with no trend adjustment, while version 3 opts into adult EER estimation and bounded trend calibration. It depends only on the Plan date catalog. The meal-planning core remains a leaf with no local dependencies. The database adapter delegates account, billing, coaching, and training-loop behavior to focused parity modules. Schema leaves have no upward dependencies.

## Current server boundary

The 7.5.0 extraction remains intact: trial, checkout, webhook, entitlement, subscription, portal, and reconciliation policy remain in focused billing modules. Build 7.8.7 composes coaching through one injected service and adds its three browser files to the literal public-file allowlist. Build 7.9.0 added the meal-planning core and two browser leaves. Build 7.10.0 extracts energy estimation and calibration from coaching into `src/energy-planning-core.js` while keeping `src/server.js` at 796 physical lines, below its reviewed 800-line ceiling. The dual adapter remains 1,198 lines because calibration reuses the existing coaching storage boundary. Build 7.8.8 keeps provider transaction orchestration in `src/payments.js` and points it down to `src/paddle-catalog.js` for deployment catalog, credential, legacy-price, and exact checkout-price policy, plus focused subscription/portal and webhook-trust leaves. `src/legacy-checkout.js` isolates the exact Build 7.4 catalog exception and its atomic migration rules.

Account session/export work is not hidden inside the HTTP root: `src/auth.js` constructs a narrow injected account-self-service service, `src/account-export.js` owns bounded serialization and workout keyset streaming, and the database adapter delegates its queries and mutations to `src/account-self-service-store.js`. Coaching follows the same direction: `src/coaching.js` owns the authenticated HTTP boundary and makes explicit profile saves the only version-1/version-2 to version-3 transition; `src/coaching-core.js` validates the overall versioned profile and composes the week without storage access; `src/energy-planning-core.js` owns exact legacy calculation compatibility, the version-3 adult EER branches, Mifflin–St Jeor and optional Cunningham cross-checks, evidence qualification (including the minimum observation span), robust weight-trend analysis, and the bounded calorie adjustment; and `src/meal-planning-core.js` validates the nested food preferences, owns the bundled recipe catalog and provenance, filters hard constraints, and generates remaining-day options. The adapter continues to delegate profile, snapshot, and daily-log persistence to `src/coaching-store.js` and `src/coaching-schema.js`. Migration `005-coaching-calibration` adds nullable `morning_weight_kg` and `intake_complete` observations with matching SQLite and Turso behavior; the existing `(user_id, log_date)` primary key serves the bounded history query, so no speculative index was added. `src/migrations.js` owns that ordered, idempotent evolution instead of leaving version checks scattered across startup code. `src/observability.js` remains an independent transport-safe leaf.

The result is 48 inventoried server modules, zero dependency cycles, and zero policy violations. The new energy-planning core is 157 physical lines under its reviewed 190-line budget and may point only to the Plan catalog. The 141-line meal-planning core stays below its reviewed 300-line budget and has no local dependencies. The coaching HTTP boundary is 134 lines and may point only to the two pure coaching leaves; the coaching core is now 174 lines and may point only to energy planning, meal planning, and the Plan catalog. The four Build 7.8.7 additions—coaching HTTP, pure generation, schema, and adapter-parity leaves—retain explicit budgets and only downward dependencies. Build 7.8.5's `src/paddle-checkout-retirement.js` remains the leaf for the exact provider mutation and validation that makes an interrupted draft non-payable without pretending Paddle deleted it. The Admin service remains 209 physical lines and owns bound-owner authorization, redacted payloads, server-generated audit reasons, and route composition; it does not import the email boundary or coordinate password/code elevation. Several files remain substantial—especially authentication, billing, the database adapter, and the composition root—but each has an explicit responsibility, allowed edge set, and reviewed ceiling.

The 7.7.0 account controls remain in focused grant state, schema, and storage modules. Administrator mutations and checkout reconciliation stay extracted into their own modules. Build 7.10.0 preserves the direct sole-owner authorization path from 7.8.4, the focused checkout-retirement dependency added in 7.8.5, the Plan/comparison boundaries from 7.8.6, and the coaching and meal-planning boundaries from 7.8.7–7.9 while adding energy planning without reversing any of those edges.

## Browser boundaries

Build 7.10.0 keeps the Home, Plan, Train, and existing Strata+ boundaries intact while preserving the five destinations introduced in 7.8.7: Today, Plan, Progress, Explore, and Personal training and calorie counting. `personal-training-ui-core.js` owns pure unit conversion, the version-3 profile form, progress math, Legacy profile/Starting/Calibrating/Trend-informed display shaping, and daily evidence form values. `personal-training-meals-ui-core.js` separately owns food-preference normalization, remaining-nutrition shaping, and calorie/gram/USD formatting. `discover-coaching-meals.js` owns the food-option request and rendered-option lifecycle, while `discover-coaching.js` retains bounded coaching state, profile/log events, save conflicts, and private-state clearing. `discover-coaching-render.js` presents the profile/model version, equation, uncertainty band, evidence sufficiency, and bounded adjustment received from the server rather than recalculating or upgrading them. The existing Strata+ API leaf remains the single HTTP transport boundary, and `discover.js` coordinates the coaching controller with account and destination state. Progress mirrors the account-backed daily intake, optional morning weight, completeness control, and food-option flow instead of introducing a separate store.

The leaves keep the Strata+ coordinator at 721 physical lines, below its reviewed 730-line ceiling. The current browser report inventories 72 modules across seven page boundaries, with zero dependency cycles and zero violations. The calibration-aware `personal-training-ui-core.js` is 212 lines under its 220-line budget, and `discover-coaching-render.js` is 94 lines under its 110-line budget. The food-preference logic leaf is 78 lines under its 140-line budget; the food-option interaction/rendering leaf is 61 lines under its 120-line budget. Home still coordinates fail-closed comparison state through its existing logic, state, rendering, and entry modules; Plan still layers reset over its canonical empty-plan and conflict-safe save boundaries; and `workout-context.js` remains the focused Train renderer for no-plan, empty-day, scheduled, and active-workout states.


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

The enforced load graph is page-specific rather than a license for leaves to call sideways into unrelated pages. Shared modules such as `discovery-core.js`, `activation-core.js`, `personal-training-ui-core.js`, `personal-training-meals-ui-core.js`, and `workout-core.js` stay dependency-light and appear before each consumer.

### Browser size result

The largest coordinator reductions and their extracted leaves are:

| Page | Coordinator before → after | Extracted modules (physical lines) |
| --- | ---: | --- |
| Home | `app.js` 626 → 146 | logic 117; state 36; API 24; render 154; events 63 |
| Strata+ | `discover.js` 1,364 → 721 | state 54; API 51; navigation 110; progress logic 74; base render 47; coaching render 94; catalog 86; detail 54; community 52; session 60; selection logic 158; coaching logic 212; meal UI logic 78; sharing 31; events 64; food-option events/rendering 61; coaching events 68 |
| Plan | `planner.js` 1,233 → 679 | logic 83; state 60; API 36; render 75; conflicts 106; templates 82; sharing 120; activation 96; events 147 |
| Train | `workout.js` 784 → 397 | state 57; API 52; calendar logic 29; progression logic 92; base render 66; context render 65; guidance 109; history 113; events 99 |
| Pricing | `pricing.js` 414 → 213 | logic 56; state 17; API 30; render 109; events 22 |
| Account | `account.js` 835 → 271 | logic 238; state 31; API 68; render 186; events 44 |
| Admin | `admin.js` 848 → 203 | state 53; logic 92; API 45; render 189; session 53; events 53 |

These totals are not presented as deleted functionality: much of the former coordinator code moved into named leaves, and new user-facing behavior was added. The evidence of improvement is the enforced direction, independent tests, smaller orchestration roots, and zero-cycle report—not a lower aggregate line count. `node scripts/frontend-architecture-report.js` prints the exact live line/nonblank/byte table and every resolved dependency for all 72 browser modules across seven page boundaries.

## Resulting module sizes

The command-generated table below is the current server snapshot. CI generates the same table on every architecture check, while the policy enforces budgets and edges against the live sources.

| Module | Responsibility | Lines | Nonblank | Size | Line budget | Local dependencies |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `server.js` | Process bootstrap | 4 | 3 | 113 B | 20 | `src/server.js` |
| `src/access-controls-schema.js` | Admin grant and checkout hold schema and authorization guards | 22 | 22 | 2.4 KiB | 55 | — |
| `src/access-controls-store.js` | Atomic audited account controls for SQLite and Turso | 34 | 34 | 2.1 KiB | 65 | `src/access-controls-schema.js` |
| `src/access-controls.js` | Complimentary access state and duration validation | 35 | 34 | 2.1 KiB | 65 | — |
| `src/account-export.js` | Bounded streaming account export serialization | 83 | 77 | 8.2 KiB | 120 | — |
| `src/account-self-service-schema.js` | Account self-service query catalog | 37 | 35 | 4.7 KiB | 55 | — |
| `src/account-self-service-store.js` | SQLite and Turso account self-service storage parity | 72 | 67 | 4.2 KiB | 95 | `src/account-self-service-schema.js` |
| `src/account-self-service.js` | Authenticated session inventory, revocation, and privacy-safe data export | 84 | 80 | 6.2 KiB | 150 | `src/account-export.js` |
| `src/admin-mfa.js` | Session-bound administrator email MFA challenge and delivery | 62 | 55 | 4.6 KiB | 100 | — |
| `src/admin-user-actions.js` | Audited administrator account and payment actions | 87 | 86 | 9.2 KiB | 160 | `src/access-controls.js`, `src/plans.js` |
| `src/admin.js` | Administrative authorization and actions | 209 | 195 | 12.4 KiB | 280 | `src/access-controls.js`, `src/admin-user-actions.js`, `src/plans.js` |
| `src/auth.js` | Authentication and account lifecycle | 812 | 769 | 53.4 KiB | 840 | `src/account-self-service.js`, `src/email.js`, `src/plans.js` |
| `src/billing-schema.js` | Commercial entitlement and recurring-subscription schema | 126 | 120 | 17.6 KiB | 140 | — |
| `src/billing-store.js` | SQLite and Turso commercial storage parity | 240 | 233 | 22.8 KiB | 240 | `src/access-controls-schema.js`, `src/billing-schema.js` |
| `src/billing.js` | Commercial entitlement, checkout, trial, webhook, and reconciliation service | 719 | 690 | 44.5 KiB | 720 | `src/access-controls.js`, `src/checkout-reconciliation.js`, `src/http.js`, `src/legacy-checkout.js`, `src/payments.js`, `src/plans.js` |
| `src/checkout-reconciliation.js` | Validated checkout closure and settlement reconciliation | 99 | 98 | 8.0 KiB | 130 | `src/legacy-checkout.js`, `src/payments.js`, `src/plans.js` |
| `src/coaching-core.js` | Validated coaching inputs and deterministic weekly training composition | 174 | 166 | 24.5 KiB | 300 | `src/energy-planning-core.js`, `src/meal-planning-core.js`, `src/plans.js` |
| `src/coaching-schema.js` | Coaching profile, weekly snapshot, and daily-log schema | 50 | 47 | 4.5 KiB | 80 | — |
| `src/coaching-store.js` | SQLite and Turso coaching storage parity | 48 | 42 | 3.9 KiB | 80 | `src/coaching-schema.js` |
| `src/coaching.js` | Strata+ coaching profile, weekly snapshot, and daily-log API | 134 | 130 | 13.6 KiB | 180 | `src/coaching-core.js`, `src/meal-planning-core.js` |
| `src/database.js` | SQLite and Turso store adapters | 1198 | 1171 | 63.8 KiB | 1200 | `src/access-controls-store.js`, `src/account-self-service-store.js`, `src/billing-store.js`, `src/coaching-store.js`, `src/migrations.js`, `src/schema.js`, `src/store-contract.js`, `src/training-loop-store.js` |
| `src/email.js` | Resend integration and email security | 388 | 355 | 19.9 KiB | 400 | `src/admin-mfa.js` |
| `src/energy-planning-core.js` | Adult EER estimation, bounded trend calibration, and nutrition planning | 157 | 145 | 21.4 KiB | 190 | `src/plans.js` |
| `src/http.js` | HTTP transport helpers | 170 | 155 | 5.9 KiB | 180 | — |
| `src/legacy-checkout.js` | Strict retired-checkout migration and completion policy | 71 | 66 | 7.4 KiB | 75 | `src/payments.js` |
| `src/meal-planning-core.js` | Validated dietary preferences and deterministic remaining-day food options | 141 | 131 | 21.6 KiB | 300 | — |
| `src/migrations.js` | Ordered, idempotent SQLite and Turso schema migration ledger | 143 | 130 | 7.8 KiB | 145 | `src/billing-schema.js` |
| `src/observability.js` | Structured request tracing and redacted operational logging | 81 | 72 | 4.0 KiB | 90 | — |
| `src/paddle-catalog.js` | Paddle catalog, credential, exact checkout-price, and subscription-transition policy | 72 | 68 | 4.7 KiB | 80 | — |
| `src/paddle-checkout-retirement.js` | Interrupted Paddle checkout retirement policy | 52 | 45 | 3.3 KiB | 80 | — |
| `src/paddle-subscriptions.js` | Recurring subscription validation and temporary customer-portal links | 136 | 129 | 8.2 KiB | 165 | — |
| `src/paddle-webhooks.js` | Paddle signature and webhook source verification | 118 | 108 | 4.6 KiB | 150 | — |
| `src/payments.js` | Paddle integration boundary | 419 | 396 | 20.9 KiB | 430 | `src/paddle-catalog.js`, `src/paddle-checkout-retirement.js`, `src/paddle-subscriptions.js`, `src/paddle-webhooks.js` |
| `src/plans.js` | Plan domain validation | 355 | 321 | 18.5 KiB | 380 | — |
| `src/product-signals-schema.js` | Aggregate product-activity schema and statements | 23 | 20 | 1.4 KiB | 35 | — |
| `src/product-signals.js` | Consent-gated aggregate product-activity boundary | 135 | 122 | 5.5 KiB | 140 | — |
| `src/progression.js` | Pure per-set performance progression and comparison rules | 177 | 175 | 13.2 KiB | 300 | `src/plans.js` |
| `src/schema.js` | Shared storage schema and statements | 364 | 358 | 44.3 KiB | 390 | `src/access-controls-schema.js`, `src/account-self-service-schema.js`, `src/billing-schema.js`, `src/coaching-schema.js`, `src/product-signals-schema.js`, `src/training-loop-schema.js` |
| `src/server.js` | HTTP composition root | 796 | 771 | 42.0 KiB | 800 | `src/access-controls.js`, `src/admin.js`, `src/auth.js`, `src/billing.js`, `src/coaching.js`, `src/database.js`, `src/email.js`, `src/http.js`, `src/observability.js`, `src/payments.js`, `src/plans.js`, `src/product-signals.js`, `src/service-composition.js`, `src/setup.js`, `src/static-assets.js`, `src/support.js`, `src/training.js`, `src/workouts.js` |
| `src/service-composition.js` | Typed auth/admin/support composition | 40 | 38 | 1.8 KiB | 60 | — |
| `src/setup.js` | Atomic weekly-plan and preference setup | 84 | 77 | 4.9 KiB | 105 | `src/plans.js` |
| `src/static-assets.js` | Bounded public asset representations | 46 | 41 | 1.9 KiB | 65 | `src/http.js` |
| `src/store-contract.js` | Storage boundary contract | 175 | 172 | 4.7 KiB | 175 | — |
| `src/support.js` | Public and administrative support workflow | 137 | 129 | 10.0 KiB | 160 | `src/email.js`, `src/plans.js` |
| `src/training-loop-schema.js` | Check-in, training-block, and adaptation storage schema | 57 | 54 | 6.4 KiB | 70 | — |
| `src/training-loop-store.js` | SQLite and Turso training-loop adapter parity | 136 | 133 | 7.1 KiB | 140 | `src/training-loop-schema.js` |
| `src/training.js` | Check-ins, deterministic progression, blocks, and approved adaptations | 358 | 346 | 24.8 KiB | 450 | `src/plans.js`, `src/progression.js` |
| `src/workouts.js` | Workout validation, history summaries, and authenticated lifecycle | 214 | 208 | 14.3 KiB | 230 | `src/plans.js` |

Snapshot result: 48 server modules, zero dependency cycles, and zero policy violations. The separate browser report covers seven page boundaries and 72 browser modules with zero cycles and zero violations.

## Static boundary types

`tsconfig.boundaries.json` runs TypeScript in strict `allowJs` plus `checkJs` mode with no output. The enforced slice covers HTTP transport, Paddle transaction/subscription/webhook validation, billing policy, account self-service and its two store implementations, store registration, setup, product signals, the training loop, coaching, energy and meal-option generation/API/schema/storage, workouts, and the production service composition. Shared declarations in `src/domain-types.d.ts`, `src/plans.d.ts`, and `src/workouts.d.ts` keep untrusted payloads unknown until validation narrows them, preserve the coaching profile version as a domain-boundary field, type the nullable morning-weight and intake-completeness observations, and keep injected capabilities smaller than the full application store.

This is an incremental boundary strategy rather than a cosmetic file-extension migration. It does not claim that every browser DOM controller or every legacy service implementation is fully typed. Runtime guards, focused tests, and the architecture edge policy remain necessary alongside static checking.

## Interpreting the result

Line counts are a maintenance signal, not a quality score. They matter here because they are paired with dependency direction and a cycle gate: a small cyclic module or a thin pass-through split would not be an improvement. Future additions to authentication, billing, the dual adapter, or the composition root should first ask whether the responsibility belongs in an existing leaf or a new independently testable boundary rather than automatically increasing a ceiling.
