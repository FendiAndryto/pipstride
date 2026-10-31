# Ticket 03: Admin Mutations + Mandatory Audit

## Goal
Buka jalur tulis admin (ubah entitlement, deactivate, revoke) — setiap mutasi **wajib** menulis
audit log. (ADR 0008 §4, §8c)

## Scope
1. Tambah endpoint mutasi di `api/v1/admin/`:
   - `PATCH /admin/users/{id}/entitlement` — ubah plan (`plan_code`, `max_connections`).
   - `POST /admin/users/{id}/deactivate` / `activate`.
   - `POST /admin/connections/{id}/revoke`.
2. **Setiap mutasi menulis `audit_logs`** (`user_id` aktor, `action`, `detail`, `ip_address`) —
   lihat model `AuditLog` (`db/models.py:179-188`) yang sudah ada tapi jarang ditulis.
   Tidak ada endpoint mutasi yang boleh ship tanpa ini.
3. Batasi aksi: **tidak** ada endpoint yang mengembalikan token koneksi plaintext (ADR 0008 §6).
4. Semua endpoint tetap di bawah `require_role("admin")` + TOTP (tiket 01-02).
5. Test: setiap endpoint mutasi menghasilkan satu baris `audit_logs`; uji negatif — hapus penulisan
   audit → test gagal.

## Files to Touch
- `services/api/app/api/v1/admin/*.py`
- `services/api/app/services/*` atau `infrastructure/db/repositories/*` (aksi mutasi + audit)
- `services/api/tests/test_admin_mutations.py` — new.

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest && lint-imports"
```
Expected: pass; test audit hijau.

## Depends on
- `02-totp-enrollment.md`

## Unblocks
- `04-support-mode-and-access-log.md`

## Status
todo
