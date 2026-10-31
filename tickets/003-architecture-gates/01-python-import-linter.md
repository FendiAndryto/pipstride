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
todo
