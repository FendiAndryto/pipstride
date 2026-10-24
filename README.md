# Pipstride — Pure Read-Only MT5 Telemetry & Journal Platform

Pipstride is a read-only trading journal and real-time account telemetry dashboard for MetaTrader 5 (MT5). A small MQL5 monitor runs on the trader's own laptop or VPS, streams account state to the API, and Pipstride turns that into a journal, equity curve, and passive risk view.

Pipstride is **strictly read-only**: it never places, modifies, or closes orders, never sets SL/TP, and never sends commands back to the terminal. The bridge endpoint that would accept orders returns `403` by design.

---

## Repository structure

```text
pipstride/
├── apps/
│   └── web/                   # React + Vite dashboard (journal, telemetry, connections)
├── services/
│   └── api/                   # FastAPI backend
│       ├── app/
│       │   ├── api/v1/        # auth, connections, bridge, telegram
│       │   ├── core/          # config, security, token hashing, live state
│       │   ├── db/            # SQLAlchemy engine, session, models
│       │   ├── models/        # Pydantic schemas
│       │   └── services/      # connections, telemetry ingest, journal reads, users
│       ├── migrations/        # Alembic migrations (production schema)
│       ├── scripts/           # prune_snapshots.py, check_migrations.py
│       ├── tests/             # Pytest suite
│       ├── alembic.ini
│       └── requirements.txt
├── mt5-ea/
│   └── PipstrideMonitor.mq5   # 100% read-only MQL5 telemetry sensor
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   └── GLOSSARY.md            # Domain vocabulary and boundary standards
├── infra/
│   └── docker-compose.yml     # Postgres + Redis + API + web
├── .github/workflows/ci.yml   # Tests, migration drift, web build, image build
├── .env.example
└── README.md
```

---

## Architecture

| Concern | Choice |
| --- | --- |
| Persistent storage | **PostgreSQL** (SQLAlchemy 2.x + Alembic) |
| Hot live telemetry | **Redis** (shared across API workers), in-process fallback for local dev |
| Auth | JWT bearer, revocable through `users.token_version` |
| Account recovery | Email + single-use hashed tokens (reset / verification), SMTP or log-only in dev |
| MT5 authentication | Per-connection token, stored as **SHA-256 hash** only |
| Multi-account | One connection per MT5 account, selected with `X-Connection-Id` |
| Abuse protection | Redis-backed rate limits (login, register, heartbeat), in-process fallback |
| Logging | One JSON line per request with `X-Request-ID` correlation |
| Execution | **None.** `/api/v1/bridge/order` always returns `403` |

### Token and binding model

1. A user creates a connection in the dashboard. The API returns the raw token **once** (`pst_live_…`) and stores only its SHA-256 digest plus a short display prefix.
2. The token is pasted into `InpBridgeToken` on `PipstrideMonitor`.
3. The first heartbeat binds the connection to that `account_number`. Any later heartbeat claiming a different account is rejected with `409`, so a leaked token cannot be pointed at another account.
4. Rotating a token invalidates the old one immediately and clears the binding. Revoking a connection stops telemetry permanently.

Because only the hash is stored, the token cannot be shown again later. Create and rotate therefore also return a ready-to-import MT5 preset (`.set`) that already contains the backend URL, the token, and the watchlist — see [MT5 monitor](#mt5-monitor).

### API surface

- `GET /health` (liveness), `GET /ready` (readiness with DB + Redis ping)
- `POST /api/v1/auth/register`, `/login`, `/logout`, `/change-password`, `GET /me`
- `POST /api/v1/auth/forgot-password`, `/reset-password`, `/verify-email`, `/auth/email` (account recovery)
- `GET|POST /api/v1/connections`, `POST /connections/{id}/rotate` (both return the token **and** a `.set` preset), `DELETE /connections/{id}`
- `POST /api/v1/bridge/heartbeat` (token auth via `X-Bridge-Token`)
- `GET /api/v1/bridge/status|positions|market|history|equity-curve|initial-deposit|risk`
- `GET /api/v1/journal/stats?range=1M|3M|1Y|ALL&source=all|ea|manual` (aggregated analytics)
- `POST /api/v1/bridge/history/reset`, `/initial-deposit`
- `GET /api/v1/bridge/order` → `405`, `POST /api/v1/bridge/order` → `403` (read-only guarantee)

Dashboard requests target the active account with the `X-Connection-Id` header; the backend falls back to the user's oldest active connection when it is omitted.

### Accounts and recovery

Registration takes an optional email; the dashboard asks for one because it is the only self-service recovery path. The address is lower-cased and unique, and stays unverified until the emailed link is opened.

- **Password reset** — `POST /auth/forgot-password` always returns `202` with the same body, so it cannot be used to probe which addresses exist. It is rate limited per IP (5 per 15 min) and per address (3 per hour) to protect inboxes. Only the token digest is stored; the raw value lives solely in the link.
- **Single use** — issuing a new token for the same purpose burns older unused ones. Consumption is a conditional update, so two concurrent requests cannot both succeed. Reset links expire after 30 minutes, verification links after 24 hours.
- **Session revocation** — a completed reset bumps `users.token_version`, which invalidates every JWT issued before it. A used link returns `400` afterwards.
- **Verification** — `POST /auth/email` attaches or changes the address and mails a new link; changing it clears any previous verification. `GET /me` exposes `email` and `email_verified`.
- **Delivery** — with `SMTP_HOST` unset, messages are logged instead of sent (development). In production a missing SMTP setup is logged as a warning and the link is never written to logs.

Self-registration always creates a `trader`; there is no role selector in the signup form and the API ignores any role field.

### Journal analytics

`GET /api/v1/journal/stats` returns everything derived from stored closed trades for the active connection:

- **Totals** — net/gross profit, win rate, profit factor, expectancy per trade, average win/loss, payoff ratio, best/worst trade, longest win/loss streaks, average holding time, traded volume.
- **Breakdowns** — per symbol, weekday, hour, direction (long vs short), and source (EA vs manual).
- **Filters** — `range` (1M, 3M, 1Y, ALL), `source` (all, ea, manual), `symbol`, `direction`.

Definitions worth knowing: win rate counts breakeven trades in the denominator; `profit_factor` and `payoff_ratio` are `null` when there is no losing trade (the UI renders `∞`); weekday/hour buckets use the broker server clock, which is what MT5 reports for deals. Nothing is estimated or interpolated — if it is not in `trades`, it is not in the stats.

---

## Quickstart

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env      # then edit SECRET_KEY, ADMIN_PASSWORD, POSTGRES_PASSWORD
cd infra
docker compose up --build
```

- Web: `http://localhost:3000`
- API: `http://localhost:8089`
- Postgres: `127.0.0.1:5432` (loopback only)
- Redis: `127.0.0.1:6379` (loopback only)

The API container runs `alembic upgrade head` before serving.

If host port `5432` is already taken (another local PostgreSQL), set `POSTGRES_PORT=55432` before `docker compose up`; the containers talk to each other on the internal network regardless.

The web container's nginx proxies `/api/` to the API service, so the dashboard works from a single origin without extra configuration.

### Option B — Local development

Start Postgres and Redis (any local install or `docker compose up postgres redis`), then:

```bash
# API
cd services/api
python -m venv .venv && . .venv/Scripts/activate   # Windows
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --port 8089 --reload
```

```bash
# Web
cd apps/web
npm install
npm run dev
```

`DATABASE_URL` defaults to a local SQLite file only when no value is supplied, which keeps a fresh checkout runnable. Set `DATABASE_URL` to PostgreSQL for anything beyond a quick look; production startup refuses SQLite.

### MT5 monitor

1. Copy `mt5-ea/PipstrideMonitor.mq5` into `MQL5/Experts/`.
2. In MT5: **Tools > Options > Expert Advisors** → enable **Allow WebRequest for listed URL** and add your API origin (e.g. `http://localhost:8089`).
3. Open the dashboard → **MT5** → **Tambah Akun**. Copy the token, or download the generated **preset (`.set`)** and place it in `MQL5/Presets/`.
4. Drag `PipstrideMonitor` onto any chart. In the **Inputs** tab click **Load** and pick the preset (it fills `InpBackendUrl`, `InpBridgeToken`, and `InpMonitoredSymbols`), then enable **Allow Algo Trading** — the EA needs it only to run; it sends telemetry, never orders.

The preset is produced at create/rotate time because the raw token is never stored. If you lose it, rotate the token to generate a new preset.

### Tests

```bash
cd services/api
pytest
```

Tests run against a throwaway SQLite database and require no external services.

### Operations

```bash
# Migration drift guard (needs PostgreSQL, run after alembic upgrade head)
cd services/api && python scripts/check_migrations.py

# Raw snapshot retention (default 180 days, see docs/adr/0005)
python scripts/prune_snapshots.py --dry-run
python scripts/prune_snapshots.py --days 180

# Database backup and restore (auto-detects local PostgreSQL or Docker container)
python scripts/backup_db.py                      # creates gzip dump in backups/ with 30-day retention
python scripts/backup_db.py --list               # list existing backup archives
python scripts/backup_db.py --verify <file.gz>   # test gzip and checksum integrity
python scripts/backup_db.py --restore <file.gz>  # restore dump with interactive confirmation
```

Every request is logged as one JSON line on stdout with `request_id`, `method`, `path`, `status_code`, and `duration_ms`; the same id is returned in the `X-Request-ID` header. Set `LOG_LEVEL` to change verbosity.

---

## Production notes

- `ENVIRONMENT=production` enables fail-fast config validation: insecure `SECRET_KEY`/`ADMIN_PASSWORD`, unrestricted `ALLOWED_HOSTS`, or a SQLite `DATABASE_URL` abort startup.
- API docs (`/docs`, `/redoc`, `/openapi.json`) are disabled in production.
- Run schema changes with `alembic revision --autogenerate` + `alembic upgrade head`; the app never calls `create_all` outside SQLite dev/test.
- The API container runs as a non-root user.
- Set `PUBLIC_BASE_URL` to the public origin so generated presets contain the URL the EA should actually reach, especially behind a proxy or CDN. Set `PUBLIC_APP_URL` to the dashboard origin used in emailed links (defaults to `PUBLIC_BASE_URL`, then the request origin).
- Configure `SMTP_HOST`/`SMTP_FROM` before launch: password reset and verification links are only logged when SMTP is unset, and production deliberately omits the link from logs. Rotate `SECRET_KEY` invalidates all JWTs, equivalent to a global sign-out.
- Schedule `scripts/prune_snapshots.py` daily; raw telemetry is capped at `SNAPSHOT_RETENTION_DAYS` (default 180), while trades are kept indefinitely.
- Login and heartbeat rate limiting share Redis when `REDIS_URL` is set, so limits hold across all API workers.
- Automatic HTTPS with Caddy: set `PIPSTRIDE_DOMAIN` in `.env` and start with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`. Caddy automatically handles Let's Encrypt certificates and adds HSTS.
- Use `GET /health` for container liveness and `GET /ready` for readiness probes behind load balancers.
- Schedule `scripts/backup_db.py` in daily cron on the server to preserve automated gzipped PostgreSQL snapshots.
