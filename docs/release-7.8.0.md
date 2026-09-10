# STRATA 7.8.0 — One clear training path

Build 7.8.0 concentrates STRATA around one understandable journey: preview a useful week, create and verify an account, deliberately start the no-card trial, review the saved Plan, train, and return to evidence from completed work. It preserves the existing HTML/CSS product and provider contracts while reducing interface duplication and splitting the largest browser coordinators into explicit modules.

## Product experience

- The homepage, Account, Pricing, Strata+, Plan, and Train hand-offs use one stable vocabulary and the same four primary destinations: Rankings, Strata+, Plan, and Train.
- Trial-eligible accounts see one seven-day no-card trial action before the subscription action. The trial still ends automatically and never converts or charges without an explicit Paddle checkout.
- Generated multi-day starter weeks now retain one or two compatible movements across sessions. That makes Training Memory useful on the first repeat workout instead of merely promising future value.
- Strata+ keeps Today primary, provides a useful first-workout Progress state, and moves secondary planning and exploration tools into clearly labeled optional sections.
- Plan preserves explicit conflict recovery, remembers the selected day, and hands compact-screen additions and saves directly to the relevant day or workout review.
- Train exposes the essential set fields first, keeps advanced logging choices under More options, presents only one real start action, and can create a private device-side calendar file for the next planned workout.
- Changed responsive layouts and a browser geometry suite protect narrow screens, text wrapping, focus navigation, disclosures, dialogs, and primary actions from overlapping or disappearing.

## Maintainable browser architecture

The seven largest interactive surfaces—Home, Strata+, Plan, Train, Pricing, Account, and Admin—now have named pure-logic, state, same-origin API, rendering, event, and coordinator boundaries. Additional focused leaves isolate catalog, community, sharing, history, guidance, conflict, activation, and template behavior where a generic page layer would still be too broad.

This is an incremental extraction, not a framework rewrite. Public routes, account data, server APIs, CSS, images, and installed-PWA behavior remain compatible. `frontend-architecture-policy.json` and `npm run architecture:check` enforce actual HTML load order, published module boundaries, reviewed size limits, one-way dependencies, and zero cycles. Focused unit/runtime tests exercise the leaves; browser E2E tests exercise the composed pages.

## Operational trust

- Production Admin elevation now requires the owner's password and a six-digit code sent through Resend to the registered owner address. Password confirmation alone cannot elevate; the code is session-bound, expires after ten minutes, and successful verification rotates the session before the existing 30-minute privileged window begins.
- Home clears stale account chrome on focus, visible-tab restoration, and persisted BFCache restoration before revalidating identity, while preserving a guest's generated preview. Pricing applies the same lifecycle discipline to trial and subscription UI, rejects stale identity responses, binds delayed trial, checkout, and completion results to the account that initiated them, and closes an open Paddle overlay after a confirmed account change so another signed-in account cannot continue it or receive a false confirmation.
- Account and Admin purge rendered private data on persisted BFCache restoration and before ordinary foreground identity revalidation. Delayed initial identity responses are superseded, only the same durable account can reopen an established Account view, and Admin additionally requires the same owner identity plus current elevation; late private responses are discarded after either view locks.
- The private owner overview adds aggregate operational milestones. Five values count distinct accounts reaching a first workout, second workout, completed workouts started at least seven days apart, trial start, or validated completed Paddle payment; a separate value counts subscriptions whose provider period advanced beyond the initial window. It exposes totals rather than workout contents or account identities and does not present period advance as proof of a renewal charge.
- Payment tests cover a validated initial entitlement, renewal-period advance, duplicate replay, and terminal cancellation as one complete lifecycle. The separate provider-acceptance checklist makes clear which facts still require a real isolated Paddle sandbox.
- Frontend logic, state, and API leaves join the enforced coverage denominator. Rendering and event behavior remain covered through VM/runtime checks and real-browser journeys because Node's process collector cannot faithfully instrument those separate realms.

## Deployment and rollback

Deploy the Node server and public assets together. The service-worker cache advances with the build and precaches the new public browser leaves while continuing to bypass account, Admin, authentication, billing, and other private API routes.

Production owner elevation now depends on working Resend delivery and the existing email-security secret; it fails closed when mail is unavailable. No database migration, Paddle price change, new product, or new secret is introduced. The existing **$0.99 USD monthly** subscription, one optional **seven-day no-card trial**, and grandfathered lifetime access remain unchanged.

Before enabling payments, complete [Paddle provider acceptance](provider-acceptance.md) against an isolated sandbox. Local automated provider tests are not proof of live catalog, credential, webhook, Turso, Resend, or hosted-network configuration.

To roll back, redeploy the prior release and its matching public assets. The additive Admin metrics read existing records and require no data reversal. A rollback also returns Admin to the prior elevation behavior, so treat that security reduction as an explicit operational decision.

See [current release readiness](release-readiness.md), [module architecture evidence](module-architecture.md), and [test architecture](testing.md) for the exact candidate checks and limitations.
