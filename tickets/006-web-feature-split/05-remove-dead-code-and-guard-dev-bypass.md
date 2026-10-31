# Ticket 05: Remove Dead Code + Guard Dev Bypass + Stop Fabricated Market Data

## Goal
Bersihkan kode mati, tutup bypass auth produksi, dan hentikan penyajian data pasar sintetis
sebagai angka nyata.

## Scope
1. **Dead code (audit §4, Dead-1/Dead-2, SRP-10):**
   - Hapus `apps/web/src/components/PositionsTable.jsx` (110, tidak pernah diimport).
   - Hapus `apps/web/src/components/MetricCard.jsx` (43, tidak pernah diimport).
   - Hapus `BucketBars` di `JournalAnalytics.jsx:34-95` (tidak pernah dirender).
2. **Dev auth bypass (SoC-10):** `LoginPage.jsx:156-161` (`handleOfflineDevBypass`) dan demo
   credentials (`:491`) — bungkus dengan `import.meta.env.DEV`. Di build produksi tidak boleh ada
   jalan masuk tanpa kredensial asli. Verifikasi tidak ada `dev-demo-token-offline` di `dist/`.
3. **Data pasar sintetis (SoC-5, SoC-6):** `MarketTab.jsx:123-148` — jangan render high/low/change
   hasil fabrikasi sebagai angka nyata. Pilihan: tampilkan "data belum tersedia" / state kosong
   saat candle non-chart belum dimuat. Perbaiki juga `H1` yang memakai candle `M15` (`:78-80`).
4. Ganti `fetch(` mentah bila ada → tetap lewat `api`/`lib/http` (jaga properti arsitektur terkuat).

## Files to Touch
- `apps/web/src/components/{PositionsTable,MetricCard}.jsx` — delete.
- `apps/web/src/components/{JournalAnalytics,LoginPage,MarketTab}.jsx`
- `apps/web/src/index.css` (hapus style mati bila ada)

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
Select-String -Path apps/web/dist/assets/*.js -Pattern "dev-demo-token-offline"
```
Expected: lint/build exit 0; `Select-String` **tidak** menemukan token bypass di bundle produksi.

## Depends on
- `02-frontend-domain-module.md` (untuk rumus PnL bila MarketTab/HomeTab terdampak)

## Unblocks
- (menyelesaikan gate fase 006)

## Status
todo
