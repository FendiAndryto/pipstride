# AGENTS.md — Pipstride Project Guide

Pure read-only MT5 telemetry and journal platform.
Repository path: `C:\Users\pendi\Repository\pipstride`

Pipstride never places, modifies, or closes orders. The order route returns `403` by design.

---

## Tech Stack

- **Dashboard (`apps/web`)**:
  - React 19 (`19.2.8`), Vite 8 (`8.3.0`), plain JavaScript + JSX (no TypeScript)
  - Icons: `lucide-react` — Linter: `oxlint` (`1.81.0`, config in `apps/web/.oxlintrc.json`)
  - Styling: pure CSS with custom design tokens (`src/index.css`, `src/App.css`). No Tailwind.
  - PWA: hand-written `public/manifest.webmanifest` + `public/sw.js` (ADR 0006)
- **Marketing site (`apps/marketing`)**:
  - Astro 7 (`7.4.5`), `@astrojs/sitemap`, static output, zero-JS by default
  - Node `>=22.23.4` required (`package.json` engines)
  - Own nested `apps/marketing/AGENTS.md` with Astro-specific dev-server guidance
- **Backend (`services/api`)**:
  - Python 3.12+ (`3.12` in CI), FastAPI (`0.161.1`), Uvicorn (`0.54.0`)
  - ORM / Migrations: SQLAlchemy `2.1.6`, Alembic `1.20.1`, `psycopg[binary]` `3.3.6`
  - Auth: JWT (`pyjwt` `2.15.1`), `bcrypt` `5.0.0`
  - Live state / cache: Redis 7 (`redis` `8.1.0`) with in-process fallback
- **Shared package (`packages/pricing`)**:
  - `catalog.json` is the single source of truth for plans and prices (ADR 0007).
  - Consumed by the API at startup (seeds `plans`) and by `apps/marketing` at build time.
  - Defining a price anywhere else is prohibited.
- **Infrastructure (`infra`)**:
  - Docker Compose: `docker-compose.yml` + `docker-compose.prod.yml` (Caddy + TLS)
  - PostgreSQL 16, Redis 7, API, web, marketing; loopback-bound by default
  - `infra/cron/pipstride-crontab` — checked-in host crontab (prune 03:15 UTC, DB dump 03:45 UTC)
- **Sensor (`mt5-ea`)**:
  - `PipstrideMonitor.mq5` — MQL5 telemetry reader, zero execution capability.
  - The same file is served to users from `apps/web/public/PipstrideMonitor.mq5`.

---

## Folder Map

```text
pipstride/
├── apps/
│   ├── web/                    # React 19 + Vite dashboard (journal, telemetry, connections)
│   │   ├── public/             # PWA icons, manifest, sw.js, downloadable EA
│   │   ├── scripts/
│   │   │   └── check-i18n.cjs  # EN/ID key-parity check (not wired into package.json)
│   │   └── src/
│   │       ├── assets/
│   │       ├── components/     # one file per view (Dashboard, HomeTab, JournalTab, ProfileTab, …)
│   │       ├── constants/      # nav.js, translations.js (EN/ID dictionary)
│   │       ├── context/        # LanguageContext
│   │       ├── hooks/          # useIdleLogout.js
│   │       └── services/       # api.js — single HTTP client for the whole app
│   └── marketing/              # Astro static site (landing, features, pricing, about)
│       ├── src/components/     # Header, Footer, sections/*, showcase/*
│       ├── src/layouts/        # BaseLayout.astro
│       ├── src/lib/pricing.js  # reads packages/pricing/catalog.json
│       ├── src/pages/          # index, features, pricing, about
│       └── src/styles/         # tokens.css, motion.css
├── packages/
│   └── pricing/catalog.json    # single source of truth for plans & prices
├── services/
│   └── api/
│       ├── app/
│       │   ├── api/v1/         # auth, bridge, connections, journal, telegram routers (thin)
│       │   ├── core/           # config, deps, live_state, logging, rate_limit, security, tokens
│       │   ├── db/             # base.py (engine, session_scope unit-of-work), models.py
│       │   ├── domain/         # pure: metrics, policies, time, errors (no framework/ORM)
│       │   ├── infrastructure/ # db/repositories/{trade,connection,telemetry,user}_repository.py
│       │   ├── models/         # Pydantic schemas (auth, bridge, journal, risk, telegram)
│       │   └── services/       # telemetry ingest, bridge status, account settings, connection, user, auth tokens, email, mt5_package, pricing_catalog, telegram
│       ├── migrations/         # Alembic (0001_initial, aa3be7b45838_account_email_and_auth_tokens)
│       ├── scripts/            # backup_db, check_migrations, prune_snapshots, reset_admin_password
│       └── tests/              # 11 test modules + conftest, 104 tests
├── mt5-ea/PipstrideMonitor.mq5 # canonical read-only sensor
├── infra/                      # compose files, Caddyfile, cron/pipstride-crontab
├── docs/
│   ├── adr/                    # ADR 0003–0009
│   ├── audits/                 # pilar1-clean-architecture.md
│   ├── specs/                  # feature specs (+ README workflow)
│   ├── GLOSSARY.md             # domain vocabulary
│   └── TICKET_TRACKER.md
├── tickets/                    # phased execution tickets, 001–007 (+ README workflow)
├── .github/workflows/ci.yml    # api tests, migration drift, web, marketing, docker images
├── backups/                    # gitignored local DB dumps
└── .venv/                      # gitignored, working local Python env (see below)
```

---

## Verified Verification Commands

All commands below were executed on 2026-11-05 and exited **0**.

### 1. Web lint
```bash
npm --prefix apps/web run lint
```
`oxlint` — exit 0. Currently reports **3 warnings** (not errors) that pre-date onboarding:
`HomeTab.jsx:379` reassign-after-render, `HomeTab.jsx:382` + `JournalTab.jsx:476` impure call during render.

### 2. Web build
```bash
npm --prefix apps/web run build
```
1952 modules → `apps/web/dist` in ~1.7s.

### 3. Web i18n parity
```bash
node apps/web/scripts/check-i18n.cjs
```
`i18n OK — 455 keys per language, 410 static keys resolved.` **Run this after touching `constants/translations.js`** — there is no npm script for it.

### 4. Marketing build
```bash
npm --prefix apps/marketing run build
```
4 static pages + `sitemap-index.xml` in ~1.1s. No lint/typecheck script exists for this app.

### 5. API test suite
```bash
cd services/api
# PowerShell
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
```
`104 passed, 1 warning in ~24s`. Tests use a throwaway SQLite DB and need **no** Postgres/Redis.

Docker alternative (matches the old note, only when the daemon is up):
```bash
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && pytest"
```

### 5b. Backend architecture gate
```bash
cd services/api
../../.venv/Scripts/lint-imports.exe
```
`6 kept, 0 broken` — includes `no-frameworks-in-domain` and `domain-imports-no-app-layer`.
`import-linter` is in `requirements-dev.txt`; the root `.venv` has it installed.

### 6. API health / readiness (requires the stack running)
```bash
curl.exe -s http://localhost:8089/health   # {"status":"ok"}
curl.exe -s http://localhost:8089/ready    # {"database":"ok","redis":"ok","status":"ready"}
```
**Not re-verified during onboarding** — Docker Desktop was not running.

### 7. Migration drift (requires PostgreSQL)
```bash
cd services/api && python scripts/check_migrations.py
```
Run after `alembic upgrade head`. Also **not re-verified** — no database available.

---

## Conventions & Rules

1. **Strictly read-only (ADR 0004)**. No route or service may submit orders. `POST /api/v1/bridge/order` → `403`, `GET` → `405`. Never add execution capability to the EA.
2. **Telemetry ingest & cache (ADR 0003, 0005)**. High-frequency heartbeats go to Redis live state; persisted snapshots are pruned by `scripts/prune_snapshots.py` (default 180 days). Trades are kept forever.
3. **Layered architecture (ADR 0009)**.
   - Backend: `app/domain/` (pure, framework-free) + `app/infrastructure/` + thin `api/v1`; `main.py` is the only module that may know everything.
   - **Fase 005 landed the backend split.** `domain/` and `infrastructure/` exist and are enforced by `import-linter`; `interfaces/` is still the legacy `api/ models/ core/deps.py` names — do not rename them without a ticket.
   - Frontend target (`app/ pages/ features/ domain/ lib/ components/ui/ styles/`) does **not** exist yet; the web app is still a flat `components/`, refactored in Fase 006.
   - `apps/marketing` is explicitly exempt from the React-centric layout.
   - `apps/A` must not import `apps/B`; `packages/*` must not import `apps/*`; `mt5-ea/` imports nothing from the Python/JS code.
   - Enforced by CI today? **Backend yes** (`import-linter`, 6 contracts). **Frontend: `dependency-cruiser` runs** for cross-app rules; the `pages/features/domain` rules stay dormant until Fase 006 creates those folders.
4. **Pricing lives in exactly one file** — `packages/pricing/catalog.json` (ADR 0007). Add or change a plan there, never in a page, component, or migration.
5. **Frontend shape**: single-page dashboard driven by active-tab state (`PipstrideHeader` + `PipstrideBottomNav`), custom CSS classes and tokens rather than utility frameworks, one HTTP client (`src/services/api.js`) with `X-Connection-Id` selecting the active account.
6. **Code quality**: smallest diff possible, zero unnecessary abstractions. Verify with lint + build (web) or `pytest` (API) before committing.
7. **Docs are bilingual-ish**: ADRs, specs, and tickets are written in Indonesian; code, comments, API docs, and README are English. Match the language of the file you are editing.

---

## Workflow: specs → tickets → phases

- Non-trivial feature: write `docs/specs/<NNN>-<name>.md` first (via `/spec`), covering problem, constraints, interface/schema, and success criteria.
- Approved specs are split into self-contained tickets under `tickets/<NNN>-<phase>/`. Each ticket has a `Status:` and a `Verification:` section.
- `tickets/README.md` is the phase board. **Phase gates are ordered** — do not start the next phase before the previous gate passes.
- Current state: **001–005 done. 006, 007 still `todo`.**
- Recommended order: `002 → 003 → 004 → 005 → 006 → 007`.
- `docs/TICKET_TRACKER.md` mirrors the board; keep both in sync when closing a ticket.

## Build & release expectations

- CI (`.github/workflows/ci.yml`) runs six jobs: `api` (pytest, Python 3.12), `migrations` (upgrade head + drift + backup/restore round-trip against Postgres 16), `web` (`npm ci && lint && build`, Node 22), `marketing` (`npm ci && build`, Node 22), `arch` (`lint-imports` + `npm run lint:arch`), and `docker` (three image builds, gated on the first three).
- Commit messages follow Conventional Commits with a scope: `fix(api):`, `feat(marketing):`, `docs(tickets):`.

---

## Gotchas

- **The API container ships `scripts/` but not `pytest` or `tests/`.** Do not run `docker exec pipstride_api python -m pytest`. Host cron deliberately shells out to `docker exec` for `prune_snapshots.py` and `backup_db.py`.
- **A working local Python env exists at repo root**: `.venv` (currently Python **3.14.2**, all deps + pytest installed). The suite passes there even though CI and the containers use 3.12. Prefer this over spin-up-a-container; if you see version-specific failures, fall back to the Docker command.
- **Docker Desktop is frequently not running on this machine.** `docker ps` fails with `open //./pipe/dockerDesktopLinuxEngine`. Check before promising any compose/health/readiness verification.
- **PowerShell aliases `curl` to `Invoke-WebRequest`.** Use `curl.exe` for API checks.
- **Postgres host port defaults to `5432`,** not `55432`. Override with `POSTGRES_PORT=55432` when a local PostgreSQL already owns 5432. (The old AGENTS.md stated 55432 as the default — it is only the recommended override.)
- **Production startup fails fast**: `ENVIRONMENT=production` rejects insecure `SECRET_KEY`/`ADMIN_PASSWORD`, wildcard `ALLOWED_HOSTS`, and a SQLite `DATABASE_URL`. `/docs`, `/redoc`, `/openapi.json` are disabled there.
- **`ADMIN_PASSWORD` in `.env` only seeds the admin once.** Rotating it does not change an existing admin — use `scripts/reset_admin_password.py`, which also bumps `token_version` and repairs a deactivated/demoted row.
- **Raw bridge tokens are never stored** (SHA-256 digest only). Create/rotate must return the token *and* the generated `.set` preset, or the user cannot recover it.
- **`apps/web/Dockerfile` still builds on `node:20-alpine`** while CI uses Node 22 and Vite 8 wants ≥20.19. Marketing was already bumped to `node:22-alpine` for Astro 7. Local builds on Node 24 are fine; the image build is the risky path.
- **`packages/pricing/README.md` references `apps/admin`,** which does not exist. It is planned in ticket 007, not present.
- **`services/api/app/data/pipstride.db`** is a local dev SQLite file (gitignored via `*.db`). Do not commit it or treat it as a migration artifact.
- **`backups/` is gitignored** and holds local dumps; cron writes outside the repo in production (`/home/fendi/my-apps/pipstride-backups`).

---

## Working loop

1. New feature → `/spec <feature>` → approve → split into `tickets/`.
2. Implement the ticket, run its `Verification` section, and the app-level commands above.
3. Before a meaningful commit, ask `oracle` to review the diff.
4. Hard design calls (schema, architecture, gnarly bugs) → `oracle` first, not after.
