# STRATA — Exercise Rankings and Weekly Planner

STRATA is an evidence-informed workout index with server-backed accounts, a private exercise-discovery studio, and a drag-and-drop weekly planner. It includes 160 resistance-training exercises—20 per muscle group, including 40 bodyweight options—across 8 muscle groups and 26 sub-muscle targets. Build 6.6.1 is an installable Progressive Web App (PWA) with Paddle-powered, one-time Discovery access.

## Requirements

- Node.js 24.x (the included `.node-version` selects the supported major)
- `npm install` once before the first run

## Project structure

Build 6.6.1 separates browser files from private server code while preserving every public URL used by visitors, Paddle, Render, and installed PWAs:

```text
server.js          Small root bootstrap used by `npm start`
src/               Private server, database, payment, and discovery data
public/pages/      HTML pages served at their existing URLs
public/scripts/    Browser JavaScript
public/styles/     Browser stylesheets
public/data/       Public exercise catalog
public/icons/      PWA and site icons
data/              Local-development SQLite files; generated and ignored
test/              Automated Node test suite
qa/                Runtime and optional browser checks
```

The organization is internal only. Routes such as `/pricing`, `/api/status`, `/api/paddle/webhook`, `/service-worker.js`, and `/manifest.webmanifest` have not changed. Never move `.env` files, Turso credentials, Paddle credentials, `src/`, or the generated root `data/` directory into `public/`. The exercise catalog in `public/data/` is intentionally public; the editorial discovery dataset in `src/data/` remains server-only.

## Run locally on a Mac

Open Terminal in this folder and run:

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`. Local development automatically creates `data/strata.sqlite`; no Turso account is needed locally.

## Install on a phone or computer

After deployment, open `/install.html` for plain-language instructions for iPhone, iPad, Android, Chrome, and Edge. On browsers that expose a native PWA prompt, the page also shows an **Install STRATA** button.

The PWA caches only public interface assets and an offline explanation page. Account APIs, authentication routes, health checks, personalized pages, and saved plans always go to the live server. An internet connection is therefore required to sign in, sync across devices, or save account changes.

## Public pricing, support, and policies

Build 6.6.1 has public, mobile-friendly pages at `/pricing`, `/contact`, `/terms`, `/privacy`, and `/refunds`. The homepage links to all five without requiring JavaScript or an account.

The homepage also includes an **About the Founder** section for Saeed Abdalla Alketbi, describing STRATA’s UAE roots and the engineering mindset behind the project. It intentionally publishes only the city-level location `Al Ain, UAE`; do not add a residential street address to the public site.

Discovery costs **$5.99 USD as a one-time purchase with no subscription**, and the public refund window is **14 calendar days after purchase**. Paddle handles checkout. The server grants Discovery only after a signed, live `transaction.completed` webhook matches the configured product, price, user, and server-created transaction. A browser callback alone never grants access. Do not change the public price independently of the Paddle catalog.

Support and policy requests go to `stratafitness.official@gmail.com`. Do not expose private promotion codes in public HTML, client JavaScript, screenshots, or repository documentation.

The public policies identify the operator only as STRATA Fitness because no verified legal name or postal/business address was supplied for this build. Before accepting payments, replace or supplement that identity with the exact operator details used for the Paddle account if Paddle or applicable law requires them. Do not invent operator details.

## Free hobby/demo deployment: Turso + Render

Render explicitly positions Free instances for testing and hobby projects rather than production use. The free filesystem is temporary, so STRATA refuses to start in production without a cloud database. Turso keeps accounts, sessions, preference profiles, community ratings, and weekly plans after Render restarts or redeploys.

**Deploy STRATA as a Node Web Service, never as a Static Site.** A static deployment can display the pages, but it cannot run the root `server.js` bootstrap, `/auth/signup`, or any `/api/*` route, so account creation will not work. The included `render.yaml` defines the correct Web Service automatically.

### 1. Create the free database

1. Create a free Turso account at `https://turso.tech`.
2. Create a database named `strata` in a nearby region.
3. Copy its database URL.
4. Create a database authentication token and copy it immediately.
5. Keep the token private. Never put it in GitHub, a screenshot, or a browser-side JavaScript file.

### 2. Configure the free Render web service

The simplest route is **New → Blueprint**, select the repository, and let Render read `render.yaml`. When prompted, enter the two Turso values and three private Paddle values. Render marks these five entries `sync: false`, so the secrets are not stored in the repository.

For manual setup, choose **Web Service** (not Static Site), connect the GitHub repository, and use:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
Instance Type: Free
```

Under Render's **Environment** page, add the following for the current, tested live deployment. The checked-in `render.yaml` uses these same non-secret production values:

```text
NODE_ENV=production
HOST=0.0.0.0
TRUST_PROXY=true
APP_BASE_URL=https://stratafitness.online
TURSO_DATABASE_URL=<the URL copied from Turso>
TURSO_AUTH_TOKEN=<the secret token copied from Turso>
PADDLE_PRODUCT_ID=pro_01m1ky8j916ybyacs836dxbz8x
PADDLE_PRICE_ID=pri_01m1kyc2zd313d7a3ssmg02424
PADDLE_CLIENT_TOKEN=<the live_ client-side token copied from Paddle>
PADDLE_API_KEY=<the private live API key copied from Paddle>
PADDLE_WEBHOOK_SECRET=<add this after creating the live notification destination>
PADDLE_CHECKOUT_ENABLED=true
PADDLE_ENFORCE_IP_ALLOWLIST=false
```

The live checkout has already passed an end-to-end test, so production keeps `PADDLE_CHECKOUT_ENABLED=true`. For a fresh or unverified Paddle setup, begin with the safe `.env.example` value `false`, finish the webhook test, and enable checkout only after the signed notification grants access correctly.

`TRUST_PROXY=true` tells the login limiter to use the client address supplied by Render's trusted reverse proxy instead of treating every proxied request as one visitor. Do not enable it when exposing the Node process directly to the public internet.

Do not add `STRATA_DATA_DIR` and do not add a Render disk. Save the variables and deploy. The server creates the Turso tables, including payment and Discovery-entitlement records, automatically on startup and verifies foreign-key enforcement.

`/healthz` performs a live database query and returns `200` only while account storage is reachable, so Render can detect a lost Turso connection instead of treating the static homepage as healthy.

### Account troubleshooting

Open these URLs on the deployed site before testing signup:

- `/api/status` should return JSON containing `"storage":"turso"` and `"persistent":true`.
- `/healthz` should return HTTP `200` with `{"ok":true}`.
- A `404` or an HTML page means the project is not running as the Node Web Service.
- `/api/status` succeeding while `/healthz` returns `503` means Render cannot currently query Turso; recheck the database URL, token, and Turso database availability.

The browser health badge is advisory. It never disables the form: the signup request itself is authoritative and now reports a retryable storage error when the database cannot be reached.

### 3. Verify persistence

Create a test account and save a workout. In Render, trigger **Manual Deploy → Deploy latest commit**, then sign in again and confirm the plan remains.

## Paddle live setup

This build is wired to the following live catalog item:

| Item | Live ID | Required value |
| --- | --- | --- |
| Discovery product | `pro_01m1ky8j916ybyacs836dxbz8x` | Digital access to the Discovery studio |
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
  transaction.payment_failed
  adjustment.created
  adjustment.updated
```

Copy the destination's endpoint signing secret into Render as `PADDLE_WEBHOOK_SECRET`. Reuse this destination after it exists—do not delete and recreate it as cleanup, because that changes the signing secret and stops STRATA from accepting future notifications. On a new integration, redeploy while `PADDLE_CHECKOUT_ENABLED` remains `false`; the already-tested live deployment keeps it `true`.

STRATA verifies the `Paddle-Signature` HMAC against the exact raw request body before processing an event. It records webhook event IDs for idempotency, validates the live product and price before granting access, and treats refund/chargeback adjustments as entitlement changes. Paddle's [signature-verification guide](https://developer.paddle.com/webhooks/about/signature-verification) explains why the raw body and signing secret must be preserved.

On Render, keep `PADDLE_ENFORCE_IP_ALLOWLIST=false`. During the live test, Render's proxy did not expose Paddle's source address in a form that matched Paddle's published CIDRs, so enabling the optional allowlist rejected genuine notifications with HTTP `403`. This setting disables only the additional source-IP filter. STRATA still rejects every webhook without a valid `Paddle-Signature` HMAC calculated over the exact raw request body using the private `PADDLE_WEBHOOK_SECRET`. A host that reliably preserves the originating IP may opt into the dynamically fetched allowlist after testing it.

### 5. Create the private family discount

Create this manually in the Paddle live catalog so the code never appears in the repository:

```text
Type: Percentage
Amount: 100% off
Applies to: STRATA Discovery only
Maximum uses: 4 total
Code: choose a private code that is not easy to guess
```

Share the code privately with only the four intended people. Do not place it in HTML, JavaScript, this README, screenshots, analytics, or support examples. A redemption still creates a real Paddle transaction and the same signed webhook-driven entitlement. If the owner uses one of the four redemptions for the launch test, three remain. If all four family redemptions must remain unused, make a separate one-use 100% launch-test discount and archive only that test discount afterward. Do not archive the family discount while it is still needed.

### 6. Run the live end-to-end test

Do this only after the live domain is approved, verification is complete, the webhook secret is set, and the newest build is deployed:

1. Set `PADDLE_CHECKOUT_ENABLED=true` in Render and deploy.
2. Open `https://stratafitness.online/pricing` in a fresh browser session and sign in to a test account.
3. Start checkout. Confirm it shows STRATA Discovery as a one-time `$5.99 USD` purchase, not a subscription.
4. Apply the private 100% discount and confirm the total is `$0.00` before completing the live checkout yourself. Paddle may not request card details for a zero-total checkout.
5. In Paddle, confirm the live transaction is `completed`.
6. In **Developer tools → Notifications**, confirm `transaction.completed` was delivered to the STRATA webhook and received an HTTP `2xx` response.
7. Return to STRATA. Discovery should unlock only after the webhook is processed. Refresh, sign out and back in, then check a second device to confirm the entitlement is stored in Turso rather than only in the browser.
8. Confirm the weekly planner still works without buying Discovery, and that another signed-in account without an entitlement is sent to pricing instead of opening Discovery.

This is a one-time product, so Paddle's subscription upgrade, scheduled-cancellation, and immediate-cancellation test steps do not apply. A `$0.00` transaction has nothing to refund. Refund behavior is covered by automated signed-webhook tests; if you later choose to test it with a real paid transaction, issue the refund from Paddle and verify the adjustment webhook removes access. Do not take a paid test merely to prove refunds.

If checkout, webhook delivery, or entitlement granting fails, immediately set `PADDLE_CHECKOUT_ENABLED=false` and redeploy. That stops new checkout creation while preserving existing account and entitlement records. Correct the problem, repeat the test, and leave the switch `true` only when every check above passes.

### 7. Open to customers

Before sharing the launch link, make one final pass:

- `/pricing`, `/contact`, `/terms`, `/privacy`, and `/refunds` all load publicly and show the same `$5.99 USD` one-time offer and 14-day refund policy.
- The approved checkout domain serves the actual STRATA app, not a placeholder.
- Render has the live token, live API key, webhook secret, current product/price IDs, and `PADDLE_CHECKOUT_ENABLED=true`.
- The latest live checkout completed, its webhook returned `2xx`, and Discovery stayed unlocked after a new login.
- The private family code is not present in source or public content.

Official references: [Paddle go-live checklist](https://developer.paddle.com/build/go-live-checklist), [default payment link](https://developer.paddle.com/build/transactions/default-payment-link), and [notification destinations](https://developer.paddle.com/webhooks/about/notification-destinations).

## Included

- Exercise rankings, sub-muscle navigation, search, and equipment/level filters
- Twenty curated movements per region, including five bodyweight choices in every region and portable resistance-band options
- Paid `/discover.html` studio for signed-in users with an active Discovery entitlement
- Visible two-to-four exercise battle builder with an inline result covering targets, scores, stability, range, resistance profile, progression, setup, equipment, and practicality
- Transparent FitScore contributions, weighted baseline, editorial adjustment, methodology boundaries, and direct evidence links
- Account-saved goal, experience, equipment, training-day, preference, and movement-constraint profile
- Personalized rankings and alternatives with an explained editorial match percentage and explicit gains/trade-offs
- Separate official FitScore and community rating; one replaceable six-part rating per account and exercise
- Search by exercise, muscle, equipment, pattern, or goal, plus filters, sorts, and quick collections including bodyweight-only discovery
- Downloadable/mobile-share exercise, comparison, and personalized-shortlist image cards
- Detailed scoring, execution notes, prescriptions, and cautions
- YouTube tutorial-search links for all 160 exercises
- Server-side account creation and login
- Separate, always-visible **Sign up** and **Log in** links on the homepage plus a server-rendered profile link for active sessions
- Dedicated `/account.html` page with native server-submitted signup/login forms, so account access does not depend on homepage JavaScript
- Scrypt password hashing with per-user random salts
- No plaintext or reversibly encrypted passwords are stored
- Random database-backed sessions in HttpOnly, SameSite cookies
- Same-origin write checks, strict same-site cookies, parameterized SQL, request-size limits, and basic login rate limiting
- Live Paddle checkout with server-created one-time transactions, CSRF protection, signed raw-body webhooks, idempotent event handling, and server-side entitlements
- Refund and chargeback adjustment handling that revokes Discovery access when appropriate
- Visible build number on every page and versioned browser assets to prevent old scripts from surviving a deployment
- Separate authenticated `/discover.html` and `/planner.html` experiences
- Seven-day schedule with optional drag-and-drop plus keyboard/touch day and reorder controls
- Serialized account autosaves, navigation flushing, editable sets/reps, and a guaranteed empty recovery day
- Responsive desktop, tablet, and mobile layouts
- Debounced catalog search and progressive mobile/desktop result batches for fast browsing as the library grows
- Gzip responses for larger catalog and discovery payloads on compatible browsers
- Installable PWA with 192px, 512px, maskable, and Apple touch icons
- Device-aware installation guide for iPhone, iPad, Android, Chrome, and Edge
- Public Discovery pricing, contact, Terms of Service, Privacy Policy, and 14-Day Refund Policy pages
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

The suite checks authentication and persistence APIs, protected password storage, live Paddle configuration, signature verification, webhook idempotency, checkout/entitlement boundaries, refund handling, PWA installation and cache-safety rules, and the pure discovery engine: scoring contributions, personalization exclusions, target-compatible battles and alternatives, request limits, plan validation, search/filter behavior, source data, and all 160 YouTube links.

Run the browser-free runtime checks as well with:

```bash
npm run qa
```

The optional Playwright UI audit is documented in `qa/README.md`.

## Production limitations

Render Free web services spin down after periods of inactivity and can take time to wake. The installed PWA cannot prevent that cold start: it shows the offline page until the server is reachable, and account syncing still needs the live Render and Turso services. Render instances also have an ephemeral local filesystem and usage limits; review [Render's current Free-instance limits](https://render.com/docs/free) before deployment. For real users, use an appropriate production service tier and operational monitoring. STRATA does not yet include email verification, password recovery, MFA, community moderation tools, or administrative account management; those require additional providers and deployment configuration.

## Editorial note

FitScore is an editorial synthesis for hypertrophy-oriented exercise selection. It is not a validated clinical scale, personalized prescription, or a claim made by the cited sources.
