# Ticket 01: Extract `domain/metrics` + `domain/policies`

## Goal
Satukan logika domain murni (profit-factor, win-rate, drawdown, _as_utc) ke satu tempat yang
tidak kenal framework.

## Scope
1. Buat `services/api/app/domain/__init__.py`.
2. `domain/metrics.py` — pindahkan dari `journal_service.py:105-164` (`compute_totals`,
   `compute_stats`, `_bucketize`) dan `bridge_service.py:274-293` (win rate, profit factor).
   - **Satu** definisi profit_factor. Pilih `None` saat tidak ada loss (perilaku
     `journal_service`, konsisten dengan audit §1.3.5), **bukan** `0.0`.
   - Hapus salinan dari `bridge_service` dan `journal_service`; ganti dengan import `domain/metrics`.
3. `domain/policies.py` — pindahkan aturan drawdown (saat ini di route `bridge.py:126-159`,
   SoC-12): ambil `(initial_deposit, equity, threshold_percent)` → `{is_alert_active, drawdown_pct, reason}`.
   String reason (mungkin EN/ID) jangan hard-code Indonesia; terima `lang` atau kembalikan kode
   dan format di view (lihat juga i18n SoC-11, tapi itu fase 006).
4. `domain/time.py` — satu `_as_utc` (SoC-23); hapus dari `bridge_service`, `journal_service`,
   `auth_token_service`; ganti dengan import.
5. `domain/errors.py` — definisikan `ConnectionLimitReached`, `ConnectionBindingError` (pindahkan
   dari `connection_service.py:19-24`) dan `RiskThresholdBreached` (baru).

## Files to Touch
- `services/api/app/domain/{__init__,metrics,policies,time,errors}.py` — new.
- `services/api/app/services/{journal_service,bridge_service,auth_token_service,connection_service}.py`
- `services/api/app/api/v1/bridge.py` (route risk mendelegasikan ke `domain/policies`)

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest"
```
Expected: semua pass; test baru di `tests/test_domain_metrics.py` mengonfirmasi profit-factor
`None` saat gross_loss=0.

Gate arch:
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && lint-imports"
```
Expected: `domain/` muncul tanpa pelanggaran; tidak ada `fastapi`/`sqlalchemy` di domain.

## Depends on
- Fase 003 (`01-python-import-linter.md`) — gate harus aktif untuk menangkap import balik.

## Unblocks
- `02-repositories-and-route-thinning.md`
- `03-service-decoupling-and-transaction-boundary.md`

## Status
todo
