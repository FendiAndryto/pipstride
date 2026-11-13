# Fase 010: User Expiry & Admin Account Creation

## Ringkasan Fase
Fase ini mengimplementasikan manajemen masa aktif akun (*account expiry*) dan pembuatan akun langsung dari Admin Console (`apps/admin`), mencakup:
1. Skema database `expires_at` pada tabel `users` (migrasi `0004_user_expires_at`).
2. Pengaturan trial registrasi mandiri via environment variable `DEFAULT_REGISTRATION_TRIAL_DAYS` (default 3 hari).
3. Penolakan login kedaluwarsa HTTP 403, proteksi sesi kedaluwarsa HTTP 401, dan proteksi sensor telemetri MT5 HTTP 403 (termasuk `is_active=False`).
4. Endpoint admin untuk pembuatan user baru (HTTP 201, atomik dengan audit) dan perpanjangan masa aktif, dengan kewajiban pencatatan `AuditLog`.
5. Tampilan form pembuatan user di `apps/admin` dengan generator password dan dialog salin kredensial cepat.
6. Indikator visual masa aktif akun pada tabel dan modal perpanjangan masa aktif di halaman detail user.

---

## Daftar Tiket

| Tiket | Deskripsi | Status | Dependensi |
|---|---|---|---|
| [`01-user-expiry-schema-and-policy.md`](./01-user-expiry-schema-and-policy.md) | Migrasi `expires_at`, config trial `.env`, guard login (403) & sesi (401) & bridge (403) | `done` | Fase 007 |
| [`02-admin-user-create-and-extend-api.md`](./02-admin-user-create-and-extend-api.md) | Endpoint `POST /admin/users` (201) & `POST /admin/users/{id}/extend-expiry` (200) + AuditLog atomik | `todo` | Tiket 01 |
| [`03-admin-frontend-create-user-modal.md`](./03-admin-frontend-create-user-modal.md) | UI Create User Modal & Copy Credentials Dialog di Admin Console | `todo` | Tiket 02 |
| [`04-admin-frontend-user-expiry-management.md`](./04-admin-frontend-user-expiry-management.md) | Badge status masa aktif & Modal Extend Expiry di Admin Console | `todo` | Tiket 03 |

---

## Urutan Eksekusi & Gate Verifikasi

Fase dinyatakan selesai jika seluruh verifikasi berikut lulus dengan exit code 0:

### 1. Backend Test Suite & Import Boundaries
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```

### 2. Admin Console Lint, Architecture, & Build
```powershell
npm --prefix apps/admin run lint
npm --prefix apps/admin run lint:arch
npm --prefix apps/admin run build
```

### 3. Web Dashboard Lint & Build
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web test
npm --prefix apps/web run build
```
