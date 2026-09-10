# STRATA 7.6.0 — First-week value

This release makes Strata's existing training loop easier to discover and try. It keeps the $0.99 USD recurring monthly price and the established Node application architecture.

## Changes

- Homepage positioning emphasizes the next workout and remembered sets. Equipment starter buttons generate real editable weeks through the existing preview, setup, and device-handoff modules.
- Pricing explains Training Memory with explicitly illustrative sample data, concise benefits, and a semantic free/Plus comparison. The purchase controls precede the longer feature details.
- New app trials last seven consecutive days. They are one-use, server-timed, no-card, and never convert into a paid subscription. Valid prior trials retain their stored expiry; used trials remain ineligible. Active-trial UI displays the actual expiry rather than implying every trial received the new duration.
- Account trial remaining time uses days/hours or shorter units as appropriate. Authentication, password-reset, verification, and admin-elevation expiry policies are unchanged.
- Checkout errors and open-checkout state take priority over generic trial messages. Trial activation is disabled while checkout is open or payment confirmation is pending. A checkout configuration error explains that an eligible no-card trial remains available.
- Today counts unique scheduled plan days completed during the local calendar week. Duplicate or unscheduled completions do not inflate the count. Missing history hides the bar; truncated history uses an “At least” qualification.
- Completed workouts offer a next-session link to Today, while preserving check-ins and the existing option to select another workout.

## Source compatibility

There are no new dependencies or schema migrations. The recurring catalog, signed entitlement verification, grandfathered lifetime access, account/plan ownership boundaries, existing device handoff, and service-worker privacy rules remain in place. Managed release labels and cache URLs have been advanced using the existing version tool.

The seven-day limit applies to new trial rows. Valid historical 30-minute rows are not extended. If malformed legacy data contains an unusually long expiry, the existing bounding logic limits it to the new seven-day maximum; this is not an automatic data repair migration. Deploy the server and its public assets together so the displayed offer matches trial creation.

The starter presets reflect the catalog's actual equipment buckets. Bodyweight can require supports such as a bar or bench; Barbell / Smith includes both types and may require attachments. Experience remains a ranking preference rather than a hard exercise-difficulty filter. No medical, coaching, or beginner-safety guarantee is introduced.

## Verification

See [release readiness](release-readiness.md) for this session's current results and limitations. New regression coverage exercises real preset generation and device preservation, seven-day expiry, valid legacy expiry, persistent checkout errors, and true completed-day progress.

A green source test does not verify a real Paddle charge, webhook delivery from Paddle, email delivery, a hosted database, or production behavior. Browser and live provider checks still need the configured deployment.

## Founder direction

See [Founder plan](founder-plan.md) for the customer focus, pilot, paid-value hypothesis, measurement limits, and the low-price payment-fee question.
