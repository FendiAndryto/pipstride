# Ticket 17-03: TradingView Advanced Real-Time Chart Container & Embed (State 2)

**Status:** done  
**Prasyarat:** 17-02  
**Membuka:** 17-04  
**Spesifikasi:** [`docs/specs/013-market-technical-analysis-chart.md`](../../docs/specs/013-market-technical-analysis-chart.md) §3.3 (State 2)

---

## Goal
Mengimplementasikan kontainer TradingView Advanced Real-Time Chart widget berkinerja tinggi pada State 2 di `MarketTab.jsx`, lengkap dengan header navigasi (`← Ganti Pair`), tema gelap menyatu dengan Pipstride, serta isolasi lifecycle React tanpa kebocoran memori.

---

## Scope & Technical Details

1. **Header Navigasi Chart (`MarketTab.jsx`)**:
   - Di render di atas chart:
     - Tombol kembali: `← Ganti Pair` (`market_btn_change_pair`), dengan icon `ArrowLeft` dari `lucide-react`.
   - Toolbar TradingView menampilkan simbol yang sedang aktif, termasuk setelah user menggantinya di widget.
   - Saat chart dibuka, fokus keyboard berpindah ke tombol Ganti Pair. Saat kembali, fokus berpindah ke input pencarian.

2. **Kontainer & Skrip Widget TradingView**:
   - Disediakan subkomponen pembungkus `TradingViewChart.jsx` yang menangani lifecycle inject widget TradingView.
   - Script resmi TradingView: `https://s3.tradingview.com/tv.js`.
   - Pola aman React:
     - Gunakan `useEffect` yang memastikan script `tv.js` dimuat satu kali secara idempotent (module-level promise + cek `window.TradingView`).
     - **StrictMode aktif** (`src/main.jsx`) sehingga effect berjalan dua kali di dev: pasang flag `cancelled` yang diperiksa *setelah* `await` script, kalau tidak widget kedua dibuat ke container yang sudah dibersihkan (iframe orphan/duplikat).
     - Inisialisasi widget via `new window.TradingView.widget({ ... })`.
     - Konfigurasi parameter widget:
       - `container_id`: ID kontainer unik per instance (bukan konstanta global).
       - `autosize`: `true`.
       - `symbol`: Ticker dari katalog, resolusi watchlist MT5, atau simbol dari pencarian bebas.
       - `interval`: `"15"` (default M15).
       - `timezone`: `"Etc/UTC"`.
       - `theme`: `"dark"`.
       - `style`: `"1"` (Candles).
       - `locale`: bahasa aktif dari `LanguageContext` (`en` atau `id`).
       - `toolbar_bg`: `"#0a1419"`.
       - `enable_publishing`: `false`.
       - `allow_symbol_change`: `true`.
       - `hide_side_toolbar`: `false` (memastikan drawing tools aktif).
       - `save_image`: `true`.
       - `studies`: `[]` — default clean; RSI/MACD membuat area chart menyusut di mobile dan tetap bisa ditambahkan user dari toolbar indikator.
     - Selama memuat, tampilkan status. Jika skrip gagal atau iframe tidak selesai dimuat sebelum batas waktu, tampilkan pesan gagal dan tombol Coba lagi.
     - Saat keluar atau mencoba lagi, bersihkan kontainer dan abaikan hasil dari pemuatan sebelumnya.

3. **Content Security Policy (`apps/web/nginx.conf`)**:
   - CSP produksi saat ini (`script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com`, tanpa `frame-src`) memblokir `s3.tradingview.com` dan iframe `*.tradingview.com`. Di dev (Vite) chart tampil, di produksi blank.
   - Wajib memperluas `$csp`: `script-src` += `https://s3.tradingview.com`, `frame-src 'self' https://*.tradingview.com`, `connect-src` += `https://*.tradingview.com`, `img-src` += `https://*.tradingview.com`. Directive `frame-src` mempertahankan `'self'` untuk terminal Replay. Variabel `$csp` dipakai ulang oleh location block lain.

4. **Responsif & Layout Styling**:
   - Kontainer chart mengisi sisa tinggi layar viewport dengan tinggi deterministik (`calc(100vh - 250px)` + `min-height: 480px`; mobile `min-height: 70vh`). Jangan pakai `height: 100%` — parent tidak punya tinggi.
   - Catatan: semua tab selalu mounted dan tab tidak aktif hanya `display: none` (`.page-container`), sehingga kontainer bisa sempat berukuran 0; tinggi deterministik mencegah chart kolaps permanen saat tab kembali dibuka.
   - Border halus `1px solid var(--line)` dengan border-radius rapi.
   - Di tampilan mobile, layout menyesuaikan tanpa overflow horizontal.

---

## Verification
```bash
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web run build
```
- Memilih pair membuka chart TradingView dengan benar dan cepat.
- Drawing tools dan indikator teknikal berfungsi penuh.
- Mengklik `← Ganti Pair` kembali ke direktori tanpa delay atau error di console.
- Mengganti tab (misal ke Journal lalu balik ke Market) tidak membuat chart menduplikasi dirinya sendiri.
- `lint` dan `lint:arch` bersih 0 violations.

**Hasil (2026-11-22):** `lint` 0 warning, `lint:arch` 0 violations (64 modul), `build` sukses; CSP `apps/web/nginx.conf` diperluas. Render chart, drawing tools, dan perilaku ganti tab **belum diverifikasi di browser** — butuh cek manual (dev server + build produksi).
