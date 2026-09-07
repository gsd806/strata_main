# STRATA 7.5.1 — Checkout continuity and guarded deletion

Build 7.5.1 is a narrow compatibility and account-safety update. It does not change the $0.99 USD monthly price, the separate one-use 30-minute no-card trial, or grandfathered completed lifetime access. The current product and recurring price are now both supplied by deployment configuration and flow consistently through server and browser validation, so replacing the Paddle product no longer leaves the public checkout pinned to the retired catalog.

## Retired checkout compatibility

Before creating a new monthly checkout, STRATA now reconciles an older unresolved purchase for the same account. A Paddle transaction that is at least 30 minutes old, or locally `past_due`, can be considered only when every durable identity field matches. A `draft` cannot use Paddle's canceled transition, so STRATA updates its complete item list to the configured monthly price, strictly validates the returned recurring item, compare-and-swaps the local catalog identity, and reuses that same transaction. For a provider-cancelable stale state, STRATA proceeds to a fresh checkout only after Paddle confirms cancellation.

The one-time compatibility exception recognizes only the exact retired Build 7.4 product and price together, with the original account and checkout metadata, API origin, automatic collection, quantity one, and no recurring billing cycle. STRATA first reads and validates that specific Paddle transaction. Integration coverage exercises the `draft` in-place migration/reuse path, provider-ready responses, lost-response retry, the `ready` cancellation path, and a delayed exact-legacy completion with a valid customer and null subscription. That delayed paid completion becomes grandfathered lifetime access; unknown one-time catalogs and unsupported provider transitions fail closed.

This path does not alter a completed grandfathered lifetime purchase, an active subscription, an unknown one-time catalog item, or a transaction with mismatched ownership, checkout, product, price, quantity, origin, or collection mode. Provider unavailability, an invalid response, a failed draft update, or a failed cancellation stops the new checkout instead of guessing that the older transaction is safe to replace.

## Guarded administrator permanent deletion

The primary administrator can permanently delete a non-owner STRATA account only through an explicitly destructive action. The target must already be paused, which signs out its active sessions. The administrator must have a current password-elevated owner session, pass the normal origin and CSRF checks, provide a bounded non-sensitive audit reason, and type `DELETE ` followed by the target's exact stored email address.

Before deletion, STRATA reconciles interrupted checkout creation and stale incomplete transaction records with Paddle, then checks the locally stored subscription state populated through signed provider events. It does not refresh a subscription from Paddle during the deletion request. A stored `active`, `trialing`, `past_due`, or `paused` subscription blocks deletion, as does a current checkout claim, unresolved payment, transaction-reconciliation failure, or invalid provider identity. Transaction reconciliation may close a strictly validated stale incomplete checkout; it never issues a refund or cancels a live subscription.

After any provider transaction reconciliation has completed, the final local database operation rechecks the target account ID, byte-exact stored email, paused state, non-owner status, absence of billing blockers, and absence of a live checkout claim. In the same guarded storage transaction or batch, it also revalidates the immutable primary owner, verified and unpaused owner account, current authorization version, unexpired owner session, and unexpired elevation. The account cascade and one matching success audit commit together; if any condition changed, neither succeeds. Provider cancellation is a preceding external action and is not part of that local atomic transaction.

Deletion removes the local STRATA account and its user-owned application records. It does not create a Paddle refund, cancel a live Paddle subscription, or erase records retained by Paddle. Billing must be handled separately and the canceled provider state must reach STRATA before this action can succeed.

## Workout recovery polish

An active workout recovery already stored on the device now suppresses the Start action immediately, including while saved account history is still loading. This removes the brief duplicate-start choice without discarding the recovery draft or weakening the server's one-active-workout guard.

## Verification scope

Focused tests cover exact retired-catalog draft migration and reuse, provider-current/local-legacy recovery, provider-confirmed cancellation before a fresh monthly checkout, signed and provider-fetch delayed lifetime completion, rejection before provider mutation for unknown or mismatched transactions, no webhook acknowledgment after an atomic migration conflict, paused-target, owner-protection, exact-email, billing, replay, session, and elevation boundaries, atomic success-audit behavior, and SQLite/Turso adapter parity. Provider calls use local fakes and do not prove that production Paddle credentials or catalog settings work.
