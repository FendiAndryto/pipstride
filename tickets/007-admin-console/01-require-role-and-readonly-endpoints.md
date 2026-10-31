# Ticket 01: `require_role` + Read-Only Admin Endpoints (behind allowlist)

## Goal
Tambah router admin **read-only** yang hanya terjangkau di belakang pembatasan origin. Belum ada
jalan tulis. (ADA 0008 §8a, §2, §3)

## Scope
1. Buat `services/api/app/api/v1/admin/__init__.py` dan sub-router:
   - `users.py`, `connections.py`, `audit.py`, `metrics.py` — **hanya endpoint GET**.
2. Dependency `require_role(*roles)`:
   - Baca `User.role`, `is_active`, `token_version` **dari DB tiap request** (bukan claim JWT).
   - Lihat `core/security` + `models` yang sudah ada (ADR 0003 model role/token_version).
3. **Mount `require_role("admin")` per router.** Tambah **architecture test** yang gagal bila ada
   modul di bawah `api/v1/admin/` membuat `APIRouter` tanpa dependency guard (ADR 0008 §2).
4. Metadata-only (ADR 0008 §6): admin melihat user, plan/entitlement, status koneksi, `last_seen_at`,
   **count** trade & aktivitas terakhir. **Tidak** mengembalikan isi `trades`/`account_settings`,
   dan **tidak pernah** token plaintext (`token_hash` tetap hash-only).
5. Pembatasan origin (sementara, sebelum TOTP): IP allowlist di Caddy/nginx **atau** Cloudflare
   Access pada host admin. Tidak ada akun admin dibuat di luar pembatasan ini.

## Files to Touch
- `services/api/app/api/v1/admin/*` — new.
- `services/api/app/core/deps.py` (atau `interfaces/deps.py` bila fase 005 selesai) — `require_role`
- `services/api/tests/test_admin_guard.py` — new (architecture test).
- `infra/Caddyfile` (gating host admin).

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest && lint-imports"
```
Expected: pass; test guard gagal bila guard dilepas (uji negatif: buat `APIRouter` polos → CI merah).

Perilaku:
```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8089/api/v1/admin/users   # tanpa token
```
Expected: 401/403 (bukan 200).

## Depends on
- Fase 003, Fase 005
- ADR 0003 (model role/token_version)

## Unblocks
- `02-totp-enrollment.md`

## Status
todo
