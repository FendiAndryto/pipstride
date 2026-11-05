# Ticket 01: Vitest Harness + Tes Paritas Domain

## Goal
Pasang Vitest di `apps/web` dan kunci paritas `domain/` + `features/journal/dayBuckets` terhadap
backend, sehingga regresi rumus gagal di CI alih-alih lolos ke produksi.

## Scope
1. **Harness** (devDependency saja, tanpa jsdom):
   - `vitest` di `devDependencies`.
   - `vitest.config.js` — environment `node`, `include: ['src/**/*.test.{js,jsx}']`,
     `restoreMocks: true`.
   - Script `"test": "vitest run"` (bukan watch, agar CI tidak menggantung).
2. **Tes** — 4 file, semuanya modul murni:
   - `src/domain/analytics.test.js` — `winRate`, `profitFactor`, `computeTotals`,
     `computeJournalStats`; termasuk paritas fixture 5 trade vs `compute_stats` Python
     (dibekukan sebagai nilai harapan literal, bukan memanggil Python saat tes).
   - `src/domain/pnl.test.js` — `summarizeAccountPnl`, `dailyDrawdownFallback`,
     `deriveDrawdownWatch`: aturan "backend menang", `null`/`undefined` aman, `base <= 0` aman.
   - `src/domain/validation.test.js` — `passwordError` urutan `length → letter → digit`,
     `isValidEmail`, `MIN_PASSWORD_LENGTH`.
   - `src/features/journal/dayBuckets.test.js` — **tes penjaga utama**: paritas
     `win_rate`/`profit_factor`/`net_profit` vs `computeTotals` untuk 4 kasus, dan
     `profit_factor === null` pada bucket breakeven-only.
3. **CI** — `.github/workflows/ci.yml` job `web`: tambah `npm test` setelah `npm run lint`.

## Files to Touch
- `apps/web/package.json`, `apps/web/package-lock.json` (vitest + script)
- `apps/web/vitest.config.js` — new
- `apps/web/src/domain/{analytics,pnl,validation}.test.js` — new
- `apps/web/src/features/journal/dayBuckets.test.js` — new
- `.github/workflows/ci.yml`

## Verification
```powershell
npm --prefix apps/web install
npm --prefix apps/web test          # exit 0, semua tes lulus
npm --prefix apps/web run lint      # 0 warning
npm --prefix apps/web run lint:arch # 0 pelanggaran
npm --prefix apps/web run build     # exit 0
node apps/web/scripts/check-i18n.cjs
```
Expected: semua exit 0.

Uji negatif (wajib, buktikan tesnya benar-benar menangkap regresi):
```powershell
# 1. kembalikan rumus lokal di dayBuckets -> tes harus MERAH
# 2. ubah round2 jadi tanpa pembulatan di domain/analytics -> tes paritas harus MERAH
# 3. pulihkan -> HIJAU
```

Bukan-bagian-bundle:
```powershell
Select-String -Path apps/web/package.json -Pattern '"vitest"' | Should show devDependencies only
Select-String -Path apps/web/dist/assets/*.js -Pattern 'vitest'   # 0 hit
```

## Depends on
- Fase 006 selesai (modul `domain/` + `features/` ada)
- Koreksi pasca-gate `dayBuckets` (commit `65ce042`)

## Unblocks
- `007-admin-console/05-admin-frontend-app.md` (paritas lintas app punya penjaga)

## Status
done

**Catatan implementasi (2026-11-05):**
- `vitest@5.1.0` (peer `vite ^6.4 || ^7 || ^8`; terpasang di atas `vite 8.3.5`). **Tanpa jsdom** —
  semua tes modul murni, `environment: 'node'`. 20 paket tambahan, 0 vulnerability.
- `vitest.config.js`: `include: ['src/**/*.test.{js,jsx}']`, `restoreMocks: true`.
  Script `"test": "vitest run"` (bukan watch, supaya CI tidak menggantung).
- 4 file tes / **54 tes**: `domain/analytics` (14), `domain/pnl` (18),
  `domain/validation` (12), `features/journal/dayBuckets` (12).
- **Deviasi:** 4 file tes, bukan 3 — `pnl` dan `validation` dipisah agar tiap modul punya
  berkas sendiri dan kegagalan menunjuk langsung ke modulnya.
- **Ditemukan saat menulis tes:** `dailyDrawdownFallback(null, null)` dan `deriveDrawdownWatch(null)`
  sudah aman (guard `?? {}` dari commit `0365743`). Tidak ada bug baru; `src/` produksi
  **tidak diubah** sama sekali di tiket ini.
- `format.js` belum punya tes (23 baris, dua formatter presentasional) — sengaja ditunda,
  tidak ada logika domain di dalamnya.
