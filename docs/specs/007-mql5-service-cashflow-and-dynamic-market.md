# SPEC-007: MQL5 Background Service (.ex5), Cash Flow Isolation (Withdrawal / Deposit), and Dynamic Market Multi-Timeframe

**Status:** approved (2026-11-14)  
**Prioritas:** High (Integritas Sensor, Akurasi Jurnal Keuangan, & UX Market Tab)  
**Referensi:** ADR 0004 (Strictly Read-Only), ADR 0009 (Layered Architecture), SPEC-003 (Market Structure 4 TF)

---

## 1. Problem Statement

Tiga kelemahan struktural teridentifikasi pada pipeline telemetri MT5 dan kalkulasi jurnal Pipstride saat ini:

### P1 — Sensor MT5 Rentan Modifikasi dan Terikat pada Chart Window
1. **Source Code Terbuka:** File konektor saat ini didistribusikan dalam bentuk kode sumber teks (`PipstrideMonitor.mq5`). Pengguna dapat membaca, mengubah logika pengiriman data, atau memanipulasi payload telemetri.
2. **Keterikatan Chart (Chart-Bound EA):** Sebagai Expert Advisor (EA), sensor harus ditempelkan (*attach*) pada salah satu grafik simbol (misal `EURUSD`). Jika pengguna secara tidak sengaja menutup chart, mengganti template (*template apply*), atau berpindah profil (*profile switch*), EA berhenti berjalan seketika dan status telemetri menjadi *Offline*.
3. **Form Input Terlalu Rumit:** Dialog input saat attach menampilkan banyak variabel teknis (`InpBackendUrl`, `InpHeartbeatInterval`, `InpRequestTimeoutMs`, `InpMonitoredSymbols`, dll.) yang membingungkan pengguna dan rawan salah konfigurasi.

### P2 — Penarikan Dana (Withdrawal) Terbaca Sebagai Trade Kalah (*Loss*)
1. **Akar Masalah Data MT5:** Di MetaTrader 5, penarikan dana dicatat dalam riwayat deal dengan tipe `DEAL_TYPE_BALANCE` (tipe 2) dengan nilai profit negatif (`profit < 0`).
2. **Distorsi Metrik Trading:** Karena sistem menganggap semua deal dengan `profit < 0` sebagai posisi trading yang kalah:
   - **Win Rate Anjlok:** Transaksi penarikan dana menambah hitungan `total_trades` dan `losing_trades`. Menang 9 dari 10 trade lalu withdraw 3 kali membuat win rate jatuh dari 90% menjadi 69% (9/13).
   - **PnL Trading Semu:** Penarikan $500 setelah trading profit $200 membuat PnL harian dilaporkan minus -$300 (merah), padahal hasil trading hari itu hijau.
   - **Profit Factor & Average Loss Rusak:** Angka penarikan dana masuk ke penyebut kalkulasi rasio risiko-keuntungan.
   - **Grafik Pertumbuhan Anjlok:** Kurva performa trading tampak seperti mengalami kerugian drastis (*drawdown/margin call* palsu) saat pengguna menarik keuntungan mereka.
   > **Status verifikasi (2026-11-14):** klaim "sistem menganggap semua deal `profit < 0` sebagai trade kalah" belum terbukti di kode — lihat §D2a. Yang pasti: cash flow tidak terlihat di jurnal dan formula saldo/ekuitas mengabaikan penarikan. Perbaikan tetap diperlukan, tetapi diagnosis harus diverifikasi dulu di akun demo.

### P3 — Market Watchlist Manual dan Error "Symbol Mismatch" Multi-Timeframe
1. **Watchlist Manual di EA:** Pengguna harus mengetik daftar simbol secara manual via string koma (`InpMonitoredSymbols`) pada properti EA di MT5.
2. **Keterbatasan Chart Symbol pada Candle Multi-TF:** Sensor hanya mengirim array candle (`candles_m5`, `candles`, `candles_h1`, `candles_h4`) untuk simbol chart tempat EA ditempel (`_Symbol`). 
3. **Error "Symbol Mismatch" di Dashboard:** Jika pengguna di Web Dashboard mengklik simbol lain di daftar pantauan (misal mengklik `GBPUSD` saat EA terpasang di `XAUUSD`), panel struktur market menampilkan pesan `Symbol Mismatch` dan data status Bullish/Bearish tidak dapat ditampilkan.

---

## 2. Keputusan Desain (Design Decisions)

### D1 — Migrasi Sensor ke MQL5 Background Service (`.ex5`)
* **Tipe Program:** Mengubah `#property copyright` dari EA menjadi `#property service`. File diletakkan di direktori terminal `MQL5/Services/`.
* **Eksekusi Mandiri:** Berjalan pada thread background mandiri di dalam proses MT5 melalui fungsi `OnStart()` dengan loop `while(!IsStopped()) { SendHeartbeat(); Sleep(interval); }`. Bebas dari chart, simbol aktif, maupun timeframe.
* **Proteksi Biner:** Didistribusikan dalam format biner terkompilasi **`PipstrideMonitor.ex5`** (melalui `apps/web/public/PipstrideMonitor.ex5`). Logika internal terkunci rapat.
* **Single Input Parameter:** Seluruh parameter teknis (`API_BASE_URL`, interval, timeout) dikunci menjadi konstanta (`const`). Jendela properti Service hanya menampilkan **1 parameter**:
  ```mql5
  input string InpBridgeToken = ""; // Masukkan Bridge Token Pipstride Anda
  ```
* **Persistensi 1x Setup:** MT5 menyimpan nilai input Service secara permanen di storage terminal (`terminal.ini`). User hanya memasukkan token **satu kali** saat *Add Service*; service otomatis menyala setiap kali terminal MT5 dibuka.

### D2 — Klasifikasi Deal MT5: Trading vs Cash Flow (Arus Kas)
* Sensor MT5 memisahkan deal riwayat berdasarkan `HistoryDealGetInteger(ticket, DEAL_TYPE)`:
  - `DEAL_TYPE_BUY` (0) & `DEAL_TYPE_SELL` (1) ➔ tetap masuk array `closed_trades` (posisi trading).
  - `DEAL_TYPE_BALANCE` (2) ➔ **tidak** masuk `closed_trades`; masuk array terpisah `cash_flow`:
    - `profit >= 0` ➔ `category: "DEPOSIT"`
    - `profit < 0` ➔ `category: "WITHDRAWAL"`
  - `DEAL_TYPE_CREDIT` (3) dan tipe non-trading lain ➔ di luar scope Fase 013, dicatat sebagai *open question* (tidak boleh diabaikan diam-diam).
* **Dua stream, bukan satu array berlabel.** Balance deal tidak punya `symbol`, `volume`, `open_price`, `close_price`, tidak punya `DEAL_POSITION_ID`, dan tidak boleh ikut jalur dedupe / `uq_trade_connection_ticket` / `count_trades` / `by_source` yang mengasumsikan posisi trading. Pemisahan dilakukan di data layer (tabel `cash_flow_deals` terpisah), bukan dengan filter `category` yang tersebar di setiap rumus.

### D2a — Temuan verifikasi kode (2026-11-14, sebelum implementasi)
Diagnosis awal P2 ("ingest memasukkan semua deal `profit < 0` sebagai trade kalah") **belum terbukti dan kemungkinan besar tidak akurat**:
* `BuildClosedTradesJson()` (`mt5-ea/PipstrideMonitor.mq5:411-468`) hanya meloloskan `DEAL_ENTRY_OUT`, sehingga balance deal belum tentu pernah masuk `closed_trades`.
* Balance deal saat ini hanya disentuh `GetAccountInitialDeposit()` (`:388-406`), yang mengambil **satu** balance deal positif pertama — bukan penjumlahan deposit, dan sama sekali tidak melihat penarikan.
* Manifestasi bug yang pasti ada: arus kas tidak terlihat di jurnal, dan `balance/equity = initial_deposit + Σ profit trading` sehingga ekuitas *overstate* setelah penarikan.

Konsekuensi: tiket 13-02 wajib memverifikasi dulu nilai `DEAL_ENTRY` / `DEAL_POSITION_ID` pada balance deal di akun demo, lalu **menambahkan** stream cash flow. Perbaikan metrik trading bersifat defensif (memastikan balance deal tidak pernah masuk jalur trade), bukan pembalikan filter yang sudah ada.

### D3 — Isolasi Metrik Trading & Formula Keuangan Murni
1. **Aturan Domain Backend (`services/api/app/domain/metrics.py`):**
   - `compute_totals()` / `compute_stats()` hanya menerima **trade rows**; fungsi ini tidak tahu dan tidak boleh tahu soal cash flow.
   - Tabel `cash_flow_deals` tidak pernah dibaca oleh jalur metrik trading, sehingga `total_trades`, `winning_trades`, `losing_trades`, `win_rate`, `profit_factor`, `average_win`, `average_loss`, `expectancy`, streak, `by_symbol`, `by_source`, `by_direction`, dan `dayBuckets` bersih secara struktural (bukan karena filter kondisional).
   - Fungsi murni baru `compute_cash_flow(deals)` ➔ `{deposits, withdrawals, net_funding}`.
2. **Kalkulasi Saldo & Ekuitas (`services/api/app/services/bridge_status_service.py`):**
   - $\text{Balance} = \text{initial\_deposit} + \sum(\text{Cash Flow bertanda}) + \sum(\text{Realized Trade PnL})$
   - Kurva ekuitas memasukkan cash flow sebagai *step event*; drawdown / risk watchdog tetap **trade-only** (risiko trading tidak boleh terlihat lebih kecil karena penarikan).
   - `get_initial_deposit_info()` hanya memakai auto-deteksi sensor selama belum ada baris cash flow untuk koneksi tersebut.
3. **Kurva Performa (Net Trading Return):**
   - Menghitung pertumbuhan murni hasil trading tanpa mendistorsi kurva saat terjadi injeksi atau penarikan modal.

### D4 — Representasi UI & Paritas Frontend (`apps/web`)
1. **Tabel Riwayat Jurnal (`TradeTable.jsx`):**
   - Transaksi penarikan dana tidak lagi diberi label/warna merah `LOSS`.
   - Ditampilkan dengan badge netral: **`WITHDRAWAL`** (warna ungu/slate) dan **`DEPOSIT`** (warna biru/teal).
2. **Kartu Ringkasan Finansial:**
   - Menampilkan metrik terpisah: **Net Trading PnL**, **Total Deposit**, dan **Total Penarikan (Withdrawal)**.
3. **Paritas Domain Frontend (`src/domain/analytics.js` & `pnl.js`):**
   - Memastikan engine analitik frontend 1:1 identik dengan backend domain rules.

### D5 — Sinkronisasi Dua Arah Watchlist & Candle Multi-TF
1. **Bebas `_Symbol`:** Fungsi `CopyRates` di MQL5 Service tidak bergantung pada chart. Service dapat membaca bar candle untuk simbol apa pun secara langsung (`CopyRates("EURUSD", ...)`).
2. **Active Symbol Streaming via Heartbeat Response:**
   - Saat pengguna memilih simbol aktif di halaman Market web (misal klik `GBPUSD`), web mengabari backend.
   - Respon heartbeat dari API ke MT5 Service membawa instruksi simbol aktif:
     ```json
     {
       "status": "ok",
       "active_market_symbol": "GBPUSD"
     }
     ```
   - Service membaca candle M5, M15, H1, H4 untuk simbol yang diminta dan mengirimkannya pada heartbeat berikutnya.
   - Mengeliminasi status `Symbol Mismatch` selamanya.

---

## 3. Schema & Wire Protocol Changes

### 3.1 Closed Trade Payload (tidak berubah)
Item pada array `closed_trades` tetap seperti sekarang — hanya posisi trading:
```json
{
  "ticket": 98765432,
  "symbol": "XAUUSD",
  "type": "SELL",
  "volume": 0.10,
  "open_price": 2650.50,
  "close_price": 2640.20,
  "profit": 103.00,
  "open_time": 1731600000,
  "close_time": 1731603600,
  "magic": 0
}
```

### 3.2 Cash Flow Payload (array baru, `cash_flow`)
Dikirim pada `POST /bridge/heartbeat` dan `POST /bridge/sync-trades`, maksimum 200 item, hanya `DEAL_TYPE_BALANCE`:
```json
{
  "cash_flow": [
    {"ticket": 98765433, "category": "WITHDRAWAL", "profit": -500.00, "time": 1731607200},
    {"ticket": 98765440, "category": "DEPOSIT",    "profit": 1000.00, "time": 1731610800}
  ]
}
```
`symbol`, `volume`, `open_price`, dan `close_price` sengaja tidak ada: nilainya tidak bermakna untuk balance deal dan hanya akan mengundang bug render.

### 3.3 Response API
`GET /api/v1/journal/stats` (field baru):
```json
{
  "totals": { "trades": 10, "win_rate": 90.0, "...": "tidak berubah" },
  "cash_flow": { "deposits": 1000.00, "withdrawals": 500.00, "net_funding": 500.00 }
}
```
`GET /api/v1/bridge/history` (field baru): array `cash_flow` (item sama seperti payload), plus `total_deposits`, `total_withdrawals`, `net_funding`.

### 3.4 Heartbeat API Response
```json
{
  "status": "ok",
  "active_market_symbol": "GBPUSD"
}
```

---

## 4. Rencana Pembagian Tiket (Fase 013)

Fitur ini dipecah menjadi 4 unit kerja mandiri di bawah folder `tickets/013-mql5-service-and-cashflow/`:

1. **`01-mql5-service-refactor-and-ex5-build.md`**
   - Konversi `mt5-ea/PipstrideMonitor.mq5` menjadi Service (`#property service`).
   - Ganti event handler chart (`OnTimer`, `_Symbol`) menjadi loop `OnStart()`.
   - Kunci parameter teknis menjadi `const`, sisakan hanya `InpBridgeToken`.
   - Distribusi biner `apps/web/public/PipstrideMonitor.ex5` & update modal panduan instalasi di `Mt5ConnectModal.jsx`.

2. **`02-cashflow-deal-classification-backend.md`**
   - Sensor: bangun array `cash_flow` dari `DEAL_TYPE_BALANCE` (Deposit vs Withdrawal), terpisah dari `closed_trades`.
   - Persistensi: tabel `cash_flow_deals` + migrasi Alembic + repository & ingest idempoten.
   - Domain: `compute_cash_flow()` murni; `bridge_status_service` menghitung balance/ekuitas lewat cash flow; drawdown tetap trade-only.
   - Unit test Python (`services/api/tests/`) untuk isolasi penarikan terhadap metrik trading dan aritmetika kas.

3. **`03-cashflow-journal-ui-and-frontend-parity.md`**
   - Domain frontend (`src/domain/analytics.js`, `pnl.js`) diselaraskan dengan aturan backend (paritas fixture).
   - Tampilan Jurnal (`TradeTable.jsx`, `KpiCards.jsx`, `useJournalData.js`): baris kas netral `WITHDRAWAL` & `DEPOSIT`, kartu ringkasan deposit/penarikan.
   - Kamus bahasa (`translations.js`) EN/ID diperbarui dan diverifikasi via `check-i18n.cjs`.

4. **`04-dynamic-market-symbols-and-multi-tf.md`**
   - Endpoint tervalidasi JWT untuk menyimpan simbol aktif yang sedang dilihat di Web Dashboard (`live_state`).
   - Heartbeat response menyertakan `active_market_symbol`.
   - MQL5 Service memanggil `CopyRates` dinamis untuk simbol aktif tersebut (M5, M15, H1, H4).
   - `MarketTab.jsx` menghapus pembatasan `symbol_mismatch`, menampilkan struktur Bullish/Bearish dinamis.

---

## 5. Kriteria Sukses (Success Criteria)

1. **Integritas Sensor:**
   - File download `PipstrideMonitor.ex5` tidak dapat diedit secara teks, dan tidak ada lagi `.mq5` yang bisa diunduh dari domain produk.
   - Service berjalan di background tanpa membuka chart apa pun di MT5.
   - Menutup seluruh chart di MT5 tidak memutus aliran telemetri ke server.
   - Perubahan deal (termasuk penutupan posisi) tetap tersinkron tanpa `OnTradeTransaction` — dibuktikan dengan polling diff di loop `OnStart`.
2. **Akurasi Jurnal:**
   - Balance deal tidak pernah masuk tabel `trades`: `count_trades`, `by_source`, dan `total_volume` tidak berubah setelah deposit/penarikan.
   - Melakukan withdrawal pada akun MT5 tidak mengubah `total_trades`, `losing_trades`, `win_rate`, `profit_factor`, maupun `net_profit` trading.
   - PnL trading harian tetap murni mencerminkan hasil posisi trading; kas dilaporkan terpisah (`deposits`, `withdrawals`, `net_funding`).
   - Saldo/ekuitas mengikuti `initial_deposit + Σ cash flow + Σ trade PnL`, dan drawdown tetap trade-only.
   - Riwayat penarikan & deposit tampil dengan badge netral dan kolom volume/harga kosong.
3. **Responsivitas Market:**
   - Memilih simbol apa pun di Market Tab web secara dinamis menampilkan struktur market (Bullish/Bearish) pada timeframe M5, M15, H1, H4 tanpa error `Symbol Mismatch`.
4. **Kualitas & Penjagaan Arsitektur:**
   - Seluruh tes backend (`pytest`) dan tes frontend (`vitest`) lulus 100%.
   - Gate arsitektur (`import-linter` dan `dependency-cruiser`) lulus 0 pelanggaran.
   - Drift migrasi (`python scripts/check_migrations.py`) 0 selisih.
   - Paritas kamus bahasa `check-i18n.cjs` konsisten.
