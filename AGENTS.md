# AGENTS.md — Pipstride Project Guide

Pure read-only MT5 telemetry and journal platform.
Repository path: `C:\Users\pendi\Repository\pipstride`

---

## Tech Stack

- **Frontend (`apps/web`)**:
  - React 19 (`19.2.8`), Vite 8 (`8.3.0`)
  - Icons: `lucide-react`
  - Linter: `oxlint` (`1.81.0`)
  - Styling: Pure CSS with custom design tokens (`src/index.css`, `src/App.css`)
- **Backend (`services/api`)**:
  - Python 3.12+, FastAPI (`0.161.1`), Uvicorn
  - ORM / Migrations: SQLAlchemy 2.0 (`2.1.6`), Alembic (`1.20.1`), `psycopg` (binary 3.3.6)
  - Auth: JWT (`pyjwt`), password hashing (`bcrypt`)
  - Live State / Cache: Redis 7 (`redis` 8.1.0)
- **Infrastructure (`infra`)**:
  - Docker Compose (`infra/docker-compose.yml`)
  - PostgreSQL 16 (port `55432` mapped to host)
  - Redis 7 (port `6379` mapped to host)
  - Nginx / Caddy reverse proxy
- **Sensor (`mt5-ea`)**:
  - MQL5 telemetry reader (`PipstrideMonitor.mq5`)
  - Strictly read-only sensor (zero trading, zero execution capability)

---

## Folder Map

```text
pipstride/
├── apps/
│   └── web/                   # React 19 + Vite dashboard & telemetry UI
│       ├── public/            # Static assets & downloadable EA
│       └── src/
│           ├── assets/        # Logos & images
│           ├── components/    # UI views (Header, BottomNav, Dashboard, JournalTab, etc.)
│           ├── constants/     # Navigation items, period definitions, translations
│           ├── context/       # LanguageContext (EN/ID i18n state)
│           └── services/      # Frontend API client (services/api.js)
├── services/
│   └── api/                   # FastAPI backend service
│       ├── app/
│       │   ├── api/v1/        # Endpoints (auth, bridge telemetry, connections, journal)
│       │   ├── core/          # App config, JWT tokens, live Redis state, rate limiter
│       │   ├── db/            # SQLAlchemy database engine and models
│       │   ├── models/        # Pydantic schemas
│       │   └── services/      # Telemetry ingest, journal analytics, MT5 bridge logic
│       ├── migrations/        # Alembic database migrations
│       ├── scripts/           # DB backup, migration checks, prune snapshots
│       └── tests/             # Pytest integration tests
├── mt5-ea/                    # Expert Advisor sensor (PipstrideMonitor.mq5)
├── infra/                     # Docker compose, Dockerfiles, Nginx/Caddy configs
├── docs/                      # Architectural Decision Records (ADRs) & Glossary
├── docs/specs/                # Spec documents for new features
└── tickets/                   # Atomic tasks and tickets
```

---

## Verified Verification Commands

Run from project root:

1. **Frontend Lint**:
   ```bash
   npm --prefix apps/web run lint
   ```
   *Verified: Clean exit code 0.*

2. **Frontend Build**:
   ```bash
   npm --prefix apps/web run build
   ```
   *Verified: Production bundle built into `apps/web/dist` in ~2.3s.*

3. **Backend Health Check**:
   ```bash
   curl.exe -s http://localhost:8089/health
   ```
   *Verified: Returns `{"status":"ok"}` when docker containers are running.*

4. **Backend Test Suite**:
   ```bash
   # Production container (pipstride_api) does NOT contain pytest, tests/, or scripts/.
   # Run via ephemeral container with mounted directory:
   docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest"
   ```
   *Verified: 58 passed, 1 warning in ~19s.*

5. **Backend Readiness Check**:
   ```bash
   curl.exe -s http://localhost:8089/ready
   ```
   *Verified: Returns `{"database":"ok","redis":"ok","status":"ready"}`.*

---

## Conventions & Rules

1. **Strictly Read-Only (ADR 0004)**:
   - MT5 connector and backend never execute, modify, or close orders.
   - Any order-submission route returns 403 Forbidden.
2. **Telemetry Ingest & Cache (ADR 0003 & 0005)**:
   - High frequency heartbeats go to Redis live state.
   - Snapshots pruned periodically via `prune_snapshots.py`.
3. **Frontend Architecture**:
   - Single-page dashboard controlled by active tab state (`PipstrideHeader` + `PipstrideBottomNav`).
   - Custom CSS classes instead of Tailwind utility classes.
4. **Code Quality**:
   - Smallest diff possible. Zero unnecessary abstractions.
   - Verify changes with lint and build before committing.

---

## Gotchas

- Production container (`pipstride_api`) excludes `pytest`, `tests/`, and `scripts/`. Do not run test commands via `docker exec pipstride_api python -m pytest`.
- Host Python environment is 3.14 without project dependencies; run backend commands via ephemeral Docker container or inside a dedicated Python 3.12 venv.
- In PowerShell, `curl` is aliased to `Invoke-WebRequest`. Use `curl.exe` when testing API endpoints via CLI.
- Database runs on port `55432` on the host to avoid collisions with default local PostgreSQL instances (`5432`).
