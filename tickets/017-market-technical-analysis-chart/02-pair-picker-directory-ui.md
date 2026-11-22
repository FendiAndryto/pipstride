# Ticket 17-02: Pair Picker Directory Interface (State 1)

**Status:** done  
**Prasyarat:** 17-01  
**Membuka:** 17-03  
**Spesifikasi:** [`docs/specs/013-market-technical-analysis-chart.md`](../../docs/specs/013-market-technical-analysis-chart.md) §3.3 (State 1)

---

## Goal
Mengembangkan tampilan State 1 (Pair Directory & Search) di `MarketTab.jsx` yang memungkinkan pengguna mencari, memfilter berdasarkan kategori, dan memilih instrumen yang ingin dianalisis secara cepat dan intuitif.

---

## Scope & Technical Details

1. **Struktur Komponen State 1 (`apps/web/src/components/MarketTab.jsx`)**:
   - Gantikan markup lama (range bar, kartu struktur bias, tombol timeframe M5/M15/H1/H4).
   - Implementasikan state internal:
     - `selectedPair`: default `null` (artinya berada di State 1).
     - `searchQuery`: string input pencarian.
     - `activeCategory`: filter kategori aktif (default `ALL`).

2. **Search Bar & Kategori Chips**:
   - Kolom pencarian responsif dengan icon `Search` dari `lucide-react`.
   - Placeholder terlokalisasi: `t('market_search_placeholder')`.
   - Tombol bersihkan pencarian jika ada teks (`X`).
   - Pil kategori horizontal scrollable: *All*, *Forex*, *Metals*, *Crypto*, *Indices*, plus tab khusus *Account* jika user memiliki koneksi MT5 aktif dengan data `market_quotes`.

3. **Grid Kartu Pair**:
   - Tampilkan kartu pair dengan styling konsisten dark-obsidian khas Pipstride (`background: var(--p1)`, `border: 1px solid var(--line)`).
   - Setiap kartu memuat:
     - Ikon instrumen (`Au`, `Eu`, `₿`, dll).
     - Simbol tebal (`XAUUSD`, `EURUSD`, dll).
     - Nama deskriptif (`Gold vs US Dollar`, dll).
     - Tag badge kategori.
     - Quick live price jika tersedia dari `bridgeStatus.market_quotes`.
   - Hover effect lembut dan aksesibilitas keyboard (dapat di-Enter atau klik).

4. **Empty State & Custom Symbol Action**:
   - Jika pencarian tidak menemukan hasil di katalog terkurasi:
     - Tampilkan pesan informatif `t('market_no_pairs_found')`.
     - Sediakan tombol CTA instan: *"Analisis [QUERY] di TradingView"* (`market_custom_symbol_cta` dengan parameter `{ symbol: query }`) yang langsung membawa user ke State 2 menggunakan simbol yang diketik.

5. **Interaksi Pemilihan**:
   - Saat pengguna mengklik salah satu kartu pair atau CTA custom:
     - Set `selectedPair` ke objek atau string simbol yang dipilih.
     - Komponen secara reaktif berpindah merender State 2 (Chart View).

6. **Zero Backend Request**:
   - Hapus pemanggilan `api.getMarketQuotes()` (fallback lama) dan `api.setActiveMarketSymbol()` (kanal kontrol ticket 13-04). Data watchlist akun sepenuhnya berasal dari `bridgeStatus.market_quotes` yang sudah dipolling Dashboard tiap 10 detik. Konsekuensi yang disadari: memilih pair di Market tidak lagi menggeser simbol yang di-stream EA — chart ditarik browser langsung dari TradingView.

---

## Verification
```bash
npm --prefix apps/web run lint
npm --prefix apps/web run build
```
- Mengetik di search bar menyaring kartu pair secara instan.
- Memilih kategori menampilkan hanya pair dalam kategori tersebut.
- Simbol kustom yang tidak ada di katalog dapat langsung dibuka via tombol CTA.
- `oxlint` 0 warning.

**Hasil (2026-11-22):** `lint` 0 warning, `build` sukses. Verifikasi perilaku (search instan, filter kategori, CTA simbol kustom) memerlukan browser — lihat catatan gate di README fase.
