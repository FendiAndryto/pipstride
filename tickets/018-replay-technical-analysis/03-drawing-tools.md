# Ticket 18-03 — Drawing dan pengelolaan objek Replay

**Status:** selesai  
**Spesifikasi:** [SPEC-014](../../docs/specs/014-replay-technical-analysis-chart.md)

Tambahkan ray, garis vertikal, channel paralel, Fibonacci extension, teks, dan panah. Sediakan snap OHLC serta kontrol gaya, duplikasi, visibilitas, kunci, hapus, undo, dan redo. Pertahankan format kompatibel untuk drawing lama dan pisahkan histori drawing dari simulasi.

**Verification:** Jalankan `replay-drawings.test.js` dan cek placement, gaya, undo, redo, serta interaksi keyboard dan sentuh.

Tes regresi lulus. Chrome headless lulus placement, pengeditan teks, undo, dan redo di desktop, serta placement melalui emulasi sentuh.
