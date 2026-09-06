# Module architecture evidence

Build 6.9.9.007 treats extraction as an enforceable boundary, not merely a file-count change. `npm run architecture:check` recursively inventories server JavaScript and reports physical lines, nonblank lines, bytes, reviewed line budgets, and every statically analyzable local dependency. It fails when a module exceeds its budget, gains an unapproved dependency, is omitted from the policy, references a missing local module, introduces a dependency cycle, or uses aliased, member-based, or computed module loading that cannot be audited.

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
          ├── database adapter ────┬── schema/queries
          │                        └── store contract
          ├── payment boundary
          └── HTTP helpers
```

The HTTP root supplies services and adapters to the checked service-composition function. Domain services must not import the composition root or concrete database adapter; those capabilities arrive through factory dependencies. The database adapter depends only on schema/query definitions and the store contract. Leaf validation and provider-boundary modules cannot depend back on services. This policy prevents accidental or conventional module-loading bypasses; it is a maintainability gate, not a sandbox against deliberately obfuscated runtime evaluation.

## Resulting module sizes

The command-generated table below is the Build 7.1.2 review snapshot. CI generates the same table on every architecture check, while the policy enforces budgets and edges against the live sources.

| Module | Responsibility | Lines | Nonblank | Size | Line budget | Local dependencies |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `server.js` | Process bootstrap | 4 | 3 | 113 B | 20 | `src/server.js` |
| `src/admin.js` | Administrative authorization and actions | 251 | 236 | 16.1 KiB | 300 | `src/plans.js` |
| `src/auth.js` | Authentication and account lifecycle | 807 | 764 | 52.9 KiB | 850 | `src/email.js`, `src/plans.js` |
| `src/database.js` | SQLite and Turso store adapters | 1300 | 1267 | 69.6 KiB | 1300 | `src/schema.js`, `src/store-contract.js` |
| `src/email.js` | Resend integration and email security | 373 | 342 | 19.6 KiB | 420 | — |
| `src/http.js` | HTTP transport helpers | 170 | 155 | 6.0 KiB | 180 | — |
| `src/payments.js` | Paddle integration boundary | 448 | 425 | 21.2 KiB | 480 | — |
| `src/plans.js` | Plan domain validation | 355 | 321 | 18.5 KiB | 400 | — |
| `src/schema.js` | Shared storage schema and statements | 413 | 409 | 49.2 KiB | 420 | — |
| `src/server.js` | HTTP composition root | 1168 | 1129 | 59.5 KiB | 1200 | `src/admin.js`, `src/auth.js`, `src/database.js`, `src/email.js`, `src/http.js`, `src/payments.js`, `src/plans.js`, `src/service-composition.js`, `src/setup.js`, `src/static-assets.js`, `src/support.js`, `src/workouts.js` |
| `src/service-composition.js` | Typed auth/admin/support composition | 39 | 37 | 1.7 KiB | 80 | — |
| `src/setup.js` | Atomic weekly-plan and preference setup | 84 | 77 | 4.9 KiB | 120 | `src/plans.js` |
| `src/static-assets.js` | Bounded public asset representations | 46 | 41 | 1.9 KiB | 80 | `src/http.js` |
| `src/store-contract.js` | Storage boundary contract | 139 | 136 | 3.6 KiB | 180 | — |
| `src/support.js` | Public and administrative support workflow | 137 | 129 | 10.0 KiB | 180 | `src/email.js`, `src/plans.js` |
| `src/workouts.js` | Workout validation, history summaries, and authenticated lifecycle | 194 | 188 | 12.3 KiB | 240 | `src/plans.js` |

Snapshot result: 16 modules, zero dependency cycles, and zero policy violations.

## Static boundary types

`tsconfig.boundaries.json` runs TypeScript in strict `allowJs` + `checkJs` mode with no output. The enforced slice covers the HTTP transport, Paddle provider validation, store-registration boundary, the atomic setup service, and the production auth/admin/support wiring inside `src/service-composition.js`. These modules use shared declarations from `src/domain-types.d.ts` and the plan-domain surface in `src/plans.d.ts`; the checked setup boundary verifies its untrusted request shape, session guard, plan/preference snapshots, and exact atomic store result, while the checked composition verifies its service/store/HTTP capabilities, account-versus-session row shapes, and the admin bootstrap cycle.

This is deliberately an incremental boundary strategy rather than a cosmetic file-extension migration. Untrusted Paddle payload fields stay `unknown` until runtime validation narrows them, HTTP request/response/header values use Node types, and service stores are named capability sets rather than a catch-all index. The store factory preserves each adapter's concrete method signatures through a generic while its existing runtime contract enforces the complete method set.

The compiler currently checks the composition function's implementation, not the large legacy implementations in `auth.js`, `admin.js`, and `support.js`, nor their call site in `src/server.js`. Their factory JSDoc publishes the intended boundary, while runtime dependency guards and integration tests cover the caller. Store capability declarations enforce required method names at composition time; detailed per-method argument and result types remain a future incremental slice. This limitation is explicit so the gate is not mistaken for whole-application TypeScript coverage.

## Interpreting the result

The graph is acyclic. The largest remaining files are the composition root and the dual database adapter; their size is explicit and budgeted rather than hidden by extraction. Authentication, administration, support, and atomic training setup are independently wired services. The direction of their imports confirms that they do not reach back into `src/server.js` or instantiate storage themselves.

Line counts are a maintenance signal, not a quality score. They are paired with dependency constraints because a small cyclic module or a thin pass-through split would not represent a better architecture.
