# Fase 012: Public Registration Closure & Discord Onboarding

## Tujuan
Menutup pendaftaran mandiri publik (*self-registration*) pada domain jurnal `app-pipstride.homever.my.id` baik di sisi antarmuka web maupun endpoint API backend, menjaga seluruh kode registrasi tetap utuh agar dapat dibuka kembali kapan saja, serta mengarahkan calon pengguna baru untuk menghubungi administrator via Discord (`ID: 757954690037186580`) untuk pembuatan akun melalui Dashboard Admin.

Didefinisikan dalam spesifikasi: [`docs/specs/006-public-registration-closure-and-discord-contact.md`](../../docs/specs/006-public-registration-closure-and-discord-contact.md).

---

## Urutan Pengerjaan & Gate

Prasyarat: Fase 010 (User Expiry & Admin Creation) & Fase 011 (Dashboard Polish).

| Tiket | Fokus | Prasyarat | Membuka | Status |
|---|---|---|---|---|
| **01** | `01-backend-registration-toggle.md` | — | 02 | `done` |
| **02** | `02-web-registration-closure-and-discord-cta.md` | 01 | — | `done` |

---

## Checklist Audit Keluar (Gate Fase 012)

Sebelum menandai fase ini selesai (`done`):
- [x] Backend API: Memanggil `POST /api/v1/auth/register` mengembalikan HTTP `403 Forbidden` saat `ENABLE_PUBLIC_REGISTRATION=False`.
- [x] Backend API Test: Suite tes unit backend (pytest) tetap lulus 100% dengan tambahan pengujian proteksi 403 — **177 passed**.
- [x] Backend Arsitektur: `lint-imports` keluar 0 broken contract — **6 kept, 0 broken**.
- [x] Frontend Web: Tab switcher `[ Create Account ]` tidak ditampilkan ke pengunjung.
- [x] Frontend Web: Notice card "Akses Terbatas / Private Beta" muncul di bawah form login dengan tombol link Discord ke `https://discord.com/users/757954690037186580`.
- [x] Frontend Web: Kode form registrasi dan fungsi `handleRegisterSubmit` tetap tersimpan utuh di `LoginPage.jsx` (tidak dihapus).
- [x] Paritas i18n: `node apps/web/scripts/check-i18n.cjs` lulus tanpa key yatim — **494 keys per language**.
- [x] Frontend Web Quality: `npm --prefix apps/web run lint`, `npm --prefix apps/web run lint:arch`, `npm --prefix apps/web test`, dan `npm --prefix apps/web run build` lulus dengan exit 0.

---

## Catatan Implementasi (2026-11-13)

Fase selesai dan gate ditutup.

1. **Dua lapis proteksi, satu sakelar.** Backend menolak lebih dulu (`403`) sehingga request
   cURL/Postman tidak bisa melewati UI; UI menyembunyikan jalur registrasi agar pengunjung tidak
   menemui jalan buntu. Membuka kembali registrasi cukup dengan
   `ENABLE_PUBLIC_REGISTRATION=true` di env **dan** `PUBLIC_REGISTRATION_ENABLED = true` di
   `LoginPage.jsx` — kode form tidak perlu ditulis ulang.
2. **Default tertutup di semua jalur deploy.** `Settings.ENABLE_PUBLIC_REGISTRATION = False`,
   `.env.example` menyetel `false`, dan compose meneruskan
   `${ENABLE_PUBLIC_REGISTRATION:-false}`. Test harness (`tests/conftest.py`) membuka flag agar
   siklus hidup akun tetap teruji; test 403 menutupnya kembali via `monkeypatch`.
3. **Onboarding diarahkan ke Discord admin**, bukan ke server komunitas (belum ada). Kartu memakai
   token warna Pipstride (`rgba(15, 34, 28, …)` / `var(--g)`) dengan tombol CTA memakai warna brand
   Discord `#5865F2` agar terbedakan jelas dari tombol submit emerald.

