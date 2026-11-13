# Fase 011: Dashboard Polish & Data Consistency

## Tujuan
Menuntaskan perbaikan visual, format mata uang dinamis (`USC` / `USD`), eliminasi bug minus ganda, sinkronisasi state ekuitas real-time, dan pembersihan sisa branding warisan di antarmuka web sebelum pembukaan tahap penagihan (Open Billing).

Didefinisikan dalam spesifikasi: [`docs/specs/005-dashboard-currency-equity-branding-fixes.md`](../../docs/specs/005-dashboard-currency-equity-branding-fixes.md).

---

## Urutan Pengerjaan & Gate

Prasyarat: Fase 006 (Web Feature Split) & Fase 008 (Web Test Harness).

| Tiket | Fokus | Prasyarat | Membuka | Status |
|---|---|---|---|---|
| **01** | `01-currency-formatting-and-double-minus-fix.md` | — | 02 | `done` |
| **02** | `02-journal-currency-propagation.md` | 01 | — | `done` |
| **03** | `03-home-equity-live-state-synchronization.md` | — | — | `done` |
| **04** | `04-header-branding-cleanup.md` | — | — | `done` |

---

## Checklist Audit Keluar (Gate Fase 011)

Sebelum menandai fase ini selesai (`done`):
- [x] `npm --prefix apps/web test` lulus semua test (termasuk unit test baru untuk `formatCurrency` dan `formatSignedMoney` dengan multi-currency & guard null). **6 files / 88 tests** (dari 69).
- [x] `npm --prefix apps/web run lint` keluar 0 warning.
- [x] `npm --prefix apps/web run lint:arch` keluar 0 violation (59 modules, 170 dependencies).
- [x] `npm --prefix apps/web run build` menghasilkan bundle produksi tanpa error (1979 modules).
- [x] Tidak ada lagi simbol `$` yang ter-hardcode pada nominal akun non-USD (saldo, ekuitas, P/L, gross profit/loss, average win/loss, trade table). Catatan: Simbol `$` pada kuotasi instrumen komoditas/kripto (Gold XAU, Bitcoin BTC) di `MarketTab` dan `HomeTab:557` adalah harga acuan pasar global USD yang sah dan dikecualikan.
- [x] Tidak ada tampilan angka berformat minus ganda (seperti `−$-1009.00`).
- [x] Angka kartu *Account Equity*, teks `Actual Equity:` di bawah grafik, dan koordinat ujung kurva SVG selalu sinkron dengan state live.
- [x] Markup dan CSS terbebas dari identitas lama `.tradegear-header`.
- [x] `node apps/web/scripts/check-i18n.cjs` tetap `491 keys per language` (tidak ada key baru yang yatim).

---

## Catatan Implementasi (2026-11-13)

Fase selesai dan gate ditutup. Detail penting untuk audit:

- **`formatSignedMoney` mendapat parameter ketiga `fractionDigits`.** Badge kalender butuh `0` desimal
  (`+USC 25`) karena lebar sel ±40px dengan `overflow: hidden`; tooltip tetap 2 desimal.
- **Minus ganda dibereskan dengan satu formatter, bukan `Math.abs` + `-` literal.** Draf awal tiket
  menyarankan `-${formatCurrency(Math.abs(gross_loss), currency)}`; itu justru menghasilkan
  `--USC 1,009.00`. Implementasi akhir memakai helper `formatGrossLoss` di `HomeTab.jsx` yang
  merender satu nilai bertanda, dengan cabang khusus agar loss nol membaca `+USC 0.00`.
- **Equity live**: `liveEquity` (`metrics.equity ?? null`) dibaca di luar `useMemo` dan masuk dependency
  list. Titik terakhir `points` di-override ke `currentVal` agar ujung kurva SVG sama dengan kartu.
  `oxlint` di repo ini **memang** punya `exhaustive-deps` aktif (klaim di draf tiket bahwa tidak ada
  ternyata salah) — justru rule itu yang menangkap `equity` sebagai dependency basi.
- **Komentar tema di `index.css:14`** (*"TradeGear dark-emerald theme"*) sengaja tidak diubah: itu nama
  tema desain, bukan selector. Semua 5 selector `.tradegear-header` sudah menjadi `.pipstride-header`.

