# Fase 009 — Live Metrics Correctness (Hotfix sebelum 007)

## Tujuan
Memperbaiki tiga metrik yang naik ke produksi dalam keadaan salah atau tidak lengkap:
daily drawdown yang tidak memakai hari broker dan tidak pernah menangkap intraday,
drawdown keseluruhan yang tidak pernah dihitung, dan market structure yang hanya
menyediakan dua timeframe karena EA tidak mengirim H1/H4.

Referensi: `docs/specs/003-live-metrics-correctness.md`.

## Prasyarat (kriteria masuk)
- Fase 005 selesai (`domain/` + `infrastructure/repositories` sudah ada).
- Fase 006 selesai (`apps/web/src/domain/` + `features/profile/` sudah ada).
- Fase 008 selesai (vitest menjaga paritas `domain/`).

## Kenapa sebelum 007
007 menambah permukaan admin di atas angka yang masih salah. Memperbaiki metrik
dulu membuat 007 tidak mewarisi bug, dan tidak ada perubahan kontrak API yang
breaking (semua field baru punya default).

## Tiket
1. `01-daily-drawdown-broker-day.md` — boundary hari broker, anchor roll-forward, max intraday.
2. `02-overall-drawdown-and-single-formula.md` — peak-to-trough **di halaman Journal** + hapus rumus cadangan di Home/Profile.
3. `03-market-structure-timeframes.md` — M5/M15/H1/H4 dari EA sampai MarketTab.

Urutan wajib: **01 → 02 → 03**.

## Gate (checklist audit keluar)
- [x] `GET /bridge/risk` memakai boundary tengah malam **waktu broker**, bukan UTC.
- [x] Floating loss saat pergantian hari tidak menghasilkan `daily_drawdown_percent > 0`.
- [x] Snapshot ≤ boundary di-roll-forward dengan trade; sumber anchor dilaporkan di
      `daily_anchor_source` (termasuk rung `session_start` saat EA baru hidup hari itu).
- [x] `daily_max_drawdown_percent` menahan drawdown intraday dan **itulah** yang menggerakkan
      `is_alert_active`.
- [x] `overall_drawdown_percent` + `max_drawdown_percent` (peak-to-trough) tersedia dan dipakai
      kartu **Drawdown di halaman Journal**; `initial_deposit` turun menjadi baris pembanding.
- [x] Nol rumus drawdown lokal di `apps/web/src` — `dailyDrawdownFallback` dan
      `deriveDrawdownWatch` dihapus; `grep` mengembalikan 0 hasil (hanya komentar riwayat).
- [x] Market structure menampilkan M5/M15/H1/H4; TF tanpa data = state jujur, tanpa angka fabrikasi.
- [x] Section "Risk Watchdog" di Profile dihapus; `margin_level` tetap tampil di kartu Active Account.
- [x] `is_data_available=false` saat tidak ada dasar equity sama sekali, sehingga UI menampilkan state
      "belum tersedia" alih-alih 0,00% yang terlihat aman.
- [x] `mt5-ea/PipstrideMonitor.mq5` dan `apps/web/public/PipstrideMonitor.mq5` identik.
- [x] `pytest` + `lint-imports` + `npm test` + `lint` + `lint:arch` + `build` + `check-i18n.cjs` hijau.

## Dampak
- **Kontrak API:** aditif. Bundle web lama tetap jalan (field baru punya default).
- **Operasional:** user harus **unduh ulang EA** agar H1/H4 muncul. Token & preset tidak berubah.
- **Egress:** +≈4,5 KB per heartbeat (dua array candle HTF 24 bar).
- **Perilaku alert:** alert harian kini menahan nilai maksimum sampai pergantian hari, jadi lebih
  sulit "hilang" saat pasar pulih. Ini perubahan yang diinginkan, bukan regresi.
- **Tata letak:** kartu drawdown pindah dari Profile ke Journal (tepat setelah KPI cards). Profile
  kembali murni ke koneksi/akun/email/password.

## Catatan lingkup
- Tetap read-only (ADR 0004). Tidak ada order, close, atau modifikasi SL/TP.
- Candle tetap hanya untuk simbol chart; multi-simbol di luar lingkup.
- Retensi snapshot 180 hari (ADR 0005) tidak berubah.

## Status fase: **done**

Hasil verifikasi akhir (2026-11-05):
- `pytest` — **121 passed** (sebelum fase ini 104).
- `lint-imports` — **6 kept, 0 broken**.
- `npm --prefix apps/web test` — **4 files, 57 tests passed**.
- `npm --prefix apps/web run lint` — 0 warning; `lint:arch` — no violations.
- `npm --prefix apps/web run build` — 1976 modules, exit 0.
- `node apps/web/scripts/check-i18n.cjs` — `i18n OK — 476 keys per language`.
- `Compare-Object` dua file EA — **IDENTICAL**.

### Temuan review sendiri (sebelum commit)

Review independen (`oracle`) tidak bisa dijalankan karena kuota habis, jadi diff diperiksa manual.
Tiga lubang ditemukan dan sudah ditutup:

1. **`is_data_available` tidak ada.** Bridge mati → `metrics=None` → anchor `None` → semua angka nol
   dan `is_alert_active=false`. UI akan menampilkan **0,00%** seolah aman. Sekarang response membawa
   `is_data_available=false` dan `drawdownView` memaksa `available=false`, jadi kartu menampilkan
   state "belum tersedia". Dikunci dua tes baru (backend + `pnl.test.js`).
2. **Pesan salah untuk TF tanpa data.** Semua TF jadi "unavailable" ketika simbol chart MT5 berbeda
   dari simbol yang dipilih, dan UI menyarankan "unduh ulang EA" — diagnosis yang salah. Sekarang
   `tfAvailability` membedakan `symbol_mismatch` / `not_streamed` / `ok` dengan pesan dan tooltip
   masing-masing.
3. **Komentar `broker_offset` menyesatkan.** Komentar lama menyiratkan cache mencegah boundary
   "jumpy", padahal cache hanya terpakai saat `metrics=None`. Komentar diperbaiki agar menyebut alasan
   sebenarnya: bridge yang diam tidak boleh tiba-tiba memakai UTC dan menggeser boundary 2-3 jam.

Fase 007 (admin console) sekarang boleh dimulai.
