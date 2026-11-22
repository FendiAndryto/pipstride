# Ticket 17-01: TradingView Symbol Mapping & Market Catalog Domain

**Status:** done  
**Prasyarat:** —  
**Membuka:** 17-02  
**Spesifikasi:** [`docs/specs/013-market-technical-analysis-chart.md`](../../docs/specs/013-market-technical-analysis-chart.md) §3.2

---

## Goal
Mengimplementasikan modul domain murni untuk katalog pair terkurasi dan fungsi pemetaan ticker broker ke format feed TradingView (`resolveTradingViewSymbol`) beserta unit test komprehensif di `apps/web/src/domain/market.test.js`.

---

## Scope & Technical Details

1. **Katalog Pair Terkurasi (`apps/web/src/domain/market.js`)**:
   - Definisikan `MARKET_CATEGORIES`:
     - `ALL`: 'all'
     - `FOREX`: 'forex'
     - `METALS`: 'metals'
     - `CRYPTO`: 'crypto'
     - `INDICES`: 'indices'
   - Definisikan `MARKET_CATALOG` (array berisi objek pair: `symbol`, `nameKey`, `category`, `tvSymbol`, `icon`) — nama ini yang dipakai gate audit Fase 017:
     - Logam/Komoditas: `XAUUSD` (OANDA:XAUUSD), `XAGUSD` (OANDA:XAGUSD), `USOIL` (TVC:USOIL).
     - Forex Majors: `EURUSD` (FX:EURUSD), `GBPUSD` (FX:GBPUSD), `USDJPY` (FX:USDJPY), `AUDUSD` (FX:AUDUSD), `USDCAD` (FX:USDCAD), `USDCHF` (FX:USDCHF), `NZDUSD` (FX:NZDUSD).
     - Crypto: `BTCUSD` (BINANCE:BTCUSDT), `ETHUSD` (BINANCE:ETHUSDT), `SOLUSD` (BINANCE:SOLUSDT).
     - Indeks Global: `US30` (CAPITALCOM:US30), `NAS100` (CAPITALCOM:US100), `SPX500` (CAPITALCOM:SPX500).

2. **Fungsi Resolusi Ticker (`resolveTradingViewSymbol`)**:
   - Menerima `baseSymbol: string`.
   - Normalisasi: strip whitespace, huruf besar, bersihkan suffix broker umum (`c`, `m`, `.a`, `#`, dll via `isSameInstrument`).
   - Jika ada di katalog `MARKET_CATALOG` (cocok persis atau lewat `isSameInstrument` sehingga suffix broker seperti `c`/`m`/`.a`/`#`/`.pro`/`.cash` ikut tertangani), kembalikan `tvSymbol` yang dipetakan.
   - Fallback:
     - Jika mengandung format bursa (`:` seperti `BINANCE:BTCUSDT` atau `NASDAQ:AAPL`), gunakan langsung.
     - Jika simbol 6 huruf standar Forex, arahkan ke `FX:<SYMBOL>`.
     - Fallback default aman: kembalikan `<SYMBOL>` bersih.

3. **Fungsi Filter & Pencarian Katalog (`filterMarketCatalog`)**:
   - Menerima `(catalog, query, category)`.
   - Melakukan filter case-insensitive terhadap `symbol` dan `name`. Karena item katalog hanya menyimpan `nameKey`, komponen pemanggil memperkaya item dengan `name` hasil `t(nameKey)` sebelum memanggil fungsi ini — jadi pencarian tetap bilingual.
   - Melakukan filter berdasarkan `category` jika bukan `ALL`.
   - Toleran input non-array (kembalikan `[]`) dan tidak memutasi input.

4. **Unit Tests (`apps/web/src/domain/market.test.js`)**:
   - Tes resolusi pair populer (`XAUUSD` $\rightarrow$ `OANDA:XAUUSD`, `EURUSD` $\rightarrow$ `FX:EURUSD`, dll).
   - Tes penanganan broker suffix (`XAUUSDc`, `EURUSD.pro` $\rightarrow$ resolusi yang benar).
   - Tes resolusi simbol kustom / fallback.
   - Tes fungsi `filterMarketCatalog` berdasarkan keyword dan kategori.

---

## Verification
```bash
npm --prefix apps/web test
npm --prefix apps/web run lint
```
Semua unit test di `market.test.js` lulus dan `oxlint` 0 warning.

**Hasil (2026-11-22):** `117 passed (9 file)`; `oxlint` 0 warning; `lint:arch` 0 violations.
