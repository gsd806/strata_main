# STRATA 7.8.5 — Interrupted checkout deletion recovery

Build 7.8.5 fixes an account-deletion dead end caused by a Paddle checkout that was interrupted while its transaction was still `draft`. The Admin actions to block new payment sessions and revoke STRATA login sessions could both succeed while that retained provider draft continued to block permanent deletion.

## What changed

- **Draft retirement.** STRATA switches an exactly validated Paddle draft to manual collection, disables checkout, applies bounded payment terms, and clears STRATA checkout metadata. Paddle retains the transaction record and its truthful `draft` state.
- **Older monthly catalogs.** Cleanup can use the durable local price and product identity from a stored purchase, or the durable checkout claim when provider creation was interrupted before the local purchase write. This cleanup-only compatibility does not permit reuse or entitlement.
- **Strict trust boundary.** First-time retirement requires the exact transaction/account/checkout identity, API origin, automatic collection, null subscription, one item, quantity one, durable price/product, and monthly cadence. Unknown, annual, one-time, completed, or mismatched state is not retired.
- **Idempotent recovery.** If Paddle accepted retirement but the response or local write was interrupted, a retry recognizes only the exact bound transaction in the non-payable retired shape, completes local revocation, releases its claim, and proceeds without another PATCH.
- **Truthful Admin states.** Checkout blocking, Paddle cleanup, STRATA session revocation, and account restoration are described as separate operations. Errors now distinguish an in-flight checkout claim, provider reconciliation failure, unsafe identity mismatch, and a payment or subscription link that is not deletion-safe.
- **Focused module.** The provider mutation and returned-state validation live in `src/paddle-checkout-retirement.js`, keeping the general Paddle boundary inside its existing architecture budget.

## Safety behavior

The change does not cancel a live subscription, refund a charge, delete Paddle's retained transaction record, or treat an unfinished payment as access. Active, trialing, past-due, or paused subscriptions still block deletion. The final account removal still rechecks the paused target, live owner identity/session, billing-safe state, and success audit atomically.

Paddle permits canceling a transaction only in supported states such as `ready` or `billed`; drafts are instead made non-payable through the documented manual-collection and disabled-checkout fields. The response must confirm manual collection, disabled checkout, no checkout URL, cleared STRATA metadata, and exact bounded payment terms before STRATA releases its local deletion blocker.

## Regression coverage

- Admin close → session revocation → permanent deletion for an interrupted draft.
- A stored draft from an earlier monthly product and price.
- An unbound checkout claim from an earlier monthly product and price.
- Paddle success followed by interrupted local cleanup, then safe retry without a second mutation.
- Provider failure retaining every local blocker and the paused account.
- Wrong account, checkout, price, product, origin, quantity, subscription, annual cadence, and one-time cadence.
- Self-service email-confirmed account deletion with an interrupted draft.
- Documented `checkout: null` and defensive `{ "url": null }` non-payable response shapes.

## Deployment and rollback

No database migration, new secret, or Paddle catalog change is required. Deploy the server and matching Admin assets together. Existing checkout holds remain active; after deployment, retry **Block new and close eligible checkouts**, then retry permanent deletion. Revoking STRATA sessions does not need to be repeated unless a new login session was created.

Rollback redeploys Build 7.8.4 and its matching assets. A draft already retired by Build 7.8.5 remains non-payable at Paddle, but Build 7.8.4 does not understand that cleanup state and may block deletion until 7.8.5 is restored.
