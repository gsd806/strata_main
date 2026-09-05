# Security policy

## Supported versions

Security fixes are made on the current release line and `main`. Older builds may not receive patches; reproduce a report against the newest available build when practical.

## Report a vulnerability privately

Email `stratafitness.official@gmail.com` with the subject `STRATA security report`. Do not open a public GitHub issue, discussion, or pull request for an undisclosed vulnerability.

Please include:

- the affected route, feature, build, or commit;
- the security impact and who could be affected;
- minimal, repeatable steps or a proof of concept;
- relevant sanitized request and response details; and
- a safe way to contact you about follow-up questions.

Do not send passwords, session cookies, reset links, verification codes, API keys, database tokens, full payment details, or personal data. Redact secrets from logs and screenshots. If a live secret was exposed, revoke or rotate it through the owning provider instead of emailing it.

Reports will be reviewed and acknowledged as soon as practical. STRATA will validate the issue, prioritize it based on impact and exploitability, prepare a fix, and coordinate disclosure with the reporter when possible. Complex or provider-dependent issues may take longer to resolve.

## Research boundaries

Use accounts and data you control. Avoid privacy violations, social engineering, denial of service, automated high-volume traffic, destructive changes, accessing another person's records, or testing Paddle/Resend infrastructure outside STRATA's own integration surface. Stop and report the issue if testing could affect real users or production data.

## In scope

Useful reports include authentication or authorization bypasses, session or CSRF weaknesses, unsafe account-state changes, sensitive-data exposure, injection, forged or replayed payment events, PWA caching of private data, and dependency vulnerabilities with a demonstrated STRATA impact.

Feature requests, general support, FitScore methodology questions, and issues without a security impact should use the normal Contact page or GitHub issue tracker.
