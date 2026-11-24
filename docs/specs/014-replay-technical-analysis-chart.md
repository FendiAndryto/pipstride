# SPEC-014 — Analisis teknikal di chart Replay

Status **Disetujui, jalur Replay native**

## Tujuan

Pengguna bisa menganalisis XAUUSD di Replay dengan alur kerja yang familiar dari tab Market. Pengguna memilih tipe chart dan timeframe, mencari indikator, menandai chart, lalu menjalankan simulasi pada candle historis milik Pipstride.

Market memakai widget TradingView dengan feed TradingView. Replay memakai Lightweight Charts dan arsip candle XAUUSD milik Pipstride. Widget Market tidak menyediakan datafeed kustom. Advanced Charts resmi mendukung datafeed kustom, tetapi akses library perlu persetujuan TradingView dan lisensi gratisnya mensyaratkan penggunaan publik. Dashboard Pipstride memerlukan login. Advanced Charts juga tidak menyertakan Bar Replay atau Pine Script. [Perbandingan widget dan library](https://www.tradingview.com/charting-library-docs/latest/resources/Frequently-Asked-Questions/) · [Ketentuan Advanced Charts](https://www.tradingview.com/charting-library-docs/latest/introduction/) · [Akses library](https://www.tradingview.com/charting-library-docs/latest/quick-start/)

## Usulan

Kembangkan terminal Replay yang sudah ada dengan antarmuka khas Pipstride. Gunakan tab Market sebagai acuan untuk kemampuan chart dan alur kerja, dengan kontrol playback dan simulasi yang tetap tersedia bersama chart. Dokumentasi widget Market mencantumkan lebih dari 80 indikator, lebih dari 100 drawing, skala persentase, dan perbandingan simbol. Daftar di bawah menetapkan cakupan awal yang disetujui. Katalog penuh dan perbandingan simbol berada di luar cakupan ini. [Kemampuan widget Market](https://www.tradingview.com/widget-docs/widgets/charts/legacy-advanced-chart/demos/technical-analysis/)

| Bagian | Target |
| --- | --- |
| Chart | Candlestick, OHLC bar, line, area, Heikin Ashi, pengaturan grid dan skala, reset tampilan, fullscreen, serta ekspor gambar dengan overlay yang sedang terlihat. |
| Drawing | Pertahankan horizontal line, rectangle, trendline, Fibonacci retracement, ruler, serta posisi simulasi. Tambahkan ray, vertical line, parallel channel, Fibonacci extension, teks dan panah. Sediakan snap ke OHLC, edit gaya, duplikasi, sembunyikan, kunci, hapus, serta undo dan redo untuk drawing. |
| Indikator | Pertahankan SMA, EMA, Supertrend, Bollinger Bands, VWAP, RSI, MACD, dan ATR. Tambahkan volume, Stochastic, ADX/DMI, Donchian, Ichimoku, dan OBV. Sediakan pencarian, pengaturan per instance, lebih dari satu instance dengan parameter berbeda, dan pengelolaan overlay atau panel indikator. |
| Replay | Pertahankan pemilihan periode, play/pause, speed, step, seek, rewind, serta simulasi long/short. Semua kontrol analisis bisa dipakai saat pause dan saat playback berjalan. |

Pine Script, skrip komunitas, alert berbasis server, serta data live atau simbol di luar arsip memerlukan cakupan tersendiri. Jika akses resmi Advanced Charts tersedia untuk penggunaan Pipstride, evaluasi opsi itu dengan kontrol playback Pipstride dan datafeed kustom sebelum mengganti mesin chart.

## Data dan penyimpanan

- Terminal memakai manifest dan arsip gzip dari `/replay/data/`. Pilihan timeframe mengikuti cakupan periode di manifest. Saat berganti timeframe pada periode yang sama, gunakan candle lengkap terakhir yang berakhir sebelum atau tepat pada posisi playback. Jika timeframe tujuan belum punya candle lengkap pada posisi itu, minta pengguna melanjutkan replay. Nilai volume mengikuti jenis volume dataset sumber.
- Mesin replay menjadi sumber kebenaran untuk posisi playback dan OHLC eksekusi simulasi. Tipe chart sintetis seperti Heikin Ashi mengubah presentasi. Indikator mengikuti OHLC sumber. Nilai hasil kalkulasi, OHLC pada crosshair, dan ekspor chart dibatasi sampai posisi playback. Kalkulasi yang membutuhkan pergeseran visual seperti Ichimoku harus mempertahankan batas akses ke data candle yang sudah terbuka.
- Drawing tetap memakai waktu UTC dan harga sebagai koordinat. Tambah versi data untuk metadata seperti gaya dan status kunci, dengan nilai default untuk drawing lama. Preferensi indikator memakai ID instance yang stabil dan memigrasikan konfigurasi indikator lama saat dibaca. Preferensi indikator berlaku per akun. Drawing tersimpan per akun, simbol, dan periode.
- Gunakan lifecycle iframe, data loader, dan mesin simulasi yang sudah tersedia. Pemilihan tipe chart atau perubahan indikator tidak mereset transaksi simulasi maupun posisi playback. Urungkan perubahan drawing secara independen dari rewind simulasi.

## Kriteria penerimaan

1. Buka XAUUSD di Replay melalui dashboard, pilih periode, atur tipe chart, pasang dua EMA dengan periode berbeda, tambahkan RSI dan satu drawing, lalu jalankan replay. Toolbar, crosshair, indikator, dan drawing tetap bisa dipakai di desktop dan layar sentuh.
2. Bandingkan nilai OHLC dan indikator pada posisi yang sama setelah langkah maju, seek, dan rewind. Uji bahwa candle yang belum terbuka tidak muncul pada chart, tooltip, panel indikator, agregasi timeframe, maupun gambar yang diekspor.
3. Ganti tipe chart dan timeframe saat ada posisi simulasi. Periksa bahwa timestamp replay, P&L, dan harga pemicu order simulasi tetap sesuai aturan mesin serta drawing tetap terikat pada waktu dan harga. Uji pergantian bulan dan batas cakupan dataset.
4. Muat kembali terminal dengan data penyimpanan lama dan baru. Periksa drawing, preferensi indikator, isolasi akun, dan pemulihan konfigurasi. Uji drawing yang disembunyikan atau dikunci, serta urungkan dan ulangi perubahan drawing.
5. Jalankan lint, test, dan build web. Tambahkan tes regresi untuk kalkulasi indikator baru, migrasi penyimpanan, dan kebocoran data setelah rewind. Verifikasi manual di browser untuk interaksi chart, ekspor, keyboard, dan sentuh.
