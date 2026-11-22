# Ticket 17-04: Bilingual Parity & Translations Dictionary

**Status:** done  
**Prasyarat:** 17-03  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/013-market-technical-analysis-chart.md`](../../docs/specs/013-market-technical-analysis-chart.md) §3.4

---

## Goal
Menyelaraskan kamus bahasa `apps/web/src/constants/translations.js` untuk mendukung seluruh teks pada antarmuka pencarian pair dan chart TradingView, membersihkan key terjemahan yang sudah usang dari komponen lama, serta memastikan audit paritas `check-i18n.cjs` lulus 100%.

---

## Scope & Technical Details

1. **Penambahan Key Terjemahan Baru (`translations.js`)**:
   Tambahkan key baru untuk Bahasa Inggris (`en`) dan Bahasa Indonesia (`id`):
   - `market_search_placeholder`:
     - ID: "Cari pair atau instrumen... (misal XAUUSD, EURUSD, BTC)"
     - EN: "Search pair or instrument... (e.g. XAUUSD, EURUSD, BTC)"
   - `market_category_all`:
     - ID: "Semua"
     - EN: "All"
   - `market_category_forex`:
     - ID: "Forex"
     - EN: "Forex"
   - `market_category_metals`:
     - ID: "Logam & Komoditas"
     - EN: "Metals & Commodities"
   - `market_category_crypto`:
     - ID: "Kripto"
     - EN: "Crypto"
   - `market_category_indices`:
     - ID: "Indeks"
     - EN: "Indices"
   - `market_category_account`:
     - ID: "Watchlist MT5"
     - EN: "MT5 Watchlist"
   - `market_btn_change_pair`:
     - ID: "Ganti Pair"
     - EN: "Change Pair"
   - `market_no_pairs_found`:
     - ID: "Tidak ada pair yang cocok"
     - EN: "No matching pairs found"
   - `market_custom_symbol_cta`:
     - ID: "Analisis {symbol} di TradingView"
     - EN: "Analyze {symbol} on TradingView"
   - `market_chart_powered_by`:
     - ID: "Data & Chart interaktif disediakan oleh TradingView"
     - EN: "Interactive data & chart powered by TradingView"
   - `market_chart_loading`: status memuat chart.
   - `market_chart_error`: pesan saat chart gagal dimuat.
   - `market_chart_retry`: label tombol untuk mencoba lagi.
   - **Nama instrumen** (dipakai `nameKey` katalog, wajib paritas EN/ID):
     - `market_symbol_silver`: "Perak / US Dollar" / "Silver / US Dollar"
     - `market_symbol_oil`: "Minyak Mentah / US Dollar" / "Crude Oil / US Dollar"
     - `market_symbol_aussie`: "Dolar Australia / US Dollar" / "Australian Dollar / US Dollar"
     - `market_symbol_loonie`: "US Dollar / Dolar Kanada" / "US Dollar / Canadian Dollar"
     - `market_symbol_swissy`: "US Dollar / Franc Swiss" / "US Dollar / Swiss Franc"
     - `market_symbol_kiwi`: "Dolar Selandia Baru / US Dollar" / "New Zealand Dollar / US Dollar"
     - `market_symbol_ether`: "Ether / US Dollar" / "Ether / US Dollar"
     - `market_symbol_solana`: "Solana / US Dollar" / "Solana / US Dollar"
     - `market_symbol_dow`: "Dow Jones 30" / "Dow Jones 30"
     - `market_symbol_nasdaq`: "Nasdaq 100" / "Nasdaq 100"
     - `market_symbol_sp500`: "S&P 500" / "S&P 500"
   - Key `market_symbol_gold/euro/pound/yen/bitcoin` yang lama tetap dipakai katalog.

2. **Pembersihan Key Usang (Clean Deprecated Keys)**:
   - Evaluasi dan bersihkan key yang secara eksklusif hanya dipakai oleh komponen lama yang sudah dibongkar (range bar, bias struktur, timeframe M5/M15/H1/H4, `market_tf_*`, `market_struct_*`).
   - **Jangan hapus** `market_waiting_feed` — masih dipakai `HomeTab.jsx:587`. Verifikasi tiap kandidat dengan grep sebelum dihapus; `check-i18n.cjs` hanya memeriksa paritas + key terpakai yang tidak terdefinisi, jadi key mati tidak akan menggagalkan gate.

3. **Verifikasi Skrip Paritas**:
   - Jalankan `node apps/web/scripts/check-i18n.cjs` untuk memastikan kedua bahasa memiliki jumlah key yang identik dan tidak ada key dinamis yang terlewat.

---

## Verification
```bash
node apps/web/scripts/check-i18n.cjs
npm --prefix apps/web test
npm --prefix apps/web run build
```
- Paritas 100% per bahasa (`i18n OK — N keys per language`).
- `vitest` suite tetap hijau 100%.
- Build produksi web berhasil tanpa error.

**Hasil (2026-11-22):** `i18n OK — 498 keys per language, 430 static keys resolved.`; `vitest` 117 pass; `build` sukses. 40 key usang dari komponen Market lama dihapus; `market_waiting_feed` dipertahankan untuk `HomeTab`.
