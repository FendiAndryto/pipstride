# ADR 0005: Telemetry Snapshot Retention

## Status
Accepted

## Context
`telemetry_snapshots` stores one row per heartbeat per connection (balance, equity, margin, floating P/L, open position count). With the default one-second heartbeat that is roughly **86,400 rows per connection per day** — around 31 million rows per connection per year, or 3 billion at 100 active connections. The table is write-heavy and only ever read for equity-curve charts and "latest state" dashboards.

PostgreSQL handles that volume, but unbounded growth has real costs:
- index bloat and slower vacuum on the hottest table;
- backup and restore time dominated by data nobody queries;
- accidental `SELECT *` on a multi-billion row table during debugging.

Trades and account settings are the actual journal, and they are small: they must never be pruned.

## Decision
1. **Raw snapshots have a bounded lifetime.** Default retention is **180 days**, configurable through `SNAPSHOT_RETENTION_DAYS`.
2. **Deletion is an explicit operator action**, not something the API does inline. `services/api/scripts/prune_snapshots.py` deletes expired rows in batches and supports `--dry-run`. It is designed to be run from cron (or a scheduled container) once per day.
3. **Trades, connections, entitlements and audit logs are never pruned** by this job.
4. **No rollups yet.** Downsampled daily aggregates are the right long-term answer once reporting needs history beyond the retention window, but adding a second write path now would complicate ingest for no user-visible benefit. This ADR is deliberately the simple half of that future design.

## Consequences
- Equity curves are limited to the retention window (180 days by default). This is documented in the README, and the window is configurable per deployment.
- A deployment that ignores retention keeps working; it just accumulates data.
- When reporting needs multi-year history, add a `equity_daily` rollup written on a schedule and prune raw snapshots more aggressively. The prune script already isolates "delete raw" from "keep everything else", so that change is additive.

## Operations
```bash
# from services/api
python scripts/prune_snapshots.py --dry-run
python scripts/prune_snapshots.py --days 180
```

Run daily, for example: `17 3 * * * cd /srv/pipstride/services/api && python scripts/prune_snapshots.py`.
