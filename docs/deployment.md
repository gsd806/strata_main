# Deployment and provider operations

This guide keeps operational detail out of the project overview. Read [architecture.md](architecture.md) before changing a trust boundary, and read [../SECURITY.md](../SECURITY.md) before reporting a vulnerability.

## Deployment model

STRATA must run as a Node web service. A static host can display files but cannot provide authentication, account APIs, protected pages, webhooks, or persistent plans.

The checked-in `render.yaml` defines the supported Render service shape:

- Node 24 selected by `.node-version`;
- `npm install --omit=dev --no-audit --no-fund` for production dependencies;
- `npm start` as the process command;
- `/healthz` as the storage-aware health check; and
- secret values entered in the host rather than committed to the repository.

Local development uses SQLite. Production refuses to start without Turso, because Render's local filesystem is ephemeral and must not become the durable account store.

## Local setup

```bash
npm install
npm run check
npm start
```

The default address is `http://127.0.0.1:4173`. Keep the Turso variables blank to create a local database below `data/`. Use `.env.example` as the variable inventory; it contains placeholders, not credentials.

## Turso and Render

1. Create a Turso database in a suitable region.
2. Create a database authentication token and store it in Render as `TURSO_AUTH_TOKEN`.
3. Store the database URL as `TURSO_DATABASE_URL`.
4. Deploy from the repository's Render Blueprint, or reproduce the Web Service settings in `render.yaml` exactly.
5. Do not configure `STRATA_DATA_DIR` or a Render disk in production.
6. Deploy, then verify both `/api/status` and `/healthz`.

Fixed runtime settings include `NODE_ENV=production`, `HOST=0.0.0.0`, `TRUST_PROXY=true`, and the public HTTPS `APP_BASE_URL`. Only enable `TRUST_PROXY` behind the configured trusted reverse proxy; a directly exposed Node process must not trust arbitrary forwarding headers.

The server applies additive schema setup on startup and checks foreign-key behavior. Do not delete or replace a production database as an upgrade step. After a deployment, create or use a test account, save a plan, redeploy, and confirm that the same account and plan remain available.

Operational endpoints:

- `/api/status` reports build and provider-readiness booleans without returning secrets.
- `/healthz` runs a live store probe and returns `200` only when storage is reachable.

A `404` or HTML response from those endpoints normally means the project was deployed as a static site or the wrong service. A successful status response with a `503` health check points to Turso connectivity or credentials.

## Resend account email

Resend delivers signup verification, password reset, account-deletion confirmation, support acknowledgments and notifications, and administrator replies. It never stores account passwords.

1. Verify the dedicated sending subdomain in Resend and finish its DNS authentication.
2. Create a restricted sending API key.
3. Generate an independent high-entropy `EMAIL_VERIFICATION_SECRET` of at least 32 characters. Do not reuse the Resend key, a session secret, or a Paddle credential.
4. Configure `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SUPPORT_EMAIL`, `EMAIL_VERIFICATION_SECRET`, and the HTTPS `APP_BASE_URL` in Render.
5. Set `EMAIL_VERIFICATION_ENABLED=true` only after every value is valid and mail delivery has been tested.

The application fails closed when email enforcement is requested but incomplete. Do not use `ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS` outside `NODE_ENV=test`; the server intentionally rejects that escape hatch in production.

Test the complete flow with a non-owner address: sign up, receive and submit the verification code, sign out/in, request a password-reset link, and confirm that using it revokes existing sessions. Also verify deletion mail only goes to the registered address and that a used or expired action link cannot be replayed.

## Primary administrator and support

`ADMIN_EMAIL` identifies the one account eligible to claim the empty primary-owner binding after email verification. The binding is stored by immutable user ID, so changing the environment variable alone does not transfer ownership. Keep that account recoverable and never expose the configured address through readiness APIs.

`SUPPORT_EMAIL` is the reply destination for the Contact and help-desk workflows. The same Resend configuration sends mail; no Gmail API or separate administrator password is needed.

After owner setup, verify password step-up, the 30-minute elevation expiry, session rotation, primary-owner self-protection, support responses, and the redacted audit trail.

## Paddle live checkout

Paddle is the merchant of record for the one-time Strata+ purchase. The current public amount and catalog identifiers must stay aligned with the live catalog and `render.yaml`.

Required configuration:

- `PADDLE_PRODUCT_ID` and `PADDLE_PRICE_ID` for the active one-time USD price;
- `PADDLE_CLIENT_TOKEN`, a live browser-safe client token;
- `PADDLE_API_KEY`, a private live server key with transaction-write access;
- `PADDLE_WEBHOOK_SECRET`, the notification destination's signing secret; and
- `PADDLE_CHECKOUT_ENABLED`, the launch/rollback switch.

Create or reuse a live notification destination at:

```text
https://stratafitness.online/api/paddle/webhook
```

Subscribe to the transaction lifecycle events used by the application, `transaction.completed`, and adjustment creation/update events. Reusing the destination preserves its signing secret; deleting and recreating it requires an intentional secret rotation in Render.

STRATA verifies `Paddle-Signature` over the exact raw request body before parsing JSON. A completed event grants access only when the transaction was created by STRATA and its transaction, product, price, account custom data, and completion state all match server-side records. Browser redirects and client tokens never grant entitlement. Event IDs, transaction state, and adjustments are stored so retries and replays remain idempotent.

Keep `PADDLE_CHECKOUT_ENABLED=false` for a new or unverified setup. Enable it only after the domain/default payment link is approved and a live end-to-end transaction reaches the matching account. Verify another browser session sees the entitlement, then process the intended test refund or adjustment and confirm access is revoked when required.

If checkout creation, webhook delivery, or entitlement granting fails, disable the switch and redeploy. That stops new purchases without deleting existing transactions or account entitlements.

`PADDLE_ENFORCE_IP_ALLOWLIST` is an optional defense in depth, not a replacement for signatures. Enable it only on a host that reliably preserves Paddle's originating address and only after testing through the real proxy. The current Render configuration leaves it false because an incorrect proxy address can reject genuine signed notifications.

Keep private promotion codes in Paddle and share them privately. Never place a code in HTML, browser JavaScript, repository documentation, screenshots, analytics, or support examples.

## Release verification

Before deployment:

```bash
npm ci
npm run check
npm run coverage
npm audit --omit=dev
```

`npm run check` verifies release metadata, runs the correctness-focused linter, executes the Node tests, and runs browser-free runtime QA. Coverage is reported separately as an informational baseline without a percentage gate. Use `npm run qa:ui` with the environment documented in `../qa/README.md` for the optional real-browser accessibility and responsive-layout pass.

After deployment:

1. Check `/api/status` and `/healthz`.
2. Confirm account, protected-page, service-worker, and manifest responses have the expected cache policy.
3. Complete a signup/login and plan-save round trip.
4. Exercise provider flows after changing Resend or Paddle configuration.
5. Confirm GitHub Actions is green before tagging or announcing a release.

## Production limits

Free Render services can sleep and take time to wake. The installed PWA may show its public offline explanation during a cold start, but private data and writes still require the live server. Free services and Turso/Resend/Paddle plans also have usage limits; select appropriate tiers and monitoring before relying on the service for real users.

The current administrator model has one password-stepped-up owner and no MFA or delegated roles. Support has no attachments or real-time chat. Treat these as operating limits rather than silently broadening privileges or storing new sensitive content.
