# Ticket 03: Service Decoupling + Transaction Boundary

## Goal
Lepas service dari framework FastAPI dan dari saling-menginstansiasi; pegang transaksi di satu tempat.

## Scope
1. **Hapus `fastapi.HTTPException` dari services (SoC-19, SoC-20).**
   - `bridge_service.py:13,76-79,91-94,398-404`: tangkap `ConnectionBindingError` (typed) dan
     biarkan route memetakan ke 409. Hapus dead `submit_order` (Dead-3) sekaligus.
2. **Pisahkan `bridge_service` (SoC-7, enam tanggung jawab):**
   - `services/telemetry_ingest_service.py` — `process_heartbeat`, `_persist_*`, cache orchestration.
   - `services/bridge_status_service.py` — status assembly + analytics (mendelegasikan ke `domain/metrics`).
   - `services/account_settings_service.py` — settings CRUD (337-383).
   - Bulk delete → `telemetry_repository` (sudah di ticket 02).
3. **Transaction boundary:** pilih `session_scope` (`db/base.py:33-43`, Dead-4) sebagai unit-of-work
   — repo/service memakai `session_scope` sebagai context manager; commit dimiliki scope, bukan
   tiap service. Hapus `db.commit()` manual di services (9+ titik, SoC-list).
   - Bila terlalu besar untuk satu tiket, kerjakan `connection_service` + `user_service` dulu
     (paling banyak `db.commit()`), dan dokumentasikan `bridge_*` sebagai follow-up sub-tiket.
4. **Dep-1:** `core/deps.py` tidak import `services/*`. Pindahkan logika "get active connection" ke
   `connection_repository` + `domain/policies`; `deps.py` hanya wiring FastAPI.
5. **Dep-2:** `BridgeService` tidak instantiate `ConnectionService` langsung — terima `connection`
   sebagai argumen (lihat audit §2.5).

## Files to Touch
- `services/api/app/services/{bridge_service,connection_service,user_service,auth_token_service}.py`
- `services/api/app/services/telemetry_ingest_service.py` — new.
- `services/api/app/services/bridge_status_service.py` — new.
- `services/api/app/services/account_settings_service.py` — new.
- `services/api/app/core/deps.py`
- `services/api/app/db/base.py` (aktivasi `session_scope`)

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest && lint-imports"
```
Expected: pass; `grep -r "HTTPException" services/api/app/services/` → 0 (atau hanya dead path
yang sedang dihapus); `grep "db.commit" services/api/app/services/` → 0 setelah migrasi `session_scope`.

## Depends on
- `02-repositories-and-route-thinning.md`

## Unblocks
- Fase 007 (admin router pakai repositori yang sama)

## Status
todo
