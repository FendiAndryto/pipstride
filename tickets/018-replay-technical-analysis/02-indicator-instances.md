# Ticket 18-02 — Katalog dan instance indikator Replay

**Status:** selesai  
**Spesifikasi:** [SPEC-014](../../docs/specs/014-replay-technical-analysis-chart.md)

Tambahkan indikator volume, Stochastic, ADX/DMI, Donchian, Ichimoku, dan OBV. Sediakan katalog yang bisa dicari, konfigurasi dan panel per instance, serta migrasi preferensi lama per akun. Batasi kalkulasi dan rendering ke candle yang sudah ditampilkan.

**Verification:** Jalankan `replay-indicators.test.js` dan cek dua EMA dengan periode berbeda, panel terpisah, pengaturan ulang, dan rewind di browser.

Tes regresi lulus. Chrome headless lulus pengeditan EMA terpisah, panel RSI, dan rendering Ichimoku Cloud.
