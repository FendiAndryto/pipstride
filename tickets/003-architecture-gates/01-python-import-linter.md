# Ticket 01: Python Layer Contracts (`import-linter`)

## Goal
Pasang `import-linter` dan tegakkan arah import backend sesuai ADR 0009 §3.

## Scope
1. Tambah `import-linter` ke `services/api/requirements-dev.txt`.
2. Buat `services/api/.importlinter` (atau `setup.cfg`) dengan contract:
   - `interfaces` boleh import `domain` + `infrastructure`; **tidak** sebaliknya.
   - `infrastructure` boleh import `domain`; `domain` **tidak** import `infrastructure`/`interfaces`.
   - `domain` dilarang import `fastapi`, `sqlalchemy`, `redis`.
   - `services` dilarang import `app.api.v1`.
3. Tambah job `arch` di `.github/workflows/ci.yml` (working-directory `services/api`) yang menjalankan
   `lint-imports`.
4. Karena layout final (`domain/`, `infrastructure/`, `interfaces/`) baru dibuat di fase 005, atur
   baseline: contract untuk path yang **sudah ada** hari ini, plus komentar TODO menunjuk fase 005.

## Files to Touch
- `services/api/requirements-dev.txt`
- `services/api/.importlinter` — new.
- `.github/workflows/ci.yml`

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && lint-imports"
```
Expected: exit 0, 0 broken contract.

Uji negatif: tambahkan sementara `from app.api.v1.auth import router` di `services/api/app/services/user_service.py`
→ `lint-imports` harus gagal → hapus lagi.

## Depends on
None (boleh paralel dengan 002).

## Unblocks
- `tickets/003-architecture-gates/02-ts-boundaries-and-api-drift.md`
- Fase 005

## Status
done

## Implementation notes (2026-11-05)

- Contracts live in `services/api/.importlinter` (single source):
  - `app.services` never imports `app.api.v1`.
  - `app.db` never imports `app.services` / `app.api.v1`.
  - `app.models` never imports `app.db` / `app.services` / `app.api.v1`.
  - `app.services` never imports `fastapi`.
  - The `domain/` and `infrastructure/` contracts from ADR 0009 §3 are
    commented out with `TODO(Fase 005)` because those packages do not exist
    yet. They are activated when the packages are created.
- `services/api/requirements-dev.txt` pins `import-linter>=2.2` and
  `grimp>=3.8` (CI installs the dev requirements; production image unaffected).
- The `fastapi` baseline was resolved instead of allowlisted: the dead
  `BridgeService.submit_order()` guard (never called; the route raises 403)
  was deleted, and the service now raises typed domain errors
  (`ConnectionTokenInvalidError`, `ConnectionBindingError`) that
  `api/v1/bridge.py` maps to 401/409. `db.rollback()` on a binding conflict is
  preserved inside the service.
- Redis: strict "no redis outside core" is not expressible with
  `forbidden` alone because routers/services legitimately import
  `app.core.live_state` / `app.core.rate_limit`, which wrap `redis`. The
  contract is therefore documented as a Fase 005 item (move adapters to
  `app.infrastructure/`), not silently disabled.

### Verification (run on homeserver, Python 3.12 container)

```text
$ lint-imports
Contracts: 4 kept, 0 broken.

$ python -m pytest -q
100% passed (0 failures)
```

Negative test: appending `from app.api.v1.auth import router` to
`app/services/user_service.py` produced:

```text
Services never import the HTTP layer (api/v1) BROKEN
fastapi is not imported by the service layer (Fase 005 baseline) BROKEN
Contracts: 2 kept, 2 broken.
```

The line was removed and the green run repeated (4 kept, 0 broken).
