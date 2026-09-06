# STRATA 7.1.3 — Visual-system and clarity release

This candidate updates the delivered 7.1.2 source. It has not been deployed and does not change production credentials, provider configuration, database schema, payment behavior, or account authorization.

## User-facing changes

Every primary surface now follows the same clean visual language established in Strata+: Manrope-led display typography, DM Mono metadata, restrained black and charcoal navigation, softer lime accents, consistent 14 px surfaces and 8 px controls, lighter shadows, deliberate focus states, and purposeful motion. Existing homepage photography, exercise imagery, install artwork, and product functionality are retained.

The responsive navigation model is consistent across Rankings, Strata+, Plan, Train, setup, accounts, public information, and install. Mobile product bars stay fixed to the viewport instead of a transformed header, maintain touch-sized targets, and avoid duplicate header actions. Long headings and the support email now wrap at deliberate boundaries instead of splitting mid-word.

The homepage no longer repeats a promotional strip, redundant calls to action, or the founder biography. A new public `/policies` directory provides one clear route to Terms, Privacy, Refunds, support, and the complete founder story. Core footers link that directory once rather than repeating three legal destinations. Pricing and support copy retain the important purchase, security, and fallback details with less repetition.

Reveal animations are prepared before first paint and activated only when content enters view. They never make already-painted content jump backward, remain disabled under reduced-motion preferences, and leave all content visible when JavaScript is unavailable.

## Compatibility and storage

There is no database migration and no change to SQLite/Turso records, account sessions, saved plans, workout history, ratings, entitlement records, Paddle identifiers, Resend configuration, or public exercise data. The service worker adds the public Policies page to the existing public-cache allowlist and keeps all account and personalized data network-only.

## Deployment

1. Use Node 24 and the existing Turso, Paddle, and Resend configuration.
2. Run `npm ci`, `npm run check`, and the isolated `npm run qa:ui` browser matrix documented in `qa/README.md`.
3. Deploy the complete server, HTML, styles, scripts, and service worker together so every `7.1.3` asset URL and cache key activates as one release.
4. Verify the homepage images, Strata+ tools, Plan and Train flows, account redirects, `/policies`, checkout status, support form, install guide, keyboard focus, reduced motion, and 320 px layouts.

## Rollback

This release is presentation- and routing-focused, so reverting the 7.1.3 source and service-worker cache to 7.1.2 does not require a database rollback. Prefer a forward fix if users have the new cache. If rollback is necessary, deploy the complete 7.1.2 asset set, confirm its service worker activates, and refresh open clients before editing plans or workouts.

## Validation limits

Local and CI checks do not prove hosted Turso capacity, real Resend delivery, real Paddle sandbox/live transactions, or production deployment health. No production account, email, payment, or provider setting is changed by this source release.
