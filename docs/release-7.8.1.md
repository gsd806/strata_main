# STRATA 7.8.1 — Session selection choices

Build 7.8.1 expands Build a session in Strata+ with four selection modes and optional muscle-group and specific-muscle focus. Members choose a brief, inspect the movements and their selection reasons, and explicitly add the result to a day in their saved week.

## Selection behavior

- **Random** varies the eligible movements within the selected focus. Saved equipment and movement limits still apply.
- **Not in my week** excludes exercise IDs already scheduled anywhere in the saved weekly plan. If the remaining eligible pool cannot satisfy the brief, the builder explains that the selection needs to change.
- **Needs focus** uses actual completed sets from today and the preceding 27 calendar days to favor less represented muscle targets within the selected focus. Planned exercises are not treated as completed work. Missing or partial history is disclosed, and an empty or unavailable relevant history uses personal fit as an explained fallback.
- **My preferences** combines the saved profile with the member's own overall and enjoyment ratings, saved movement board, and repeated completed exercise use, including muscle-group and specific-muscle patterns. Repeated use is described as training history rather than proof that the member liked an exercise.

The muscle-group and specific-muscle controls narrow the selected training focus. An unavailable combination receives an actionable explanation. Time remains an estimate, and every generated movement can be reviewed before saving.

## Plan and data behavior

Session generation reads the existing exercise catalog, account profile, saved week, ratings, movement board, and loaded workout summaries. It does not introduce a new account preference field or database migration. History-based reasons reflect the loaded history window, and a missing history response is not presented as an empty training record.

Adding a session uses the existing revision-checked weekly-plan save. Duplicate movements on the destination day are skipped, capacity and recovery-day limits remain enforced, and a changed week requires review before retrying. A session generated with Not in my week must be rebuilt if its movements appear in the refreshed plan before saving.

## Validation status

`node scripts/release-version.js --check` passed with Node.js 24.20.0: managed references align at 7.8.1 across 32 allowlisted files.

The complete `npm run check` passed on Darwin arm64 with Node.js 24.20.0 on 2026-09-10:

- 685 Node tests and 39 browser tests passed, with zero failures, skips, or cancellations.
- Coverage: 94.44% lines, 79.80% branches, and 89.61% functions; all enforced floors passed.
- Release alignment, architecture, boundary types, lint, all five runtime smoke checks, and performance budgets passed.
- The eight new session browser checks cover selection methods, specific-muscle filters, history fallbacks, strict exclusion, revision conflicts, explicit saves, and responsive controls at 320, 390, and 1440 pixels.
- An independent matrix exercised 1,025 successful selection combinations and 139 expected pool/role shortages without filter, duplicate, eligibility, or weekly-exclusion failures.

These are local source checks using isolated fixtures. The new candidate has not been deployed, and its exact commit still needs the required Node 24 Linux CI before release promotion. Results from [7.8.0](release-7.8.0.md) are historical.

## Deployment and rollback

Deploy the Node server and matching public assets together. Managed build references and the service-worker cache advance to 7.8.1. This feature introduces no new provider configuration, payment-catalog change, secret, or database migration.

Rollback consists of redeploying the prior application and its matching assets. Sessions already added to a weekly plan use the existing plan format and remain ordinary saved exercises.

See [release readiness](release-readiness.md), [module architecture](module-architecture.md), and [test architecture](testing.md) for the project's release requirements and recorded evidence.
