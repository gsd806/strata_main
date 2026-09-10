# STRATA 7.7.0 — Founder account controls

This release adds complimentary Strata+ grants, easier administrator account deletion, and controls for unfinished Paddle checkouts. The subscription price stays $0.99 USD per month. The seven-day no-card trial and Training Memory improvements from 7.6.0 remain included.

## Give someone Strata+

Open `/admin`, confirm the owner password, select **People**, find an account, and choose **Give free Strata+**. This works for the owner account as well as other registered accounts.

Choose a whole number of minutes, hours, days, weeks, calendar months, or calendar years; an exact future expiry; or **Until revoked**. Dates entered in the form use the administrator's device time zone and are converted to UTC. Calendar months and years clamp to the last valid day when necessary. A grant starts when confirmed; a new grant replaces the previous grant rather than adding to it. Use **Revoke free Strata+** to end it early.

The user sees their complimentary access and expiry in Account and Pricing. A grant is independent of payment and trial records. It does not charge anyone, consume their trial, create a fake purchase, or cancel an existing paid subscription. Revocation leaves any independent paid or trial access in place. Server access ends at the exact expiry. Previously authorized offline workout continuation lasts at most 24 hours and never beyond a finite grant expiry; online access is rechecked on the next request.

## Close payment sessions

Choose **Block & close payment sessions**, enter a reason and the displayed confirmation. The account is immediately blocked from creating or reopening a checkout through STRATA. The server attempts to close unfinished transactions already associated with the account, including freshly created transactions and interrupted checkout claims. **Allow payment sessions** reverses the hold; canceled transactions stay canceled.

Paddle permits cancellation only in supported states such as `ready` or `billed`. Drafts, processing payments, and provider failures remain visible as unresolved records; retry after their status changes. Each reconciliation examines at most eight purchase records plus an interrupted checkout claim. A hold remains active even if provider cancellation fails. An in-flight provider request may already have been accepted when the hold is placed; the system preserves its record and does not claim that such a payment was stopped.

This control does not cancel a recurring subscription, refund a payment, or stop recurring collection on an existing subscription. Manage those separately in Paddle or the account's subscription portal. Official provider references: [transaction state restrictions](https://developer.paddle.com/errors/transactions/transaction_invalid_status_change/), [processing payment restrictions](https://developer.paddle.com/errors/transactions/transaction_immutable_while_processing_payment/), and [subscription cancellation](https://developer.paddle.com/api-reference/subscriptions/cancel-subscription/).

## Delete an account

Choose **Permanently delete account** and type `DELETE account@email` exactly. The reason is prefilled and editable. The server pauses the account, revokes its sessions, reconciles supported checkouts, and performs the final guarded deletion. There is no separate manual suspension step.

If a live subscription or unresolved payment prevents deletion, the account stays paused and the dialog explains what happened. Close the dialog to restore the account or retry deletion after resolving billing. Successful deletion removes STRATA account data while retaining the audit event. The primary owner remains protected from account deletion and other destructive self-actions.

## Installation and storage

Deploy the server and public assets together using the existing Node deployment process. No new dependency or payment catalog configuration is needed. Startup adds `admin_account_controls` with `CREATE TABLE IF NOT EXISTS` on both SQLite and Turso, preserving existing account, trial, and purchase data. This additive table follows the app's existing startup schema process. It stores grant dates, revocation, checkout hold, and a revision for concurrent edits; it is deleted with its user. The user's export includes their grant dates and checkout hold, without administrator reasons or session secrets.

Owner password elevation, Origin/CSRF checks, exact confirmations, commit-time session validation for grant/hold writes, revision conflicts, and transactional audit writes protect these controls. Existing payment completion and webhook validation stay in place. See [current verification](release-readiness.md) for what was actually tested.
