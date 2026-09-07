# STRATA 7.4.1 — Responsive content integrity

This candidate updates the delivered 7.4.0 source. It has not been deployed and does not change the database schema, HTTP APIs, credentials, provider configuration, payment price, account authorization, exercise catalog, or saved member data.

## What changed

Planner library cards now size themselves from their content. Long exercise names and metadata cannot escape into the next result, while FitScores and Add, Guide, and Video actions occupy explicit grid areas. The same containment treatment covers scheduled cards, day destinations, filters, save errors, and the narrow desktop sidebar. Controls remain at least 44 px where they are used as touch targets.

Strata+ keeps long movement names readable, restores clear detail-dialog context and close-control contrast, and keeps the comparison tray above the mobile navigation. Narrow workout layouts give exercise titles, set progress, logging formats, timers, save controls, check-ins, dialogs, and optional Plan adaptations their own responsive rows. Weekly setup again uses five equal mobile navigation cells.

Account, information, install, offline, and admin layouts now allow dynamic identities, email addresses, identifiers, server responses, and long action labels to shrink and wrap inside their components. Mobile sticky headers use an opaque background when blur is disabled, preventing scrolled content from showing through.

## Verification

Run on the supported Node 24 runtime before promotion:

```bash
npm ci
npm run check
npm run qa:ui
```

The local source gate passed 475 Node tests, the enforced 90% line / 78% branch / 85% function coverage floors, architecture, strict boundary typing, lint, runtime QA, performance budgets, and 21 Chromium E2E tests. The live UI audit passed 18 routes at eight widths from 320 through 768 px, including the 339 px reproduction, with zero text-containment failures, horizontal overflow, fixed-navigation focus overlap, or unexpected first-party browser errors. Planner geometry was also checked at 760, 761, 768, 1024, and 1440 px.

## Deployment

1. Back up production through the existing v7.4 procedure even though this patch has no migration.
2. Deploy the complete build together, including HTML version references, styles, scripts, and service worker, so installed PWAs activate the `7.4.1` cache consistently.
3. On physical phone, tablet, and desktop browsers, inspect Plan library and scheduled cards with the longest names; Strata+ detail and comparison surfaces; workout logging and save controls; setup navigation; and sticky account/public headers.
4. Repeat the authenticated save/conflict, offline-public-page, installation, and post-deploy health checks from the 7.4.0 guide.

## Rollback

Build 7.4.1 is presentation- and regression-test-only. The tagged v7.4.0 application is its direct schema-compatible rollback target. Roll back the complete application and public asset set together so HTML URLs and the service-worker cache key remain aligned. Do not use the pristine v7.3.0 binary after v7.4 tables exist; the training-loop rollback limits in the [7.4.0 release guide](release-7.4.0.md) still apply.

## Validation limits

Automated Chromium checks do not replace physical-device review, browser zoom and text-size testing, localization testing, hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, or post-deployment observation. No production account, provider setting, payment, email, GitHub release, tag, or deployment is changed by this source candidate.
