# Ticket 02: Web Registration Closure, Non-Destructive Flag & Discord CTA

## Goal
Menutup pendaftaran mandiri pada frontend (`apps/web`), menyembunyikan tab switcher registrasi tanpa menghapus kode form/handler di `LoginPage.jsx`, menyematkan kartu notifikasi akses terbatas dengan tombol tautan langsung ke profil Discord administrator (`https://discord.com/users/757954690037186580`), serta memperbarui kamus terjemahan bilingual (EN & ID) dengan paritas 100%.

---

## Scope

1. **Non-Destructive Feature Flag & Discord Link (`apps/web/src/components/LoginPage.jsx`)**:
   - Deklarasikan konstanta di file:
     ```javascript
     // Set to true to re-enable the public self-registration tab and form (SPEC-006)
     const PUBLIC_REGISTRATION_ENABLED = false;
     const DISCORD_ADMIN_URL = 'https://discord.com/users/757954690037186580';
     ```
   - Sembunyikan tab switcher `[ Sign In | Create Account ]` jika `!PUBLIC_REGISTRATION_ENABLED`.
   - Pastikan state default form selalu `'login'`.
   - Bungkus render form registrasi dengan `PUBLIC_REGISTRATION_ENABLED && activeTab === 'register'`.
   - Jangan hapus deklarasi state registrasi (`regUsername`, `regEmail`, `regPassword`, dll.) maupun handler `handleRegisterSubmit`.

2. **Kartu Akses Terbatas & Tombol Discord (`LoginPage.jsx`)**:
   - Tampilkan kartu berdesain Pipstride dark emerald di bawah form Sign In ketika `!PUBLIC_REGISTRATION_ENABLED`.
   - Memuat ikon `ShieldCheck`, judul `auth_private_access_title`, deskripsi `auth_private_access_desc`, dan tombol CTA `auth_contact_discord_btn` mengarah ke `DISCORD_ADMIN_URL` dengan `target="_blank"` dan `rel="noopener noreferrer"`.

3. **Kamus Terjemahan Bilingual (`apps/web/src/constants/translations.js`)**:
   - Tambahkan key berikut ke section auth kamus bahasa Inggris (`en`) dan Indonesia (`id`):
     - `auth_private_access_title`: `'Early Access / Invitation Only'` / `'Akses Terbatas / Melalui Undangan'`
     - `auth_private_access_desc`: `'Public registration is currently closed. New accounts are provisioned directly by the administrator.'` / `'Pendaftaran publik saat ini ditutup. Akun baru dibuatkan langsung oleh administrator.'`
     - `auth_contact_discord_btn`: `'Request Account via Discord'` / `'Hubungi Admin via Discord'`

---

## Files to Touch
- `apps/web/src/components/LoginPage.jsx`
- `apps/web/src/constants/translations.js`

---

## Verification
```bash
# 1. Paritas i18n
node apps/web/scripts/check-i18n.cjs

# 2. Linting & arsitektur
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch

# 3. Unit test & build
npm --prefix apps/web test
npm --prefix apps/web run build
```
Ekspektasi:
- `i18n OK — 494 keys per language, 436 static keys resolved.`
- `oxlint` 0 warnings.
- `depcruise` 0 violations.
- Vitest 6 files / 88 tests pass.
- Vite build sukses menghasilkan `apps/web/dist`.

---

## Hasil Verifikasi (2026-11-13)

- `check-i18n.cjs` → `i18n OK — 494 keys per language, 436 static keys resolved.` (+3 key per bahasa).
- `oxlint` → 0 warning. `lint:arch` → 0 violations (59 modules, 170 dependencies).
- `vitest run` → **6 files / 88 tests passed**.
- `vite build` → 1979 modules, `dist/` tergenerate (bundle utama 428.38 kB / 122.20 kB gzip).
- Non-destruktif: seluruh state `reg*`, `handleRegisterSubmit`, dan blok JSX form registrasi tetap
  ada; hanya dibungkus guard `PUBLIC_REGISTRATION_ENABLED`. `activeView` mengoerce state
  `'register'` sisa menjadi `'login'` supaya tidak pernah jatuh ke form recovery.
- Kartu notice (`#private-access-notice`) + CTA (`#discord-admin-contact-btn`) dirender di bawah
  form Sign In hanya saat `activeView === 'login'`; tautan `target="_blank"` +
  `rel="noopener noreferrer"` ke `https://discord.com/users/757954690037186580`.
- Verifikasi render sekali pakai (React `renderToStaticMarkup`) mengonfirmasi tab registrasi &
  `#signup-form` absen sementara notice + CTA hadir; smoke test sementara itu dihapus agar suite
  tetap 88 test murni sesuai gate.

## Status
done

