# SPEC-013: Perombakan Halaman Market Menjadi Fokus Analisis Teknikal (TradingView Integration & Pair Directory)

## 1. Problem & Context

Saat ini, tab Market pada aplikasi dashboard Pipstride (`apps/web/src/components/MarketTab.jsx`) menampilkan komponen bawaan berupa:
1. Ringkasan quote bid/ask terbatas.
2. *Price action range bar* (posisi harga saat ini di antara titik High dan Low).
3. Kartu pembacaan struktur pasar (Higher Highs / Lower Lows / Consolidation) yang bergantung pada payload 24–35 bar candle dari heartbeat MQL5.

Keterbatasan utama dari sistem saat ini:
- Tidak memiliki grafik candlestick interaktif visual dan tidak menyediakan peralatan analisis teknikal (drawing tools, trendline, fibonacci, indikator teknikal).
- Upaya menarik data candlestick penuh dan streaming tick realtime dari terminal MT5 ke server backend Pipstride berisiko tinggi membebani CPU, bandwidth, serta memicu blocking pada thread MQL5 `WebRequest`.
- Komponen analisis bawaan saat ini memakan ruang layar tetapi belum memberikan pengalaman analisis teknikal yang memuaskan bagi trader.

**Keputusan Desain:**
Halaman Market dirombak total dan difokuskan murni untuk **analisis teknikal**. Seluruh komponen lama (range bar, kartu struktur bias, dan tombol timeframe kaku M5/M15/H1/H4) dihapus. Sebagai gantinya, diintegrasikan **TradingView Advanced Real-Time Chart Widget** dengan arsitektur **"Pair Picker First"** (pemilihan pair terlebih dahulu sebelum chart dimuat), dengan beban server **0%** (*zero server overhead*).

---

## 2. Goals & Constraints

### Goals
- **Goal 1 (Clean Technical Analysis Focus)**: Menghapus komponen analisis teks/range bar lama dari `MarketTab.jsx` dan mengalihkan 100% fokus tab Market ke antarmuka analisis teknikal interaktif.
- **Goal 2 (Pair Picker First Flow)**: Tab Market tidak langsung memuat chart acak secara default. Saat dibuka, halaman menampilkan antarmuka pencarian dan direktori pair (Forex, Logam/Komoditas, Crypto, Indeks) yang bersih dan cepat.
- **Goal 3 (Full-Featured TradingView Integration)**: Setelah pair dipilih, halaman menampilkan TradingView Advanced Chart secara penuh (*full-screen viewport*) dilengkapi *drawing tools*, indikator, *candle style selector*, dan *timeframe switcher*. Ketersediaan data dan latensi mengikuti feed TradingView.
- **Goal 4 (Zero Server Load)**: Seluruh data tick dan candlestick ditarik langsung oleh browser dari CDN TradingView. Backend FastAPI, Redis, dan terminal MT5 user tidak dibebani komputasi atau bandwidth streaming baru.
- **Goal 5 (Seamless Navigation & Usability)**: Pada tampilan chart, disediakan bar kontrol ringkas dengan tombol `← Ganti Pair` (*Change Pair*) untuk kembali ke direktori pencarian pair kapan saja.
- **Goal 6 (Bilingual & Quality Gate)**: Seluruh label antarmuka memiliki paritas Bahasa Indonesia dan Inggris pada `translations.js`, lolos audit `check-i18n.cjs`, `oxlint` 0 warning, serta test suite web tetap 100% hijau.

### Constraints
- Tidak mengubah kontrak telemetri bridge MT5 yang sedang berjalan pada backend.
- Menjaga konsistensi tema gelap Pipstride. Token aktual di `apps/web/src/index.css` adalah sumber kebenaran: `--bg #080f14`, `--p #111e26`, `--p2 #172932`, `--line #29404a`, `--text #eff7f5`, `--muted #91a7ae`, aksen `--g #45e0ad`.
- Widget TradingView harus diisolasi dalam lifecycle React yang bersih (`useEffect` mount/unmount) agar tidak terjadi memory leak atau duplikasi iframe saat berganti tab atau ganti pair.
- CSP produksi (`apps/web/nginx.conf`) harus mengizinkan `s3.tradingview.com` dan iframe `https://*.tradingview.com`. Pertahankan `'self'` di `frame-src` untuk terminal Replay.

---

## 3. Detailed Technical Design

### 3.1. Alur Antarmuka Dua Tahap (Two-State Architecture)

Komponen `MarketTab.jsx` diatur dengan dua status (*state*):

```text
[Buka Tab Market]
        │
        ▼
┌────────────────────────────────────────────────────────┐
│  STATE 1: PAIR DIRECTORY & SEARCH                     │
│  - Input Pencarian Simbol Instan                       │
│  - Filter Kategori: All | Forex | Metals | Crypto | .. │
│  - Grid Kartu Pair Terkurasi & Simbol Akun MT5         │
└────────────────────────────────────────────────────────┘
        │
        │ (User klik salah satu pair)
        ▼
┌────────────────────────────────────────────────────────┐
│  STATE 2: FULL-SCREEN TECHNICAL ANALYSIS CHART         │
│  - Top Bar: [← Ganti Pair]                             │
│  - Container TradingView Advanced Real-Time Chart      │
│  - Full Height Viewport, Dark Theme, Drawing Tools     │
└────────────────────────────────────────────────────────┘
```

### 3.2. Pemetaan Simbol TradingView (`apps/web/src/domain/market.js`)

Untuk memastikan simbol yang dipilih memuat chart yang valid di TradingView, domain `market.js` dilengkapi fungsi pemetaan resolusi ticker (`resolveTradingViewSymbol`) dan katalog terkurasi:

1. **Format Ticker Penyedia:**
   - Emas/Perak: `XAUUSD` $\rightarrow$ `OANDA:XAUUSD`, `XAGUSD` $\rightarrow$ `OANDA:XAGUSD`.
   - Forex Majors: `EURUSD` $\rightarrow$ `FX:EURUSD`, `GBPUSD` $\rightarrow$ `FX:GBPUSD`, `USDJPY` $\rightarrow$ `FX:USDJPY`, `AUDUSD` $\rightarrow$ `FX:AUDUSD`, `USDCAD` $\rightarrow$ `FX:USDCAD`, `USDCHF` $\rightarrow$ `FX:USDCHF`.
   - Crypto: `BTCUSD` / `BTCUSDT` $\rightarrow$ `BINANCE:BTCUSDT`, `ETHUSD` $\rightarrow$ `BINANCE:ETHUSDT`, `SOLUSD` $\rightarrow$ `BINANCE:SOLUSDT`.
   - Indeks Global: `US30` $\rightarrow$ `CAPITALCOM:US30`, `NAS100` $\rightarrow$ `CAPITALCOM:US100`, `SPX500` $\rightarrow$ `CAPITALCOM:SPX500`.

2. **Dukungan Simbol Bebas:**
   Jika user mengetik simbol khusus yang tidak ada di daftar kurasi (misal saham `AAPL` atau pair eksotis `EURGBP`), sistem menyediakan opsi pencarian bebas yang langsung meneruskan simbol ke widget TradingView.

### 3.3. Komponen Antarmuka (`apps/web/src/components/MarketTab.jsx`)

1. **State 1 — Pair Directory:**
   - Komponen input pencarian dengan debounce atau filter reaktif.
   - Tombol pil kategori: *All*, *Forex*, *Metals*, *Crypto*, *Indices*.
   - Grid kartu yang menampilkan:
     - Ikon simbol khas Pipstride (`Au`, `Eu`, `Gu`, `₿`, dll.).
     - Kode pair & nama lengkap instrumen.
     - Badge kategori.
     - Integrasi dinamis: Jika akun MT5 terhubung, simbol dari watchlist akun pengguna (`bridgeStatus.market_quotes`) ditampilkan di bagian atas dengan badge khusus *Account Watchlist*.

2. **State 2 — Chart View:**
   - Header bar ringkas:
     - Tombol kembali: `← Ganti Pair` (`market_btn_change_pair`).
     - Simbol aktif ditampilkan di toolbar TradingView dan ikut berubah saat user memilih simbol lain di widget.
   - Kontainer TradingView:
     - Dibuat melalui script injection dinamis dari `https://s3.tradingview.com/tv.js` atau embed widget container resmi.
     - Parameter widget:
       - `autosize: true`
       - `theme: "dark"`
       - `style: "1"` (Candlestick)
       - `locale: "en"` / `"id"` (sinkron dengan `LanguageContext`)
       - `toolbar_bg: "#0a1419"`
       - `enable_publishing: false`
       - `allow_symbol_change: true` (user juga dapat berpindah simbol langsung di dalam widget)
       - `save_image: true`
       - `hide_side_toolbar: false` (drawing tools aktif)
       - `studies: ["STD;RSI", "STD;MACD"]` (opsional preset atau default clean)

### 3.4. Paritas Kamus Bahasa (`apps/web/src/constants/translations.js`)

Menambahkan key terjemahan bilingual baru (EN/ID) dan membersihkan sisa key yang sudah tidak dipakai dari komponen lama:
- `market_search_placeholder`: "Cari pair atau instrumen... (e.g. XAUUSD, EURUSD, BTC)" / "Search pair or instrument... (e.g. XAUUSD, EURUSD, BTC)"
- `market_category_all`: "Semua" / "All"
- `market_category_forex`: "Forex" / "Forex"
- `market_category_metals`: "Logam & Komoditas" / "Metals & Commodities"
- `market_category_crypto`: "Kripto" / "Crypto"
- `market_category_indices`: "Indeks" / "Indices"
- `market_category_account`: "Watchlist MT5" / "MT5 Watchlist"
- `market_btn_change_pair`: "Ganti Pair" / "Change Pair"
- `market_no_pairs_found`: "Tidak ada pair yang cocok" / "No matching pairs found"
- `market_custom_symbol_cta`: "Analisis {symbol} di TradingView" / "Analyze {symbol} on TradingView"
- Status memuat chart, pesan gagal, dan aksi coba lagi tersedia dalam EN dan ID.
- `market_chart_powered_by`: "Data & Chart interaktif disediakan oleh TradingView" / "Interactive data & chart powered by TradingView"
- Nama instrumen untuk `nameKey` katalog: `market_symbol_silver`, `market_symbol_oil`, `market_symbol_aussie`, `market_symbol_loonie`, `market_symbol_swissy`, `market_symbol_kiwi`, `market_symbol_ether`, `market_symbol_solana`, `market_symbol_dow`, `market_symbol_nasdaq`, `market_symbol_sp500` (paritas EN/ID wajib).

---

## 4. Acceptance Criteria & Verification

1. **State 1 Verification:**
   - Membuka tab Market menampilkan direktori pencarian pair tanpa memuat chart terlebih dahulu.
   - Mengetik simbol pada kolom pencarian langsung menyaring daftar pair secara instan.
   - Mengklik kategori memfilter daftar pair sesuai kategori yang dipilih.
   - Jika MT5 terhubung, pair dari akun user muncul dalam daftar.

2. **State 2 Verification:**
   - Mengklik salah satu pair membuka kontainer TradingView Chart untuk pair tersebut.
   - Drawing tools di sisi kiri berfungsi normal (bisa menggambar garis, trendline, teks).
   - Timeframe dan indikator teknikal dapat diakses dan diubah secara bebas oleh user.
   - Tombol `← Ganti Pair` mengembalikan tampilan ke State 1 tanpa error console atau memory leak.

3. **Performance & Reliability Verification:**
   - Tidak ada panggilan HTTP berulang atau streaming tick ke server backend Pipstride.
   - Lolos audit lint: `npm --prefix apps/web run lint` (0 warnings).
   - Lolos audit boundary: `npm --prefix apps/web run lint:arch` (0 violations).
   - Lolos audit i18n: `node apps/web/scripts/check-i18n.cjs` (0 missing keys, paritas 1:1).
   - Test suite frontend tetap hijau: `npm --prefix apps/web test` (semua unit test pass).
   - Bundle build sukses: `npm --prefix apps/web run build`.
