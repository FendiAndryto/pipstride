# Ticket 01: Currency Formatting & Double-Minus Fix

## Goal
Memperbarui fungsi formatter moneter murni di `apps/web/src/domain/format.js` agar mendukung mata uang dinamis (`currency`) pada nilai bertanda (`formatSignedMoney`) serta menangani guard `null`/`NaN` pada `formatCurrency` tanpa hardcoded `$`, menambahkan import `formatSignedMoney` dan mengeliminasi bug visual minus ganda pada ringkasan Gross Profit / Gross Loss di `HomeTab.jsx`, serta menambahkan unit test komprehensif di `apps/web/src/domain/format.test.js` (dengan penanganan NBSP `\u00A0`).

## Scope

1. **Pure Formatter Extension (`apps/web/src/domain/format.js`)**:
   - Perbarui `formatCurrency(val, currency = 'USD')`:
     - Hilangkan `return '$0.00'` statis pada guard null/undefined/NaN.
     - Ubah agar memformat angka `0` dengan currency yang diminta (misal: `formatCurrency(null, 'USC')` menghasilkan `USC\u00A00.00`).
   - Perbarui `formatSignedMoney(value, currency = 'USD', fractionDigits = 2)`:
     - Menghilangkan hardcoded `$`.
     - Menggunakan `Intl.NumberFormat` dengan `style: 'currency'`, `currency: safeCurrency`, dan `signDisplay: 'always'`.
     - Sediakan fallback `try...catch` jika kode currency tidak standar agar tidak pernah crash di runtime.
     - Tangani `null`, `undefined`, dan `NaN` dengan aman mengembalikan `formatSignedMoney(0, currency, fractionDigits)` (misal `+USC\u00A00.00` atau `+$0.00`).
     - Parameter ketiga `fractionDigits` (default `2`) mengisi `minimumFractionDigits` **dan** `maximumFractionDigits`.
       Dipakai tiket 02 untuk badge kalender (`fractionDigits = 0`, misal `+USC\u00A025`) yang lebar selnya hanya ±40px;
       tooltip tetap `2`. Tanpa ini badge `+USC\u00A01,298.80` (13 karakter) akan ter-clip oleh `overflow: hidden`.

2. **Perbaikan Import, Double-Minus & Hardcoded `$` di `HomeTab.jsx`**:
   - Di `apps/web/src/components/HomeTab.jsx:12`:
     - Tambahkan `formatSignedMoney` pada import:
       ```javascript
       import { formatCurrency, formatSignedMoney, formatRatio } from '../domain/format';
       ```
   - Di `apps/web/src/components/HomeTab.jsx` baris 259–262:
     - Ganti:
       ```javascript
       `${t('home_gross')} +$${activeHistory.gross_profit?.toFixed(2) ?? '0.00'} / -$${activeHistory.gross_loss?.toFixed(2) ?? '0.00'}`
       ```
     - Menjadi (perhatikan guard nol: jangan sampai tampil `-$0.00`):
       ```javascript
       `${t('home_gross')} ${formatSignedMoney(activeHistory.gross_profit ?? 0, currency)} / ${
         (activeHistory.gross_loss ?? 0) > 0
           ? `-${formatCurrency(activeHistory.gross_loss, currency)}`
           : formatSignedMoney(0, currency)
       }`
       ```
     - Karena backend mengembalikan `gross_loss` bertanda minus (misal `-1009.00`), cabang negatif sengaja **tidak** memakai `Math.abs(...)`:
       `formatCurrency(-1009.00, 'USC')` sudah menghasilkan `-USC\u00A01,009.00` dengan sendirinya, jadi menambahkan `-` literal akan menciptakan minus ganda yang justru mau dihilangkan tiket ini.
     - Cabang `> 0` dipertahankan agar hari tanpa loss membaca `+USC\u00A00.00` (netral), bukan `-USC\u00A00.00`.

3. **Unit Tests (`apps/web/src/domain/format.test.js`)**:
   - Buat file test baru `format.test.js` (dijalankan via Vitest di `apps/web`):
     - Uji `formatCurrency(val, currency)`: USD, USC, EUR, dan boundary null/undefined/NaN (harus menghasilkan simbol currency yang tepat, bukan `$0.00` untuk USC).
     - Uji `formatSignedMoney(val, currency, fractionDigits)`:
       - Positif: `1298.80` pada USD (`+$1,298.80`) dan USC (`+USC\u00A01,298.80`).
       - Negatif: `-1009.00` pada USD (`-$1,009.00`) dan USC (`-USC\u00A01,009.00`).
       - Nol: `0` (`+$0.00` / `+USC\u00A00.00`).
       - Nilai falsy / NaN: `null`, `undefined`, `NaN`.
       - `fractionDigits = 0`: `25` pada USC (`+USC\u00A025`) dan `-12` pada USD (`-$12`).
     - *Catatan Tes*: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USC' })` memakai non-breaking space (`\u00A0`) karena `USC` adalah kode 3 huruf tanpa simbol. Assertion test wajib mencocokkan `\u00A0` atau memakai regex whitespace. Sebaliknya `USD` (`+$1,298.80`) dan `EUR` (`€0.00`) **tidak** memakai spasi sama sekali — jangan menulis assertion USD dengan `\u00A0`.
     - Uji `formatRatio` dan `formatDateTime`.

## Files to Touch
- `apps/web/src/domain/format.js`
- `apps/web/src/components/HomeTab.jsx`
- `apps/web/src/domain/format.test.js` (file baru)

## Verification
```powershell
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
```
Expected: Test `format.test.js` lulus 100%, total test suite bertambah, linting 0 warning dan 0 arsitektur violation.

## Depends on
- Tidak ada (tiket mandiri pertama).

## Unblocks
- `02-journal-currency-propagation.md`

## Status
done
