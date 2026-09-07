# Module architecture evidence

Build 7.4.1 retains extraction as an enforceable boundary, not merely a file-count change. `npm run architecture:check` recursively inventories server JavaScript and reports physical lines, nonblank lines, bytes, reviewed line budgets, and every statically analyzable local dependency. It fails when a module exceeds its budget, gains an unapproved dependency, is omitted from the policy, references a missing local module, introduces a dependency cycle, or uses aliased, member-based, or computed module loading that cannot be audited.

The policy lives in `architecture-policy.json`; it should change only with an intentional architecture review. A larger line budget is not the default response to a failure: first decide whether the module has accumulated another responsibility.

## Dependency direction

```text
root bootstrap
    └── HTTP composition root
          ├── typed service composition (factories injected)
          │     ├── auth service ────────┬── email boundary
          │     │                        └── plan domain
          │     ├── admin service ────────── plan domain
          │     └── support service ─────┬── email boundary
          │                              └── plan domain
          ├── setup service ──────────────── plan domain
          ├── training service ─────────┬── plan domain
          │                             └── workout summaries
          ├── product-signal boundary (aggregate counts only)
          ├── database adapter ────┬── schema/queries ───┬── product-signal schema
          │                        │                     └── training-loop schema
          │                        ├── training-loop store ── training-loop schema
          │                        └── store contract
          ├── payment boundary
          └── HTTP helpers
```

The HTTP root supplies services and adapters to the checked service-composition function. Domain services must not import the composition root or concrete database adapter; those capabilities arrive through factory dependencies. The database adapter depends only on schema/query definitions and the store contract. Leaf validation and provider-boundary modules cannot depend back on services. This policy prevents accidental or conventional module-loading bypasses; it is a maintainability gate, not a sandbox against deliberately obfuscated runtime evaluation.

## Browser, account, and product-signal boundaries

The server architecture inventory deliberately covers the process bootstrap and `src/**/*.js`; it does not present browser entry scripts as server modules. Build 7.4.1 keeps the existing preview, account, privacy, and training-facing browser responsibilities:

- `public/scripts/preview-core.js` is a deterministic, side-effect-free recommendation slice. The homepage passes it the public exercise catalog, a bounded visitor profile, and the existing ranking helpers. Preview choices remain page state and are not written to a plan or account.
- `public/scripts/account.js` remains the Account page controller. Its returning-member dashboard reads `/api/plan` and, only for active Strata+ access, a bounded `/api/workouts` summary window. Today/next-workout, current-week completion, and comparable records are derived in the browser rather than persisted as a second training model. The controller verifies that the plan response still belongs to the initially authenticated account before requesting or combining workout data.
- `public/scripts/product-signals.js` owns a strict browser allowlist, the reviewable local milestone summary, privacy-signal handling, and the separate aggregate-sharing preference. When sharing is enabled it sends only one allowlisted event name, with omitted credentials and no referrer. It never transmits the event detail supplied by feature callers.
- `public/scripts/discover.js` composes the private Today, Plan, Progress, and Explore workspaces. Its progress summaries use only bounded, verified account history and keep measurement types and units separate. A training-block or plan-adaptation write includes the account or stored revision and then rechecks authenticated identity before accepting private state.
- `public/scripts/workout.js` owns the optional post-completion check-in and displays deterministic next-session guidance. It never interprets a response as a diagnosis and never applies a proposed plan change without a separate approval action.
- `public/scripts/onboarding-core.js` provides a deterministic three-day beginner quick-start profile; `public/scripts/onboarding.js` still requires an equipment choice and a visible generated-week preview before saving.

The public `/api/product-signals` boundary is implemented by the typed `src/product-signals.js` service. Same-origin, JSON-shape, allowlist, network, and global rate checks run before the store increments a UTC-day count. The address-derived rate key is HMACed with a process-local random salt and is not stored. `src/product-signals-schema.js` defines only `(event_day, event_name, event_count)` rows; there is no account, session, browser, URL, plan, exercise, workout, or recommendation foreign key. Elevated reads return bounded action counts, not unique people, cohorts, or connected journeys, and the cleanup boundary retains at most 90 UTC days.

## Resulting module sizes

The command-generated table below is the Build 7.4.1 review snapshot. CI generates the same table on every architecture check, while the policy enforces budgets and edges against the live sources.

| Module | Responsibility | Lines | Nonblank | Size | Line budget | Local dependencies |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `server.js` | Process bootstrap | 4 | 3 | 113 B | 20 | `src/server.js` |
| `src/admin.js` | Administrative authorization and actions | 251 | 236 | 16.1 KiB | 300 | `src/plans.js` |
| `src/auth.js` | Authentication and account lifecycle | 807 | 764 | 52.9 KiB | 850 | `src/email.js`, `src/plans.js` |
| `src/database.js` | SQLite and Turso store adapters | 1315 | 1281 | 70.6 KiB | 1320 | `src/schema.js`, `src/store-contract.js`, `src/training-loop-store.js` |
| `src/email.js` | Resend integration and email security | 373 | 342 | 19.6 KiB | 420 | — |
| `src/http.js` | HTTP transport helpers | 170 | 155 | 6.0 KiB | 180 | — |
| `src/payments.js` | Paddle integration boundary | 448 | 425 | 21.2 KiB | 480 | — |
| `src/plans.js` | Plan domain validation | 355 | 321 | 18.5 KiB | 400 | — |
| `src/product-signals-schema.js` | Aggregate product-activity schema and statements | 23 | 20 | 1.4 KiB | 40 | — |
| `src/product-signals.js` | Consent-gated aggregate product-activity boundary | 135 | 122 | 5.5 KiB | 140 | — |
| `src/schema.js` | Shared storage schema and statements | 419 | 414 | 49.4 KiB | 420 | `src/product-signals-schema.js`, `src/training-loop-schema.js` |
| `src/server.js` | HTTP composition root | 1185 | 1146 | 60.5 KiB | 1200 | `src/admin.js`, `src/auth.js`, `src/database.js`, `src/email.js`, `src/http.js`, `src/payments.js`, `src/plans.js`, `src/product-signals.js`, `src/service-composition.js`, `src/setup.js`, `src/static-assets.js`, `src/support.js`, `src/training.js`, `src/workouts.js` |
| `src/service-composition.js` | Typed auth/admin/support composition | 39 | 37 | 1.7 KiB | 80 | — |
| `src/setup.js` | Atomic weekly-plan and preference setup | 84 | 77 | 4.9 KiB | 120 | `src/plans.js` |
| `src/static-assets.js` | Bounded public asset representations | 46 | 41 | 1.9 KiB | 80 | `src/http.js` |
| `src/store-contract.js` | Storage boundary contract | 151 | 148 | 4.0 KiB | 180 | — |
| `src/support.js` | Public and administrative support workflow | 137 | 129 | 10.0 KiB | 180 | `src/email.js`, `src/plans.js` |
| `src/training-loop-schema.js` | Check-in, training-block, and adaptation storage schema | 57 | 54 | 6.4 KiB | 80 | — |
| `src/training-loop-store.js` | SQLite and Turso training-loop adapter parity | 136 | 133 | 7.1 KiB | 140 | `src/training-loop-schema.js` |
| `src/training.js` | Check-ins, deterministic progression, blocks, and approved adaptations | 448 | 433 | 29.8 KiB | 450 | `src/plans.js`, `src/workouts.js` |
| `src/workouts.js` | Workout validation, history summaries, and authenticated lifecycle | 195 | 189 | 12.5 KiB | 240 | `src/plans.js` |

Snapshot result: 21 modules, zero dependency cycles, and zero policy violations.

## Static boundary types

`tsconfig.boundaries.json` runs TypeScript in strict `allowJs` + `checkJs` mode with no output. The enforced slice covers the HTTP transport, Paddle provider validation, store-registration boundary, atomic setup service, anonymous aggregate product-activity boundary, the complete training-loop service/schema/adapter boundary, and the production auth/admin/support wiring inside `src/service-composition.js`. These modules use shared declarations from `src/domain-types.d.ts`, `src/plans.d.ts`, and `src/workouts.d.ts`; the checked setup boundary verifies its untrusted request shape, session guard, plan/preference snapshots, and exact atomic store result, the training boundary verifies explicit check-in and block shapes plus narrow workout/plan/store capabilities, the product-activity boundary verifies its narrow store/HTTP/admin capabilities and allowlisted rows, while the checked composition verifies its service/store/HTTP capabilities, account-versus-session row shapes, and the admin bootstrap cycle.

This is deliberately an incremental boundary strategy rather than a cosmetic file-extension migration. Untrusted Paddle payload fields stay `unknown` until runtime validation narrows them, HTTP request/response/header values use Node types, and service stores are named capability sets rather than a catch-all index. The store factory preserves each adapter's concrete method signatures through a generic while its existing runtime contract enforces the complete method set.

The compiler currently checks the composition function's implementation, not the large legacy implementations in `auth.js`, `admin.js`, and `support.js`, nor their call site in `src/server.js`. Their factory JSDoc publishes the intended boundary, while runtime dependency guards and integration tests cover the caller. Store capability declarations enforce required method names at composition time; detailed per-method argument and result types remain a future incremental slice. This limitation is explicit so the gate is not mistaken for whole-application TypeScript coverage.

## Interpreting the result

The graph is acyclic. The largest remaining files are the composition root and the dual database adapter; their size is explicit and budgeted rather than hidden by extraction. Authentication, administration, support, atomic training setup, the private training loop, and anonymous aggregate product signals are independently wired services. The direction of their imports confirms that they do not reach back into `src/server.js` or instantiate storage themselves.

Line counts are a maintenance signal, not a quality score. They are paired with dependency constraints because a small cyclic module or a thin pass-through split would not represent a better architecture. Several modules are intentionally close to their reviewed ceilings in this snapshot, so future additions should trigger a responsibility and dependency review rather than an automatic budget increase.
