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
| MT5 authentication | Per-connection token, stored as **SHA-256 hash** only |
| Multi-account | One connection per MT5 account, selected with `X-Connection-Id` |
| Execution | **None.** `/api/v1/bridge/order` always returns `403` |

### Token and binding model

1. A user creates a connection in the dashboard. The API returns the raw token **once** (`pst_live_…`) and stores only its SHA-256 digest plus a short display prefix.
2. The token is pasted into `InpBridgeToken` on `PipstrideMonitor`.
3. The first heartbeat binds the connection to that `account_number`. Any later heartbeat claiming a different account is rejected with `409`, so a leaked token cannot be pointed at another account.
4. Rotating a token invalidates the old one immediately and clears the binding. Revoking a connection stops telemetry permanently.

### API surface

- `POST /api/v1/auth/register`, `/login`, `/logout`, `/change-password`, `GET /me`
- `GET|POST /api/v1/connections`, `POST /connections/{id}/rotate`, `DELETE /connections/{id}`
- `POST /api/v1/bridge/heartbeat` (token auth via `X-Bridge-Token`)
- `GET /api/v1/bridge/status|positions|market|history|equity-curve|initial-deposit|risk`
- `POST /api/v1/bridge/history/reset`, `/initial-deposit`
- `GET /api/v1/bridge/order` → `405`, `POST /api/v1/bridge/order` → `403` (read-only guarantee)

Dashboard requests target the active account with the `X-Connection-Id` header; the backend falls back to the user's oldest active connection when it is omitted.

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
3. Open the dashboard → **MT5** → **Tambah Akun**, copy the token, and paste it into `InpBridgeToken`.
4. Drag `PipstrideMonitor` onto any chart and enable **Allow Algo Trading** (the EA needs it only to run; it sends telemetry, never orders).

### Tests

```bash
cd services/api
pytest
```

Tests run against a throwaway SQLite database and require no external services.

---

## Production notes

- `ENVIRONMENT=production` enables fail-fast config validation: insecure `SECRET_KEY`/`ADMIN_PASSWORD`, unrestricted `ALLOWED_HOSTS`, or a SQLite `DATABASE_URL` abort startup.
- API docs (`/docs`, `/redoc`, `/openapi.json`) are disabled in production.
- Run schema changes with `alembic revision --autogenerate` + `alembic upgrade head`; the app never calls `create_all` outside SQLite dev/test.
- The API container runs as a non-root user.
