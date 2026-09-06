# STRATA 7.1.2 — Review and deployment guide

This candidate updates the delivered 7.1.1 source. It has not been deployed and does not change live provider configuration.

## User-journey changes

Strata+ now opens as a dashboard rather than dropping the member into a tool. The hero has one state-aware action: `Start working out` when the saved week contains training, or `Build my first week` when it does not. Weekly-plan editing stays in the plan pulse so the same destination is not presented twice. The seven tools have equal visual weight, descriptive labels, and one visible workspace at a time; direct tool hashes remain shareable.

Recommendation headings are stable interface copy and never include the account display name. Long names are constrained in navigation and may still appear as escaped account context where appropriate. Light recommendation/profile surfaces use dark text, dark workspaces use light text, keyboard focus remains visible, reduced-motion preferences are respected, and mobile navigation switches to the same bottom-bar model across Strata+, Plan, and Train at 760 px and below.

An empty workout day no longer leaves an unusable Start control. It offers the next scheduled day or Plan instead. Clean synced active sessions appear once in history; a newer unsaved device draft appears once in recovery. Starting again in one tab focuses that visible Resume action. Concurrent stale tabs receive the canonical active workout from the server and resume it instead of creating a second active account session.

Weekly setup now reads and writes the plan and matching recommendation profile as one operation. The save checks both server revisions and the account identity. Existing seven-day weeks are presented with a clearly disclosed Sunday recovery default because setup accepts one to six training days; nothing is saved until the member previews and confirms the replacement.

## Storage and compatibility

Local SQLite and Turso use the existing plan and preference records, with a new atomic store operation that advances both records together. Existing weekly plan JSON, workout history, guest plans, templates, ratings, and entitlement records remain compatible.

This release adds a partial unique workout index that enforces one active workout per account at the database boundary, including across application instances. During startup migration, if legacy data contains more than one active workout for an account, the most recently updated session remains active. Older duplicates are retained as completed history with their exercise and set data intact. Index creation and reconciliation run in one write transaction for both SQLite and Turso.

## Deployment

1. Use Node 24 and the existing Turso, Paddle, and Resend configuration. Do not change credentials or catalog identifiers for this release.
2. Run `npm ci`, `npm run check`, and the authenticated `npm run qa:ui` matrix with Chromium available.
3. Take a verified online backup using the existing deployment guide.
4. Deploy the complete 7.1.2 server, browser assets, and service worker together. Existing open tabs should refresh before editing plans or resuming workouts.
5. Confirm signed-out/free boundaries, paid and trial access, plan/profile setup replacement, empty-day routing, one active workout across two tabs or application instances, and installed-PWA cache activation.

## Rollback

Keep the pre-release database backup, but do not restore it automatically because doing so would discard plans and workouts created after deployment. Prefer a forward fix. Do not run the 7.1.1 workout writer against a database already migrated by 7.1.2: the retained unique active-workout index expects the new conflict-handling path. If rollback is unavoidable, pause writes and either keep the 7.1.2 workout write path or remove `workouts_one_active_per_user` as an explicit migration step after confirming there is no other application writer. Refresh open clients and verify plan/profile timestamps before resuming traffic.

## Validation limits

See `docs/release-readiness.md` for local evidence. Local SQLite, emulated Turso contract tests, fake signed Paddle webhooks, and test-mode email do not establish hosted Turso capacity or real Paddle/Resend readiness. No production account, purchase, email, deployment, or provider configuration is changed by these checks.
