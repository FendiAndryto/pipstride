# Ticket 13-04: Dynamic Market Watchlist & Multi-Timeframe Candles via Website

**Status:** in_progress — bagian otomatis hijau (2026-11-14); checklist manual MT5 (ganti simbol live) belum dijalankan.  
**Prasyarat:** 13-01  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/007-mql5-service-cashflow-and-dynamic-market.md`](../../docs/specs/007-mql5-service-cashflow-and-dynamic-market.md) §D5, §3.4

---

## Goal
Memindahkan kendali simbol yang dipantau dari input MT5 ke Web Dashboard: web menetapkan simbol aktif per koneksi, heartbeat response membawa instruksi tersebut, dan MQL5 Service menarik candle M5/M15/H1/H4 untuk simbol itu secara dinamis tanpa chart dan tanpa `Symbol Mismatch`.

---

## Konteks & Problem (terverifikasi 2026-11-14)

1. Watchlist saat ini berasal dari `InpMonitoredSymbols` (`mt5-ea/PipstrideMonitor.mq5:318`) dan dipakai `BuildMarketQuotesJson()` (`:473-500`) untuk seluruh daftar quote di MarketTab. Menghapus input itu (13-01) **mematikan sumber daftar simbol**, bukan hanya candle.
2. Candle chart-bound: `BuildCandlesJson()` memakai `_Symbol` (`:536`), `chart_symbol` = `_Symbol` (`:732`).
3. `FindBrokerSymbol()` fallback `return _Symbol` (`:296`) — di Service `_Symbol` tidak bermakna, jadi fallback harus diganti.
4. `MarketTab.jsx:106-118` menandai `symbol_mismatch` untuk semua TF saat `metrics.chart_symbol` ≠ simbol yang dipilih; pesannya dirender di `:300` dan `:411`.
5. Auth: route tulis bridge (`heartbeat`, `sync-trades`) memakai `X-Bridge-Token` (`services/api/app/api/v1/bridge.py:55-58`), sedangkan aksi dari web memakai JWT `Depends(get_active_connection)` (`:196-236`). Endpoint "set simbol aktif" dari web **wajib** memakai jalur JWT; kalau ditempel di jalur bridge token, request web akan 401.
6. `core/live_state.py` hanya punya fungsi spesifik (`save_live_payload`, `save_trade_count`, `request_trade_resync`, `save_broker_offset`, …) — belum ada slot untuk simbol aktif, jadi perlu fungsi baru di kedua backend (`_MemoryBackend`, `_RedisBackend`).

---

## Scope

### 1. Backend state (`services/api`)
- `app/core/live_state.py`: tambah pasangan fungsi mengikuti pola yang ada:
  - `save_active_symbol(connection_id, symbol)`, `load_active_symbol(connection_id)`, `clear_active_symbol(connection_id)`
  - `save_watchlist(connection_id, symbols: list[str])`, `load_watchlist(connection_id)`
  - Redis TTL tidak wajib (state hidup selama koneksi dipakai); in-process fallback tetap harus kompatibel.
- Seed default: `settings.MT5_MONITORED_SYMBOLS` (sudah ada di `core/config.py:56`) dipakai saat `load_watchlist()` kosong.
- Endpoint JWT baru di `app/api/v1/bridge.py`:
  ```
  PUT /api/v1/bridge/active-symbol    { "symbol": "GBPUSD" }
  ```
  - `Depends(get_active_connection)` (bukan `X-Bridge-Token`).
  - Validasi: uppercase, regex `^[A-Z0-9._#-]{1,32}$` (samakan dengan `_SAFE_SYMBOL` di `mt5_package.py`), tolak selain itu dengan 422.
  - Efek: `save_active_symbol(...)`; **dan** tambahkan ke watchlist bila belum ada (maks 32 simbol) — ini satu-satunya cara simbol baru masuk daftar, karena UI hanya bisa mengklik quote yang sudah ada.
  - Response: `{"status":"ok","active_market_symbol":"GBPUSD","watchlist":[...]}`.
- `HeartbeatResponse` (`app/models/bridge.py:115`) tambah:
  - `active_market_symbol: Optional[str] = None`
  - `watchlist: List[str] = Field(default_factory=list)`
- `telemetry_ingest_service.process_heartbeat()`: isi kedua field dari `live_state` saat membangun response (`:139-143`).
- Test baru `services/api/tests/test_active_symbol.py`:
  - 401/403 tanpa JWT; 200 dengan JWT; simbol di-normalisasi uppercase; simbol invalid → 422.
  - Heartbeat response memuat simbol yang baru diset + watchlist yang memuatnya.
  - Simbol tersimpan per `connection_id` (dua koneksi tidak saling bocor).

### 2. Sensor (`mt5-ea/PipstrideMonitor.mq5`)
- Hapus `InpMonitoredSymbols`; ganti `EnsureWatchlistCache()` agar sumbernya `g_watchlist[]` yang diisi dari heartbeat response (default: `g_default_symbol` bila response kosong).
- Parse response heartbeat (`resultData` dari `WebRequest`) dengan helper manual (MQL5 tidak punya JSON parser): `bool JsonStringValue(const string json, const string key, string &out)` memakai `StringFind` + escape handling. Ambil `active_market_symbol`. Ambil `watchlist` sebagai array string (split sederhana pada `"..."` setelah key).
- `BuildCandlesJson(string symbol, ENUM_TIMEFRAMES tf, int bars)` — ubah signature agar simbol eksplisit; panggil `CopyRates(sym, tf, 0, bars, rates)`.
- Bangun candle untuk simbol aktif saja: `PERIOD_M5 35`, `PERIOD_M15 35`, `PERIOD_H1 24`, `PERIOD_H4 24`; isi `candles_m5`, `candles`, `candles_h1`, `candles_h4`, dan `chart_symbol` = nama simbol broker hasil `FindBrokerSymbol()`.
- Cache: bangun ulang maksimum 1×/30 s **dan** segera saat simbol aktif berubah (jangan panggil `CopyRates` 4 TF tiap heartbeat 5 s).
- `FindBrokerSymbol()` fallback → `g_default_symbol` (bukan `_Symbol`); `SymbolSelect(resolved, true)` tetap dipanggil agar data historis tersedia.
- `BuildMarketQuotesJson()` iterasi `g_watchlist` (bukan input), tetap memakai `g_d1_cache`; reset cache saat watchlist berubah.
- Rebuild `.ex5` dan perbarui checksum di modal (lihat 13-01 §2).

### 3. Frontend (`apps/web`)
- `services/api.js`: `setActiveMarketSymbol(symbol)` → `PUT /api/v1/bridge/active-symbol` dengan body `{ symbol }`.
- `components/MarketTab.jsx`:
  - Hapus cabang `symbol_mismatch` di `tfAvailability` (`:106-118`), di pesan `:300`, dan di `:411`.
  - State baru per TF: `ok` | `not_streamed` (EA build lama belum kirim TF itu) | `waiting_for_symbol` (baru ganti simbol, heartbeat berikutnya belum tiba). `waiting_for_symbol` harus punya salinan sendiri, jangan menumpang pesan "EA lama".
  - Saat user memilih simbol: `setActiveMarketSymbol(symbol)` (fire-and-forget + `.catch`), tampilkan `waiting_for_symbol` sampai `metrics.chart_symbol` cocok dengan `isSameInstrument`.
  - `isSameInstrument` tetap dipakai untuk memvalidasi bahwa candle yang datang memang milik simbol aktif — mismatch sesaat bukan error, hanya state menunggu.
- i18n (EN + ID): tambah `market_tf_waiting_symbol`; hapus/hentikan pemakaian `market_tf_symbol_mismatch` bila sudah tidak dirender (pastikan `check-i18n.cjs` tidak melaporkan key yatim).

---

## Files to Touch
- `services/api/app/core/live_state.py`
- `services/api/app/models/bridge.py`
- `services/api/app/api/v1/bridge.py`
- `services/api/app/services/telemetry_ingest_service.py`
- `services/api/tests/test_active_symbol.py` (baru)
- `mt5-ea/PipstrideMonitor.mq5`
- `apps/web/public/PipstrideMonitor.ex5` (rebuild)
- `apps/web/src/components/MarketTab.jsx`
- `apps/web/src/components/Mt5ConnectModal.jsx` (checksum)
- `apps/web/src/services/api.js`
- `apps/web/src/constants/translations.js`

---

## Verification
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe

cd ../..
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web run build
node apps/web/scripts/check-i18n.cjs
```

**Kriteria lulus:**
- Backend: `PUT /api/v1/bridge/active-symbol` tanpa JWT → 401; dengan JWT → 200; simbol invalid → 422; heartbeat response memuat simbol tersebut.
- Web: memilih `GBPUSD` saat service dulu terpasang di `XAUUSD` menampilkan struktur M5/M15/H1/H4 tanpa pesan `Symbol Mismatch` (setelah ≤1 heartbeat).
- Web: TF yang belum dikirim build lama tetap menampilkan pesan "belum dikirim", bukan pesan mismatch.
- Manual MT5: ganti simbol di web → candle berubah dalam ≤1 interval heartbeat tanpa membuka chart apa pun; daftar quote tetap terisi walau tidak ada chart.

---

## Log Verifikasi (2026-11-14)

**Otomatis — hijau:**
- `metaeditor64 /compile` → `Result: 0 errors, 0 warnings` (`mt5-ea/compile.log`; 2999 ms pada build final). Percobaan pertama gagal `error 203: invalid index value` karena `MAX_CONTROL_SYMBOLS` dideklarasi `const int`; MQL5 hanya menerima literal/`#define` sebagai dimensi array, lalu diperbaiki jadi `#define MAX_CONTROL_SYMBOLS 32`.
- `.ex5` hasil build: **51.506 byte**, SHA-256 `262dd4963a2e8f6092743493c6e2f26f49405da0102da763f69b7dd23fbe0e3d`. Disalin ke `apps/web/public/PipstrideMonitor.ex5` dan ikut ke `apps/web/dist/` (hash dist identik); `EA_SHA256` di `Mt5ConnectModal.jsx` diperbarui ke nilai tersebut. Angka ini menggantikan hash pada log 13-01/13-02 karena 13-04 mengubah sensor lagi.
- `pytest` penuh → **193 passed** (185 + 7 tes `tests/test_active_symbol.py` + 1 tes baseline override di `test_cash_flow.py`).
- `lint-imports` → **6 kept, 0 broken**; `alembic heads` → satu head `0005_cash_flow_deals`.
- `vitest run` → **7 file, 99 tes**; `oxlint` 0 error/0 warning; `lint:arch` → 61 modul, 0 pelanggaran; `vite build` → 1980 modul; `check-i18n.cjs` → **499 key/bahasa, 439 static key resolved**.

**Cakupan terhadap kriteria:**
- `PUT /active-symbol` tanpa JWT → 401; dengan JWT → 200 (`active_market_symbol` + `watchlist` uppercase); simbol `""`, `"GB PUSD"`, `"GBP/USD"`, 33 karakter, dan `'GBPUSD"}'` → 422.
- Heartbeat response memuat `active_market_symbol` hasil set dan `watchlist` yang memuatnya; tanpa pemilihan, `active_market_symbol: null` + `watchlist` = seed `MT5_MONITORED_SYMBOLS`.
- Seleksi tersimpan per `connection_id` (koneksi kedua tidak melihat simbol koneksi pertama) dan pemilihan berulang tidak menduplikasi watchlist.
- `MarketTab.jsx`: tidak ada lagi string `symbol_mismatch`, `market_tf_needs_chart_symbol`, atau `market_no_candles_body` di `apps/web/src` (grep 0 hasil selain key baru). State per TF sekarang `ok | not_streamed | waiting_for_symbol`.
- Sensor: `#property service`, satu `input InpBridgeToken`, tidak ada `OnTimer`/`EventSetTimer`/`OnTradeTransaction` (hanya komentar penjelas), `_Symbol` hanya di komentar, candle dibangun untuk `ActiveBrokerSymbol()` dan `chart_symbol` memakai simbol yang sama.

**Deviasi dari teks tiket:**
1. **TTL control-state 30 hari, bukan tanpa TTL.** Tiket bilang "Redis TTL tidak wajib"; tanpa TTL, koneksi yang dihapus meninggalkan key selamanya. `CONTROL_TTL_SECONDS = 30 hari` cukup panjang untuk terminal yang mati semalam, tapi tetap bisa dibersihkan.
2. **`MAX_CONTROL_SYMBOLS` = `#define`, bukan `const int`.** Dimensi array MQL5 wajib literal (error 203 di percobaan pertama).
3. **Helper tambahan `ActiveBrokerSymbol()`.** `FindBrokerSymbol()` memindai seluruh simbol terminal, jadi hasil resolusi di-cache di `g_active_broker` dan di-invalidate oleh `ApplyServerControl()`/`InvalidateDerivedCaches()`.
4. **`EnsureWatchlistCache()` fallback ke satu simbol (`g_default_symbol`), bukan daftar default.** Server sudah jadi satu-satunya sumber daftar; EA tidak lagi menyimpan salinan `DEFAULT_WATCHLIST`.
5. **Dua key i18n dihapus, bukan dibiarkan yatim:** `market_tf_needs_chart_symbol` dan `market_no_candles_body` (500 → 499 key/bahasa). Pesan pengganti `market_tf_waiting_symbol` dipakai untuk tooltip TF maupun body empty-state.
6. **`waiting_for_symbol` juga berlaku saat `chart_symbol` masih kosong** (belum ada heartbeat). Ini kondisi jujur "menunggu", bukan error, dan hilang sendiri pada heartbeat pertama.
7. **Parsing response memakai dua helper terarah** (`JsonStringValue`, `JsonStringArray`), bukan JSON parser penuh — response hanya objek datar + satu array string.

**Belum dijalankan (butuh terminal MT5 pengguna):**
- Pilih simbol di web lalu amati candle M5/M15/H1/H4 berubah ≤1 interval heartbeat tanpa membuka chart.
- Pastikan daftar quote tetap terisi saat tidak ada chart sama sekali.
- Konfirmasi tidak ada lagi pesan `Symbol Mismatch` pada build baru.

---

## Amandemen Review (2026-11-15)

1. **Simbol baru di-*prepend*, bukan di-*append*.** `PUT /active-symbol` dulu menambahkan simbol ke akhir watchlist lalu memotong ke 32, sehingga pada watchlist yang sudah penuh simbol yang baru saja diklik langsung terbuang dan heartbeat berikutnya tidak pernah memuatnya. Sekarang `watchlist = [symbol, *watchlist][:32]`. Tes `test_active_symbol.py` tidak berubah karena tidak ada kasus 33 simbol di sana; perilaku ini dijaga oleh pembacaan kode, bukan tes.
2. **Parameter i18n `market_tf_waiting_symbol` hanya `{symbol}`.** Kalimatnya tidak memakai `{tf}`, jadi pemanggilan di `MarketTab.jsx` tidak lagi mengoper `tf` (key 499 tetap).
3. **Deskripsi `chart_symbol` diperbarui** menjadi "Symbol the monitor is streaming candles for (broker name)" — teks lama ("Current symbol on active MT5 chart") menyesatkan setelah sensor tidak lagi butuh chart.
4. **`typing` di `models/bridge.py` digabung** menjadi satu baris (`Any, List, Literal, Optional`), menghapus impor ganda yang tertinggal dari perubahan 13-04.
5. Build `.ex5` terakhir: **51.506 byte**, SHA-256 `262dd4963a2e8f6092743493c6e2f26f49405da0102da763f69b7dd23fbe0e3d` — lebih kecil dari build sebelumnya karena `AppendCashFlowRecord()` menggantikan blok `StringFormat` yang terduplikasi di 13-02.
