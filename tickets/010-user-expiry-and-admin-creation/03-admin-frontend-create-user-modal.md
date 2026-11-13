# Ticket 03: Admin Console Create User Modal & Copy Credentials Dialog

## Goal
Menyediakan antarmuka visual di `apps/admin` bagi admin untuk mendaftarkan akun pengguna baru beserta fitur generator password acak (kombinasi huruf besar, kecil, angka, simbol menggunakan `window.crypto.getRandomValues`) dan dialog cepat untuk menyalin kredensial akun. Password hanya bersumber dari state form klien (bukan dari API response demi kepatuhan metadata-only). Validasi form di klien mencakup format username regex yang sama dengan backend.

## Scope
1. **Shared Plan Constants (`apps/admin/src/constants/plans.js`)**:
   - Buat konstanta bersama daftar paket:
     ```javascript
     // Mirror of packages/pricing/catalog.json (ADR 0007).
     // apps/admin cannot import the catalog directly (no-cross-app-imports rule).
     export const PLAN_OPTIONS = [
       { code: 'free', label: 'FREE — 1 Connection default', defaultConnections: 1 },
       { code: 'core', label: 'CORE — 1 Connection default', defaultConnections: 1 },
       { code: 'plus', label: 'PLUS — 3 Connections default', defaultConnections: 3 },
       { code: 'pro',  label: 'PRO — 5 Connections default',  defaultConnections: 5 },
     ];
     ```
   - Refactor `UserEntitlementModal.jsx` untuk mengimpor `PLAN_OPTIONS` dari `../../constants/plans` (menghapus hardcoded options di baris 85-88).
2. **Password Generator Helper (`window.crypto.getRandomValues`)**:
   - Fungsi `generatePassword(length = 16)` di `UserCreateModal.jsx` (atau `features/users/generatePassword.js`).
   - Wajib menggunakan CSPRNG browser: `window.crypto.getRandomValues(new Uint32Array(length))` (bukan `Math.random`).
   - Output dijamin mengandung minimal: 1 huruf besar, 1 huruf kecil, 1 angka, 1 simbol aman.
   - Panjang minimal 12 karakter sehingga lolos `validate_password_complexity` backend.
3. **Validasi Form Klien (Username Regex & Length)**:
   - Pola regex: `^[a-zA-Z0-9_.-]{3,32}$`.
   - Validasi langsung di event onChange / onSubmit form agar error feedback muncul seketika di UI tanpa menunggu response API.
4. **API Client (`apps/admin/src/features/users/api.js`)**:
   - Tambah method `createUser(payload)`: memanggil `POST /api/v1/admin/users`.
5. **Komponen Modal Input (`UserCreateModal.jsx`)**:
   - Buat di `apps/admin/src/features/users/UserCreateModal.jsx`.
   - Menggunakan komponen UI: `Modal`, `Input`, `Button` dari `components/ui/`.
   - Field input:
     - `username`: validasi teks (3–32 karakter, pola `^[a-zA-Z0-9_.-]+$`).
     - `email`: opsional.
     - `password`: input password + tombol "Generate Random" + toggle intip/sembunyikan. Disimpan di local React state.
     - `plan_code`: selector dropdown menggunakan `PLAN_OPTIONS` dari `../../constants/plans`.
     - `duration`: selector durasi:
       - Preset:
         - `3 Hari (Trial)` → `{ duration_days: 3 }`
         - `30 Hari (1 Bulan)` → `{ duration_days: 30 }`
         - `90 Hari (3 Bulan)` → `{ duration_days: 90 }`
         - `365 Hari (1 Tahun)` → `{ duration_days: 365 }`
         - `Permanen (Lifetime)` → `{ set_lifetime: true }`
         - `Kustom` → input angka hari → `{ duration_days: <n> }`
   - Tombol "Batal" dan "Buat Akun".
6. **Komponen Dialog Kredensial (`UserCredentialsModal.jsx`)**:
   - Buat di `apps/admin/src/features/users/UserCredentialsModal.jsx`.
   - Menerima props `{ username, password, email, planCode, expiresAtText }` dari state form `UserCreateModal` (bukan dari API response).
   - URL login dashboard: `import.meta.env.VITE_APP_URL || 'https://app-pipstride.homever.my.id'`.
   - Format teks kredensial:
     ```text
     Kredensial Akun Pipstride:
     - URL Dashboard: <url>
     - Username: <username>
     - Password: <password>
     - Paket: <plan_label>
     - Masa Aktif: <expiresAtText>
     ```
   - Tombol **"Salin Kredensial"** (`navigator.clipboard.writeText`) + umpan balik visual *"Tersalin ke Clipboard!"*.
   - Tombol "Tutup".
7. **Integrasi Halaman (`UsersPage.jsx`)**:
   - Tombol aksi **"Tambah Pengguna"** di header halaman (ikon `UserPlus`).
   - State flow: buka `UserCreateModal` → submit berhasil → tampilkan `UserCredentialsModal` → tutup → reload tabel.
8. **Dokumentasi Environment Variable Admin (`apps/admin/README.md`)**:
   - Catat `VITE_APP_URL` di `apps/admin/README.md` (default fallback: `https://app-pipstride.homever.my.id`).
   - Berikan catatan bahwa Vite membake environment variable saat build; fallback mencakup skenario standar produksi.

## Files to Touch
- `apps/admin/src/constants/plans.js` (baru)
- `apps/admin/src/features/users/UserEntitlementModal.jsx`
- `apps/admin/src/features/users/api.js`
- `apps/admin/src/features/users/UserCreateModal.jsx` (baru)
- `apps/admin/src/features/users/UserCredentialsModal.jsx` (baru)
- `apps/admin/src/pages/UsersPage.jsx`
- `apps/admin/README.md`

## Verification
```powershell
npm --prefix apps/admin run lint
npm --prefix apps/admin run lint:arch
npm --prefix apps/admin run build
```
Expected:
- Oxlint 0 warning.
- Dependency-cruiser 0 violations (`constants/` diizinkan oleh rule `pages-only-import-approved-layers` karena masuk pola `src/constants`).
- Vite build sukses.

## Depends on
- `02-admin-user-create-and-extend-api.md`

## Unblocks
- `04-admin-frontend-user-expiry-management.md`

## Status
todo
