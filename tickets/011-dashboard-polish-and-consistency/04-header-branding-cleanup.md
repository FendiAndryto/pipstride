# Ticket 04: Header Legacy Branding Cleanup

## Goal
Membersihkan sisa class warisan `.tradegear-header` pada komponen markup dan CSS stylesheet, menggantikannya dengan identitas kanonikal `.pipstride-header` tanpa mengubah sedikit pun tampilan estetika, layout, responsivitas mobile, maupun fungsionalitas interaktif header Pipstride.

## Scope

1. **Markup Refactor (`apps/web/src/components/PipstrideHeader.jsx`)**:
   - Ganti class pada elemen `<header>` utama di baris 55:
     - Sebelum: `<header className="tradegear-header" id="pipstride-header">`
     - Sesudah: `<header className="pipstride-header" id="pipstride-header">`

2. **CSS Selector Updates (`apps/web/src/index.css`)**:
   - Perbarui seluruh deklarasi selector yang mereferensikan `.tradegear-header` (total **5** selektor, terverifikasi):
     - Baris 89: `.tradegear-header` $\rightarrow$ `.pipstride-header`
     - Baris 1341: `@media (max-width: 640px) { .tradegear-header` $\rightarrow$ `.pipstride-header`
     - Baris 1349: `.tradegear-header .status-pill,` $\rightarrow$ `.pipstride-header .status-pill,`
     - Baris 1350: `.tradegear-header .header-connection-badge` $\rightarrow$ `.pipstride-header .header-connection-badge`
     - Baris 1397: `@media (max-width: 400px) { .tradegear-header` $\rightarrow$ `.pipstride-header`
   - **Rename langsung, tanpa alias.** Selector gabungan (`.pipstride-header, .tradegear-header`) **dilarang**:
     gate Fase 011 mensyaratkan *"Markup dan CSS terbebas dari identitas lama `.tradegear-header`"*, jadi alias akan menggagalkan gate.
     Ini aman karena `apps/web` adalah single-bundle: setelah `PipstrideHeader.jsx:55` diubah, tidak ada lagi markup yang memakai class lama.
   - **Verifikasi wajib**: `Get-ChildItem apps\web\src -Recurse -File -Include *.jsx,*.js,*.css | Select-String -Pattern "tradegear"` harus **kosong** (0 hasil).
   - Jangan menyentuh komentar tema di `index.css:14` (*"Semantic tokens aligned with TradeGear dark-emerald theme"*): itu menyebut nama tema desain, bukan selector, dan di luar cakupan tiket ini.

3. **Verifikasi Visual & Responsivitas**:
   - Pastikan header di desktop (logo, navigasi, status pill, avatar) tetap rapi dan tidak geser.
   - Pastikan responsivitas mobile pada viewport `< 640px` dan `< 400px` tetap berjalan sesuai desain (avatar dot badge tampil, status pill sembunyi).

## Files to Touch
- `apps/web/src/components/PipstrideHeader.jsx`
- `apps/web/src/index.css`

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web run build
```
Expected: 0 lint warning, 0 build error.

## Depends on
- Tidak ada (mandiri).

## Unblocks
- Gate Fase 011

## Status
done
