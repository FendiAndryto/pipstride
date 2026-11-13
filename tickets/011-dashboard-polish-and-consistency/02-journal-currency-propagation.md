# Ticket 02: Journal Currency Propagation

## Goal
Meneruskan simbol mata uang akun aktif (`metrics.currency`, misal `USC`) dari `JournalTab` ke seluruh sub-komponen layar jurnal (`KpiCards`, `JournalAnalytics`, `TradeTable`, dan `MonthCalendar`) sehingga semua nominal metrik, P/L tertutup, tabel transaksi, dan kalender mencerminkan satuan mata uang akun alih-alih simbol dollar (`$`) yang di-hardcode.

## Scope

1. **`JournalTab.jsx`**:
   - Ekstrak `currency` dari `bridgeStatus`:
     ```javascript
     const currency = bridgeStatus?.metrics?.currency || 'USD';
     ```
   - Teruskan prop `currency` ke:
     - `<KpiCards ... currency={currency} />`
     - `<JournalAnalytics ... currency={currency} />`
     - `<TradeTable ... currency={currency} />`
     - `<MonthCalendar ... currency={currency} />`

2. **`KpiCards.jsx` (`apps/web/src/features/journal/KpiCards.jsx`)**:
   - Terima prop `currency = 'USD'`.
   - Gunakan `formatSignedMoney(netPnl, currency)` pada tile Realized Closed P/L.

3. **`JournalAnalytics.jsx` (`apps/web/src/components/JournalAnalytics.jsx`)**:
   - Terima prop `currency = 'USD'` pada `export default function JournalAnalytics({ stats, loading, periodLabel, selectedSymbol = 'ALL', onSelectSymbol = null, currency = 'USD' })`.
   - Perbarui seluruh pemanggilan `formatSignedMoney(val)` menjadi `formatSignedMoney(val, currency)` pada:
     - Tile Expectancy, Avg Win, Avg Loss, Best Trade, Worst Trade (baris 127, 134, 141, 167, 173).
     - Ringkasan footer net profit (baris 299).
   - **`BucketBars` adalah fungsi lokal di file yang sama** (baris 28) dan saat ini tidak menerima `currency`. Tambahkan parameter dan teruskan dari pemanggilnya (baris 289), jika tidak badge batang performa (baris 78, 227, 272) akan tetap memakai default `USD`:
     ```javascript
     function BucketBars({ title, subtitle, buckets, icon: Icon, currency = 'USD' }) {
     // ...
     <BucketBars ... currency={currency} />
     ```

4. **`TradeTable.jsx` (`apps/web/src/features/journal/TradeTable.jsx`)**:
   - Terima prop `currency = 'USD'`.
   - Tambahkan import di bagian atas file (saat ini file ini **belum** mengimpor apa pun dari `domain/format`):
     ```javascript
     import { formatSignedMoney } from '../../domain/format';
     ```
   - Perbarui kolom Profit (baris 79) dari:
     ```javascript
     {trade.profit >= 0 ? '+' : '-'}${Math.abs(trade.profit).toFixed(2)}
     ```
     Menjadi (satu-satunya bentuk yang diterima, tanpa alternatif):
     ```javascript
     {formatSignedMoney(trade.profit, currency)}
     ```
   - Catatan: sumber aslinya memakai karakter minus ASCII `'-'`, bukan `'−'` (U+2212). Jangan menyalin varian U+2212 dari draf lama.
   - `formatSignedMoney` sudah menangani tanda negatif dan `null`/`NaN` sendiri, jadi tidak perlu `Math.abs(...)` maupun ternary tanda.

5. **`MonthCalendar.jsx` (`apps/web/src/features/journal/MonthCalendar.jsx`)**:
   - Terima prop `currency = 'USD'`.
   - Tambahkan import di bagian atas file (saat ini file ini **belum** mengimpor apa pun dari `domain/format`):
     ```javascript
     import { formatSignedMoney } from '../../domain/format';
     ```
   - **Badge P/L tanggal (baris 70) — wajib compact, `fractionDigits = 0`:**
     ```javascript
     {hasTrades ? formatSignedMoney(dayPnl, currency, 0) : '·'}
     ```
     Alasan: sel kalender memakai `gridTemplateColumns: 'repeat(7, minmax(0, 1fr))'`, `fontSize: 9.5px`, dan `overflow: hidden`.
     Format 2 desimal (`+USC\u00A01,298.80`, 13 karakter) akan ter-clip. `+USC\u00A025` (±7 karakter) aman.
   - **Tooltip tanggal terpilih (baris 82) — presisi penuh, `fractionDigits = 2`:**
     ```javascript
     pnl: dailyPnlMap[selectedDate] !== undefined
       ? formatSignedMoney(dailyPnlMap[selectedDate], currency)
       : t('journal_no_closed_trade')
     ```
     Tooltip berada di baris teks penuh di bawah grid, jadi lebar tidak masalah dan justru butuh presisi.
   - Jangan memakai `formatCurrency` di sini: nominal P/L harian bisa negatif dan `formatCurrency` tidak memasang tanda `+` untuk nilai positif.

## Files to Touch
- `apps/web/src/features/journal/JournalTab.jsx`
- `apps/web/src/features/journal/KpiCards.jsx`
- `apps/web/src/components/JournalAnalytics.jsx`
- `apps/web/src/features/journal/TradeTable.jsx`
- `apps/web/src/features/journal/MonthCalendar.jsx`

## Verification
```powershell
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web run build
```
Expected: Seluruh test pass, 0 warning linter, 0 pelanggaran arsitektur, build sukses.

## Depends on
- `01-currency-formatting-and-double-minus-fix.md`

## Unblocks
- Gate Fase 011

## Status
done
