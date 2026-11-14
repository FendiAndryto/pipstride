# SPEC-008: Cash-Flow-Neutralized Drawdown Calculation (Trade-Only Risk Watchdog)

**Status:** approved  
**Prioritas:** High (Integritas Metrik Risiko & Eliminasi Pelanggaran Drawdown Palsu)  
**Referensi:** ADR 0004 (Strictly Read-Only), ADR 0009 (Layered Architecture), SPEC-003 (Broker-Day Daily Drawdown & Peak-to-Trough Overall), SPEC-007 (Cash Flow Isolation)

---

## 1. Problem Statement

Pada implementasi SPEC-007 (Fase 013 Tiket 02 & 03), transaksi arus kas (`DEAL_TYPE_BALANCE` ➔ `DEPOSIT` & `WITHDRAWAL`) telah berhasil diisolasi dari tabel posisi trading (`trades` vs `cash_flow_deals`), Trade Table telah menampilkan baris kas netral, dan kurva ekuitas (`get_equity_curve`) telah merefleksikan penarikan sebagai *step down*.

Namun, **modul evaluasi risiko (`bridge_status_service.get_daily_anchor`, `get_daily_trough`, `get_overall_drawdown` dan `app/domain/policies.py`) yang dibangun pada Fase 009 (SPEC-003) belum disesuaikan terhadap data arus kas.** 

Hal ini menimbulkan tiga anomali kritis:

### P1 — Penarikan Dana (Withdrawal) Terbaca Sebagai Kerugian Trading (*False Daily Drawdown*)
1. **Mekanisme Bug:**
   - Anchor ekuitas harian (`anchor["equity"]`) ditetapkan saat pergantian hari broker (00:00 broker time) atau saat sesi monitoring dibuka (misal $1,925.39).
   - Ketika pengguna melakukan penarikan dana sebesar $1,700 pada siang/sore hari, saldo dan ekuitas di terminal MT5 langsung berkurang menjadi $225.39.
   - Endpoint risiko (`GET /api/v1/bridge/risk`) mengevaluasi drawdown dengan rumus:
     $$\text{Daily Drawdown \%} = \frac{\text{Anchor Equity} - \text{Live Equity}}{\text{Anchor Equity}} \times 100\%$$
     $$\text{Daily Drawdown \%} = \frac{1925.39 - 225.39}{1925.39} \times 100\% = \mathbf{88.29\%}$$
2. **Dampak:** Akun langsung dilaporkan mengalami **breach / pelanggaran batas harian** (melebihi limit 3%), status risiko menjadi merah/waspada, dan notifikasi peringatan drawdown palsu terpicu, padahal pengguna tidak mengalami kerugian trading sama sekali.

### P2 — Penambahan Modal (Deposit) Menutupi Kerugian Trading (*Hidden Drawdown*)
1. **Mekanisme Bug:**
   - Jika ekuitas awal hari adalah $1,000, lalu pengguna mendepositkan dana segar $500 di tengah hari (ekuitas menjadi $1,500).
   - Pengguna kemudian mengalami kerugian trading sebesar $150 (ekuitas turun menjadi $1,350).
   - Karena $1,350 masih lebih tinggi dari anchor awal hari ($1,000), sistem melaporkan Daily Drawdown = **0.0%**.
2. **Dampak:** Kerugian trading riil sebesar $150 (10% dari modal aktif saat itu) tidak terdeteksi oleh sistem pengawas risiko.

### P3 — Overall Drawdown Mengukur Penarikan Kas Sebagai Penurunan Puncak (*False Peak-to-Trough*)
1. Di `get_overall_drawdown()`, puncak ekuitas (`peak_equity`) direkonstruksi dari `deposit + running trade profit`. Nilai ini tidak mengurangkan penarikan kas.
2. Nilai puncak tersebut kemudian dibandingkan dengan `current_equity` live yang sudah terpotong oleh penarikan kas pengguna.
3. Selisih penarikan kas terbaca permanen sebagai *peak-to-trough overall drawdown*.

---

## 2. Keputusan Desain (Design Decisions)

### D1 — Prinsip Fundamental: Drawdown adalah Metrik Murni Risiko Trading (*Trade-Only*)
* Drawdown dirancang khusus untuk memantau performa dan batasan kerugian trading (prop firm rule / money management).
* Arus kas masuk (`DEPOSIT`) dan arus kas keluar (`WITHDRAWAL`) adalah mutasi modal eksternal (*capital transfers*), bukan hasil transaksi pasar (*market performance*).
* Segala bentuk mutasi arus kas wajib dinetralkan dari perhitungan drawdown harian maupun akumulatif.

### D2 — Formula Daily Drawdown Dinetralkan Arus Kas (*Cash-Flow-Neutralized Daily Drawdown*)
Untuk mengukur penurunan ekuitas yang murni disebabkan oleh hasil trading hari ini:

1. **Hitung Arus Kas Bersih Hari Ini ($\Delta CF_{\text{today}}$):**
   Ambil seluruh mutasi kas pada akun sejak boundary pergantian hari broker (`boundary` 00:00 UTC broker time):
   $$\Delta CF_{\text{today}} = \sum_{\text{sejak boundary}} \text{amount}$$
   *(di mana deposit bertanda positif dan penarikan bertanda negatif)*.

2. **Dua Pendekatan Ekuivalen:**
   - **Metode A (Adjusted Daily Anchor):**
     $$\text{Anchor}_{\text{adjusted}} = \text{Anchor}_{\text{raw}} + \Delta CF_{\text{today}}$$
     Drawdown harian dihitung terhadap modal aktif yang telah disesuaikan:
     $$\text{Daily Drawdown \%} = \max\left(0, \frac{\text{Anchor}_{\text{adjusted}} - \text{Live Equity}}{\text{Anchor}_{\text{adjusted}}} \times 100\%\right)$$
   - **Metode B (Neutralized Live Equity):**
     $$\text{Equity}^*_{\text{live}} = \text{Live Equity} - \Delta CF_{\text{today}}$$
     $$\text{Daily Drawdown \%} = \max\left(0, \frac{\text{Anchor}_{\text{raw}} - \text{Equity}^*_{\text{live}}}{\text{Anchor}_{\text{raw}}} \times 100\%\right)$$

   Kedua metode menghasilkan nilai selisih kerugian nominal yang identik:
   $$\text{Kerugian Trading Riil} = \text{Anchor}_{\text{adjusted}} - \text{Live Equity} = \text{Anchor}_{\text{raw}} - \text{Equity}^*_{\text{live}}$$
   *Keputusan:* Gunakan **Adjusted Daily Anchor** ($\text{Anchor}_{\text{adjusted}}$), karena saat penarikan terjadi, basis modal aktif yang dipertaruhkan pengguna hari itu memang telah berkurang menjadi modal sisa.
   *Guard:* Bila $\text{Anchor}_{\text{adjusted}} \le 0$ (misal saldo ditarik habis hingga nol), drawdown dilaporkan bersih **0.0%**.

### D3 — Netralisasi Intraday Trough (`get_daily_trough`)
`daily_trough` digunakan untuk mengingat penurunan terdalam yang terjadi di dalam hari berjalan (*intraday dip*).
* Nilai snapshot ekuitas minimum dinetralkan dengan arus kas yang telah terjadi hingga titik waktu tersebut, dievaluasi **per segmen kas** sehingga penarikan tidak menurunkan palung trading dan deposit tidak menutupinya. Fungsi `equity_minimum_since` (satu minimum global) digantikan `equity_minimum_between` (minimum per rentang).
* Penarikan dana kas di tengah hari tidak boleh menurunkan trough trading harian.

### D4 — Overall Drawdown Peak-to-Trough Selaras dengan Equity Curve
* Mengadopsi logika rekonsiliasi yang sama dengan `get_equity_curve` (SPEC-007 §D3):
  Puncak performa (`peak`) dan palung (`trough`) dievaluasi dari kurva hasil trading kumulatif atau kurva ekuitas bertahap di mana penarikan dana hanya menggeser baseline modal dan tidak dihitung sebagai kerugian puncak-ke-palung.

---

## 3. Spesifikasi Teknis & Skema Data

### 3.1 Backend Service Layer (`services/api/app/services/bridge_status_service.py`)

> **Verifikasi kode (2026-11-15):** seluruh API yang dirujuk di bawah sudah ada —
> `get_daily_anchor` (l.443), `get_daily_trough` (l.592), `get_overall_drawdown` (l.546),
> `get_equity_curve` (l.216), `cash_flow_repository.sum_cash_flow` (`net_funding`) dan
> `cash_flow_repository.cash_flow_events`. Baseline suite: **194 test hijau**.

1. **Penyesuaian `get_daily_anchor()`**
   `get_daily_anchor()` punya **lima** cabang sumber anchor, bukan satu. Setiap cabang
   mencatat `anchor_moment` (saat nilai anchor itu benar), lalu penyesuaian kas diterapkan
   **sekali** lewat helper privat `_apply_cash_flow()` agar tidak ada cabang yang terlewat:

   | `source` | `anchor_moment` |
   | --- | --- |
   | `snapshot_exact` | `snapshot.captured_at` |
   | `snapshot_rollforward` | `boundary` (00:00 broker time) |
   | `session_start` | `first_today.captured_at` |
   | `deposit_reconstruction` | `boundary` |
   | `current_fallback` | **tidak disesuaikan** (`net_cash_flow = 0.0`) |

   `current_fallback` dikecualikan karena anchor-nya *adalah* ekuitas live; menyesuaikannya
   akan mengembalikan sifat sirkular yang justru dihapus ticket 09-01.

   ```python
   summary = cash_flow_repository.sum_cash_flow(db, connection.id, since=anchor_moment)
   net_cash = summary["net_funding"]          # deposit - withdrawal (withdrawal negatif)
   anchor["net_cash_flow"] = net_cash
   anchor["raw_equity"] = round(float(anchor["equity"]), 2)
   anchor["equity"] = max(0.0, round(anchor["raw_equity"] + net_cash, 2))
   anchor["balance"] = max(0.0, round(float(anchor["balance"]) + net_cash, 2))
   ```
   Kunci `anchor_moment`, `net_cash_flow`, dan `raw_equity` selalu ada di dict anchor
   (default `boundary`, `0.0`, `None`) sehingga pemanggil tidak perlu `get()`.
   Guard: `equity <= 0` (mis. saldo ditarik habis) membuat `_percent_from()` melaporkan 0.0%.

2. **Penyesuaian `get_daily_trough()` — sadar-segmen**
   Signature berubah menjadi `get_daily_trough(db, connection, anchor)` karena segmentasi
   butuh `raw_equity`, `anchor_moment`, dan `equity` yang sudah disesuaikan.
   Trough dievaluasi **per segmen waktu antar mutasi kas**, karena dua sisi penarikan tidak
   sebanding: $1,700 yang keluar dari akun $1,925.39 menyisakan modal $225.39, dan memegang
   $225.39 bukanlah drawdown.

   1. Segmen 0 = `[anchor_moment, kas_1)`, segmen *i* = `[kas_i, kas_{i+1})` (terakhir sampai `now`).
   2. Modal segmen = `raw_equity + akumulasi kas sebelum segmen` (kas yang membuka segmen
      masuk ke modal segmen berikutnya).
   3. `min(equity)` per segmen lewat fungsi repository baru
      `telemetry_repository.equity_minimum_between(db, connection_id, start, end)`
      (menggantikan `equity_minimum_since`, tetap mensyaratkan `equity > 0`).
   4. `worst = max((modal - min) / modal * 100)` di seluruh segmen.
   5. Nilai kembalian dikonversi ke basis `equity` yang sudah disesuaikan sehingga
      `policies.evaluate_drawdown(adjusted, live, trough, th)` mereproduksi `worst`:
      `adjusted * (1 - worst / 100)`. Tanpa mutasi kas hari ini, nilai ini identik dengan
      minimum snapshot historis — kompatibel dengan perilaku sebelum SPEC-008.

   Alasan memakai minimum per segmen (bukan minimum global): deposit di awal hari lalu loss
   lebih dalam setelahnya akan menyembunyikan palung riil jika hanya satu minimum global
   yang dipakai (inilah P2 pada sumbu trough).

3. **Penyesuaian `get_overall_drawdown()` — basis *trade-only***
   Timeline direkonstruksi dari trade **dan** cash flow, persis rekonsiliasi
   `get_equity_curve()`:
   - Deal deposit paling awal dikecualikan sebagai baseline (logika `has_override` /
     `get_sensor_initial_deposit` / `earliest_deposit`) agar deposit pertama tidak dihitung dua kali.
   - Setiap titik dievaluasi pada basis trade-only: `trade_only = equity - cum_cash`, dan
     `peak`/`trough`/`current` semuanya memakai basis itu.
   - Konsekuensi: penarikan menggeser baseline turun (tidak meninggalkan drawdown permanen),
     deposit tidak menaikkan "puncak performa". `peak_equity` pada respons karena itu berarti
     **puncak performa yang netral kas**, bukan puncak saldo mentah.
   - `peak_equity_at` memakai timestamp event (trade atau kas) tempat puncak terjadi.


### 3.2 Wire Schema (`app/models/risk.py`)

> **Koreksi nama field (2026-11-15):** draft awal spec menyebut `is_daily_drawdown_alert`
> dan `is_overall_drawdown_alert`. Nama sebenarnya di `RiskWatchdogStatusResponse` adalah
> `is_alert_active` dan `is_overall_alert_active`. Tidak ada field baru dengan nama draft
> tersebut — memakai nama itu akan menghasilkan field yang tidak pernah diisi.

Model respons `RiskWatchdogStatusResponse` tetap kompatibel ke belakang (*backward compatible*),
semua field lama tidak berubah nama:
- `daily_drawdown_percent: float`
- `daily_max_drawdown_percent: float`
- `is_alert_active: bool`
- `overall_drawdown_percent: float`
- `max_drawdown_percent: float`
- `is_overall_alert_active: bool`

Field tambahan opsional untuk transparansi audit (default `None`, klien lama tetap jalan):
- `daily_anchor_adjusted: Optional[float] = None` ➔ `anchor["equity"]` (basis setelah penyesuaian)
- `daily_cash_flow: Optional[float] = None` ➔ `anchor["net_cash_flow"]` (ΔCF sejak `anchor_moment`)

`daily_starting_equity` dan `daily_starting_balance` kini berisi nilai **yang sudah disesuaikan**
(bukan snapshot mentah), sehingga `daily_realized_pnl = balance_live - daily_starting_balance`
otomatis bersih dari mutasi kas. Nilai mentah tersedia lewat `daily_anchor_adjusted - daily_cash_flow`.

---

## 4. Dampak Arsitektur & Boundary (ADR 0009)

* **Domain Layer (`app/domain/policies.py`)**:
  Fungsi evaluasi `evaluate_drawdown(anchor_equity, current_equity, lowest_equity, threshold)` tetap murni (*pure mathematical function*). Logika penyesuaian anchor terhadap cash flow dilakukan di service layer sebelum policy dievaluasi, sehingga domain tetap terisolasi dari database dan framework.
* **Repository Layer**:
  Memanfaatkan fungsi yang sudah ada di `cash_flow_repository.py` (`sum_cash_flow`, `cash_flow_events`,
  `earliest_deposit`) **plus satu fungsi baca baru** `telemetry_repository.equity_minimum_between()`
  untuk minimum ekuitas per segmen kas. Tidak ada perubahan skema tabel database dan tidak ada
  migrasi baru.

---

## 5. Kriteria Penerimaan & Verifikasi

1. **Uji Kasus Penarikan Kas (Withdrawal):**
   - Akun memiliki saldo awal hari $1,000.
   - Penarikan kas $300 dilakukan hari ini (saldo menjadi $700), tanpa aktivitas trading.
   - `daily_drawdown_percent` harus bernilai **0.0%** (tidak ada alert, tidak breach).
2. **Uji Kasus Penarikan Kas Diikuti Loss Trading:**
   - Saldo awal hari $1,000.
   - Penarikan kas $200 (modal aktif menjadi $800).
   - Trader membuka posisi dan mengalami loss $40 (ekuitas menjadi $760).
   - `daily_drawdown_percent` harus bernilai **5.0%** ($(800 - 760) / 800 \times 100\%$).
3. **Uji Kasus Deposit Diikuti Loss Trading:**
   - Saldo awal hari $1,000.
   - Deposit kas $500 (modal aktif menjadi $1,500).
   - Trader membuka posisi dan mengalami loss $150 (ekuitas menjadi $1,350).
   - `daily_drawdown_percent` harus mencatat kerugian **10.0%** ($(1500 - 1350) / 1500 \times 100\%$), bukan 0%.
4. **Verifikasi Suite Penuh:**
   - Baseline sebelum perubahan: **194 test** hijau (`pytest`).
   - Setelah perubahan: **200 test** hijau (194 + 6 test baru), dan `lint-imports` tetap
     `6 kept, 0 broken` (`app.domain` tetap murni).
   - Test baru berada di `services/api/tests/test_cash_flow.py` dan menguji lewat endpoint
     `GET /api/v1/bridge/risk` (bukan hanya fungsi service), termasuk skenario trough
     intraday yang pullback setelah recovery.
