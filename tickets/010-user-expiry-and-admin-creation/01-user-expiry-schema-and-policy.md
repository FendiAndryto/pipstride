# Ticket 01: User Expiry Schema, Config, & Access Guard

## Goal
Menambahkan dukungan tanggal kedaluwarsa (`expires_at`) pada akun pengguna, konfigurasi durasi trial pendaftaran mandiri (`DEFAULT_REGISTRATION_TRIAL_DAYS`), penolakan login untuk akun kedaluwarsa (HTTP 403), proteksi sesi aktif (HTTP 401, dengan cabang pesan akurat terpisah dari nonaktif), dan proteksi sensor telemetri MT5 (HTTP 403 untuk kedaluwarsa **dan** `is_active=False` pada `heartbeat` dan `sync-trades`), dengan normalisasi timezone `as_utc` yang aman untuk SQLite dan PostgreSQL.

## Scope
1. **Database Migration**:
   - Tambah kolom `expires_at: DateTime(timezone=True)` (nullable, indexed) pada tabel `users`.
   - File migrasi Alembic: `services/api/migrations/versions/0004_user_expires_at.py` (down_revision: `0003_support_sessions`).
   - Update model `User` di `services/api/app/db/models.py`.
2. **Environment Configuration**:
   - Tambah `DEFAULT_REGISTRATION_TRIAL_DAYS: int = 3` di `services/api/app/core/config.py`.
   - Dokumentasikan di `.env.example`.
3. **Domain Policy & Timezone Normalization**:
   - Di `services/api/app/domain/policies.py`:
     Implementasikan fungsi murni:
     ```python
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
     `as_utc()` (`app.domain.time:41`) **wajib** digunakan agar kompatibel dengan SQLite.
4. **Pendaftaran Mandiri (`/auth/register`)**:
   - Di `services/api/app/api/v1/auth.py` (router `register`):
     Router menghitung `expires_at` berdasarkan `settings.DEFAULT_REGISTRATION_TRIAL_DAYS`:
     ```python
     trial_days = settings.DEFAULT_REGISTRATION_TRIAL_DAYS
     expires_at = (datetime.now(timezone.utc) + timedelta(days=trial_days)) if trial_days > 0 else None
     ```
     Lalu meneruskan ke `user_service.register(..., expires_at=expires_at)`.
   - Di `services/api/app/services/user_service.py`:
     Perluas parameter `register(...)` dengan `expires_at: Optional[datetime] = None` dan set ke `User(... expires_at=expires_at)`.
     **register() tidak membaca `settings`** — parameter `expires_at` selalu diterima dari pemanggil.
     Alur admin yang memanggil `register()` / `prepare_user()` (tiket 02) meneruskan `expires_at` yang sudah dihitung sendiri, sehingga tidak terkena default trial.
5. **Penolakan Login & Session Guard**:
   - Di `services/api/app/api/v1/auth.py` (`login`):
     - Anti-enumeration terjaga: verifikasi via `user_service.authenticate`. Jika gagal (user tidak ditemukan, password salah, `is_active=False`) → HTTP 401 Unauthorized standar.
     - Setelah `authenticate` mengembalikan user, cek masa aktif **sebelum** TOTP:
       jika `user.expires_at is not None` dan `as_utc(user.expires_at) <= datetime.now(timezone.utc)`:
       → `HTTPException(status_code=403, detail="Masa aktif akun telah berakhir. Silakan hubungi admin untuk memperpanjang langganan.")`.
   - Di `services/api/app/core/deps.py` (`get_current_user`):
     - Pertahankan dua cabang pesan terpisah agar diagnosa tepat:
       ```python
       if not user or not user.is_active:
           raise _unauthorized("User not recognized or account deactivated")
       if user.expires_at is not None and as_utc(user.expires_at) <= datetime.now(timezone.utc):
           raise _unauthorized("Session expired: account has expired. Please contact support to renew.")
       ```
6. **Proteksi Telemetri Sensor MT5**:
   - Di `services/api/app/api/v1/bridge.py` (`receive_heartbeat` dan `sync_trades`):
     - Buat helper guard bersama (misal `_check_connection_owner_active(connection)`):
       ```python
       def _check_connection_owner_active(connection: Mt5Connection) -> None:
           if not is_account_active(connection.user.is_active, connection.user.expires_at):
               raise HTTPException(
                   status_code=status.HTTP_403_FORBIDDEN,
                   detail="Account is inactive or has expired.",
               )
       ```
     - Panggil di awal handler `receive_heartbeat` dan `sync_trades` setelah `connection` teresolusi.
     - **Perubahan perilaku**: Sebelumnya, menonaktifkan user (`is_active=False`) via admin console tidak langsung memutus telemetri EA. Setelah tiket ini, **deactivate user juga langsung menolak heartbeat & sync-trades** — ini perilaku yang diinginkan.
7. **Automated Tests** (`services/api/tests/test_user_expiry.py`):
   - User dengan `expires_at` di masa lalu + password benar → gagal login **403** (`"Masa aktif akun telah berakhir..."`).
   - User dengan password salah → gagal login **401** (anti-enumeration).
   - User dengan `is_active=False` → gagal login **401** (anti-enumeration).
   - User dengan `expires_at` di masa depan → sukses login **200**.
   - User tanpa `expires_at` (lifetime) → sukses login **200**.
   - **AC #4**: Token JWT diterbitkan saat user masih aktif; kemudian `user.expires_at` dimundurkan ke masa lalu (via `db.execute`); request berikutnya menggunakan token tersebut → ditolak HTTP **401** dengan detail `"Session expired: account has expired..."`.
   - Akun yang `is_active=False` dengan token JWT lama → ditolak HTTP **401** dengan detail `"User not recognized or account deactivated"` (pesan akurat, tidak tertukar).
   - Registrasi baru otomatis mendapatkan `expires_at = now + settings.DEFAULT_REGISTRATION_TRIAL_DAYS` hari (test assert terhadap `settings.DEFAULT_REGISTRATION_TRIAL_DAYS`, bukan angka 3 hardcoded).
   - Bridge `receive_heartbeat` ditolak HTTP **403** jika pemilik koneksi kedaluwarsa.
   - Bridge `receive_heartbeat` ditolak HTTP **403** jika pemilik koneksi `is_active=False`.
   - Bridge `sync_trades` ditolak HTTP **403** jika pemilik koneksi kedaluwarsa.
   - Bridge `sync_trades` ditolak HTTP **403** jika pemilik koneksi `is_active=False`.

## Files to Touch
- `services/api/migrations/versions/0004_user_expires_at.py`
- `services/api/app/db/models.py`
- `services/api/app/core/config.py`
- `services/api/app/domain/policies.py`
- `services/api/app/services/user_service.py`
- `services/api/app/api/v1/auth.py`
- `services/api/app/core/deps.py`
- `services/api/app/api/v1/bridge.py`
- `.env.example`
- `services/api/tests/test_user_expiry.py`

## Verification
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest tests/test_user_expiry.py -v
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```
Expected: Semua test terkait expiry lulus, full suite tetap hijau, lint-imports 6 kept 0 broken.

## Depends on
- Fase 007 (`tickets/007-admin-console/`)

## Unblocks
- `02-admin-user-create-and-extend-api.md`

## Status
done
