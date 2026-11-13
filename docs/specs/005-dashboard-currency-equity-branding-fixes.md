# SPEC-005: Dashboard Visual Polish, Dynamic Currency & State Consistency Fixes

## 1. Problem & Context

Berdasarkan peninjauan antarmuka dashboard (`apps/web`), ditemukan inkonsistensi visual dan anomali data yang dapat merusak kredibilitas profesional platform di mata calon pelanggan berbayar menjelang fase Open Billing:

1. **Simbol Mata Uang Tercampur (USC vs $) & Typo Minus Ganda**:
   - Akun Cent (Exness USC) menampilkan saldo dan ekuitas dalam `USC 1,392.80` pada kartu Balance & Equity.
   - Namun, pada kartu *Performance Snapshot* dan *Trading Journal* (Realized Closed P/L, Analytics, Trade Table, dan Kalender Bulanan), format angka berubah menjadi dollar (`+$289.80`, `+$1298.80`). Hal ini membingungkan trader karena profit ratusan sen disalahartikan sebagai ratusan dollar.
   - Terdapat **typo minus ganda** (`−$-1009.00`) di *Performance Snapshot* ([`HomeTab.jsx:260`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/components/HomeTab.jsx#L260)) akibat string template `-$` digabungkan dengan nilai backend `gross_loss` yang sudah bertanda minus.
   - Fungsi global `formatSignedMoney` di [`apps/web/src/domain/format.js`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/domain/format.js) meng-hardcode simbol `$` tanpa menerima parameter mata uang akun.
   - Fungsi `formatCurrency` di [`format.js:5`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/domain/format.js#L5) mengembalikan hardcoded `'$0.00'` ketika nilai null/NaN, sehingga akun non-USD (seperti USC) tetap menghasilkan simbol `$` saat data kosong.

2. **Desinkronisasi Angka Equity Antar-Komponen**:
   - Di kartu *Account Equity* (`HomeTab`), angka menampilkan `USC 1,617.20` (berasal dari live telemetry MT5).
   - Di footer grafik *Account Performance* (`HomeTab`), label `Actual Equity:` menampilkan `USC 1,603.20`.
   - Hal ini terjadi karena footer grafik memprioritaskan snapshot statis `activeCurve?.current_equity` dari panggilan REST API `getEquityCurve()` alih-alih telemetry live `metrics.equity` yang terus diperbarui oleh heartbeat MT5.
   - Selain itu, titik terakhir pada kurva koordinat SVG (`points[points.length - 1]`) masih menggunakan angka snapshot lama, sehingga garis visual grafik berakhir di nilai yang berbeda dari angka ekuitas riil.

3. **Sisa Branding Lama pada CSS/HTML**:
   - Komponen header menggunakan `<header className="tradegear-header" id="pipstride-header">` di [`PipstrideHeader.jsx:55`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/components/PipstrideHeader.jsx#L55).
   - Terdapat tepat 5 selektor CSS di [`apps/web/src/index.css`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/index.css) (baris 89, 1341, 1349, 1350, 1397) yang masih menggunakan class `.tradegear-header`, sisa dari identitas lama sebelum rebranding menjadi Pipstride.

---

## 2. Goals & Success Criteria

- **Goal 1**: Semua metrik moneter di Home Tab dan Journal Tab konsisten menggunakan mata uang akun aktif (`metrics.currency` / `USC`, `USD`, `EUR`, `JPY`, dll.), termasuk penanganan nilai kosong/null/NaN.
- **Goal 2**: Bug minus ganda dieliminasi secara tuntas tanpa parsing string manual.
- **Goal 3**: Angka pada kartu *Account Equity*, teks `Actual Equity:` pada footer grafik performa, dan titik ujung kurva SVG selalu tersinkronisasi 100% dari sumber state telemetry live.
- **Goal 4**: Identitas markup dan CSS header bersih dari penamaan warisan `tradegear-header`, beralih ke `pipstride-header`.
- **Kriteria Sukses**:
  - `apps/web` lulus linting (`npm --prefix apps/web run lint`) dengan 0 warning.
  - Paritas arsitektur & dependensi (`npm --prefix apps/web run lint:arch`) tetap 0 pelanggaran.
  - Test suite unit web (`npm --prefix apps/web test`) lulus 100% dengan file baru `format.test.js` yang memvalidasi dynamic currency, boundary null/NaN, dan non-breaking space (`\u00A0`).
  - Web production build (`npm --prefix apps/web run build`) keluar kode 0.

---

## 3. Detailed Technical Design

### 3.1. Dynamic Currency & Signed Money Formatter (`apps/web/src/domain/format.js`)

1. **Perbaikan `formatCurrency(val, currency = 'USD')`**:
   - Hilangkan hardcoded `'$0.00'` pada guard null/NaN.
   - Format angka `0` dengan currency yang diminta:
     ```javascript
     export const formatCurrency = (val, currency = 'USD') => {
       const safeCurrency = currency || 'USD';
       const num = (val === null || val === undefined || isNaN(val)) ? 0 : Number(val);
       try {
         return new Intl.NumberFormat('en-US', {
           style: 'currency',
           currency: safeCurrency,
           minimumFractionDigits: 2,
           maximumFractionDigits: 2
         }).format(num);
       } catch {
         return `${safeCurrency} ${num.toFixed(2)}`;
       }
     };
     ```
   - Contoh: `formatCurrency(null, 'USC')` $\rightarrow$ `USC\u00A00.00` (bukan `$0.00`).

2. **Perluasan `formatSignedMoney(value, currency = 'USD', fractionDigits = 2)`**:
   - Gunakan `Intl.NumberFormat` dengan `signDisplay: 'always'`:
     ```javascript
     export const formatSignedMoney = (value, currency = 'USD', fractionDigits = 2) => {
       const safeCurrency = currency || 'USD';
       const num = (value === null || value === undefined || isNaN(value)) ? 0 : Number(value);
       try {
         return new Intl.NumberFormat('en-US', {
           style: 'currency',
           currency: safeCurrency,
           signDisplay: 'always',
           minimumFractionDigits: fractionDigits,
           maximumFractionDigits: fractionDigits
         }).format(num);
       } catch {
         const prefix = num >= 0 ? '+' : '-';
         return `${prefix}${safeCurrency} ${Math.abs(num).toFixed(fractionDigits)}`;
       }
     };
     ```
   - Parameter `fractionDigits` (default `2`) dibutuhkan badge kalender di §3.3 (`fractionDigits = 0`) karena lebar selnya ±40px dengan `overflow: hidden`.
   - Perhatikan bahwa `Intl.NumberFormat('en-US', ...)` untuk kode 3 huruf seperti `USC` memisahkan kode dan angka menggunakan **Non-Breaking Space** (`\u00A0`), e.g. `+USC\u00A01,298.80`. Sebaliknya `USD`/`EUR` memakai simbol tanpa spasi (`+$1,298.80`, `€0.00`). Tes unit assertion wajib mencocokkan `\u00A0` hanya untuk kode 3 huruf.

### 3.2. Performance Snapshot di HomeTab (`apps/web/src/components/HomeTab.jsx`)

1. **Tambah Import**:
   - Di `HomeTab.jsx:12`, tambahkan `formatSignedMoney` ke import list:
     ```javascript
     import { formatCurrency, formatSignedMoney, formatRatio } from '../domain/format';
     ```

2. **Perbaiki Baris 259–262**:
   - Ganti pemformatan string manual:
     ```javascript
     <div className="tiny">
       {activeHistory && activeHistory.total_trades > 0
         ? `${t('home_gross')} ${formatSignedMoney(activeHistory.gross_profit ?? 0, currency)} / ${
             (activeHistory.gross_loss ?? 0) > 0
               ? `-${formatCurrency(activeHistory.gross_loss, currency)}`
               : formatSignedMoney(0, currency)
           }`
         : t('home_gross_ratio')}
     </div>
     ```
   - Karena `gross_loss` dari backend sudah negatif (misal `-1009.00`), `formatCurrency` sudah menuliskan tanda minusnya sendiri. Jangan menambahkan `-` literal di depan `Math.abs(...)`: pola `-${formatCurrency(Math.abs(x))}` menghasilkan **minus ganda yang sama** yang mau dihilangkan tiket ini (`--USC 1,009.00`).
   - Cabang `> 0` memastikan hari tanpa loss membaca `+USC\u00A00.00`, bukan `-USC\u00A00.00`.

### 3.3. Propagasi Currency ke Seluruh Komponen Journal (`apps/web/src/features/journal/`)

1. **`JournalTab.jsx`**:
   - Ambil `currency = bridgeStatus?.metrics?.currency || 'USD'`.
   - Teruskan `currency` ke:
     - `<KpiCards ... currency={currency} />`
     - `<JournalAnalytics ... currency={currency} />`
     - `<TradeTable ... currency={currency} />`
     - `<MonthCalendar ... currency={currency} />`
2. **`KpiCards.jsx`**:
   - Terima `currency = 'USD'`.
   - Gunakan `formatSignedMoney(netPnl, currency)` pada tile Realized Closed P/L.
3. **`JournalAnalytics.jsx`**:
   - Terima `currency = 'USD'`.
   - Teruskan `currency` ke semua pemanggilan `formatSignedMoney(val, currency)` (Expectancy, Avg Win, Avg Loss, Best Trade, Worst Trade, summary footer).
   - Teruskan juga ke komponen lokal `BucketBars` (`currency` sebagai prop baru), karena badge batang per-simbol/jam/hari memakai formatter yang sama.
4. **`TradeTable.jsx`**:
   - Terima `currency = 'USD'`, tambahkan `import { formatSignedMoney } from '../../domain/format';` (file ini belum punya import tersebut).
   - Ganti hardcoded `$` di baris 79 dengan:
     ```javascript
     {formatSignedMoney(trade.profit, currency)}
     ```
5. **`MonthCalendar.jsx`**:
   - Terima `currency = 'USD'`, tambahkan `import { formatSignedMoney } from '../../domain/format';`.
   - Badge harian (baris 70) **wajib compact** `formatSignedMoney(dayPnl, currency, 0)` (`+USC\u00A025`); sel kalender sempit dan `overflow: hidden`, format 2 desimal akan ter-clip.
   - Tooltip (baris 82) memakai `formatSignedMoney(dailyPnlMap[selectedDate], currency)` presisi penuh.
   - `formatCurrency` tidak dipakai di sini karena nominal P/L harian bisa negatif dan `formatCurrency` tidak memasang `+` untuk nilai positif.

### 3.4. Sinkronisasi Equity Live State & Titik Ujung Kurva (`apps/web/src/components/HomeTab.jsx`)

1. **Prioritas Live State**:
   - Di `HomeTab.jsx` baris 47: `const equity = metrics.equity ?? 0;`.
   - Tambahkan `const liveEquity = metrics.equity ?? null;` **di luar** `useMemo`, lalu di dalam `useMemo` pembuatan `performanceChart`:
     ```javascript
     // Bersihkan guard: prioritaskan live telemetry saat terhubung
     const currentVal = (isConnected && liveEquity !== null)
       ? liveEquity
       : (activeCurve?.current_equity ?? startVal);
     ```
   - Tambahkan `liveEquity` dan `isConnected` ke array dependency `useMemo` (baris 183). `metrics` sendiri tidak ada di dependency list; membaca `metrics.equity` langsung di dalam memo menghasilkan nilai yang benar hari ini tetapi menyembunyikan dependency dari tooling (`oxlint` di repo ini tidak mengaktifkan `exhaustive-deps`).

2. **Sinkronisasi Titik Akhir Kurva SVG (`points`)**:
   - Saat `activeCurve.points` ada (`points.length > 0`) dan akun terhubung (`isConnected && liveEquity !== null`):
     ```javascript
     let points = activeCurve?.points ? [...activeCurve.points] : [];
     if (points.length > 0 && isConnected && liveEquity !== null) {
       points[points.length - 1] = {
         ...points[points.length - 1],
         equity: currentVal,
         balance
       };
     }
     ```
   - `balance` di `HomeTab` sudah numerik (`metrics.balance ?? 0`), jadi `balance || points[...].balance` akan menimpa titik dengan `0` setiap kali saldo benar-benar nol. Pakai `balance` langsung.
   - Ini menjamin garis SVG kurva berakhir tepat pada koordinat Y dari `currentVal`, selaras dengan kartu KPI dan teks `Actual Equity:` di footer.

### 3.5. Rebranding Header (`PipstrideHeader.jsx` & `index.css`)

- Ubah `<header className="tradegear-header" id="pipstride-header">` menjadi `<header className="pipstride-header" id="pipstride-header">`.
- Di `apps/web/src/index.css`:
  - Ubah kelima selektor `.tradegear-header` (baris 89, 1341, 1349, 1350, 1397) menjadi `.pipstride-header`, **tanpa alias gabungan**, agar gate "terbebas dari identitas lama" terpenuhi.

---

## 4. Pengecualian Sah (Out of Scope / Non-Bugs)

Simbol `$` pada komponen berikut adalah **harga kuotasi pasar instrumen komoditas/kripto internasional** (Gold XAU/USD, Bitcoin BTC/USD), **bukan** saldo akun atau PnL pengguna:
- [`apps/web/src/components/MarketTab.jsx:203`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/components/MarketTab.jsx#L203): `{item.symbol.includes('XAU') || item.symbol.includes('BTC') ? `$${formattedPrice}` : formattedPrice}`
- [`apps/web/src/components/MarketTab.jsx:234`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/components/MarketTab.jsx#L234): `${activeQuote.symbol.includes('XAU') || activeQuote.symbol.includes('BTC') ? '$' : ''}...`
- [`apps/web/src/components/HomeTab.jsx:536`](file:///c:/Users/pendi/Repository/pipstride/apps/web/src/components/HomeTab.jsx#L536): `isCrypto || isGold ? `$${q.bid.toFixed(q.digits)}` : q.bid.toFixed(q.digits)`

Kode-kode ini **dilarang diubah** karena 1 troy ounce emas dan Bitcoin memang diperdagangkan dan dikuotasikan dalam denominasi US Dollar di pasar global terlepas dari mata uang akun trader.

---

## 5. Scope & Ticket Breakdown

Fase 011 terdiri dari 4 tiket:
1. **Ticket 01**: `01-currency-formatting-and-double-minus-fix.md` — Dynamic `formatSignedMoney` & `formatCurrency` di `domain/format.js`, import & fix minus ganda di `HomeTab.jsx`, dan unit test di `domain/format.test.js`.
2. **Ticket 02**: `02-journal-currency-propagation.md` — Meneruskan prop `currency` ke seluruh ekosistem Trading Journal (`JournalTab`, `KpiCards`, `JournalAnalytics`, `TradeTable`, `MonthCalendar`).
3. **Ticket 03**: `03-home-equity-live-state-synchronization.md` — Sinkronisasi state `equity` live telemetry dengan footer `Actual Equity:` dan override titik ujung kurva di `HomeTab.jsx`.
4. **Ticket 04**: `04-header-branding-cleanup.md` — Refactor penamaan class `.tradegear-header` menjadi `.pipstride-header` di `PipstrideHeader.jsx` dan `index.css`.

---

## 6. Verification Commands

```powershell
# 1. Unit tests domain format & analytics
npm --prefix apps/web test

# 2. Linter & boundaries
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch

# 3. i18n key parity
node apps/web/scripts/check-i18n.cjs

# 4. Production web build
npm --prefix apps/web run build
```
