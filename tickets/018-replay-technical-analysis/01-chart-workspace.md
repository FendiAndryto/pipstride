# Ticket 18-01 — Workspace chart Replay

**Status:** selesai  
**Spesifikasi:** [SPEC-014](../../docs/specs/014-replay-technical-analysis-chart.md)

Tambahkan pemilih tipe chart, pengaturan skala dan grid, OHLC crosshair, reset tampilan, dan ekspor PNG ke terminal. Gunakan candle sumber untuk simulasi. Saat mengganti timeframe pada periode yang sama, tampilkan sampai candle lengkap terakhir pada waktu replay tersebut.

**Verification:** Jalankan tes `switches chart types` dan cek pergantian timeframe, reset, dan PNG di browser dengan candle arsip.

Chrome headless lulus pergantian lima tipe chart dan empat skala, M5 ke M15 dan H1, serta pembuatan PNG setelah rewind. Penyimpanan unduhan ke disk belum diuji.
