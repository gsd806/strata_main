# STRATA 7.8.8 — Guided coaching setup and $2.99 monthly pricing

Build 7.8.8 gives the Personal training and calorie counting profile a clearer four-step setup and changes the public Strata+ offer to **$2.99 USD per month**. The release keeps every coaching input and calculation from 7.8.7, adds no database migration, and preserves existing recurring subscribers through an explicit server-only Paddle catalog transition.

## What changed

- **A guided coaching profile.** The setup now opens with a deliberate overview and four desktop step links for Body, Training, Experience, and Nutrition. Each field group is a separate, readable card instead of one uninterrupted form surface.
- **Faster mobile orientation.** The duplicate introductory copy is compacted on narrow screens so the first inputs begin in the initial viewport. Safe input groups share a row where space permits and return to one column at 320 pixels.
- **Clear known-exercise entry.** An empty state explains that known exercises are optional. When an exercise is added, Exercise, Sets, Reps, Weight, and Unit retain visible labels on tablet and mobile rather than relying on placeholders.
- **Responsive and accessible presentation.** Section legends sit inside their cards, helper text and controls retain stronger contrast, the form reflows at 200% text size, and the setup remains keyboard navigable without horizontal overflow at the supported release widths.
- **A $2.99 monthly offer.** Current homepage, pricing, legal, account, runtime configuration, deployment guidance, and automated expectations now identify the new Strata+ price as $2.99 USD per month. The optional seven-day no-card trial and prior lifetime entitlements are unchanged.
- **Provider-confirmed new checkout pricing.** New checkout still uses only the server-configured current `PADDLE_PRICE_ID`. Before returning that transaction to the browser, STRATA now requires Paddle to return the configured product, a one-month billing cycle, quantity one, automatic collection, and a base unit price of exactly `299` minor units in USD.
- **Explicit legacy-recurring continuity.** `PADDLE_LEGACY_RECURRING_PRICE_IDS` may list earlier monthly price IDs on the configured product. Those IDs remain server-only and are accepted only for existing subscription entitlement and interrupted-checkout reconciliation; they can never create a new checkout. Wrong products, annual cycles, malformed lists, duplicates, the current price, and the retired one-time price fail closed.
- **Truthful grandfathered account status.** Signed-in billing status uses neutral monthly-subscription language when the exact legacy renewal amount is not available, avoiding a false claim that an older subscriber has already moved to $2.99.

## Paddle rollout

Changing application copy does not change Paddle by itself. Before enabling checkout for this release:

1. Disable new checkout with `PADDLE_CHECKOUT_ENABLED=false`.
2. Create or update the intended Paddle price so its base `unit_price` is `299` with `currency_code` `USD`, its billing cycle is one month, and it belongs to the configured product.
3. If the price ID changes, put the previous recurring price ID in `PADDLE_LEGACY_RECURRING_PRICE_IDS`, then set `PADDLE_PRICE_ID` to the new current ID. Decide separately in Paddle whether existing subscriptions stay grandfathered or are migrated.
4. Deploy the complete 7.8.8 commit, run production preflight, and test a new checkout plus an existing subscriber, renewal, cancellation, wrong amount, wrong product, and wrong billing cycle.
5. Enable checkout only after those checks pass. Remove a legacy ID only when no active subscription or recoverable checkout still uses it.

Paddle represents USD amounts in cents, so `$2.99` is returned as the string `"299"`. The browser-safe public payment configuration contains the advertised amount but never exposes API keys, webhook secrets, or the legacy price allowlist.

## Verification

The release gate covers the complete Node regression suite, enforced coverage, lint and boundary typing, architecture checks, runtime QA, endpoint/storage performance budgets, and the browser matrix. Focused payment tests cover exact amount and currency validation, public-config secrecy, invalid legacy allowlists, current-only checkout creation, old recurring entitlement, unfinished-checkout migration, wrong-product denial, annual-cycle denial, cancellation, and account recovery. The coaching browser flow covers 1440, 768, 390, and 320 pixel layouts, 200% text reflow, setup accessibility, visible mobile capability labels, generation, persistence, and stale-write recovery.

Final counts and coverage are recorded in [release readiness](release-readiness.md).

## Rollback

No schema rollback is required. Disable checkout before reverting application code because 7.8.7 advertises and expects the old $0.99 offer and does not understand `PADDLE_LEGACY_RECURRING_PRICE_IDS`. Restore a Paddle/environment combination that matches the deployed application before re-enabling checkout. If a new price ID was introduced, do not remove it or the old recurring price until outstanding transactions and active subscriptions have been reconciled.
