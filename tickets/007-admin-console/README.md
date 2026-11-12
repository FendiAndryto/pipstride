# Fase 007 — Admin Console + Privilege Boundary

## Tujuan
Permukaan internal untuk mengelola user: lihat akun, ubah entitlement, deaktivasi/revoke, inspeksi
audit trail — dengan boundary privasi & least-privilege yang ditegakkan struktur, bukan diiklankan.

Referensi: `docs/adr/0008-admin-console-surface-and-privilege-boundary.md`.

## Prasyarat (kriteria masuk)
- **Fase 003 selesai** (arch guard; guard dependency admin diuji di sini).
- **Fase 005 selesai** (repositories agar admin membaca lewat jalur yang sama).
- **Fase 006** (frontend) direkomendasikan selesai agar `lib/http` + `domain` bisa dipakai ulang.
- **Urutan internal wajib** (§8): (a) read-only → (b) TOTP → (c) mutasi → (d) support mode.

## Tiket
1. `01-require-role-and-readonly-endpoints.md`  — (a)
2. `02-totp-enrollment.md`                       — (b)
3. `03-admin-mutations-and-audit.md`             — (c)
4. `04-support-mode-and-access-log.md`           — (d)
5. `05-admin-frontend-app.md`

## Gate (checklist audit keluar)
- [x] Semua modul di `api/v1/admin/` memasang `require_role(...)` (architecture test gagal bila ada
      `APIRouter` telanjang — ADR 0008 §2).
- [x] Role dibaca dari **DB tiap request** (bukan claim JWT); demote/deactivate langsung berlaku (ADR 0008 §3).
- [x] TOTP wajib untuk admin/support; migrasi `users.totp_secret` (terenkripsi) + `totp_enrolled_at` (ADR 0008 §5).
- [x] Setiap mutasi menulis `audit_logs` (actor, action, detail, ip) — endpoint tanpa audit tidak boleh ship (ADR 0008 §4).
- [x] Support mode time-boxed 30 menit, reason wajib, tercatat di `support_sessions` + `audit_logs` (ADR 0008 §6).
- [x] Access log user-visible di `apps/web` **ada sebelum** support mode diaktifkan (prasyarat ADR 0008 §6).
- [x] Admin **tidak pernah** menerima token koneksi plaintext; `token_hash` tetap hash-only (ADR 0008 §6).
- [x] Sebelum TOTP ship: origin admin dibatasi (IP allowlist / Cloudflare Access), tidak ada akun admin di luar itu (ADR 0008 §5).
- [x] `apps/admin` bundle & origin terpisah dari `apps/web`; tidak ada route `/admin` di dalam `apps/web` (ADR 0008 §7).
- [x] `pytest` + gate `arch` + build admin hijau.

## Dampak
- Ops/support. Blast radius backend dibagi dengan produk (satu proses FastAPI) — diterima sadar
  (ADR 0008 Consequences), bukan klaim isolasi.

## Catatan lingkup
- **Satu service backend**; tambah router, bukan service baru (ADR 0008 §1).
- Tanpa tabel `admins` terpisah; pakai `User.role` (`admin`/`support`).
- Tunda bila belum ada user yang perlu di-support; jangan bangun lebih awal.

## Catatan implementasi (keluar fase)
- Backend: `api/v1/admin/{users,connections,audit,metrics,support}.py` semuanya memakai
  `dependencies=[Depends(require_role(...))]`; `tests/test_admin_guard.py` memeriksa AST dan punya
  kontrol negatif (router polos → merah), plus uji demote/deactivate langsung berlaku.
- TOTP: migrasi `0002_admin_totp` (`users.totp_secret` terenkripsi Fernet + `totp_enrolled_at`).
  Login admin/support tanpa kode → 401; akun belum enroll → 403 dengan jalur enrollment
  password-only (`/auth/totp/enroll/start|verify`) agar admin tidak terkunci.
- Mutasi: entitlement, deactivate/activate, revoke koneksi, grant/revoke support → semua menulis
  `audit_logs` (actor, action, detail, ip, `target_user_id`).
- Support mode: `support_sessions` (migrasi `0003_support_sessions`), 30 menit, alasan wajib,
  grant/revoke/detail-view dicerminkan ke audit. Opt-in via `SUPPORT_MODE_ENABLED` (default false).
- Access log user: `GET /api/v1/access-log` + `AccessLogSection` di `ProfileTab` (`apps/web`).
- Admin reads: hanya `token_prefix`, tidak ada field token plaintext/`token_hash` di schema admin.
- Origin: host Caddy terpisah (`ADMIN_DOMAIN`) dengan allowlist `ADMIN_ALLOWED_IPS`; di luar
  allowlist dijawab 404. `apps/admin` bundle sendiri, tanpa route `/admin` di `apps/web`.
- Verifikasi: pytest penuh hijau, `lint-imports` 6/0, web lint/test/build + i18n hijau, admin
  `lint` + `lint:arch` + `build` hijau. Docker image build & drift migrasi Postgres **belum**
  dijalankan di mesin ini (Docker Desktop mati) — divalidasi oleh job CI `migrations`/`docker`.
