# Ticket 04: Admin Console User Expiry Management & Visual Indicators

## Goal
Menampilkan indikator visual status masa aktif akun pada tabel daftar pengguna dan halaman detail pengguna di `apps/admin`, serta menyediakan modal untuk memperpanjang atau mengubah masa aktif akun. Badge label definitif dan konsisten antara spec dan implementasi.

## Scope
1. **Helper Format Status Masa Aktif (`apps/admin/src/domain/format.js` & `lib/format.js`)**:
   - Di `apps/admin/src/domain/format.js`:
     Implementasikan `formatExpiryStatus(expiresAt, isActive, isExpired = false)` dengan urutan presedensi ketat dan terpadu:
     ```javascript
     export function formatExpiryStatus(expiresAt, isActive, isExpired = false) {
       // 1. Nonaktif manual (is_active=false) mengalahkan status tanggal
       if (!isActive) {
         return { label: 'Nonaktif', variant: 'neutral' };
       }
       // 2. Lifetime / permanen
       if (!expiresAt) {
         return { label: 'Permanen', variant: 'neutral' };
       }
       // 3. Flag is_expired dari backend atau kalkulasi tanggal sudah lewat
       if (isExpired) {
         return { label: 'Kedaluwarsa', variant: 'danger' };
       }
       const expiry = new Date(expiresAt);
       // Guard: tanggal tidak valid → safe fallback
       if (isNaN(expiry.getTime())) {
         return { label: 'Tidak Diketahui', variant: 'neutral' };
       }
       const now = new Date();
       const diffMs = expiry.getTime() - now.getTime();
       const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
       // 4. Perhitungan tanggal browser jika sudah lewat
       if (diffDays <= 0) {
         return { label: 'Kedaluwarsa', variant: 'danger' };
       }
       // 5. Kurang dari 1 hari (sisa jam < 24 jam)
       if (diffMs < 86_400_000) {
         return { label: 'Kurang dari 1 hari', variant: 'danger' };
       }
       // 6. Segera berakhir (≤3 hari) — berlaku untuk semua plan
       if (diffDays <= 3) {
         return { label: `Segera Berakhir (${diffDays} hari)`, variant: 'warning' };
       }
       // 7. Aktif normal
       return { label: `Aktif (${diffDays} hari)`, variant: 'success' };
     }
     ```
     Catatan:
     - Menerima parameter `isExpired = false` (dari backend `user.is_expired`) sebagai sumber kebenaran utama, dengan fallback ke diff tanggal browser.
     - Label menggunakan satuan `"hari"`, bukan `"h"` (yang berarti jam di `formatRelativeTime`, baris 44-48).
     - "Segera Berakhir" digunakan untuk semua plan (bukan "Masa Uji" yang keliru untuk paket berbayar).
   - Di `apps/admin/src/lib/format.js`:
     Re-export `formatExpiryStatus` agar halaman (`pages/`) yang dibatasi rule `pages-only-import-approved-layers` depcruise dapat mengimpor dari `lib/format.js`.
2. **Indikator pada Tabel Pengguna (`UsersTable.jsx`)**:
   - Gunakan komponen `Badge` yang sudah ada (`src/components/ui/Badge.jsx`) dengan varian (`success`, `warning`, `danger`, `neutral`) yang sudah di-style di `main.css:508-538`.
   - Tampilkan badge status masa aktif menggunakan `formatExpiryStatus(user.expires_at, user.is_active, user.is_expired)`.
3. **API Client (`apps/admin/src/features/users/api.js`)**:
   - Tambah method `extendUserExpiry(userId, payload)`: memanggil `POST /api/v1/admin/users/${userId}/extend-expiry`.
4. **Modal Perpanjang Masa Aktif (`UserExtendExpiryModal.jsx`)**:
   - Buat di `apps/admin/src/features/users/UserExtendExpiryModal.jsx`.
   - Menggunakan `Modal`, `Button`, `Input` dari `components/ui/`.
   - Menampilkan status & tanggal kedaluwarsa saat ini (formatted).
   - Pilihan aksi:
     - Tambah Durasi Preset: `+7 Hari`, `+30 Hari`, `+90 Hari`, `+365 Hari` → `{ duration_days: n }`.
     - Jadikan Permanen (Lifetime) → `{ set_lifetime: true }`.
     - Kustom Hari → `{ duration_days: n }`.
     - Atur Tanggal Tertentu → `{ exact_expires_at: "<ISO-8601 timezone-aware>" }`.
5. **Integrasi Halaman Detail Pengguna (`UserDetailPage.jsx`)**:
   - Tampilkan kartu informasi **Masa Aktif & Kedaluwarsa** dengan badge via `formatExpiryStatus(user.expires_at, user.is_active, user.is_expired)`.
   - Tambahkan tombol aksi **"Perpanjang / Edit Masa Aktif"** (ikon `Clock` / `Calendar`).
   - Buka `UserExtendExpiryModal` dan reload data user setelah sukses.

## Files to Touch
- `apps/admin/src/domain/format.js`
- `apps/admin/src/lib/format.js`
- `apps/admin/src/features/users/api.js`
- `apps/admin/src/features/users/UsersTable.jsx`
- `apps/admin/src/features/users/UserExtendExpiryModal.jsx` (baru)
- `apps/admin/src/pages/UserDetailPage.jsx`

## Verification
```powershell
npm --prefix apps/admin run lint
npm --prefix apps/admin run lint:arch
npm --prefix apps/admin run build
```
Expected:
- Oxlint 0 warnings.
- Dependency-cruiser 0 violations.
- Vite build sukses.

## Depends on
- `03-admin-frontend-create-user-modal.md`

## Unblocks
- Fase 010 Gate

## Status
todo
