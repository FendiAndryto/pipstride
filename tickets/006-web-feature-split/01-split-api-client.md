# Ticket 01: Split `services/api.js` → `lib/http` + `lib/storage`

## Goal
Pisahkan transport HTTP, persistensi token, dan state domain — sekarang bercampur di satu file 421 baris
dengan 6 tanggung jawab (SRP-6, SoC-1, SoC-9).

## Scope
1. Buat `apps/web/src/lib/http.js`:
   - `authFetch` (dengan 401 → `pipstride:session-expired`), **tambah** `AbortController` + timeout.
   - Tidak ada `localStorage`/`sessionStorage`/`import.meta.env` di sini; terima config dari luar.
2. Buat `apps/web/src/lib/storage.js`:
   - Token get/set/clear (`localStorage` vs `sessionStorage` sesuai `rememberMe`).
   - Active connection id get/set (dipindah dari `api.js:37-47`).
3. Buat `apps/web/src/lib/download.js`:
   - `downloadPreset`/blob download (pindah dari `api.js:54-66`, DOM concern keluar dari transport).
4. `apps/web/src/services/api.js` menjadi kumpulan endpoint tipis yang memakai `lib/http`.
   Target < ~150 baris.
5. Update semua pemanggil (`components/*`, `App.jsx`) bila signature berubah.

## Files to Touch
- `apps/web/src/lib/{http,storage,download}.js` — new.
- `apps/web/src/services/api.js`
- Pemanggil yang terdampak (`Dashboard.jsx`, `LoginPage.jsx`, `ProfileTab.jsx`, `App.jsx`).

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
```
Expected: exit 0, 0 oxlint warning; `Select-String -Path apps/web/src/services/api.js -Pattern "localStorage"` → 0 hit.

## Depends on
- Fase 003 `02-ts-boundaries-and-api-drift.md` (rule boundary aktif)

## Unblocks
- `02-frontend-domain-module.md`
- Fase 007 (admin memakai `lib/http` yang sama)

## Status
todo
