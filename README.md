# STRATA — Exercise Rankings and Workout Planning

STRATA is an evidence-informed workout index with server-backed, email-verified accounts, a private Strata+ studio, and weekly, community, and monthly workout planning. It includes 200 resistance-training exercises—25 per muscle group, including 50 bodyweight options—across 8 muscle groups and 26 sub-muscle targets. Build 6.9.8 is an installable Progressive Web App (PWA) with Resend-powered account email, Paddle-powered one-time Strata+ access, and a private owner dashboard.

**Build 6.9.8 is the Strata+ studio release.** A new personalized Session Builder turns training focus, available time, saved equipment, experience, goals, and movement limits into an explainable 20-, 35-, or 50-minute routine with sets, reps, rest, and personal-match reasoning. Members can add the complete session to any non-recovery planner day in one conflict-safe action, while the new weekly pulse surfaces the next scheduled workout and honest plan coverage at a glance. The studio now uses a richer responsive visual system with layered depth, clearer hierarchy, purposeful entrance and state motion, refined cards and controls, stronger focus and touch treatments, and comprehensive reduced-motion support. Account, price, payment, entitlement, and data-privacy behavior are unchanged.

The community weekly plans introduced in Build 6.9.3 remain included. Any signed-in member can publish a structured copy of their current saved week from the Plan page and later unpublish their own listing. Strata+ members can browse those plans and deliberately apply one to Plan; applying replaces the member's current saved week after an explicit confirmation. A shared listing shows the author's STRATA display name, never their email address. STRATA stores validated plan data rather than accepting binary file uploads.

The private Monthly Plan workspace introduced in Build 6.9.2 remains included. A member can copy their signed-in weekly plan or locally import a STRATA weekly-plan JSON file, assign up to several muscle targets to each training day, mark rest days, and generate an exactly 31-day dated plan. The same inputs produce the same exercise rotation, and the result is saved to the member's Turso-backed account for cross-device access. Members can open the browser's print dialog to save a clean PDF or deliberately send plan text through the device share sheet or clipboard.

The login-free weekly planner and one-time Strata+ trial introduced in Build 6.9.1 remain included. A signed-out visitor can build and keep a weekly plan in that browser's local storage; signing in continues to use the private Turso-backed weekly plan that syncs across devices. Each eligible signed-in account may start one 10-day Strata+ trial with no card, renewal, or automatic charge. Trial access follows the account across devices and expires automatically; existing Paddle purchases remain unchanged and continue to grant ongoing access.

The catalog has 200 exercises, including 50 bodyweight choices. A seven-block mobile-first hub opens one focused Strata+ workspace at a time, while deep links and browser history still work. The hub includes the personalized Session Builder and Community Plans for previewing and applying shared weeks. Community ratings remain Strata+-only, aggregate anonymously across every account, refresh when a member returns to or reopens a rating view, and keep each member to one replaceable rating per exercise.

The secure administrator and complete help desk introduced in Build 6.8.1 remain included. The one verified STRATA account whose email exactly matches the server-only `ADMIN_EMAIL` becomes the permanently bound primary administrator. It can open `/admin`, confirm its current STRATA password for a 30-minute elevated session, view service/account/support summaries, search accounts, inspect limited account and Strata+ status, send recovery or deletion-confirmation links to the registered address, cancel pending deletion requests, revoke sessions, suspend or restore accounts, answer support requests, and review an audit trail. It never exposes password hashes, codes, tokens, provider credentials, full payment details, or direct account-deletion controls.

The public Contact page now has a server-backed support form. Requests receive a reference, remain visible in the Help Desk, and can be answered through the existing Resend setup. Email remains available as a fallback at `stratafitness.official@gmail.com`.

This build retains the Build 6.7.5 account-security work: password reset and email-confirmed deletion use hashed, single-use 30-minute links; password resets revoke every session; production signup fails closed when verification is incomplete; and authentication-critical writes prove success from SQL `RETURNING` rows instead of unreliable affected-row metadata.

## Requirements

- Node.js 24.x (the included `.node-version` selects the supported major)
- `npm install` once before the first run

## Project structure

Build 6.9.8 separates browser files from private server code while preserving every public URL used by visitors, Paddle, Render, and installed PWAs:

```text
server.js          Small root bootstrap used by `npm start`
src/               Private routes, plan/HTTP domains, storage adapters, schema, email, payments, and discovery data
scripts/           Allowlisted release-version tooling
public/pages/      HTML pages served at their existing URLs
public/scripts/    Browser JavaScript
public/styles/     Browser stylesheets
public/data/       Public exercise catalog
public/icons/      PWA and site icons
data/              Local-development SQLite files; generated and ignored
test/              Automated Node test suite
qa/                Runtime and optional browser checks
```

Use `npm run release:check` to audit all managed build references, `npm run release:version -- --dry-run x.y.z` to preview a bump, and `npm run release:version -- x.y.z` to apply it. The tool reads and writes only its explicit release manifest; it never walks dependencies, Git internals, generated data, or private runtime files.

The organization is internal only. Routes such as `/pricing`, `/forgot-password`, `/reset-password`, `/delete-account`, `/api/status`, `/api/paddle/webhook`, `/service-worker.js`, and `/manifest.webmanifest` have stable public URLs. Never move `.env` files, Turso credentials, Resend credentials, verification challenges, Paddle credentials, `src/`, or the generated root `data/` directory into `public/`. The exercise catalog in `public/data/` is intentionally public; the editorial discovery dataset in `src/data/` remains server-only.

## Run locally on a Mac

Open Terminal in this folder and run:

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`. Local development automatically creates `data/strata.sqlite`; no Turso account is needed locally.

## Install on a phone or computer

After deployment, open `/install.html` for plain-language instructions for iPhone, iPad, Android, Chrome, and Edge. On browsers that expose a native PWA prompt, the page also shows an **Install STRATA** button.

The PWA caches only public interface assets and an offline explanation page. Account APIs, authentication routes, health checks, personalized pages, the administrator area, password-reset pages, deletion pages, and saved plans always go to the live server. The two bearer-link pages intentionally do not initialize the PWA helper or load a manifest, reducing the number of components present while handling a one-time token. An internet connection is required to sign in, use Admin, contact the help desk, recover or delete an account, sync across devices, or save account changes.

## Public pricing, support, and policies

Build 6.9.8 has public, mobile-friendly pages at `/pricing`, `/contact`, `/terms`, `/privacy`, and `/refunds`. The homepage links to all five without requiring JavaScript or an account. `/contact` submits help requests into Turso and sends acknowledgments and reference-only owner notifications through Resend; the full message stays in the private Admin help desk. Durable one-way IP/email quotas, a honeypot, and secret/card detection protect the form across Render restarts. If the form is unavailable, the public mail link still works.

The homepage also includes an **About the Founder** section for Saeed Abdalla Alketbi, describing STRATA’s UAE roots and the engineering mindset behind the project. It intentionally publishes only the city-level location `Al Ain, UAE`; do not add a residential street address to the public site.

Strata+ costs **$5.99 USD as a one-time purchase with no subscription**, and the public refund window is **14 calendar days after purchase**. Paddle handles checkout. The server grants Strata+ only after a signed, live `transaction.completed` webhook matches the configured product, price, user, and server-created transaction. A browser callback alone never grants access. Do not change the public price independently of the Paddle catalog.

Support and policy requests go to `stratafitness.official@gmail.com`. Do not expose private promotion codes in public HTML, client JavaScript, screenshots, or repository documentation.

The public policies identify the operator only as STRATA Fitness because no verified legal name or postal/business address was supplied for this build. Before accepting payments, replace or supplement that identity with the exact operator details used for the Paddle account if Paddle or applicable law requires them. Do not invent operator details.

## Primary administrator and help desk

No additional website, Gmail integration, Google Cloud project, or separate admin password is required. The Gmail address is the identity for a normal STRATA account and the reply mailbox; Resend remains the service that sends transactional email.

The checked-in Render configuration sets these non-secret values:

```text
ADMIN_EMAIL=stratafitness.official@gmail.com
SUPPORT_EMAIL=stratafitness.official@gmail.com
```

To activate the owner account after deploying Build 6.9.8:

1. If `stratafitness.official@gmail.com` already has a verified STRATA account, deploy and sign in again. Startup binds that immutable user ID as the primary administrator, revokes older sessions, and invalidates any recovery or deletion links issued before promotion.
2. If it has no STRATA account, create one with that exact address, complete the six-digit email verification, then sign out and sign back in once. The first verified login securely claims the empty administrator slot.
3. Open `/account.html` and choose **Open Admin**, or go directly to `/admin`.
4. Re-enter the current STRATA password. STRATA rotates the session cookie and CSRF token, unlocks management for 30 minutes in that one browser session, and then requires confirmation again.

The primary administrator binding is stored in Turso, not inferred from an editable browser field or request body. Email aliases, capitalization tricks, forged `role` fields, and other accounts cannot claim it. Once bound, changing `ADMIN_EMAIL` alone does not transfer ownership; that failure is intentional. Keep the exact setting and the owner account recoverable. The primary owner cannot suspend or delete itself through Admin.

Safe management controls include account search, limited status and plan totals, Strata+ purchase visibility, session revocation, temporary suspension/restoration, registered-email recovery links, pending-deletion cancellation, support status/notes/replies, and an audit log. Paddle transactions and entitlements remain read-only in Admin, refunds remain in Paddle, and permanent deletion remains a user-confirmed email flow.

Every account mutation requires the owner session, the same-session CSRF token, an exact same-origin request, a recent password confirmation, typed confirmation text, and a non-sensitive audit reason. Promotion, elevation, session revocation, suspension/restoration, deletion cancellation, recovery assistance, and support workflow changes are audited; related database changes use guarded transactions. Admin HTML and JSON use private/no-store caching, are excluded from the PWA cache, and are marked `noindex`.

## Free hobby/demo deployment: Turso + Render

Render explicitly positions Free instances for testing and hobby projects rather than production use. The free filesystem is temporary, so STRATA refuses to start in production without a cloud database. Turso keeps accounts, sessions, preference profiles, community ratings, private weekly and monthly plans, and published structured weekly-plan copies after Render restarts or redeploys.

**Deploy STRATA as a Node Web Service, never as a Static Site.** A static deployment can display the pages, but it cannot run the root `server.js` bootstrap, `/auth/signup`, or any `/api/*` route, so account creation will not work. The included `render.yaml` defines the correct Web Service automatically.

### 1. Create the free database

1. Create a free Turso account at `https://turso.tech`.
2. Create a database named `strata` in a nearby region.
3. Copy its database URL.
4. Create a database authentication token and copy it immediately.
5. Keep the token private. Never put it in GitHub, a screenshot, or a browser-side JavaScript file.

### 2. Configure the free Render web service

The simplest route is **New → Blueprint**, select the repository, and let Render read `render.yaml`. Render asks for nine values marked `sync: false`: two Turso credentials, the email-verification switch plus two email secrets, and the checkout switch plus three Paddle values. These values are entered in Render and are not stored in the repository. The Paddle client-side token is intentionally browser-visible after deployment; the API keys, database token, webhook secret, and verification secret remain server-only.

For manual setup, choose **Web Service** (not Static Site), connect the GitHub repository, and use:

```text
Runtime: Node
Build Command: npm install --omit=dev --no-audit --no-fund
Start Command: npm start
Health Check Path: /healthz
Instance Type: Free
```

Under Render's **Environment** page, add the following for the current live deployment. The checked-in `render.yaml` supplies the fixed non-secret values and asks you to enter both rollout switches manually:

```text
NODE_ENV=production
HOST=0.0.0.0
TRUST_PROXY=true
APP_BASE_URL=https://stratafitness.online
ADMIN_EMAIL=stratafitness.official@gmail.com
SUPPORT_EMAIL=stratafitness.official@gmail.com
TURSO_DATABASE_URL=<the URL copied from Turso>
TURSO_AUTH_TOKEN=<the secret token copied from Turso>
EMAIL_VERIFICATION_ENABLED=true
RESEND_API_KEY=<the private Resend sending API key>
EMAIL_FROM=STRATA <accounts@auth.stratafitness.online>
EMAIL_REPLY_TO=stratafitness.official@gmail.com
EMAIL_VERIFICATION_SECRET=<an independent long random secret>
PADDLE_PRODUCT_ID=pro_01m1ky8j916ybyacs836dxbz8x
PADDLE_PRICE_ID=pri_01m1kyc2zd313d7a3ssmg02424
PADDLE_CLIENT_TOKEN=<the live_ client-side token copied from Paddle>
PADDLE_API_KEY=<the private live API key copied from Paddle>
PADDLE_WEBHOOK_SECRET=<add this after creating the live notification destination>
PADDLE_CHECKOUT_ENABLED=true
PADDLE_ENFORCE_IP_ALLOWLIST=false
```

The live checkout has already passed an end-to-end test, so the current production service may keep `PADDLE_CHECKOUT_ENABLED=true`. For a fresh or unverified Paddle setup, begin with `false`, finish the webhook test, and enable checkout only after the signed notification grants access correctly. An existing deployment whose signup email already works should keep `EMAIL_VERIFICATION_ENABLED=true`; the same verified Resend configuration powers verification, password reset, account deletion, support acknowledgments, support notifications, and administrator replies. Build 6.9.1 adds only the non-secret `ADMIN_EMAIL` and `SUPPORT_EMAIL` settings shown above.

`EMAIL_VERIFICATION_ENABLED` must be spelled exactly and set explicitly to `true` or `false`; Build 6.9.8 refuses to start in production if the value is absent or invalid. Do not set `ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS` in Render. That test-only escape hatch is accepted only when `NODE_ENV=test` and cannot enable production signup.

`TRUST_PROXY=true` tells the login limiter to use the client address supplied by Render's trusted reverse proxy instead of treating every proxied request as one visitor. Do not enable it when exposing the Node process directly to the public internet.

Do not add `STRATA_DATA_DIR` and do not add a Render disk. Save the variables and deploy. The server performs an additive Turso migration on startup, including the community weekly-plan structure, without replacing existing users, private plans, ratings, purchases, or account-security data. **Do not delete the Turso database or its accounts for this upgrade.** The server also verifies foreign-key enforcement.

`/healthz` performs a live database query and returns `200` only while account storage is reachable, so Render can detect a lost Turso connection instead of treating the static homepage as healthy.

### Account troubleshooting

Open these URLs on the deployed site before testing signup:

- `/api/status` should return JSON containing `"build":"6.9.8"`, `"storage":"turso"`, `"persistent":true`, `"emailVerificationEnabled":true`, `"emailVerificationConfigured":true`, `"passwordResetEnabled":true`, `"accountDeletionEnabled":true`, and `"adminConfigured":true`. The response exposes readiness booleans only, never the administrator address or any credential value.
- `/healthz` should return HTTP `200` with `{"ok":true}`.
- A `404` or an HTML page means the project is not running as the Node Web Service.
- `/api/status` succeeding while `/healthz` returns `503` means Render cannot currently query Turso; recheck the database URL, token, and Turso database availability.

The browser health badge is advisory. It never disables the form: the signup request itself is authoritative and now reports a retryable storage error when the database cannot be reached.

### 3. Verify persistence

Create a test account and save a workout. In Render, trigger **Manual Deploy → Deploy latest commit**, then sign in again and confirm the plan remains.

## Resend account-email setup

Build 6.9.1 uses Resend for signup verification, password-reset links, account-deletion confirmation links, support acknowledgments and owner notifications, and administrator replies. Signup codes expire after 10 minutes, permit at most five incorrect attempts, and cannot be resent until 60 seconds have passed. The entire pre-account challenge ends after 30 minutes. STRATA keeps the challenge in a short-lived, HttpOnly pre-authentication cookie and stores only an HMAC digest of the code in Turso—not the code itself. A new user row and normal account session are created atomically only after a correct code.

The migration also adds a durable `email_verified_at` marker. Existing 6.6/6.7.0 user rows begin unverified because the old schema had no trustworthy proof that their inbox had been checked. After verification is enabled, each existing user enters the correct password and completes one email code at the next login. Their user ID, password hash, planner, preferences, ratings, and Strata+ purchases stay attached to the same account. Older sessions are denied while the marker is empty, then revoked when verification succeeds so only the new verified session remains.

### 1. Verify the sending subdomain

1. Create a Resend account, open **Domains**, and add `auth.stratafitness.online`. Resend [recommends a subdomain](https://resend.com/docs/add-a-domain) for transactional mail so its sending reputation and DNS records stay separate from the main website.
2. At the DNS provider for `stratafitness.online`, add the exact DKIM and SPF records Resend displays. Do not replace the website's existing A, AAAA, or CNAME records. If the DNS provider offers HTTP proxying for a Resend CNAME, leave that record DNS-only.
3. Wait until Resend reports the domain as **Verified**. DNS changes often appear quickly but can take longer to propagate. Add a DMARC record after verification as recommended in Resend's domain guide.

The From address is `STRATA <accounts@auth.stratafitness.online>`. Resend permits any From address on a verified domain; that address does not need a separate mailbox. Replies are directed to `stratafitness.official@gmail.com` through `EMAIL_REPLY_TO`.

### 2. Create the two private secrets

In Resend, create an API key named `strata-render-production` with **Sending access** and restrict it to `auth.stratafitness.online`. Resend's [API-key guide](https://resend.com/docs/create-an-api-key) explains these least-privilege options. Copy the key once and enter it directly in Render as `RESEND_API_KEY`; never put it in GitHub, browser JavaScript, screenshots, logs, or chat.

Create a different high-entropy secret for `EMAIL_VERIFICATION_SECRET`. For example, run this locally and paste only the resulting value into Render:

```bash
openssl rand -base64 48
```

This secret protects each six-digit-code HMAC and also keys private email-rate-limit identifiers and Resend idempotency values. It must not equal the Resend API key, a Paddle secret, a Turso token, or a user password. Rotating it invalidates every pending verification challenge, but does not affect already-created accounts or already-issued password-reset/deletion links, whose random tokens are hashed separately.

### 3. Deploy with account email enabled

Add these values on the STRATA Render Web Service's **Environment** page:

```text
EMAIL_VERIFICATION_ENABLED=true
RESEND_API_KEY=<the private sending-only key copied from Resend>
EMAIL_FROM=STRATA <accounts@auth.stratafitness.online>
EMAIL_REPLY_TO=stratafitness.official@gmail.com
EMAIL_VERIFICATION_SECRET=<the independent random value>
```

If these exact settings are already working in Build 6.7.1, keep them unchanged while deploying 6.9.8. Startup creates the new tables and columns before the server begins accepting requests, so a separate database reset or email-off migration deploy is not required. After the deploy:

1. Confirm `/healthz` still returns HTTP `200` and `/api/status` reports Build 6.9.8 with Turso persistent, every account-email flag `true`, and `adminConfigured:true`.
2. Sign in to one existing account and confirm its planner and Strata+ entitlement are unchanged.
3. Confirm the Resend domain is verified and the API key, From address, Reply-To address, and HMAC secret remain present in Render.

For a brand-new installation whose Resend domain or secrets are not ready, use `EMAIL_VERIFICATION_ENABLED=false` temporarily. New signup, password reset, and deletion email requests then fail closed instead of creating an unsafe account action. Change it to `true` only after all email settings are valid. If Resend or HMAC configuration is incomplete while enforcement is requested, STRATA fails closed for unverified accounts and new signup until the configuration is corrected; accounts already marked verified can still sign in. Do not disable that protection in source code or reuse another service's secret.

### 4. Test the complete signup flow

Use a private/incognito window and an email inbox you control:

1. Submit a new name, email, and password. Confirm STRATA shows the six-digit-code step and does not create an authenticated account session yet.
2. In Resend **Emails/Logs**, confirm the verification message was accepted, then check the inbox and spam folder. Resend's [Send Email API](https://resend.com/docs/api-reference/emails/send-email) is the authoritative delivery reference.
3. Enter the code within 10 minutes. Confirm account creation completes, a normal session begins, and the planner works on a second device after signing in.
4. Confirm an incorrect code is rejected, five incorrect attempts end that challenge, and requesting another email is blocked for the first 60 seconds.
5. Request a new code after the cooldown and confirm the older code no longer works. Also confirm that a code or challenge older than its 10-minute/30-minute limit is rejected cleanly.
6. For an existing account, confirm the correct password leads to email verification, the old session cannot access `/api/me`, and the verified session preserves the existing planner and Strata+ access.

Verification, password-reset, and deletion-confirmation messages are essential transactional account mail, not marketing messages. Resend's published free-account limits are currently 100 transactional emails per day and 3,000 per month, with a default API rate limit of 10 requests per second; check the Resend **Usage** page and the current [quota documentation](https://resend.com/docs/knowledge-base/account-quotas-and-limits) rather than assuming those limits will never change. If Resend is temporarily unavailable, verified users must still be able to sign in; new users can retry or resend instead of receiving a partially created account.

## Password reset and account deletion

Password reset is available from both account states:

- A signed-out person selects **Forgot password?** on `/account.html`, or opens `/forgot-password`, and enters the registered email address. The response is deliberately identical whether or not an account exists.
- A signed-in person opens **Account Security** on `/account.html` and asks STRATA to send a reset link to the registered address. The browser cannot choose a different recipient.

Each reset email contains a random, one-time link that expires after 30 minutes. The bearer token is placed in the URL fragment, removed from the address bar immediately by the reset page, and stored only as a SHA-256 hash in Turso. After the user enters a new 10–128 character password, STRATA stores a new per-user salted scrypt hash, increments `auth_version`, invalidates every old session and pending account-action link, and requires a fresh sign-in. The version check also prevents a login that verified the old password just before reset from creating a surviving session afterward.

Account deletion starts only from the signed-in **Account Security** panel. STRATA sends the confirmation link to the account’s registered email. Opening that link is read-only: deletion requires a second explicit submit with the exact word `DELETE`. A pending request can be canceled from the Account page, and checkout cannot start while deletion is pending. Requesting or opening the email never changes a Paddle transaction; payment reconciliation occurs only after the owner submits `DELETE`. A recent or processing Paddle payment then blocks deletion so a late payment cannot be detached from its account. When an abandoned local checkout is more than 30 minutes old, STRATA checks its live Paddle state and cancels it only if Paddle reports a cancelable `draft`, `ready`, or `billed` status and confirms the cancellation. A valid remote completion repairs a missed local completion before deletion proceeds; paid, past-due, malformed, unknown, or unreachable states fail closed.

Completed deletion permanently removes the local user, sessions, planner, preferences, ratings, account-action data, and local Paddle purchase/entitlement mapping. It does not erase Paddle’s independent merchant-of-record records and does not issue a refund. A newly created account using the same email receives a new user ID and does not inherit Strata+; request any eligible refund before deleting. Test deletion only with a disposable account, not an account whose data or purchase access you need.

After deployment, test all three paths:

1. Signed out: request a link from `/forgot-password`, reset the password, then confirm the old password and all old sessions fail while the new password works.
2. Signed in: request another reset from **Account Security** and confirm it is delivered to the registered address.
3. Disposable account only: request deletion, verify that merely opening the email does nothing, cancel one request, request again, type `DELETE`, and confirm the account can no longer sign in.

## Paddle live setup

This build is wired to the following live catalog item:

| Item | Live ID | Required value |
| --- | --- | --- |
| Strata+ product | `pro_01m1ky8j916ybyacs836dxbz8x` | Digital access to the Strata+ studio |
| One-time price | `pri_01m1kyc2zd313d7a3ssmg02424` | `$5.99 USD`, non-recurring |
| Checkout domain | `stratafitness.online` | Approved in Paddle live |
| Default payment link | — | `https://stratafitness.online/pricing` |
| Webhook URL | — | `https://stratafitness.online/api/paddle/webhook` |

Paddle sandbox IDs, tokens, API hosts, and test-mode environment calls must not be used in the deployed build. Live Paddle.js is the default; there should be no `Paddle.Environment.set("sandbox")` call.

### 1. Check the live catalog

In the Paddle live dashboard, open the catalog and confirm the product and price IDs above belong together. The price must be an active, one-time `$5.99 USD` price, not a subscription. If the live price is wrong and has already been used, create a new price and update both `PADDLE_PRICE_ID` and the public pricing copy together; never delete or repurpose live records that may have transaction history.

### 2. Add credentials to Render

Open the STRATA Web Service in Render, then **Environment**. Add every variable shown in the deployment section above.

- `PADDLE_CLIENT_TOKEN` must be a **live** client-side token beginning with `live_`. Paddle.js intentionally exposes this token in the browser.
- `PADDLE_API_KEY` must be a current **live** API key beginning with `pdl_live_apikey_`. It is server-only and needs the `transaction.write` permission.
- `PADDLE_WEBHOOK_SECRET` is the notification destination's endpoint secret. Add it only after completing the next step.
- The current tested production deployment uses `PADDLE_CHECKOUT_ENABLED=true`. For a new or unverified deployment, use `false` as a safety switch until configuration can be checked without letting visitors begin checkout.

The product ID and price ID are identifiers, not credentials. The API key and webhook secret are credentials. Never paste the API key or webhook secret into chat, source code, client JavaScript, screenshots, Git commits, or public logs. Enter them directly in Render. If either is exposed, rotate it in Paddle and update Render immediately.

### 3. Approve the domain and payment link

In the Paddle **live** dashboard:

1. Confirm business and identity verification shows complete.
2. Open **Checkout → Checkout settings → Domains** (or **Request domain approval**) and submit `stratafitness.online`. Wait until its status is **Approved**.
3. In **Checkout settings**, set the default payment link to `https://stratafitness.online/pricing`.
4. Enable the payment methods you want Paddle to offer.
5. Turn on Paddle's **display discount field on the checkout** option so the private family code can be entered. STRATA also requests the discount field when it opens checkout.

Live checkout will not open until verification has passed and the live domain is approved. The default payment link must use the real HTTPS deployment, not localhost.

### 4. Create the live webhook destination

In **Developer tools → Notifications**, create one live notification destination:

```text
Description: STRATA production
URL: https://stratafitness.online/api/paddle/webhook
Events:
  transaction.completed
  transaction.canceled
  transaction.paid
  transaction.past_due
  transaction.payment_failed
  adjustment.created
  adjustment.updated
```

Copy the destination's endpoint signing secret into Render as `PADDLE_WEBHOOK_SECRET`. Reuse this destination after it exists—do not delete and recreate it as cleanup, because that changes the signing secret and stops STRATA from accepting future notifications. On a new integration, redeploy while `PADDLE_CHECKOUT_ENABLED` remains `false`; the already-tested live deployment keeps it `true`.

STRATA verifies the `Paddle-Signature` HMAC against the exact raw request body before processing an event. It records webhook event IDs for idempotency, validates the live product and price before granting access, and treats refund/chargeback adjustments as entitlement changes. Payment-status events keep the local purchase ledger current. A failed attempt that remains `ready` reuses the same checkout; only stale `draft`, `ready`, or `billed` transactions are canceled after Paddle validates ownership and catalog metadata and confirms their cancellation, while unresolved `paid` or `past_due` transactions stay blocked. Every create attempt also carries a durable server checkout reference, so a retry searches Paddle for an interrupted transaction before it can create another. Paddle's [signature-verification guide](https://developer.paddle.com/webhooks/about/signature-verification) explains why the raw body and signing secret must be preserved.

On Render, keep `PADDLE_ENFORCE_IP_ALLOWLIST=false`. During the live test, Render's proxy did not expose Paddle's source address in a form that matched Paddle's published CIDRs, so enabling the optional allowlist rejected genuine notifications with HTTP `403`. This setting disables only the additional source-IP filter. STRATA still rejects every webhook without a valid `Paddle-Signature` HMAC calculated over the exact raw request body using the private `PADDLE_WEBHOOK_SECRET`. A host that reliably preserves the originating IP may opt into the dynamically fetched allowlist after testing it.

### 5. Create the private family discount

Create this manually in the Paddle live catalog so the code never appears in the repository:

```text
Type: Percentage
Amount: 100% off
Applies to: Strata+ only
Maximum uses: 4 total
Code: choose a private code that is not easy to guess
```

Share the code privately with only the four intended people. Do not place it in HTML, JavaScript, this README, screenshots, analytics, or support examples. A redemption still creates a real Paddle transaction and the same signed webhook-driven entitlement. If the owner uses one of the four redemptions for the launch test, three remain. If all four family redemptions must remain unused, make a separate one-use 100% launch-test discount and archive only that test discount afterward. Do not archive the family discount while it is still needed.

### 6. Run the live end-to-end test

Do this only after the live domain is approved, verification is complete, the webhook secret is set, and the newest build is deployed:

1. Set `PADDLE_CHECKOUT_ENABLED=true` in Render and deploy.
2. Open `https://stratafitness.online/pricing` in a fresh browser session and sign in to a test account.
3. Start checkout. Confirm it shows Strata+ as a one-time `$5.99 USD` purchase, not a subscription.
4. Apply the private 100% discount and confirm the total is `$0.00` before completing the live checkout yourself. Paddle may not request card details for a zero-total checkout.
5. In Paddle, confirm the live transaction is `completed`.
6. In **Developer tools → Notifications**, confirm `transaction.completed` was delivered to the STRATA webhook and received an HTTP `2xx` response.
7. Return to STRATA. Strata+ should unlock only after the webhook is processed. Refresh, sign out and back in, then check a second device to confirm the entitlement is stored in Turso rather than only in the browser.
8. Confirm the weekly planner still works without buying Strata+, and that another signed-in account without an entitlement is sent to pricing instead of opening Strata+.

This is a one-time product, so Paddle's subscription upgrade, scheduled-cancellation, and immediate-cancellation test steps do not apply. A `$0.00` transaction has nothing to refund. Refund behavior is covered by automated signed-webhook tests; if you later choose to test it with a real paid transaction, issue the refund from Paddle and verify the adjustment webhook removes access. Do not take a paid test merely to prove refunds.

If checkout, webhook delivery, or entitlement granting fails, immediately set `PADDLE_CHECKOUT_ENABLED=false` and redeploy. That stops new checkout creation while preserving existing account and entitlement records. Correct the problem, repeat the test, and leave the switch `true` only when every check above passes.

### 7. Open to customers

Before sharing the launch link, make one final pass:

- `/pricing`, `/contact`, `/terms`, `/privacy`, and `/refunds` all load publicly and show the same `$5.99 USD` one-time offer and 14-day refund policy.
- The approved checkout domain serves the actual STRATA app, not a placeholder.
- Render has the live token, live API key, webhook secret, current product/price IDs, and `PADDLE_CHECKOUT_ENABLED=true`.
- The latest live checkout completed, its webhook returned `2xx`, and Strata+ stayed unlocked after a new login.
- The private family code is not present in source or public content.

Official references: [Paddle go-live checklist](https://developer.paddle.com/build/go-live-checklist), [default payment link](https://developer.paddle.com/build/transactions/default-payment-link), and [notification destinations](https://developer.paddle.com/webhooks/about/notification-destinations).

## Included

- Exercise rankings, sub-muscle navigation, search, and equipment/level filters
- Twenty-five curated movements per region, including at least six bodyweight choices in every region and portable resistance-band options
- Paid `/discover.html` studio for signed-in users with an active Strata+ entitlement
- Visible two-to-four exercise battle builder with an inline result covering targets, scores, stability, range, resistance profile, progression, setup, equipment, and practicality
- Account-saved goal, experience, equipment, training-day, preference, and movement-constraint profile
- Personalized rankings and alternatives with an explained editorial match percentage and explicit gains/trade-offs
- Separate official FitScore and community rating; one replaceable six-part rating per account and exercise
- Search by exercise, muscle, equipment, pattern, or goal, plus filters, sorts, and quick collections including bodyweight-only discovery
- Downloadable/mobile-share exercise, comparison, and personalized-shortlist image cards
- Detailed scoring, execution notes, prescriptions, and cautions
- YouTube tutorial-search links for all 200 exercises
- Server-side account creation and login
- Separate, always-visible **Sign up** and **Log in** links on the homepage plus a server-rendered profile link for active sessions
- Dedicated `/account.html` page with native server-submitted signup/login forms, so account access does not depend on homepage JavaScript
- Resend-delivered six-digit email verification for new signups, with a 10-minute code, five-attempt limit, 60-second resend cooldown, and hard 30-minute challenge
- HMAC-only verification-code storage, a short-lived HttpOnly pre-authentication cookie, and no user row or normal session until verification succeeds
- Durable verification state for new and existing accounts; legacy IDs, plans, ratings, preferences, and purchases are preserved through the one-time email check
- Revocation of pre-verification sessions when an existing account completes its email check
- Signed-out **Forgot password** and signed-in password reset, both delivered only to the registered email with a 30-minute, one-time link
- Credential-version rotation and complete session revocation after reset, including protection against an old-password login racing the reset
- Signed-in account-deletion request, registered-email confirmation, cancel control, explicit `DELETE` confirmation, and transactional local-data cleanup
- Checkout/deletion interlocks that prevent deletion from orphaning a pending Paddle transaction
- Scrypt password hashing with per-user random salts
- No plaintext or reversibly encrypted passwords are stored
- Random database-backed sessions in HttpOnly, SameSite cookies
- Same-origin write checks, strict same-site cookies, parameterized SQL, request-size limits, and basic login rate limiting
- Live Paddle checkout with server-created one-time transactions, CSRF protection, signed raw-body webhooks, idempotent event handling, and server-side entitlements
- Refund and chargeback adjustment handling that revokes Strata+ access when appropriate
- Visible build number on every page and versioned browser assets to prevent old scripts from surviving a deployment
- Authenticated `/discover.html` plus a login-free, device-saved `/planner.html` with optional account sync
- Seven-day schedule with optional drag-and-drop plus keyboard/touch day and reorder controls
- Serialized account autosaves, navigation flushing, editable sets/reps, and a guaranteed empty recovery day
- Signed-in publishing of the current weekly plan as validated structured data, with no binary uploads or email-address exposure
- Strata+-only community plan browsing, explicit replacement of the current saved week when applying a plan, and owner-controlled unpublishing
- Private Strata+ Monthly Plan workspace that can copy the signed-in weekly plan or locally import its STRATA JSON export
- Multiple muscle targets or an explicit rest choice for every weekday, with deterministic generation of exactly 31 dated days and account sync through Turso
- Print-optimized monthly-plan output for browser **Save as PDF**, plus deliberate OS share, clipboard, and text-file fallbacks
- Responsive desktop, tablet, and mobile layouts
- Debounced catalog search and progressive mobile/desktop result batches for fast browsing as the library grows
- Gzip responses for larger catalog and discovery payloads on compatible browsers
- Installable PWA with 192px, 512px, maskable, and Apple touch icons
- Device-aware installation guide for iPhone, iPad, Android, Chrome, and Edge
- Public Strata+ pricing, contact, Terms of Service, Privacy Policy, and 14-Day Refund Policy pages
- Responsive About the Founder section with UAEU and Al Ain background
- Safe-area support, 44px mobile controls, narrow-screen navigation, and iPhone form-zoom prevention
- Network-first navigation with a clear offline page; private account data is never put in the PWA cache

## Storage modes

- Without `TURSO_DATABASE_URL`: local SQLite file for development and tests.
- With `TURSO_DATABASE_URL`: remote Turso database for production.
- Production intentionally fails fast if Turso credentials are missing, preventing accidental deployment with disposable account data. There is no production override because accepting accounts into temporary storage would lose user credentials and plans.

## Tests

```bash
npm test
```

The suite checks authentication and persistence APIs, protected password storage, pending-signup isolation, code HMAC validation, verification expiry and attempt limits, resend rotation and cooldowns, provider failures, Turso-safe returned-row completion semantics, legacy-account one-time verification, one-time reset/deletion tokens, registered-email delivery, reset replay prevention, credential-version login races, full session revocation, deletion cancellation and cascades, preservation of unrelated account and payment data, community weekly-plan ownership, Strata+ browse/apply gating, explicit replacement behavior, admin ownership and session rotation, primary-owner protection, redacted management APIs, audited account actions, optimistic support updates, durable help-form limits, secret/card rejection, support-mail idempotency, pending-checkout interlocks, live Paddle configuration, signature verification, webhook idempotency, checkout/entitlement boundaries, refund handling, PWA installation and cache-safety rules, and the pure discovery engine: scoring contributions, personalization exclusions, target-compatible battles and alternatives, request limits, plan validation, search/filter behavior, source data, and all 200 YouTube links.

Run the browser-free runtime checks as well with:

```bash
npm run qa
```

The optional Playwright UI audit is documented in `qa/README.md`.

## Production limitations

Render Free web services spin down after periods of inactivity and can take time to wake. The installed PWA cannot prevent that cold start: it shows the offline page until the server is reachable, and account syncing still needs the live Render and Turso services. Render instances also have an ephemeral local filesystem and usage limits; review [Render's current Free-instance limits](https://render.com/docs/free) before deployment. Email delivery additionally depends on Resend and valid DNS authentication for `auth.stratafitness.online`. For real users, use an appropriate production service tier and operational monitoring. STRATA has one password-stepped-up owner account, but does not yet include MFA, multiple administrator roles, file attachments, real-time chat, or automated community-content moderation.

## Editorial note

FitScore is an editorial synthesis for hypertrophy-oriented exercise selection. It is not a validated clinical scale, personalized prescription, or a claim made by the cited sources.
