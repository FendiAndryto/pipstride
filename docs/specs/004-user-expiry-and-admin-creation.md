# SPEC-004: Manajemen Masa Aktif Akun (Account Expiry) & Pembuatan Pengguna via Admin Console

## 1. Problem Statement
Saat ini di Pipstride:
1. **Tidak Ada Pembuatan Akun via Admin Console**: Admin tidak dapat mendaftarkan akun pengguna secara langsung dari `apps/admin`. Akun hanya bisa dibuat lewat alur registrasi publik mandiri (`/auth/register`). Untuk skenario onboarding klien manual (misal pembayaran di luar sistem), admin harus mendaftar via form publik atau langsung manipulasi database.
2. **Semua Akun Aktif Selamanya (Tanpa Expiration)**: Kolom status hanya berupa boolean `is_active`. Tidak ada batas masa aktif (durasi/expiration date).
3. **Registrasi Mandiri Tidak Terbatas**: Pengguna yang mendaftar secara mandiri di `app-pipstride.homever.my.id` langsung mendapatkan paket `free` dengan akses tanpa batas waktu (lifetime), sehingga tidak ada pembatasan masa percobaan (*trial period*) 3 hari.

## 2. Goals & Success Criteria
1. **Dukungan Masa Aktif Akun**:
   - Menambahkan field `expires_at: DateTime(timezone=True)` (nullable, indexed) pada model `User`.
   - Menggunakan helper `as_utc()` (`app.domain.time:41`) untuk normalisasi offset timezone (mencegah bug perbandingan naive/aware di SQLite dev/test).
   - Akun dianggap aktif jika `is_active == True` DAN (`expires_at is None` atau `as_utc(expires_at) > now_utc`).
2. **Trial Default untuk Registrasi Mandiri**:
   - Ditentukan melalui konfigurasi environment variable `DEFAULT_REGISTRATION_TRIAL_DAYS` (default `3`).
   - Endpoint `POST /api/v1/auth/register` (router auth) menghitung `expires_at = now_utc + timedelta(days=settings.DEFAULT_REGISTRATION_TRIAL_DAYS)` lalu meneruskannya ke `user_service.register(..., expires_at=...)`.
   - `user_service.register()` sendiri **tidak membaca** `settings` — parameter `expires_at` diterima dari pemanggil. Dengan demikian jalur admin yang memanggil register tidak terkena default trial.
   - Nilai `DEFAULT_REGISTRATION_TRIAL_DAYS <= 0` berarti trial dinonaktifkan (akun baru aktif tanpa batas waktu, `expires_at=None`).
3. **Penolakan Login & Proteksi Sesi**:
   - Pada `POST /api/v1/auth/login`:
     1. Kredensial username & password diverifikasi terlebih dahulu via `user_service.authenticate()`. Jika salah atau `is_active == False` → HTTP 401 Unauthorized standar (anti-enumeration terjaga).
     2. Setelah password valid, cek masa aktif **sebelum** TOTP: jika `user.expires_at is not None` dan `as_utc(user.expires_at) <= now_utc` → HTTP 403 Forbidden: `"Masa aktif akun telah berakhir. Silakan hubungi admin untuk memperpanjang langganan."`
   - Pada `get_current_user` (`app/core/deps.py`):
     - Pertahankan dua cabang terpisah agar pesan akurat:
       1. Jika `not user or not user.is_active` → HTTP 401: `"User not recognized or account deactivated"`.
       2. Jika `user.expires_at is not None and as_utc(user.expires_at) <= now_utc` → HTTP 401: `"Session expired: account has expired. Please contact support to renew."`.
   - Pada MT5 Bridge (`/bridge/heartbeat` & `/bridge/sync-trades`):
     - Guard bersama: cek `is_account_active(connection.user.is_active, connection.user.expires_at)`.
     - Jika tidak aktif (baik `is_active == False` maupun kedaluwarsa) → HTTP 403 Forbidden: `"Account is inactive or has expired."`.
     - **Catatan perubahan perilaku**: Sebelumnya menonaktifkan user (`is_active=False`) tidak langsung memutus telemetri EA yang sudah terhubung. Setelah perubahan ini, **deactivate user akan segera menolak heartbeat & sync-trades EA** karena bridge sekarang mengecek `is_account_active`.
4. **Pembuatan Akun dari Admin Console (`apps/admin`)**:
   - Admin dapat membuat akun baru melalui `POST /api/v1/admin/users` (HTTP 201 Created).
   - Input divalidasi ketat:
     - `username`: 3–32 karakter, regex `^[a-zA-Z0-9_.-]+$` (via `validate_username`).
     - `password`: minimal 8 karakter, wajib kombinasi huruf dan angka (via `validate_password_complexity`).
     - `email`: opsional, divalidasi format dan keunikan (via `normalize_email`).
     - `role`: dibatasi hanya `"trader"` (mencegah pembuatan role privileged ber-expiry).
     - `plan_code`: divalidasi terhadap database `Plan`.
     - Masa aktif: **minimal satu** dari tiga opsi yang harus diisi:
       - `duration_days: int > 0` — menghitung `expires_at = now_utc + timedelta(days=duration_days)`.
       - `exact_expires_at: datetime` — tanggal pasti (wajib timezone-aware, divalidasi via `@field_validator` yang menolak `tzinfo is None`; server normalisasi ke UTC via `as_utc`).
       - `set_lifetime: true` — `expires_at = None` (permanen).
       - Jika lebih dari satu terisi: terapkan presedensi `set_lifetime > exact_expires_at > duration_days`.
       - Jika ketiganya kosong/null: HTTP 400 Bad Request `"Provide duration_days, exact_expires_at, or set_lifetime"`.
   - **Batas transaksi**: `admin_service.create_user` membuka **satu** `session_scope(db)` yang mencakup insert user, insert entitlement, dan _audit **secara atomik** via `user_service.prepare_user(...)` — jika audit gagal, user dan entitlement ikut di-rollback. Lihat §3.6.
   - Dialog konfirmasi: password diambil dari state form klien (bukan dari API response atau AuditLog).
   - Duplikat username → HTTP 409 Conflict (konsisten dengan endpoint publik `/auth/register`).
5. **Perpanjangan / Manajemen Masa Aktif Pengguna**:
   - Admin dapat memperpanjang via `POST /api/v1/admin/users/{user_id}/extend-expiry` (HTTP 200 OK, response `AdminUserItem`).
   - Aturan presedensi (didukung parameter opsional `now=None` untuk determinisme pengujian):
     1. `set_lifetime == True` → set `expires_at = None`.
     2. `exact_expires_at is not None` → wajib timezone-aware future datetime, set `expires_at = as_utc(exact_expires_at)`.
     3. `duration_days > 0` → jika `expires_at` saat ini masih aktif di masa depan, tambahkan dari `as_utc(user.expires_at)`; jika sudah lewat/None, tambahkan dari `now_utc`.
     4. Tidak ada opsi → HTTP 400 Bad Request.
   - Mutasi dicatat di `AuditLog` dengan action `admin.user.expiry_updated`.
   - Tabel dan detail user menampilkan badge status masa aktif via `formatExpiryStatus(expiresAt, isActive, isExpired)` dengan urutan presedensi terpadu:
     1. `isActive === false` → `Nonaktif` (varian: `neutral`)
     2. `expiresAt === null` → `Permanen` (varian: `neutral`)
     3. `isExpired === true || diffDays <= 0` (sudah lewat) → `Kedaluwarsa` (varian: `danger`)
     4. `diffMs < 86_400_000` (kurang dari 24 jam) → `Kurang dari 1 hari` (varian: `danger`)
     5. `diffDays <= 3` → `Segera Berakhir (X hari)` (varian: `warning`)
     6. `diffDays > 3` → `Aktif (X hari)` (varian: `success`)

---

## 3. Architecture & Interface Design

### 3.1 Backend Schema & Migration
* **Tabel `users`**:
  * Tambah kolom `expires_at: DateTime(timezone=True)`, `nullable=True`, `index=True`.
  * Migrasi Alembic: `0004_user_expires_at.py` (down_revision: `0003_support_sessions`).

### 3.2 Configuration (`Settings`)
* `DEFAULT_REGISTRATION_TRIAL_DAYS: int = 3` di `services/api/app/core/config.py`.
* Dokumentasikan di `.env.example`.

### 3.3 Domain / Policy Rule
Fungsi murni di `services/api/app/domain/policies.py`:
```python
from datetime import datetime, timezone
from typing import Optional
from app.domain.time import as_utc

def is_account_active(
    is_active: bool,
    expires_at: Optional[datetime],
    now: Optional[datetime] = None,
) -> bool:
    if not is_active:
        return False
    if expires_at is None:
        return True
    current = as_utc(now) or datetime.now(timezone.utc)
    target = as_utc(expires_at)
    return target > current
```

### 3.4 API Endpoints & Request/Response Contracts

#### A. Publik (`/api/v1/auth/`)
* `POST /auth/register`:
  * Router menghitung `expires_at`:
    ```python
    trial_days = settings.DEFAULT_REGISTRATION_TRIAL_DAYS
    expires_at = (datetime.now(timezone.utc) + timedelta(days=trial_days)) if trial_days > 0 else None
    ```
  * Memanggil `user_service.register(..., expires_at=expires_at)`.
  * `register()` **tidak membaca** `settings`; parameter `expires_at` diterima dari pemanggil.
* `POST /auth/login`:
  * Anti-enumeration: Jika user tidak ditemukan, password salah, atau `is_active == False` → HTTP 401 Unauthorized standar.
  * Expiry check: Jika password valid tapi `as_utc(user.expires_at) <= now_utc` → HTTP 403 Forbidden: `"Masa aktif akun telah berakhir. Silakan hubungi admin untuk memperpanjang langganan."`.
  * Dilakukan **sebelum** pengecekan TOTP.

#### B. Admin Console (`/api/v1/admin/users`)
* `POST /api/v1/admin/users`:
  * Guard: `require_role("admin")`.
  * Status code: `201 Created`.
  * Validation: `@field_validator("exact_expires_at")` menolak jika `value is not None and value.tzinfo is None` (`ValueError("exact_expires_at must be timezone-aware (e.g. ISO-8601 with offset or 'Z')")`).
  * Response Body: `AdminUserItem` (metadata-only, tanpa password).
  * Duplikat username → `409 Conflict`.
  * Audit log: `action="admin.user.created"`, `target_user_id=new_user.id` — password **tidak pernah** masuk ke field `detail`.

* `POST /api/v1/admin/users/{user_id}/extend-expiry`:
  * Guard: `require_role("admin")`.
  * Status code: `200 OK`.
  * Validation: `@field_validator("exact_expires_at")` menolak jika naive.
  * Response Body: `AdminUserItem` (data ter-update).
  * Audit log: `action="admin.user.expiry_updated"`, `target_user_id=user.id`.

### 3.5 Frontend Admin Console (`apps/admin`)
* **State Password Kredensial**:
  * Password disimpan pada local React state di `UserCreateModal`.
  * URL login dashboard menggunakan `import.meta.env.VITE_APP_URL || 'https://app-pipstride.homever.my.id'`.
  * Didokumentasikan di `apps/admin/README.md`.
* **Validasi Form Klien**:
  * Input username divalidasi dengan regex `^[a-zA-Z0-9_.-]+$` (3–32 karakter) langsung di form agar feedback instan sebelum request terkirim.
* **Badge Labels (Definitif)**:
  * Presedensi di `formatExpiryStatus(expiresAt, isActive, isExpired = false)`:
    1. `isActive === false` → `Nonaktif` (neutral)
    2. `expiresAt === null` → `Permanen` (neutral)
    3. `isExpired === true || diffDays <= 0` (sudah lewat) → `Kedaluwarsa` (danger)
    4. `diffMs < 86_400_000` (kurang dari 24 jam) → `Kurang dari 1 hari` (danger)
    5. `diffDays <= 3` → `Segera Berakhir (X hari)` (warning)
    6. `diffDays > 3` → `Aktif (X hari)` (success)
  * Satuan label: `"hari"` (bukan `"h"` yang berarti jam di `domain/format.js:44-48`).
  * Guard NaN: `if (isNaN(expiry.getTime())) return { label: 'Tidak Diketahui', variant: 'neutral' }`.
* **Shared Plan Constants (`apps/admin/src/constants/plans.js`)**:
  * Daftar paket diekstrak ke konstanta bersama (digunakan oleh `UserCreateModal` dan `UserEntitlementModal`).
  * Komentar di file: `// Mirror of packages/pricing/catalog.json (ADR 0007); admin cannot import the catalog directly.`
* **Reuse Komponen**: `Modal`, `Input`, `Button`, `Badge` (varian `success/warning/danger/neutral` sudah ada di `main.css:508-538`).
* **Generator Password**: Menggunakan CSPRNG `window.crypto.getRandomValues` (bukan `Math.random`), menghasilkan min. 12 karakter (huruf besar, kecil, angka, simbol aman) sehingga dijamin lolos `validate_password_complexity`.

### 3.6 Transaction Boundary: Create User + Audit (ADR 0008 §4)
Masalah: `user_service.register()` saat ini membungkus insert-nya sendiri dalam `session_scope(db)` (commit otomatis saat keluar scope, `app/db/base.py:38-54`). Jika `admin_service.create_user` memanggil `register()` lalu `_audit()` di luar scope, user sudah ter-commit sebelum audit → jika audit gagal, lahir user tanpa jejak audit.

**Solusi**: Jadikan `prepare_user` fungsi publik di `UserService`:
```python
def prepare_user(self, db, username, plain_password, role, email, plan_code, expires_at) -> User:
    """Validate, create User + Entitlement, flush only (no commit).
    Caller must wrap in session_scope."""
    cleaned = validate_username(username)
    validate_password_complexity(plain_password)
    # ... validasi, cek duplikat, lookup plan ...
    user = User(username=cleaned, ..., expires_at=expires_at)
    db.add(user)
    db.flush()
    db.add(Entitlement(user_id=user.id, plan_code=plan.code, max_connections=plan.max_connections))
    return user

def register(self, db, username, plain_password, role="trader", email=None,
             plan_code="free", expires_at=None) -> User:
    """Public registration path — owns the commit."""
    with session_scope(db):
        user = self.prepare_user(db, username, plain_password, role, email, plan_code, expires_at)
    db.refresh(user)
    return user
```

`admin_service.create_user` kemudian memanggil `prepare_user` di dalam satu `session_scope`:
```python
def create_user(self, db, *, actor, req, ip_address) -> User:
    expires_at = _resolve_expiry(req.duration_days, req.exact_expires_at, req.set_lifetime)
    with session_scope(db):
        user = user_service.prepare_user(db, req.username, req.password, req.role, req.email, req.plan_code, expires_at)
        _audit(db, actor_id=actor.id, target_user_id=user.id,
               action="admin.user.created", ip_address=ip_address,
               detail=f"plan={req.plan_code}, expires_at={expires_at}")
    db.refresh(user)
    return user
```

Hal ini menjamin:
- Publik (`register`) tetap bekerja identik (commit sendiri).
- Admin (`create_user`) membungkus insert user + entitlement + audit dalam **satu transaksi atomik**.
- Validasi (username, password, email, duplikat, plan) tetap terpusat di `prepare_user` (public method) — single source of truth tanpa melanggar konvensi underscore.

---

## 4. Acceptance Criteria
1. Migrasi database `0004_user_expires_at` berhasil dieksekusi tanpa merusak data pengguna lama (`expires_at = None`).
2. Pendaftaran publik via web app otomatis diberi masa aktif `settings.DEFAULT_REGISTRATION_TRIAL_DAYS` hari (default 3 hari, test assert terhadap setting, bukan angka hardcoded).
3. Akun yang telah kedaluwarsa gagal login dengan pesan HTTP 403 yang jelas.
4. Token JWT yang tadinya valid ditolak dengan HTTP 401 setelah `expires_at` lewat.
5. Ingest telemetri MT5 monitor (`receive_heartbeat` dan `sync-trades`) ditolak dengan HTTP 403 jika akun pemilik koneksi telah kedaluwarsa **atau** `is_active == False`.
6. Admin dapat membuat pengguna baru dari dashboard `apps/admin`, response berstatus HTTP 201 dengan skema `AdminUserItem` (metadata-only). Duplikat username → 409.
7. Modal "Salin Kredensial" menampilkan password dari state form klien dan berhasil menyalin ke clipboard.
8. Admin dapat memperpanjang masa aktif akun pengguna yang sudah ada melalui modal extend expiry.
9. Semua aksi admin (`admin.user.created` dan `admin.user.expiry_updated`) tercatat dalam `AuditLog` dengan `target_user_id` yang benar. Insert user + audit berada dalam satu transaksi atomik (jika audit gagal, user di-rollback).
10. Seluruh test backend (`pytest`), gate arsitektur (`lint-imports`), web lint/test/build, dan admin lint/arch/build lulus tanpa error.

---

## 5. Out of Scope
* Sistem payment gateway otomatis (Stripe/Xendit/Midtrans).
* Pengiriman email otomatis pengingat masa aktif akan habis.
* Pembuatan role admin/support dari modal user (khusus role trader).
