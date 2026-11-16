# SPEC-010: Dashboard Realized PnL Correctness, Net Capital Baseline, & Cash Flow Transparency

**Status:** approved  
**Prioritas:** High (Integritas Metrik Finansial & Eliminasi Distorsi Arus Kas pada Dashboard)  
**Referensi:** ADR 0004 (Strictly Read-Only), ADR 0009 (Layered Architecture), SPEC-003 (Live Metrics Correctness), SPEC-007 (Cash Flow Isolation), SPEC-008 (Cash-Flow-Neutralized Drawdown), SPEC-009 (Deposit Reconstruction Drawdown Fix)

---

## 1. Problem Statement

Pipstride memisahkan transaksi trading (`closed_trades`) dari mutasi kas (`cash_flow`) pada SPEC-007 agar penarikan dana tidak lagi merusak Win Rate atau terbaca sebagai trade kalah. 

Namun, evaluasi mendalam pada alur perhitungan ringkasan akun di **Dashboard (`HomeTab.jsx`)** dan **Journal (`JournalTab.jsx`)** menemukan **tiga kelemahan kalkulasi finansial**:

### P1 — P/L Sepanjang Waktu di Dashboard Masih Memakai Rumus Selisih Kasar
1. **Mekanisme Anomali:**
   - Pada `bridge_status_service.py` baris 91–94:
     ```python
     settled_pnl = round(balance - deposit, 2) if deposit else 0.0
     settled_pnl_pct = round((settled_pnl / deposit) * 100.0, 2) if deposit else 0.0
     all_time_pnl = round(equity - deposit, 2) if deposit else 0.0
     all_time_pnl_pct = round((all_time_pnl / deposit) * 100.0, 2) if deposit else 0.0
     ```
   - Dan pada modul domain frontend `apps/web/src/domain/pnl.js`:
     ```javascript
     const settledDelta = balance - initialDeposit;
     const allTimeDelta = equity - initialDeposit;
     ```
   - Nilai `deposit` diisi oleh sensor MT5 (`PipstrideMonitor.mq5::GetAccountInitialDeposit`) yang **hanya mengambil deal setoran pertama (deal index 0)**.
2. **Distorsi Nyata Akibat Mutasi Kas:**
   - **Kasus Top-Up (Suntikan Modal):** Pengguna deposit awal $1.000, lalu tanpa trading melakukan top-up $500 (Saldo menjadi $1.500). Dashboard menghitung $1.500 - 1.000 = +\$500$ dan melaporkan **P/L Sepanjang Waktu: +$500 (+50.0%)**, padahal pengguna belum mencetak satu sen pun profit trading!
   - **Kasus Penarikan (Withdrawal):** Pengguna deposit awal $1.000, berhasil trading untung $200 (Saldo $1.200), lalu menarik modal/profit $400 (Saldo sisa $800). Dashboard menghitung $800 - 1.000 = -\$200$ dan melaporkan **P/L Sepanjang Waktu: -$200 (-20.0%)**, mengklaim trader merugi padahal kinerja trading mereka positif.

### P2 — "Initial Balance (Benchmark)" Tidak Merefleksikan Modal Bersih Riil (*Net Capital*)
1. Label di kartu Saldo Dashboard saat ini adalah `Initial Balance (Benchmark): $X.XX (from MT5)`.
2. Jika ada penambahan modal berkala atau penarikan, patokan deposit pertama ini menjadi usang dan tidak merefleksikan posisi modal bersih yang sebenarnya sedang dipertaruhkan oleh trader:
   $$\text{Net Invested Capital} = \sum \text{Deposits} - \sum \text{Withdrawals}$$
3. Pengguna tidak memiliki visibilitas di Dashboard untuk mengetahui berapa modal pokok bersih yang tertanam versus berapa murni hasil akumulasi profit/loss trading mereka.

### P3 — Ambiguitas Konteks Periode pada Kartu Arus Kas Journal
1. Kartu `Total Deposit`, `Total Penarikan`, dan `Arus Kas Bersih` di tab Journal terikat pada **filter periode aktif** (default `1M` / 30 hari terakhir, atau bulan kalender berjalan).
2. Jika deposit awal dilakukan 2 bulan yang lalu dan pengguna baru saja melakukan top-up 5 hari yang lalu:
   - Kartu `Total Deposit` di Journal hanya memunculkan nominal deposit 5 hari yang lalu tersebut.
   - Pengguna mengira sistem mengganti modal awal dengan deposit terbaru, padahal deposit lama hanya tersaring oleh filter waktu 30 hari.
3. Diperlukan penegasan label periode dan kejelasan visual antara modal periode aktif versus modal seumur hidup (*all-time funding*).

---

## 2. Keputusan Desain (Design Decisions)

### D1 — All-Time Realized Trading P/L Wajib Murni dari Akumulasi Trade Riil
Kinerja trading harus 100% kebal terhadap mutasi kas (deposit maupun withdrawal).
$$\text{Settled P/L} = \sum_{t \in \text{Closed Trades}} \text{Trade.profit}$$
* Di backend `bridge_status_service.get_status()`, `settled_pnl` dihitung langsung dari agregat SQL atau repository `trade_repository.sum_profit_between(db, connection.id)`.
* Tidak ada lagi operasi `balance - deposit` untuk menghitung realized trading P/L.
* Jika akun belum memiliki trade yang ditutup, `settled_pnl = 0.00`.

### D2 — Penetapan Modal Bersih (*Net Capital*) dan Perhitungan Persentase Pertumbuhan
1. **Modal Bersih Berjalan (*Net Invested Capital*):**
   - Basis modal efektif (`initial_deposit` sensor **atau** `custom_initial_deposit` jika override) ditambah seluruh mutasi kas **setelah** baseline deal:
     $$\text{Net Capital} = \text{effective deposit} + \text{net\_funding}(\text{excluding baseline deal})$$
   - Baseline deal (setoran positif paling awal) dikecualikan hanya bila nominalnya cocok dengan `initial_deposit` sensor; kalau tidak cocok, baris itu adalah mutasi tambahan (baseline belum ter-ingest) dan harus ikut dijumlahkan.
   - Berlaku untuk akun override maupun non-override: pada override, `custom_initial_deposit` menggantikan baseline sensor, sehingga baris baseline sensor tetap dikecualikan.
   - Bila sensor belum pernah melaporkan `initial_deposit`, baris cash flow (`net_funding`) menjadi sumber utama; bila keduanya kosong, `net_capital = initial_deposit` (deposit efektif / fallback saldo).
2. **All-Time Equity P/L:**
   $$\text{All-Time Equity P/L} = \text{Settled P/L} + \text{Floating P/L}$$
   (Atau setara dengan $\text{Live Equity} - \text{Net Capital}$).
3. **Persentase Pertumbuhan (Return on Capital):**
   $$\text{Settled P/L \%} = \begin{cases} 
   \dfrac{\text{Settled P/L}}{\text{Net Capital}} \times 100\%, & \text{jika Net Capital} > 0 \\
   0.00\%, & \text{jika Net Capital} \le 0 
   \end{cases}$$
   $$\text{All-Time Equity P/L \%} = \begin{cases} 
   \dfrac{\text{All-Time Equity P/L}}{\text{Net Capital}} \times 100\%, & \text{jika Net Capital} > 0 \\
   0.00\%, & \text{jika Net Capital} \le 0 
   \end{cases}$$
4. **Arti Persentase (Wajib Ditulis di Label UI):**
   - Persentase adalah *return on current net capital*, bukan pertumbuhan absolut. Contoh: deposit 1.000, profit 200, tarik 400 → net capital 600 → tampil 33,3% (bukan 20%).
   - Karena itu label kartu harus menyebut basisnya (mis. `P/L vs Modal Bersih`), dan perilaku ini dikunci oleh unit test agar tidak dikira regresi.

### D3 — Tampilan Dashboard (`HomeTab.jsx`) yang Informatif dan Akurat
1. **Kartu Total Saldo (`home-kpi-balance`):**
   - Angka Utama: `formatCurrency(balance)`
   - Baris 1: `Modal Bersih:` `formatCurrency(netCapital)` (dengan indikator status manual atau MT5).
   - Baris 2: `Hasil Riil Trading:` `+formatCurrency(settledPnl)` `(+X.X%)` — hijau jika untung, merah jika rugi.
2. **Kartu Ekuitas Akun (`home-kpi-equity`):**
   - Angka Utama: `formatCurrency(equity)`
   - Baris 1: `Total Hasil (Riil + Floating):` `+formatCurrency(allTimePnl)` `(+X.X%)`
   - Baris 2: `Risiko Floating:` `formatCurrency(floatingPnl)`

### D4 — Transparansi Periode pada Arus Kas Journal (`KpiCards.jsx`)
1. Beri label periode yang eksplisit pada kartu arus kas di Journal:
   - Misalnya: `Total Deposit (30 Hari Terakhir)` atau `Total Deposit (Bulan Ini)`.
2. Saat pengguna memilih filter `ALL`, label otomatis berubah menjadi `Total Deposit (Semua Waktu)`.
3. Sediakan catatan/petunjuk visual ringkas bahwa untuk melihat akumulasi seluruh modal dari awal buka akun, pengguna dapat beralih ke filter `ALL`.

---

## 3. Spesifikasi Teknis & Wire Format

### 3.1 Response Model `BridgeStatusResponse` (`services/api/app/models/bridge.py`)
Tambahkan field modal bersih ke payload status tanpa memutus kompatibilitas yang sudah ada. **Pertahankan field lama sebagai `Optional[...] = None`** — mengubahnya menjadi `float = 0.0` akan memaksa nilai nol pada klien/skema yang sudah mendarat:
```python
class BridgeStatusResponse(BaseModel):
    # ... field yang sudah ada (jangan diubah tipenya) ...
    initial_deposit: Optional[float] = None
    net_capital: Optional[float] = Field(
        None,
        description="Cumulative net capital funding (effective deposit + deposits minus withdrawals after baseline)",
    )
    settled_pnl: Optional[float] = None
    settled_pnl_percent: Optional[float] = None
    all_time_pnl: Optional[float] = None
    all_time_pnl_percent: Optional[float] = None
```

### 3.2 Service Layer `BridgeStatusService::get_status()`
```python
# 0. Hitung net capital SEBELUM cabang fresh/offline, supaya payload offline
#    tetap membawa modal bersih.
realized_pnl = round(float(trade_repository.sum_profit_between(db, connection.id) or 0.0), 2)

sensor_deposit = account_settings_service.get_sensor_initial_deposit(connection)
cash_totals = cash_flow_repository.sum_cash_flow(db, connection.id)
baseline_deal = cash_flow_repository.earliest_deposit(db, connection.id)

# Baseline hanya dikecualikan bila baris paling awal benar-benar setoran sensor.
# Kalau nominalnya beda, baris itu adalah mutasi tambahan (baseline belum
# ter-ingest) dan tidak boleh dibuang.
baseline_id = None
if sensor_deposit and baseline_deal is not None:
    if abs(float(baseline_deal.amount or 0.0) - float(sensor_deposit)) < 0.01:
        baseline_id = baseline_deal.id

if sensor_deposit:
    adjusted_cash = cash_flow_repository.sum_cash_flow(db, connection.id, exclude_id=baseline_id)
    net_capital = round(float(deposit or 0.0) + float(adjusted_cash.get("net_funding") or 0.0), 2)
elif cash_totals["deposits"]:
    # Sensor tidak melaporkan baseline: baris cash flow adalah satu-satunya sumber.
    net_capital = round(float(cash_totals["net_funding"]), 2)
else:
    net_capital = round(float(deposit or 0.0), 2)

if not fresh:
    return BridgeStatusResponse(..., net_capital=net_capital, settled_pnl=0.0, ...)

# 1. Settled P/L = akumulasi trade riil (bukan balance - deposit).
settled_pnl = realized_pnl

# 2. All-time P/L = realized + floating.
floating_pnl = float(payload.floating_pnl or 0.0)
all_time_pnl = round(realized_pnl + floating_pnl, 2)

# 3. Persentase terhadap modal bersih berjalan.
base_capital = net_capital if (net_capital and net_capital > 0) else float(deposit or 0.0)
settled_pnl_pct = round((settled_pnl / base_capital) * 100.0, 2) if base_capital > 0 else 0.0
all_time_pnl_pct = round((all_time_pnl / base_capital) * 100.0, 2) if base_capital > 0 else 0.0
```

Catatan:
- `sum_profit_between` menjumlahkan `Trade.profit` yang **sudah** termasuk swap + commission (`PipstrideMonitor.mq5`), jadi tidak ada drift terhadap saldo.
- `get_initial_deposit_info()` (`InitialDepositResponse`) mewarisi nilai `get_status()`. Setelah SPEC ini, field `settled_pnl` di endpoint `/bridge/initial-deposit` ikut bermakna *all-time trading P/L vs net capital*. Endpoint ini tidak dipakai UI (`api.js` hanya mendefinisikan `getInitialDeposit`), tetapi test lama mengunci nilainya — lihat tiket 14-01.

### 3.3 Domain Parity Frontend (`apps/web/src/domain/pnl.js`)
```javascript
export function summarizeAccountPnl(bridgeStatus, metrics) {
  const status = bridgeStatus ?? {};
  const live = metrics ?? {};
  const balance = live.balance ?? 0;
  const equity = live.equity ?? 0;
  const floatingPnl = live.floating_pnl ?? (equity - balance);

  const initialDeposit = status.initial_deposit ?? live.initial_deposit ?? balance;
  const netCapital = provided(status.net_capital) ? status.net_capital : initialDeposit;

  // Realized PnL hanya dari backend. TIDAK ada fallback `balance - deposit`
  // atau `balance - netCapital`: keduanya adalah turunan selisih yang SPEC ini
  // hapus, dan akan menampilkan angka semu saat cash flow belum lengkap.
  const settledPnl = provided(status.settled_pnl) ? status.settled_pnl : 0;
  const allTimePnl = provided(status.all_time_pnl) ? status.all_time_pnl : settledPnl + floatingPnl;

  const baseCapital = netCapital > 0 ? netCapital : initialDeposit;

  return {
    initialDeposit,
    netCapital,
    isDepositOverridden: status.is_deposit_overridden ?? false,
    settledPnl,
    settledPnlPercent: provided(status.settled_pnl_percent)
      ? status.settled_pnl_percent
      : percentOfBase(settledPnl, baseCapital),
    allTimePnl,
    allTimePnlPercent: provided(status.all_time_pnl_percent)
      ? status.all_time_pnl_percent
      : percentOfBase(allTimePnl, baseCapital)
  };
}
```

Konsekuensi: dua test lama di `pnl.test.js` yang mengunci fallback `balance - deposit` (mengharapkan `100`) **harus diperbarui** menjadi `0`; ini bagian dari tiket 14-02, bukan regresi.

---

## 4. Kriteria Keberhasilan (Success Criteria)

1. **Top-Up Tidak Lagi Memicu Profit Trading Semu:**
   - Melakukan deposit tambahan ke akun tanpa ada trade tertutup menghasilkan `settled_pnl = 0.00` dan `settled_pnl_percent = 0.0%` di Dashboard.
2. **Penarikan Dana Tidak Lagi Terbaca Sebagai Rugi Trading:**
   - Menarik dana setelah profit trading mempertahankan `settled_pnl` positif sesuai total keuntungan trade riil.
3. **Modal Bersih Terpantau Transparan:**
   - Dashboard menampilkan modal bersih yang akurat: `effective deposit + (deposits − withdrawals setelah baseline deal)`.
4. **Verifikasi Test Suite & Lint:**
   - Seluruh test suite backend (`pytest`) dan frontend (`vitest`) lulus 100%.
   - Assertion lama yang mengunci formula `balance - deposit` **diganti** dengan nilai trade-based, bukan dihapus tanpa pengganti: `tests/test_connections.py` (`500.0`/`5.0` → `30.0`/`0.3`; `5_500.0` → `30.0` pada test override) serta dua test fallback di `apps/web/src/domain/pnl.test.js` (`100` → `0`).
   - Payload `/bridge/status` saat offline/stale tetap membawa `net_capital` yang benar (bukan `null`).
   - Paritas i18n lulus (`node apps/web/scripts/check-i18n.cjs`).
   - Boundary arsitektur lulus (`lint-imports` & `npm run lint:arch`).
