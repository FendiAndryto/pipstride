# Ticket 04: Support Mode + User-Visible Access Log

## Goal
Satu-satunya jalur menuju detail spesifik seorang user: elevasi time-boxed dengan alasan wajib,
yang **terlihat oleh user** yang bersangkutan. (ADR 0008 §6, §8d)

## Scope
1. Migrasi: tabel `support_sessions` (`id, admin_id, target_user_id, reason, granted_at, expires_at, revoked_at`).
2. Endpoint grant/revoke:
   - Time-box **30 menit**, `reason` wajib.
   - Setiap grant & revoke mirror ke `audit_logs`.
3. Endpoint detail user (isi `trades`/`account_settings`) **hanya** dapat diakses dalam support session aktif.
4. **Prasyarat keras:** access log **user-visible** di `apps/web` (user melihat siapa mengakses
   datanya, kapan) harus ADA sebelum support mode diaktifkan. Bila access log belum ada → support
   mode tetap disabled (feature flag/guard).
5. Banner support mode di UI admin (state machine: grant → expire → revoke → display).

## Files to Touch
- `services/api/migrations/versions/000X_support_sessions.py` — new.
- `services/api/app/db/models.py` (`SupportSession`)
- `services/api/app/api/v1/admin/*` (grant/revoke/detail)
- `apps/web/src/features/*` (access-log view user) — bergantung fase 006
- `services/api/app/api/v1/*` (endpoint access log untuk user)

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements.txt && python -m alembic upgrade head && python scripts/check_migrations.py"
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest && lint-imports"
npm --prefix apps/web run lint && npm --prefix apps/web run build
```
Expected: pass; test: akses detail tanpa session aktif → 403; session expire → 403; setiap
grant/revoke ada di `audit_logs`; user melihat baris akses di UI.

## Depends on
- `03-admin-mutations-and-audit.md`

## Unblocks
- `05-admin-frontend-app.md` (banner + support UI)

## Catatan
- Support mode **wajib disabled** sampai access log user-visible selesai — ini gerbang, bukan catatan.
- Ini menambah state machine (grant/expire/revoke/display) — biaya yang diterima sadar (ADR 0008).

## Status
todo
