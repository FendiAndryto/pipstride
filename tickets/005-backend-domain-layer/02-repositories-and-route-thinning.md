# Ticket 02: Repositories + Route Thinning

## Goal
Isolasi akses ORM ke `infrastructure/repositories`; route berhenti menyentuh ORM.

## Scope
1. Buat `services/api/app/infrastructure/__init__.py`.
2. `infrastructure/db/repositories/`:
   - `trade_repository.py` — `list_trades(connection_id, filters)` (pindahkan query dari
     `journal.py:31-51`, SoC-18).
   - `connection_repository.py` — get/list/create/delete untuk `Mt5Connection`.
   - `telemetry_repository.py` — snapshot/trade persist + bulk delete (SoC-21: ganti `db.query().delete()`
     dengan 2.0 `delete()`).
3. `app/api/v1/journal.py`: hapus import `sqlalchemy`/`Trade`; panggil `trade_repository`. Route tipis.
4. `app/api/v1/connections.py`: ganti `_project`/`_preset` hand-built dict (SoC-17) dengan
   `ConnectionResponse`/`PresetFileResponse` dari `app/models/`.
5. `app/api/v1/telegram.py`: pindahkan inline schemas (`TelegramTestAlertRequest`,
   `TelegramToggleRequest`, SoC-16) ke `app/models/telegram.py`.

## Files to Touch
- `services/api/app/infrastructure/**` — new.
- `services/api/app/api/v1/{journal,connections,telegram}.py`
- `services/api/app/models/telegram.py` — new.

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest && lint-imports"
```
Expected: pass; `journal.py` tidak lagi import `sqlalchemy`/`app.db.models`.

## Depends on
- `01-extract-domain-metrics-policies.md` (infra import domain, bukan langsung service)

## Unblocks
- `03-service-decoupling-and-transaction-boundary.md`

## Status
todo
