# Ticket 13-03: Cash Flow Journal UI & Frontend Domain Parity

**Status:** done (2026-11-14)
**Prasyarat:** 13-02  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/007-mql5-service-cashflow-and-dynamic-market.md`](../../docs/specs/007-mql5-service-cashflow-and-dynamic-market.md) §D4, §3.3

---

## Goal
Menampilkan deposit & penarikan sebagai baris jurnal netral (bukan kerugian trading), menyajikan ringkasan kas terpisah dari PnL trading, dan memastikan seluruh turunan di frontend (`domain/`, `features/journal/`, `HomeTab`) tidak pernah mencampur cash flow ke metrik trading.

---

## Konteks & Problem (terverifikasi 2026-11-14)

1. Belum ada badge `LOSS` di tabel. `TradeTable.jsx:65` menampilkan `trade.type` (BUY/SELL), dan hanya sel profit yang diwarnai merah/hijau (`:78`). Jadi scope bukan "hapus badge merah", tapi "tambahkan badge kategori + netralkan warna + kosongkan kolom yang tidak relevan".
2. Permukaan kontaminasi frontend lebih luas dari `analytics.js`/`pnl.js`:
   - `features/journal/useJournalData.js`: `symbolFallbackPnl` (154-157), `dailyPnlMap` (159-170), `monthTrades`/`monthStats` (172-186), fallback `totalTrades`/`winningTrades`/`losingTrades` (196-201).
   - `features/journal/dayBuckets.js` (+ `dayBuckets.test.js`).
   - `components/HomeTab.jsx` → `summarizeAccountPnl`, `drawdownView` dari `domain/pnl.js`; `features/journal/DrawdownCard.jsx`.
3. Angka statistik utama datang dari backend (`api.getJournalStats`), sedangkan mode `MONTH` dihitung lokal via `computeJournalStats(monthTrades)`. Keduanya harus konsisten.
4. Setelah 13-02, `GET /bridge/history` mengirim dua stream: `trades[]` dan `cash_flow[]`; `GET /journal/stats` mengirim `cash_flow: {deposits, withdrawals, net_funding}`. Frontend tidak boleh menurunkan cash flow dari array trades lagi.

---

## Scope

### 1. Domain frontend (`apps/web/src/domain/`)
- `analytics.js`:
  - `computeJournalStats(trades)` tetap **trade-only**; tambahkan komentar kontrak bahwa input tidak boleh memuat baris kas.
  - Fungsi baru:
    ```javascript
    export function calculateCashFlow(items) {
      let deposits = 0;
      let withdrawals = 0;
      (items || []).forEach((item) => {
        const amount = Number(item.profit ?? item.amount ?? 0);
        if (item.category === 'DEPOSIT') deposits += Math.abs(amount);
        else if (item.category === 'WITHDRAWAL') withdrawals += Math.abs(amount);
      });
      return { deposits, withdrawals, netFunding: deposits - withdrawals };
    }
    ```
- `pnl.js`: `summarizeAccountPnl`/`drawdownView` tetap trade-only; jangan menambahkan cash flow ke drawdown (risiko trading tidak boleh terlihat lebih kecil karena penarikan). Beri komentar eksplisit.
- Tes: `analytics.test.js` (kas: deposit, penarikan, campuran, kosong; `computeJournalStats` identik saat hanya trade dikirim), `pnl.test.js` (drawdown tidak berubah oleh cash flow), `dayBuckets.test.js`.

### 2. Data hook (`apps/web/src/features/journal/useJournalData.js`)
- Simpan `cashFlow` terpisah: `const cashFlow = historyData?.cash_flow || []`.
- `trades` **hanya** dari `historyData.trades`. `symbolFallbackPnl`, `dailyPnlMap`, `monthTrades`, `monthStats`, `dayBuckets`, `tradedSymbols` semuanya trade-only (tidak ada perubahan rumus, hanya pastikan tidak ada baris kas yang masuk).
- Baris tabel gabungan hanya untuk render:
  ```javascript
  const journalRows = useMemo(() => {
    const cashRows = (filter === 'All' ? cashFlow : []).map((item) => ({
      ...item, kind: 'CASH', close_time: item.time, symbol: '', volume: 0, close_price: 0, magic: 0,
    }));
    return [...trades.map((t) => ({ ...t, kind: 'TRADE' })), ...cashRows]
      .sort((a, b) => (b.close_time || 0) - (a.close_time || 0));
  }, [trades, cashFlow, filter]);
  ```
  Filter `EA`/`Manual` tidak menampilkan baris kas; `All` menampilkan keduanya. Pencarian mencocokkan `ticket` dan `category`.
- Pagination dihitung dari `filteredRows` (gabungan), bukan `filteredTrades`.
- Kembalikan `cashFlow` + aggregate dari `activeStats.cash_flow` agar `KpiCards` tidak menghitung ulang.
- `useJournalData` juga dipakai `JournalTab.jsx`; sesuaikan prop yang diteruskan.

### 3. Tabel jurnal (`apps/web/src/features/journal/TradeTable.jsx`)
- Baris `kind === 'CASH'`:
  - Kolom simbol/tipe → badge netral: `WITHDRAWAL` (slate/indigo) dan `DEPOSIT` (teal/cyan). Jangan pakai kelas `red`/`var(--red)`.
  - Kolom lot, exit price → `-`.
  - Source → `Cash` (bukan `Manual`).
  - Profit → nominal dengan warna netral (`var(--muted)` / `#c9d8dc`), bukan hijau/merah.
  - `digits` tidak boleh dihitung dari `trade.symbol.includes(...)` untuk baris kas (`symbol` kosong).
- Baris trade tetap seperti sekarang.
- `colSpan` empty-state tidak berubah.

### 4. Kartu ringkasan (`apps/web/src/features/journal/KpiCards.jsx`, `JournalAnalytics.jsx`)
- Tambah kartu: **Net Trading PnL** (sudah ada, pastikan label jelas), **Total Deposit**, **Total Withdrawal**, opsional **Net Funding**.
- Sumber angka: `activeStats.cash_flow` (backend) — bukan penjumlahan ulang dari `journalRows`.
- Jangan mengubah styling/komponen yang sudah ada di luar penambahan kartu (ikuti token CSS yang berlaku; `apps/web` tanpa Tailwind).

### 5. Paritas backend & i18n
- `apps/web/src/constants/translations.js` (EN + ID), minimal:
  - `journal_badge_deposit`, `journal_badge_withdrawal`
  - `journal_stat_total_deposits`, `journal_stat_total_withdrawals`
  - `journal_source_cash`
  - `journal_stat_net_funding` (bila kartu net funding dipakai)
- `node apps/web/scripts/check-i18n.cjs` wajib 0 missing key **dan** tidak menambah key yatim (script melaporkan key statis yang tidak ter-resolve — pastikan setiap key baru benar-benar dipakai).

---

## Files to Touch
- `apps/web/src/domain/analytics.js`
- `apps/web/src/domain/analytics.test.js`
- `apps/web/src/domain/pnl.js`
- `apps/web/src/domain/pnl.test.js`
- `apps/web/src/features/journal/useJournalData.js`
- `apps/web/src/features/journal/dayBuckets.js`
- `apps/web/src/features/journal/dayBuckets.test.js`
- `apps/web/src/features/journal/TradeTable.jsx`
- `apps/web/src/features/journal/KpiCards.jsx`
- `apps/web/src/features/journal/JournalTab.jsx` (prop wiring)
- `apps/web/src/components/JournalAnalytics.jsx` (bila kartu diletakkan di sana)
- `apps/web/src/constants/translations.js`

---

## Verification
```powershell
npm --prefix apps/web test
node apps/web/scripts/check-i18n.cjs
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web run build
```

**Kriteria lulus:**
- Fixture 10 trade (9 win) + 3 penarikan + 1 deposit:
  - `computeJournalStats(trades)` → `trades: 10`, `winRate: 90`, `netProfit` = murni trading.
  - `calculateCashFlow(cashFlow)` → deposits/withdrawals/netFunding benar.
  - Tabel menampilkan 14 baris (10 trade + 4 kas) saat filter `All`.
- Drawdown dari `pnl.js` tidak berubah ketika ada penarikan.
- Baris kas tidak tampil saat filter `EA` atau `Manual`.
- `vitest run` exit 0; `lint:arch` 0 pelanggaran; build sukses.

---

## Log Verifikasi (2026-11-14)

**Otomatis — hijau:**
- `npm --prefix apps/web test` → **7 file, 99 tes** (baseline 88 + 11 baru: 3 `calculateCashFlow`, 7 `joinJournalRows`, 1 guard drawdown).
- `node apps/web/scripts/check-i18n.cjs` → `i18n OK — 500 keys per language, 440 static keys resolved` (494 → 500; keenam key baru benar-benar dipakai di `TradeTable.jsx`/`KpiCards.jsx`).
- `npm --prefix apps/web run lint` → `oxlint` 0 error, 0 warning.
- `npm --prefix apps/web run lint:arch` → `no dependency violations found (61 modules, 174 dependencies)`.
- `npm --prefix apps/web run build` → 1980 modul, sukses; `.tag.deposit/.withdrawal/.neutral` ada di CSS bundle dan `.ex5` tetap tersalin ke `dist/`.

**Cakupan terhadap kriteria:**
- `computeJournalStats(trades)` pada fixture → `trades: 10`, `wins: 9`, `losses: 1`, `net_profit: 65` (murni trading).
- `calculateCashFlow(cashFlow)` → `{ deposits: 1000, withdrawals: 500, netFunding: 500 }`.
- `joinJournalRows` pada filter `All` + `ALL` → **14 baris**; filter `EA` → 6, `Manual` → 4, `XAUUSD` → 5 (baris kas tidak pernah ikut).
- `drawdownView` menghasilkan objek identik meski `riskStatus` diberi field `cash_flow`/`total_withdrawals` (drawdown trade-only).

**Deviasi dari teks tiket:**
1. **Gabungan baris diekstrak ke modul murni baru `features/journal/journalRows.js`** (`joinJournalRows`, `cashRowOf`, `inMonth`). Hook React tidak bisa diuji di Vitest (`environment: 'node'`, tanpa jsdom), sementara tiket menuntut bukti "14 baris". Ekstraksi ini satu-satunya cara memverifikasi kontrak tanpa menambah jsdom.
2. **Kartu kas diletakkan sebagai grid kedua di `KpiCards.jsx`**, bukan di `JournalAnalytics.jsx`: `JournalAnalytics` merender statistik trading dari `activeStats`, dan menaruh angka funding di sana akan mencampur dua domain secara visual.
3. **`Total Withdrawal` memakai `formatCurrency` (tanpa tanda) + warna `--muted`; hanya `Net Funding` yang bertanda.** Nominal penarikan yang tampil "-$300" akan terbaca sebagai kerugian trading, persis yang ingin dihindari tiket.
4. **Tidak ada tes baru di `dayBuckets.test.js`.** `buildDayBuckets` tidak pernah menerima baris kas (dijaga oleh `joinJournalRows`), jadi tes tambahan di sana hanya akan menguji fixture buatan.
5. **`filteredTrades` tetap trade-only** dan dipakai CSV export; `filteredRows`/`paginatedRows` hanya untuk tabel. Ini mempertahankan perilaku export yang sudah ada.
