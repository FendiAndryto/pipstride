# Ticket 02: TOTP Enrollment (Mandatory for Admin/Support)

## Goal
2FA wajib untuk akun admin/support sebelum jalur tulis apa pun dibuka. (ADR 0008 §5)

## Scope
1. Migrasi Alembic: tambah `users.totp_secret` (terenkripsi at rest) dan `users.totp_enrolled_at`.
2. **Pilih library TOTP** — keputusan tiket ini, **verifikasi dulu** bahwa paket benar ada dan
   dipelihara sebelum menambahke `requirements.txt` (mis. `pyotp`; konfirmasi dengan
   dokumentasi resmi paket, bukan asumsi). Jangan invent nama API.
3. Endpoint enrollment: generate secret → tampilkan sekali → verifikasi kode → set `totp_enrolled_at`.
4. Gate login: akun dengan role `admin`/`support` **tidak bisa** login tanpa TOTP terverifikasi.
5. Enkripsi `totp_secret` memakai kunci dari config (jangan plaintext di kolom DB).
6. Setelah TOTP hidup: pembatasan origin di tiket 01 menjadi pertahanan berlapis, bukan satu-satunya.

## Files to Touch
- `services/api/migrations/versions/000X_admin_totp.py` — new.
- `services/api/app/db/models.py` (kolom baru di `User`)
- `services/api/app/api/v1/admin/` atau `auth.py` (endpoint enrollment)
- `services/api/app/core/config.py` (kunci enkripsi TOTP)
- `services/api/requirements.txt`

## Verification
```powershell
# migrations parity (job CI `migrations`)
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements.txt && python -m alembic upgrade head && python scripts/check_migrations.py"
```
Expected: migrasi apply; `check_migrations.py` melaporkan model == migrasi.

```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest"
```
Expected: pass; test: login admin tanpa TOTP ditolak; setelah enroll, diterima.

## Depends on
- `01-require-role-and-readonly-endpoints.md`

## Unblocks
- `03-admin-mutations-and-audit.md`

## Catatan
- Kolom `totp_secret` harus terenkripsi; `token_hash` tetap hash-only (jangan disamakan).
- Jangan buat akun admin baru di luar origin yang dibatasi (ADR 0008 §5).

## Status
todo
