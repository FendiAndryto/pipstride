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
- [ ] Semua modul di `api/v1/admin/` memasang `require_role(...)` (architecture test gagal bila ada
      `APIRouter` telanjang — ADR 0008 §2).
- [ ] Role dibaca dari **DB tiap request** (bukan claim JWT); demote/deactivate langsung berlaku (ADR 0008 §3).
- [ ] TOTP wajib untuk admin/support; migrasi `users.totp_secret` (terenkripsi) + `totp_enrolled_at` (ADR 0008 §5).
- [ ] Setiap mutasi menulis `audit_logs` (actor, action, detail, ip) — endpoint tanpa audit tidak boleh ship (ADR 0008 §4).
- [ ] Support mode time-boxed 30 menit, reason wajib, tercatat di `support_sessions` + `audit_logs` (ADR 0008 §6).
- [ ] Access log user-visible di `apps/web` **ada sebelum** support mode diaktifkan (prasyarat ADR 0008 §6).
- [ ] Admin **tidak pernah** menerima token koneksi plaintext; `token_hash` tetap hash-only (ADR 0008 §6).
- [ ] Sebelum TOTP ship: origin admin dibatasi (IP allowlist / Cloudflare Access), tidak ada akun admin di luar itu (ADR 0008 §5).
- [ ] `apps/admin` bundle & origin terpisah dari `apps/web`; tidak ada route `/admin` di dalam `apps/web` (ADR 0008 §7).
- [ ] `pytest` + gate `arch` + build admin hijau.

## Dampak
- Ops/support. Blast radius backend dibagi dengan produk (satu proses FastAPI) — diterima sadar
  (ADR 0008 Consequences), bukan klaim isolasi.

## Catatan lingkup
- **Satu service backend**; tambah router, bukan service baru (ADR 0008 §1).
- Tanpa tabel `admins` terpisah; pakai `User.role` (`admin`/`support`).
- Tunda bila belum ada user yang perlu di-support; jangan bangun lebih awal.
