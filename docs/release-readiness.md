# STRATA 7.0.0 — Release readiness

This source update targets a 100-person pilot. The application has been improved and exercised with 100 simultaneous authenticated accounts on a local Node 24 / SQLite server. It has not been deployed or certified for 100 users against a production Turso instance.

## What changed

- The original ten-attempt shared-IP signup/login limit is replaced by bounded network and hashed-identity guards. A group sharing Wi-Fi can authenticate while one identity remains rate-limited across addresses.
- Static public responses reuse preloaded/compressed representations under a 16 MiB budget. Personalized HTML remains private. HTTP timeouts and a ten-second shutdown deadline bound slow connections and deployments.
- JSON null, arrays and scalar request bodies return HTTP 400 instead of unexpected errors.
- Monthly saves use atomic expected-revision checks on both storage adapters. Two concurrent saves cannot silently overwrite each other; a stale tab keeps its setup and receives an actionable message. Corrupt legacy rows retain a recoverable revision.
- The weekly planner blocks new items above 30 per day / 140 per week and keeps older oversized guest drafts intact. Offline visitors can explicitly open the separate device guest plan.
- Imported monthly exercises are checked against current equipment and movement constraints. Eligibility calculation failures do not silently admit exercises.
- Failed logout stays on the page with a retry message. Monthly/rating forms lock while saving; comparison actions restore keyboard focus. Mobile profile access remains available.
- Shared styling adds clearer controls, restrained card and modal motion, score indicators, and a weekly chart using actual plan data. Reduced-motion preferences disable animations; enhancement failure does not hide content.
- Release references and PWA caches advance together. Local startup supports an optional .env. The deployment blueprint selects an always-on 1 CPU / 2 GB starting point and npm ci.

## Verification

| Check | Result |
| --- | --- |
| Node test suite | 299 passed, 0 failed |
| Coverage floors | Passed |
| Release version audit | Passed |
| Architecture policy | Passed, 14 modules within their budgets |
| Type checks and lint | Passed |
| Account / discovery / planner / PWA runtime smoke | Passed |
| Existing endpoint/storage performance budgets | Passed |
| 100 users with distinct real source IPs | Passed; 2,720 requests; zero unexpected errors |
| 100 users sharing one real source IP | Passed; 2,720 requests; zero unexpected errors |
| Two-tab stale weekly save rejection | 100 expected HTTP 409 responses in each load run |
| Browser E2E / visual verification | Blocked: Chromium is absent and its download repeatedly timed out |
| Live Turso, Resend and Paddle | Not exercised against live accounts |

The complete npm run check command exits unsuccessfully at its browser E2E stage because Chromium cannot launch. The earlier stages above passed; this is not reported as a fully green release gate. The browser-free runtime checks use a simulated DOM and do not establish pixel layout, mobile rendering, or full browser behavior.

Each load run creates 100 real test accounts and sessions, reads the compressed catalog, performs five simultaneous read/save/read rounds per user, races two writes per user, verifies conflict/idempotency behavior, checks private account and CSRF isolation, rejects malformed requests, tests identity throttles across real and spoofed addresses, restarts storage, and checks logout revocation. The scripts spawn only an isolated loopback server and use the existing explicit test-only email verification bypass. No transactional emails or payments are sent.

### Local p95 observations

These are regression observations on this runner, not hosted latency promises. The runs are short bursts rather than a production soak test.

| Operation | 100 distinct source IPs | One shared source IP |
| --- | ---: | ---: |
| Registration | 1427.77 ms | 1386.13 ms |
| Login | 1146.68 ms | 914.21 ms |
| Catalog load | 335.92 ms | 179.30 ms |
| Private plan read | 71.91 ms | 68.82 ms |
| Private plan save | 73.50 ms | 59.13 ms |

Raw evidence: [distinct IP run](verification/load-distinct-ip.json), [shared IP run](verification/load-shared-ip.json), [release gate log](verification/release-check.log).

## Launch steps still required

1. Configure the deployment's Turso credentials, verified Resend sender, verification secret and domain. Configure Paddle only when accepting payments. Existing production guards remain enabled.
2. Run npm ci, install Chromium with npx playwright install --with-deps chromium, then run npm run check. Confirm keyboard navigation, reduced motion, narrow/mobile layouts and 200% zoom in real browsers.
3. In a staging environment backed by the intended Turso region, verify registration and verification delivery, reset/deletion flows, sign-in/out, plan sync from two devices, and payment webhook verification. Use Paddle sandbox for purchase testing.
4. Establish backup/restore and uptime/error monitoring, verify the trusted proxy setting, then measure the actual hosted workload before inviting the pilot. Start with one app instance; process-local request limits need shared coordination before adding replicas.

No hosted service, live account, domain, payment setting or database has been changed. The paid hosting blueprint is a reviewable configuration, not a purchase or deployment.

## Run locally

Use Node 24.x, run npm ci, then npm start. The app opens at http://127.0.0.1:4173. Copy .env.example to .env to configure providers; no credentials are included.

Reproduce isolated Linux capacity checks with npm run load:100 and npm run load:100:shared. The source and lockfile are included; node_modules, test databases and temporary artifacts are excluded from the release archive.

See [deployment instructions](deployment.md) for provider configuration and [changelog](../CHANGELOG.md) for release changes. No finite test suite proves that an application is free of all defects; the remaining checks above define the limits of this delivery.
