# STRATA 7.8.1 — Focused training visuals

Build 7.8.1 adds Particle Charts only where a compact visual answers an existing question. It introduces three restrained surfaces in STRATA’s dark, warm-white, lime, and red language; it does not add a dashboard of synthetic scores or decorate the active workout logger.

## Three bounded surfaces

- **Strata+ Training Memory:** the selected movement, logging format, and measure are plotted across at most the latest 12 exact matches from the loaded 100-session response. A single match is labeled as a baseline and does not draw a trend.
- **Planner primary muscle sets:** a horizontal bar view reflects the top eight exact primary-muscle set counts already produced by deterministic Plan analysis. The existing rows remain the accessible source of truth. The visual adds no readiness, recovery, injury, balance, or outcome score and performs no separate network or storage work.
- **Workout History:** the selected movement, logging format, and measure use every exact match in the currently loaded history window—up to 20 sessions initially, extended only when the member chooses Load more. The existing best-in-window value, loaded-window scope, one-point baseline, and exact session table remain explicit.

The two workout surfaces group results only when exercise, measurement, load type, and unit match. Kilograms and pounds remain separate, as do external, assisted, bodyweight, repetition, and timed formats. Active workouts and malformed, unfinished, unsupported, or non-finite records do not become chart points. None of the three views claims causation or predicts a result.

## One shared chart core

`StrataParticleChart` centralizes STRATA’s theme and the create, update, resize, failure, and destroy lifecycle. `discover-chart.js`, `planner-charts.js`, and `workout-chart.js` only project their page’s already-validated data and manage that page’s status and exact-value DOM. Selector changes update one existing instance instead of appending another root.

The shared core caps device-pixel ratio at 1.5, pauses when hidden, uses density 4 with at most 8,000 particles, and removes idle jitter. It uses lime marks and DM Mono axes. Reduced-motion users receive the complete values with chart animation disabled. Controls stack, chart hosts stay contained, and wide exact tables scroll inside their cards at 320 px.

Each surface remains useful without canvas. Strata+ and Workout History preserve semantic exact-value tables and honest baseline or unavailable states; Planner preserves its exact muscle rows and treats the chart as `aria-hidden` visual repetition. A missing or failed runtime destroys and hides the visual rather than hiding the underlying facts.

## Supply chain, PWA, and privacy

STRATA pins the byte-identical `particle-charts@1.0.0` UMD artifact and serves it from the STRATA origin. Page tags use the reviewed SHA-384 SRI value and anonymous CORS mode. Tests enforce the asset checksum, SRI, same-origin URLs, dependency order, public static allowlist, build-versioned PWA precache, and complete MIT notice. An upgrade requires another explicit review and re-pin.

Only static chart code enters the public PWA cache. Workout API responses remain network-only, and the chart layer writes no additional selection or value records to localStorage, IndexedDB, Cache Storage, or the server. Before Strata+ or Workout access is revalidated, lost, or replaced by another identity, the active instance is destroyed and its generated canvas, accessibility DOM, selectors, status, scope, and exact values are blanked synchronously. Planner’s chart derives only from the Plan analysis already on the page and is destroyed when that input becomes empty.

## Deployment and rollback

Deploy the Node server and public assets together so the static allowlist, page script order, and Build 7.8.1 cache agree. There is no database migration, payment-catalog change, authentication change, or new environment variable.

To roll back, redeploy the exact 7.8.0 application and matching assets. Its service worker will replace the 7.8.1 static cache on activation; no account or database data needs reversal.

See [current release readiness](release-readiness.md), [module architecture evidence](module-architecture.md), [test architecture](testing.md), and [third-party notices](third-party-assets.md) for the exact candidate evidence and limits.
