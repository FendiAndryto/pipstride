# Ticket 04: Split `JournalTab.jsx` (814 → `features/journal/*`)

## Goal
Pecah file 814 baris menjadi fitur terpisah (SRP-2, CRITICAL).

## Scope
1. Buat `apps/web/src/features/journal/`:
   - `JournalTab.jsx` menjadi komposisi tipis (< ~120 baris).
   - `useJournalData.js` — gabungkan 5 fetch effect (`:79-194`) menjadi satu hook dengan
     polling tunggal + visibility/in-flight guard (pola dari spec 002).
   - `TradeTable.jsx` (tabel trade, `:433`).
   - `CsvExport.js` → pindah ke `lib/` (IO export, bukan domain).
   - `MonthCalendar.jsx` (`:750-811`) + `useMonthStepper.js` (`:202-252`).
   - `KpiCards.jsx` (kartu KPI) — angka dari `domain/analytics` / `api.getJournalStats`.
2. Hapus `monthStats` `useMemo` (`:282-400`) — digantikan `domain/analytics`/backend (tiket 02).
3. Pindahkan filter/search state ke `useJournalData`.
4. String hard-code Indonesia → `translations.js` untuk bagian yang disentuh (SoC-11).

## Files to Touch
- `apps/web/src/features/journal/*` — new.
- `apps/web/src/components/JournalTab.jsx`
- `apps/web/src/components/JournalAnalytics.jsx` (hapus `BucketBars` dead, SRP-10)
- `apps/web/src/constants/translations.js`

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
node apps/web/scripts/check-i18n.cjs
```
Expected: exit 0; `i18n OK`; tidak ada file > ~300 baris di `features/journal/`.

## Depends on
- `02-frontend-domain-module.md`

## Unblocks
- (menyelesaikan gate fase 006)

## Status
todo
