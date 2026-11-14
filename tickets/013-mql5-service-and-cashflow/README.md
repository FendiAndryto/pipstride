# Fase 013: MQL5 Background Service (.ex5), Cash Flow Isolation, & Dynamic Market

## Tujuan
Mengembangkan keandalan dan akurasi ekosistem Pipstride melalui 3 pilar:
1. **Sensor Terproteksi & Bebas Chart:** Mengonversi `PipstrideMonitor` dari EA (.mq5) yang terikat chart menjadi MQL5 Background Service biner (.ex5) dengan single input token.
2. **Isolasi Arus Kas (Withdrawal/Deposit):** Memisahkan deal saldo kas ke stream tersendiri sehingga penarikan dana tidak pernah masuk metrik trading, dan saldo/ekuitas dihitung jujur.
3. **Market Watchlist Dinamis:** Mengendalikan simbol yang dipantau langsung dari Web Dashboard dan membaca candle multi-timeframe (M5, M15, H1, H4) secara dinamis tanpa hambatan `Symbol Mismatch`.

Didefinisikan dalam spesifikasi: [`docs/specs/007-mql5-service-cashflow-and-dynamic-market.md`](../../docs/specs/007-mql5-service-cashflow-and-dynamic-market.md).

---

## Urutan Pengerjaan & Gate

Prasyarat: Fase 009 (Live Metrics Correctness), Fase 011 (Dashboard Polish), & Fase 012 (Public Registration Closure).

| Tiket | Fokus | Prasyarat | Membuka | Status |
|---|---|---|---|---|
| **01** | `01-mql5-service-refactor-and-ex5-build.md` | — | 02, 04 | `in_progress` |
| **02** | `02-cashflow-deal-classification-backend.md` | 01 | 03 | `in_progress` |
| **03** | `03-cashflow-journal-ui-and-frontend-parity.md` | 02 | — | `done` |
| **04** | `04-dynamic-market-symbols-and-multi-tf.md` | 01 | — | `in_progress` |
| **05** | `05-heartbeat-timeout-jitter-tolerance.md` | — | — | `done` |

**Jangan paralelkan 02 dan 04.** Keduanya mengedit `mt5-ea/PipstrideMonitor.mq5` dan harus me-rebuild `apps/web/public/PipstrideMonitor.ex5` + checksum di modal. Urutan yang direkomendasikan: `13-01 → 13-02 → 13-03 → 13-04`.

---

## Checklist Audit Keluar (Gate Fase 013)

**Sensor & distribusi**
- [x] `mt5-ea/PipstrideMonitor.mq5` memakai `#property service`, satu `input InpBridgeToken`, dan tidak lagi memakai `OnTimer`, `EventSetTimer`, `OnTradeTransaction`, `_Symbol`, atau `Comment()`.
- [ ] Sinkronisasi deal berjalan lewat polling diff di loop `OnStart()` (bukan event chart) — dibuktikan dengan trade baru muncul di jurnal ≤ 1 interval heartbeat.
- [x] Biner `PipstrideMonitor.ex5` terkompilasi (`compile.log`: 0 errors) dan ikut ter-build ke `apps/web/dist/`.
- [x] `.gitignore` mengecualikan `apps/web/public/PipstrideMonitor.ex5` dari aturan `*.ex5`.
- [x] `apps/web/public/PipstrideMonitor.mq5` sudah tidak ada/tidak bisa diunduh (404).
- [x] Checksum SHA-256 di `Mt5ConnectModal.jsx` = hash biner yang didistribusikan.
- [x] Modal memandu `MQL5/Services/` + **Add Service** + whitelist WebRequest (bukan "attach ke chart" / "Allow Algo Trading").

**Cash flow**
- [x] `GET /bridge/history` mengembalikan `trades[]` dan `cash_flow[]` terpisah; ticket cash flow tidak pernah muncul di `trades`.
- [ ] Tabel `cash_flow_deals` + migrasi Alembic ada; `python scripts/check_migrations.py` 0 drift.
- [x] Ingests idempoten (duplikat ticket tidak menghasilkan baris ganda) dan reset jurnal menghapus kedua tabel.
- [x] Unit test membuktikan 10 trade (9 win) + 3 penarikan tetap `trades=10`, `win_rate=90`, `net_profit` murni trading.
- [x] Ekuitas = `initial_deposit + Σ cash flow + Σ trade PnL`; drawdown tetap trade-only.
- [x] Jurnal menampilkan badge netral `WITHDRAWAL`/`DEPOSIT`, kolom lot & harga `-`, warna profit netral.
- [x] Kartu ringkasan menampilkan Net Trading PnL, Total Deposit, Total Penarikan.

**Market dinamis**
- [x] `PUT /api/v1/bridge/active-symbol` memakai JWT (`get_active_connection`), bukan `X-Bridge-Token`.
- [x] Heartbeat response memuat `active_market_symbol` + `watchlist`; sensor membangun candle M5/M15/H1/H4 untuk simbol tersebut.
- [x] `MarketTab.jsx` tidak lagi merender `symbol_mismatch`; state menunggu (`waiting_for_symbol`) dipisahkan dari "TF belum dikirim".

**Kualitas**
- [x] `pytest` penuh lulus; `vitest run` lulus; `import-linter` 6 kept/0 broken; `npm run lint:arch` 0 pelanggaran.
- [x] `node apps/web/scripts/check-i18n.cjs` lulus tanpa key hilang maupun key yatim.
- [x] `apps/web` lint + build bersih; marketing/admin tidak tersentuh.

**Sisa sebelum gate boleh ditutup:** dua butir di atas (latensi trade baru ≤1 heartbeat, drift migrasi) serta checklist manual MT5 di tiket 13-01/13-02/13-04 — semuanya butuh terminal MT5 atau PostgreSQL yang berjalan.
