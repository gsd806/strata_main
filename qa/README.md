# STRATA QA

## Fast checks

Run the release audit, correctness-focused linter, Node suite, and all four browser-free runtime smokes:

```bash
npm run check
```

`npm run qa` remains an alias for the same full check. The runtime smokes execute the homepage, discovery, and weekly-planner scripts against a small fake DOM, then start a real local server to verify the PWA routes, headers, icons, manifest, versioned-cache lifecycle, private-data exclusions, protected-page gating, and build status. The planner smoke also exercises desktop catalog pagination, unique-card expansion, and focus transfer after **Load more**. These checks catch initialization, rendering, and deployment regressions, but they do not replace the real-browser audit.

For an informational application-code coverage baseline, run:

```bash
npm run coverage
```

Coverage has no arbitrary percentage gate. Treat uncovered security and state-transition branches as test-review leads, not as a reason to add low-value tests for the number alone.

## Browser audit

Install Chromium once after `npm install`:

```bash
npx playwright install chromium
```

Start STRATA in a separate terminal. Use an isolated data directory so QA accounts do not enter the development database:

```bash
STRATA_DATA_DIR="$(mktemp -d)" npm start
```

Then run:

```bash
npm run qa:ui
```

The audit expects `http://127.0.0.1:4173` by default. It creates a temporary account through the UI, exercises the inline battle, detail and rating views, search and equipment filters, planner autosave, every main route at a 320px viewport, and the device-aware install guide. It exits nonzero on assertion failures, first-party browser errors, failed first-party requests, undersized primary install controls, or horizontal mobile overflow.

Configuration:

- `STRATA_QA_BASE_URL` points the audit at another running instance.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` uses a specific Chromium executable.
- `STRATA_QA_ARTIFACT_DIR` enables screenshots and writes them to the specified directory. Screenshots are disabled by default.

The audit closes its browser reliably, but it does not start or stop STRATA. Stop the separate server when the run finishes and remove its temporary data directory if your operating system does not clean it automatically.
