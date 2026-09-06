# STRATA 7.1.0 — Release readiness

**Status: reviewable candidate; not deployed or certified for production.** Hosted verification and a successful automated Chromium run remain launch gates.

## Delivered

Workout logging and resumable sessions; rest timer; completion/history; previous exercise performance and correctly scoped progress charts; first-week onboarding; undo and exercise replacement; reusable local week templates and JSON import; account draft recovery; account-switch and password-reset race fixes; isolated payment sandbox support; responsive visual/motion updates.

The starting point was the actual v7.0.0 GitHub source archive, with a second identical-content archive check. See [source provenance](verification/7.0.0-source.json), [changelog](../CHANGELOG.md), and [migration/deployment/rollback guide](release-7.1.0.md).

## Verification on this runner

| Check | Result |
| --- | --- |
| Node tests | 385 passed, zero failed |
| Measured coverage | 92.32% lines, 81.33% branches, 87.55% functions; existing floors preserved |
| Release/architecture/types/lint | Passed; 15 server modules, zero cycles, all within reviewed budgets |
| Account/discovery/planner/PWA runtime checks | Passed, including new stale-tab, undo, template, recovery and account-switch checks |
| Endpoint/storage performance budgets | Passed; 40 measured samples after 8 warmups per operation |
| SQLite online backup and restore | Passed with live WAL, fresh-directory restore, owner isolation and integrity checks |
| 100 users, distinct source IPs | Passed; 5,723 requests, zero unexpected errors, 300 expected conflicts |
| 100 users, shared source IP | Passed; 5,723 requests, zero unexpected errors, 300 expected conflicts |
| 100 users, shared IP, one CPU core | Passed; 5,723 requests, zero unexpected errors; local process affinity restricted to one core |
| Real desktop browser training flow | Passed the scoped manual journey described below |
| Automated Chromium E2E | Blocked before assertions: missing Chromium executable; installation download timed out |
| Hosted Turso, real Resend and Paddle sandbox | Not executed; credentials/infrastructure not provisioned for this task |
| Full mobile/200% zoom/reduced-motion browser matrix | Implemented test coverage and CSS; not fully verified here |

The complete npm run check exits with failure at its Chromium stage. The two E2E files could start their isolated servers, but neither could launch the required browser binary. This is not a fully green release gate. The new browser journey file is included and the existing CI workflow installs Chromium before running it.

Full command output: [release gate log](verification/7.1.0-release-check.log). This contains the passing Node/coverage/runtime/performance stages and exact Chromium failure. [Chromium install output](verification/7.1.0-chromium-install.log) records the download failure.

## 100-user measurements

The workload uses real synthetic account registration/login and server sessions, five plan rounds, workout create/retry/log/complete/history operations, competing writes, CSRF/owner isolation, restart persistence, stale/successful deletion and logout. Expected 409 responses are tested behavior, not discarded errors. Email verification is bypassed only through the existing explicit test-only switch; no mail or purchases are sent.

| Measurement | Distinct IPs | Shared IP |
| --- | ---: | ---: |
| Signup p95 | 1,164.52 ms | 1,430.38 ms |
| Login p95 | 1,152.36 ms | 1,126.51 ms |
| Plan save p95 | 74.55 ms | 71.22 ms |
| Workout save p95 | 71.80 ms | 56.33 ms |
| Workout completion p95 | 73.37 ms | 76.84 ms |
| History p95 | 52.75 ms | 47.32 ms |
| Peak application RSS | 159.02 MiB | 172.50 MiB |
| Application CPU time, both server lifetimes | 12,630 ms | 13,850 ms |

Raw [distinct-IP evidence](verification/7.1.0-load-distinct.json) and [shared-IP evidence](verification/7.1.0-load-shared.json) include every measured operation, thresholds, true peak in-flight requests, source mode, runtime and resource sampling details.

These are short local bursts against SQLite, not a sustained hosted soak. The unconstrained runner allowed multiple CPU cores; average initial application CPU exceeded two cores during those bursts. The 1 CPU / 2 GB blueprint cannot inherit those latency numbers. CPU is process user/system time (including worker threads), and RSS excludes the load generator, reverse proxy and hosted database. No production SLO is implied by the harness's local regression budgets.

### One-core shared-network check

A separate run constrained both the application and local load generator to one CPU core. All 5,723 requests passed with zero unexpected errors and 300 expected conflicts. Signup p95 was 4,671.28 ms, login 4,467.37 ms, workout save 167.22 ms, and workout completion 79.66 ms. Peak application RSS was 146.73 MiB. This isolates CPU pressure more closely than the unconstrained runs, but still uses local SQLite and imposes no 2 GB memory cgroup; it does not certify the deployed service. Raw [one-core evidence](verification/7.1.0-load-one-cpu.json) records one available logical CPU.

Reproduce on Linux with CPU affinity (the load generator also shares that core):

```bash
python3 - <<'PYTHON'
import os
os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
os.execvp('node', ['node', 'scripts/load-100-users.js', '--shared-ip', '--json'])
PYTHON
```

## Real-browser evidence

A desktop Chromium session exercised the actual running application using visible controls and synthetic guest data:

1. Opened onboarding and generated the default Monday/Wednesday/Friday preview.
2. Saved the guest week and opened it in Plan Studio.
3. Replaced Friday's Leg Extension with Bodyweight Sissy Squat; verified 3 sets and 8–20 prescription were retained.
4. Opened Workout Room, chose guest mode and Monday, and started the planned workout.
5. Logged Machine Hip Thrust at 40 kg × 10 actual reps; completed the set and observed the 1:30 rest timer.
6. Saved/closed, reloaded, explicitly recovered the session, and verified the 40/10 values remained.
7. Finished with one checked set; history showed one completed session and a 40 kg best. Selecting volume showed exactly 400 kg·reps; unchecked sets did not count.
8. Reloaded and confirmed completed history remained.

The same check found the HTTP randomUUID issue and lost guest day selection; they were fixed and regression-tested. Actual catalog tests also caught/fixed seconds shorthand being treated as reps. Screenshots were visually reviewed for the new desktop onboarding/workout screens. This limited manual journey does not substitute for the blocked authentication/payment browser suite or mobile/device matrix.

## Remaining launch requirements

- Obtain a green npm run check on a machine/CI runner with Chromium installed. Exercise native and enhanced auth, verification/recovery, account deletion, logout, account workout persistence, network interruptions, retries and conflict resolution in that browser suite.
- Test 100 concurrent authenticated users on the intended host and Turso region, including a shared network, realistic saved history, and sustained load. Agree hosted latency/error/resource thresholds before the run.
- Verify Resend delivery and a real isolated Paddle sandbox checkout/refund; do not infer these from mocked provider tests.
- Restore a hosted backup to an isolated database and verify users, plans, entitlements and workout ownership.
- Review mobile, keyboard, reduced motion, enlarged text and assistive-technology behavior in actual browsers.
- Authorize production deployment only after the above evidence is reviewed.

Templates and onboarding choices are local; account plans/workouts sync. Charts label their loaded-history scope. Guest saves use Web Locks where supported and best-effort raw comparisons elsewhere. Account writes use database CAS. These boundaries are intentional and visible in the interface.
