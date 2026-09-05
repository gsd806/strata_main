# STRATA performance evidence

Performance work starts with repeatable evidence. Run the local regression check with:

```bash
npm run performance
```

The script starts an isolated SQLite application, creates a real account through HTTP, warms each path, and records 40 sequential samples. The child receives an explicit minimal environment: local SQLite, test-only direct signup, HTTP cookies, fixed loopback binding, UTC, and disabled admin, email, Paddle, proxy, and IP-allowlist behavior. Ambient secrets, provider URLs, `NODE_OPTIONS`, and production settings are not inherited. It also measures storage operations directly against a separate on-disk SQLite database seeded with 500 accounts, sessions, and plans. Every response and database result is validated, so a fast error cannot be mistaken for a successful measurement.

The tracked paths are intentionally small and high-value:

- `GET /healthz`, including the storage probe;
- `GET /api/status`, the public runtime/configuration boundary;
- authenticated `GET /api/plan`, which composes session, plan, access, trial, deletion, and admin state;
- CSRF-protected `PUT /api/plan`, including validation and compare-and-swap persistence;
- session lookup by its hashed token;
- plan lookup by account; and
- plan compare-and-swap persistence.

The command reports median and p95 latency and exits nonzero when either exceeds its checked-in budget. These budgets are local/CI regression tripwires, not production service-level objectives:

| Operation | Median budget | p95 budget |
| --- | ---: | ---: |
| Health endpoint | 20 ms | 75 ms |
| Status endpoint | 20 ms | 75 ms |
| Authenticated plan endpoint | 35 ms | 125 ms |
| Authenticated plan-save endpoint | 35 ms | 125 ms |
| Session lookup | 5 ms | 20 ms |
| Plan lookup | 5 ms | 20 ms |
| Plan compare-and-swap | 10 ms | 35 ms |

## Recorded baseline

A Build 6.9.9.007 pre-release run on 2026-09-06 used the locally installed Node 24.20.0 binary directly on Darwin arm64, 40 measured samples, eight warmups, and the 500-account storage fixture. The application child process used the same binary through `process.execPath`. The capture command was `node scripts/performance-check.js --json` after `node --version` confirmed `v24.20.0`:

| Operation | Observed median | Observed p95 |
| --- | ---: | ---: |
| Health endpoint | 1.781 ms | 2.364 ms |
| Status endpoint | 1.711 ms | 2.573 ms |
| Authenticated plan endpoint | 1.678 ms | 2.028 ms |
| Authenticated plan-save endpoint | 2.075 ms | 2.884 ms |
| Session lookup | 0.006 ms | 0.008 ms |
| Plan lookup | 0.003 ms | 0.005 ms |
| Plan compare-and-swap | 0.042 ms | 0.066 ms |

This is one captured run, not a universal expected value. A second Node 24 check on the same host produced endpoint p95 values from 2.35–3.61 ms, illustrating ordinary scheduler noise while remaining far inside the regression budgets. The JSON output now records its Node version, platform, architecture, sample count, warmups, and fixture size so later evidence identifies its environment. The command output remains authoritative for the machine being evaluated.

Use `STRATA_PERF_SAMPLES` to select 10–500 measured samples and `npm run performance -- --json` to produce machine-readable evidence. Compare runs made with the same Node version, storage mode, hardware class, sample count, and background load. A single local result is evidence of a regression in this code path, not a claim about production network latency or Turso service behavior.

Before optimizing a path, capture the JSON output and a profiler or query-plan explanation. After changing it, rerun the same command under the same conditions, keep correctness tests enabled, and report both the before and after distributions. Do not loosen a budget to make an unexplained regression green.
