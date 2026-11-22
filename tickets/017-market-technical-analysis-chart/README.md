# Fase 017: Market Technical Analysis Chart & Pair Directory

## Tujuan
Merombak total tab Market pada dashboard Pipstride (`apps/web`):
1. **Fokus Murni Analisis Teknikal:** Menghilangkan kartu kalkulasi range bar dan bias struktur lama yang kaku, mengubah tab Market menjadi antarmuka analisis teknikal interaktif bergaya workstation.
2. **Alur Pair Picker First:** Pengguna memilih atau mencari instrumen yang ingin dianalisis terlebih dahulu melalui direktori pair terkurasi dan terintegrasi dengan watchlist akun MT5, tanpa memuat chart acak di awal.
3. **Integrasi TradingView Advanced Real-Time Chart:** Menghadirkan chart interaktif penuh (drawing tools, multi-timeframe, indikator teknikal) dengan tema gelap khas Pipstride.
4. **Beban Server 0% (*Zero Server Load*):** Seluruh data tick dan candlestick ditarik langsung oleh browser pengguna dari CDN TradingView tanpa membebani backend FastAPI, Redis, atau terminal MT5.

Didefinisikan dalam spesifikasi: [`docs/specs/013-market-technical-analysis-chart.md`](../../docs/specs/013-market-technical-analysis-chart.md).

---

## Urutan Pengerjaan & Gate

Prasyarat: Fase 006 (Web Feature Split), Fase 008 (Web Test Harness).

| Tiket | Fokus | Prasyarat | Membuka | Status |
|---|---|---|---|---|
| **01** | `01-tradingview-symbol-mapping-and-catalog.md` | — | 02 | `done` |
| **02** | `02-pair-picker-directory-ui.md` | 01 | 03 | `done` |
| **03** | `03-tradingview-chart-container-and-embed.md` | 02 | 04 | `done` |
| **04** | `04-i18n-dictionary-and-translations.md` | 03 | — | `done` |

Rekomendasi urutan eksekusi: `17-01 → 17-02 → 17-03 → 17-04`.

---

## Checklist Audit Keluar (Gate Fase 017)

**Domain & Logic**
- [x] `apps/web/src/domain/market.js` mengekspor fungsi resolusi ticker TradingView (`resolveTradingViewSymbol`) dan katalog pair terkurasi (`MARKET_CATALOG`, `MARKET_CATEGORIES`).
- [x] Resolusi ticker mencakup Forex majors, Logam (Gold/Silver), Kripto, dan Indeks global, serta fallback bersih untuk simbol kustom.
- [x] Unit test baru pada `src/domain/market.test.js` memvalidasi seluruh skenario pemetaan ticker dan filter katalog.

**Antarmuka Pengguna (UI/UX)**
- [x] State 1 (Pair Directory): Kolom pencarian instan menyaring daftar pair secara reaktif.
- [x] State 1: Tombol filter kategori (*All*, *Forex*, *Metals*, *Crypto*, *Indices*) berfungsi akurat.
- [x] State 1: Simbol dari akun MT5 yang sedang terhubung (*Account Watchlist*) diprioritaskan di daftar.
- [ ] State 2 (Chart View): Memilih pair membuka kontainer TradingView Advanced Real-Time Chart dengan *drawing tools* dan *indicators* aktif. **Butuh cek browser.**
- [ ] State 2: Kontainer chart mengisi tinggi layar secara proporsional (*full height viewport*) dengan tema gelap konsisten. **Butuh cek browser** (token aktual `--bg #080f14` / `--p2 #172932`, bukan hex di spec lama).
- [x] State 2: Terdapat header navigasi dengan tombol `← Ganti Pair` yang mulus mengembalikan tampilan ke State 1.
- [ ] Lifecycle React bersih: tidak ada duplikasi iframe atau script leak saat ganti pair atau berpindah tab. **Butuh cek browser** (guard pembersihan kontainer dan listener sudah diuji dengan widget tiruan).

> **Catatan gate:** Jalankan `npm --prefix apps/web run dev`, lalu buka Market dan pilih XAUUSD. Cek drawing tools, timeframe, indikator, fokus setelah memilih pair dan menekan **Ganti Pair**, serta perpindahan dari Market ke Journal dan kembali. Cek pesan gagal dan tombol coba lagi dengan memblokir sementara permintaan skrip TradingView. Di build production, buka chart Market dan terminal Replay untuk menguji kedua origin iframe dengan CSP aktif.

**Kualitas, Arsitektur, & Bahasa**
- [x] `npm --prefix apps/web test` lulus 100% (semua file test pass).
- [x] `npm --prefix apps/web run lint` lulus dengan 0 warning dan 0 error (`oxlint`).
- [x] `npm --prefix apps/web run lint:arch` lulus 0 violations (`dependency-cruiser`).
- [x] `node apps/web/scripts/check-i18n.cjs` lulus paritas EN/ID (498 key sinkron per bahasa).
- [x] `apps/web/nginx.conf` `$csp` mengizinkan `script-src https://s3.tradingview.com`, `frame-src https://*.tradingview.com`, dan `connect-src https://*.tradingview.com`. Directive `frame-src` juga menyertakan `'self'` untuk terminal Replay.
- [x] `npm --prefix apps/web run build` sukses menghasilkan bundle produksi di `apps/web/dist`.
