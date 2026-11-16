# Fase 014: Dashboard Realized PnL Correctness, Net Capital Baseline, & Cash Flow Transparency

## Tujuan
Memperbaiki kalkulasi metrik finansial pada Dashboard dan Journal Pipstride:
1. **Realized P/L Murni di Dashboard:** Mengeliminasi distorsi formula `balance - deposit` sehingga top-up modal atau penarikan dana tidak lagi menghasilkan profit semu atau kerugian semu.
2. **Modal Bersih (*Net Invested Capital*):** Menampilkan posisi modal bersih riil ($\sum \text{Deposit} - \sum \text{Penarikan}$) pada kartu Saldo Dashboard menggantikan patokan satu kali setoran awal.
3. **Transparansi Arus Kas di Journal:** Menghilangkan kebingungan antara mutasi kas periode aktif (misal 30 hari) dengan akumulasi seumur hidup akun melalui label periode yang tegas dan penyelarasan baseline.

Didefinisikan dalam spesifikasi: [`docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md`](../../docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md).

---

## Urutan Pengerjaan & Gate

Prasyarat: Fase 013 (MQL5 Service & Cash Flow Isolation).

> **Gate belum terbuka (audit 2026-11-16):** Fase 013 masih `Berjalan` — 13-01, 13-02, dan 13-04 berstatus `in_progress`. Karena 14-01 bergantung pada kelengkapan data `cash_flow_deals` (13-02), jangan mulai 14-01 sebelum gate 013 ditutup atau ada keputusan eksplisit untuk menerima risiko data parsial (lihat guard baseline di tiket 14-01).

> **Keputusan (2026-11-16):** risiko data parsial diterima secara eksplisit; eksekusi 14-01 sampai 14-04 dilanjutkan dengan guard baseline pada 14-01 (baris deposit yang tidak cocok dengan `initial_deposit` sensor tetap dihitung sebagai funding tambahan). Gate Fase 013 tetap terbuka dan harus ditutup terpisah.

| Tiket | Fokus | Prasyarat | Membuka | Status |
|---|---|---|---|---|
| **01** | `01-backend-realized-pnl-and-net-capital.md` | — | 02 | `done` |
| **02** | `02-frontend-domain-and-pnl-parity.md` | 01 | 03 | `done` |
| **03** | `03-dashboard-ui-capital-and-pnl-display.md` | 02 | 04 | `done` |
| **04** | `04-journal-cashflow-labeling-and-clarity.md` | 03 | — | `done` |

Rekomendasi urutan eksekusi: `14-01 → 14-02 → 14-03 → 14-04`.

---

## Checklist Audit Keluar (Gate Fase 014)

**Backend & Metrik**
- [x] `GET /api/v1/bridge/status` mengembalikan `settled_pnl` murni dari akumulasi closed trades (`trade_repository.sum_profit_between`).
- [x] `net_capital` dikirim dalam `BridgeStatusResponse` dan merefleksikan `effective deposit + net funding setelah baseline deal` (tahan terhadap baris baseline yang belum ter-ingest).
- [x] Cabang offline/stale tetap mengembalikan `net_capital` (bukan `null`) dengan PnL `0.0`.
- [x] Akun dengan top-up tanpa aktivitas trading menghasilkan `settled_pnl = 0.00` dan `settled_pnl_percent = 0.0%`.
- [x] Akun dengan penarikan dana setelah profit trading mempertahankan `settled_pnl` positif yang akurat.
- [x] Assertion test lama yang mengunci formula `balance - deposit` sudah diperbarui (`test_connections.py` nilai `30.0` / `5_500.0` → trade-based; dua test fallback `pnl.test.js`).

**Frontend & UI**
- [x] `apps/web/src/domain/pnl.js` sinkron 1:1 dengan backend (lulus pengujian `pnl.test.js`), dan tidak ada fallback `balance - deposit`.
- [x] Kartu Saldo di Dashboard menampilkan **Modal Bersih** (`netCapital`) dan **P/L Riil Trading** (`settledPnl`) dengan label yang sesuai.
- [x] Kartu Ekuitas menampilkan **Total Hasil (Riil + Floating)** — label `home_realized_vs_initial` tidak lagi dipakai.
- [x] Kartu Arus Kas di Journal menyebut periode aktif di judul kartu (mis. `Total Deposit (30 hari terakhir)` vs `(semua waktu)`).
- [x] Caption baseline pada `DrawdownCard.jsx` memakai `net_capital`; perhitungan drawdown tidak berubah (tetap trade-only).

**Kualitas & Verifikasi**
- [x] `pytest` penuh lulus (baseline 205, bertambah dengan test baru).
- [x] `vitest run` di `apps/web` lulus (baseline 99 test / 7 file).
- [x] `import-linter` 6 kept, 0 broken.
- [x] `npm run lint:arch` 0 pelanggaran.
- [x] `node apps/web/scripts/check-i18n.cjs` lulus paritas EN/ID + tidak ada key terpakai yang tak terdefinisi (script **tidak** mendeteksi orphan; cek manual key yang dihapus).
- [x] `apps/web` build sukses menghasilkan bundle `dist/`.

## Catatan Implementasi (2026-11-16)

Keempat tiket selesai dan gate fase ditutup. Gate prasyarat Fase 013 masih terbuka saat eksekusi dimulai, sehingga risiko data parsial diterima secara eksplisit dan dimitigasi oleh guard baseline di 14-01: baris deposit paling awal hanya dikecualikan dari delta kas bila nominalnya cocok dengan `initial_deposit` sensor (toleransi 0.01), sehingga baseline yang belum ter-ingest tetap dihitung sebagai funding tambahan, bukan hilang.

Bukti verifikasi akhir:
- `pytest` penuh: **209 passed, 1 warning** (baseline 205 + test baru 14-01).
- `lint-imports`: **6 kept, 0 broken**.
- `vitest`: **7 file / 103 test passed** (baseline 99 + test baru 14-02).
- `oxlint`: **0 warning, 0 error**.
- `check-i18n.cjs`: **500 key per bahasa, 440 static key resolved** (script tidak mendeteksi orphan; key `home_initial_balance`, `home_all_time_pl`, `home_realized_vs_initial`, `journal_stat_total_deposits`, `journal_stat_total_withdrawals`, `journal_stat_net_funding` dihapus manual dari EN/ID).
- `vite build`: sukses (`dist/assets/index-*.js` 432.68 kB, gzip 123.38 kB).
- `lint:arch`: **0 violations (61 modul / 174 dependencies)**.
