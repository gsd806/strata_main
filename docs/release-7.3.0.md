# STRATA 7.3.0 — Product proof and returning-member clarity

This candidate updates the delivered 7.2.0 source. It has not been deployed and does not change production credentials, provider configuration, payment pricing, account authorization, existing training records, or the editorial FitScore catalog.

## Product proof before signup

The homepage now lets a visitor choose a goal, muscle group, available equipment, and experience level, then inspect a three-exercise shortlist before creating an account. The preview uses the same deterministic recommendation rules and public exercise catalog as Strata+, keeps the official FitScore separate from the personal match, and explains both the strongest decision signal and the lowest-scored trade-off. Preview choices stay in the current page and are not added to a plan or profile.

The result presents the free weekly planner and paid Strata+ path side by side. Rankings and manual weekly planning remain available without an account. Strata+ remains an optional 10-day no-card trial followed by a $5.99 USD one-time purchase with no subscription.

## Returning-member experience

The signed-in Account page now derives one next action from the saved week and access state. Strata+ members can see the next scheduled day, current-week completed-day progress, a recent completed session, and comparable saved-history improvements. Free members still receive useful plan guidance without a false workout-completion claim.

Progress comparisons keep timed work, bodyweight repetitions, and external load separate; assisted load is excluded from best-load claims. A record is surfaced only after a later comparable saved result exceeds an earlier result. Partial history is labeled as recent-history rather than all-time history. Adaptation language describes the observed schedule or record and never claims to measure recovery, readiness, pain, technique, or injury risk.

Weekly setup, Plan, Train, pricing, and account copy now distinguish free planning from Strata+ guidance more consistently. Error states use specific recovery language and accessible announcements, while mobile hand-offs and focus targets remain reachable above the fixed navigation.

## Recommendation trust and product signals

The public Policies directory now defines four separate signals: editorial FitScore, personal match, community rating, and the optional recommendation check. None is presented as validated medical advice or a prediction of individual results, and recommendation feedback does not train or automatically change the ranking rules.

The browser keeps a reviewable local summary of a strict allowlist of coarse product milestones and the latest optional recommendation answer. It rejects arbitrary fields and does not store exercise IDs, recommendation contents, plan contents, set data, URLs, account IDs, names, or contact details. Global Privacy Control and Do Not Track disable collection, and the Privacy page provides inspect, copy, disable, and clear controls.

Only after the separate aggregate-sharing choice is enabled, the browser may send one allowlisted event name to a same-origin endpoint without account credentials. The server increments a UTC-day aggregate count immediately; it does not create a visitor, session, IP, URL, workout, exercise, or recommendation row. A process-local, salted network rate key is used only for abuse control and is never persisted. Counts older than 90 days are deleted. The elevated owner dashboard can read aggregate action counts, but the data cannot identify unique people, connect a funnel journey, or distinguish repeated actions by one person.

## Storage compatibility

This release adds one shared `product_signal_counts` table keyed by UTC day and an allowlisted event name, with a bounded integer count. SQLite and Turso use the same schema, statements, store contract, retention boundary, and behavior tests. The migration is additive and does not rewrite existing accounts, sessions, plans, workouts, ratings, community plans, support requests, or Paddle records.

Rolling back application code does not require deleting the aggregate table; an older build simply ignores it. Counts collected by 7.3.0 can be deleted independently and are not tied to account deletion because no account relationship is stored.

## Deployment

1. Use Node 24 and the existing Turso, Paddle, and Resend configuration.
2. Run `npm ci`, `npm run check`, and `npm run qa:ui` with the isolated test configuration documented in `qa/README.md`.
3. Deploy the complete 7.3.0 server, HTML, styles, scripts, manifest, and service worker together so the new cache and additive schema activate consistently.
4. Verify the guest preview, free-versus-Strata+ labels, signed-in next action, saved-week progress, recommendation feedback controls, owner aggregate readout, setup and planner save states, workout recovery, pricing, focus order, reduced motion, offline public pages, and 320 px layouts.

## Rollback

If a presentation or browser regression requires rollback, deploy the complete 7.2.0 asset set and service worker together, confirm that its cache activates, and refresh open clients. The additive aggregate-count table and optional browser-local signal keys can remain; 7.2.0 ignores both. Existing training and account records require no data rollback.

## Validation limits

Local and CI checks do not prove hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, production deployment health, third-party font/image availability, or every physical PWA device. Aggregate action counts are directional product evidence, not unique visitors, conversion rates, cohorts, or complete user journeys. No production account, provider setting, payment, email, GitHub release, tag, or deployment is changed by this source candidate.
