# Ticket 14-01: Backend Pure Realized Trading PnL & Net Capital Baseline

**Status:** done  
**Prasyarat:** Fase 013  
**Membuka:** 14-02  
**Spesifikasi:** [`docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md`](../../docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md)

---

## Goal

Memperbaiki kalkulasi metrik `settled_pnl`, `settled_pnl_percent`, `all_time_pnl`, dan `all_time_pnl_percent` pada endpoint `GET /api/v1/bridge/status` di backend, agar murni bersumber dari akumulasi hasil closed trades (`trade_repository.sum_profit_between`) dan mutasi kas riil (`cash_flow_repository.sum_cash_flow`), sehingga top-up modal atau penarikan dana tidak lagi mendistorsi laporan performa trading pada Dashboard.

---

## File yang Terlibat

| File | Tindakan | Deskripsi Perubahan |
|---|---|---|
| `services/api/app/models/bridge.py` | Edit | Tambahkan field `net_capital: Optional[float] = None` pada schema `BridgeStatusResponse`. |
| `services/api/app/services/bridge_status_service.py` | Edit | Ubah logika penentuan `settled_pnl` dan `all_time_pnl` di `get_status()` dari formula selisih `balance - deposit` menjadi pure trading profit + cash flow net funding. |
| `services/api/tests/test_connections.py` | Edit / Tambah Test | Tambahkan skenario uji: top-up tidak menambah trading PnL, penarikan tidak mengurangi trading PnL. |
| `services/api/tests/test_cash_flow.py` | Edit / Tambah Test | Verifikasi respons `get_status` saat ada transaksi cash flow beragam. |

---

## Rincian Implementasi

### 1. Perbarui Schema `BridgeStatusResponse` (`services/api/app/models/bridge.py`)
Tambahkan field `net_capital` opsional (default `None`). **Jangan** mengubah `settled_pnl`/`all_time_pnl*` yang sudah ada dari `Optional[float]` menjadi `float = 0.0`:
```python
net_capital: Optional[float] = Field(
    None,
    description="Cumulative net capital funding (effective deposit + deposits minus withdrawals after baseline)",
)
```

### 2. Perbarui `BridgeStatusService::get_status()` (`services/api/app/services/bridge_status_service.py`)
Gantikan blok baris 89–94 lama (`settled_pnl = round(balance - deposit, 2) ...`).

**a. Hitung net capital dan realized PnL sebelum cabang fresh/offline** (baris 68), supaya payload offline pun membawa modal bersih:
```python
realized_pnl = round(float(trade_repository.sum_profit_between(db, connection.id) or 0.0), 2)

# Baseline sensor adalah `initial_deposit` yang dilaporkan EA. Baris cash flow
# paling awal hanya boleh dikecualikan bila nominalnya cocok — kalau beda,
# berarti baseline belum ter-ingest dan baris itu adalah mutasi tambahan.
sensor_deposit = account_settings_service.get_sensor_initial_deposit(connection)
cash_totals = cash_flow_repository.sum_cash_flow(db, connection.id)
baseline_deal = cash_flow_repository.earliest_deposit(db, connection.id)
baseline_id = None
if sensor_deposit and baseline_deal is not None:
    if abs(float(baseline_deal.amount or 0.0) - float(sensor_deposit)) < 0.01:
        baseline_id = baseline_deal.id

if sensor_deposit:
    adjusted_cash = cash_flow_repository.sum_cash_flow(db, connection.id, exclude_id=baseline_id)
    net_capital = round(float(deposit or 0.0) + float(adjusted_cash.get("net_funding") or 0.0), 2)
elif cash_totals["deposits"]:
    net_capital = round(float(cash_totals["net_funding"]), 2)
else:
    net_capital = round(float(deposit or 0.0), 2)
```
`deposit` tetap `get_effective_initial_deposit` (override bila ada, jika tidak sensor). Untuk akun override, baseline sensor tetap dikecualikan karena `custom_initial_deposit` menggantikannya.
> Catatan: `cash_totals["net_funding"]` mentah hanya boleh dipakai saat sensor belum melaporkan `initial_deposit`. Pada akun yang sudah punya baseline sensor, memakai `net_funding` mentah akan under-count ketika baris baseline gagal ter-ingest, sehingga persentase P/L membengkak.

**b. Cabang offline/stale** — tambahkan `net_capital=net_capital` pada `BridgeStatusResponse(...)` di early return (baris 68–83). Nilai PnL tetap `0.0`.

**c. Cabang fresh** — ganti perhitungan menjadi:
```python
settled_pnl = realized_pnl
floating_pnl = float(payload.floating_pnl or 0.0)
all_time_pnl = round(realized_pnl + floating_pnl, 2)

base_capital = net_capital if (net_capital and net_capital > 0) else float(deposit or 0.0)
settled_pnl_pct = round((settled_pnl / base_capital) * 100.0, 2) if base_capital > 0 else 0.0
all_time_pnl_pct = round((all_time_pnl / base_capital) * 100.0, 2) if base_capital > 0 else 0.0
```
Lalu teruskan `net_capital=net_capital` pada instansiasi response fresh.

**d. `get_initial_deposit_info()`** (`InitialDepositResponse`, baris 385–393) mewarisi nilai dari `get_status()`, jadi makna `settled_pnl` di `/bridge/initial-deposit` ikut berubah menjadi *all-time trading P/L vs net capital*. Endpoint ini tidak dipanggil UI (`apps/web/src/services/api.js` hanya mendefinisikan `getInitialDeposit`), jadi keputusan yang diambil: terima perubahan + perbarui assertion test. Alternatif (hitung sendiri relatif deposit) hanya jika endpoint akan dipakai lagi — jangan diam-diam dibiarkan ambigu.

### 3. Perbarui Assertion Test Lama (WAJIB — tanpa ini gate pytest gagal)
`tests/test_connections.py`:
- `test_status_reports_live_metrics_after_heartbeat` (baris 105–107): fixture `heartbeat_payload` berisi dua closed trade (`+50.0`, `-20.0`) dan tidak punya baris cash flow, sehingga nilai baru adalah `settled_pnl == 30.0` dan `settled_pnl_percent == 0.3` (basis `net_capital == 10_000.0`). Assertion `500.0` / `5.0` mengunci formula lama.
- `test_initial_deposit_override_wins_over_mt5` (baris 207): `settled_pnl` menjadi `30.0` (realized trade), **bukan** `5_500.0`. Persentase dihitung terhadap `net_capital = 5_000 + 0 = 5_000` → `0.6`.
- Tambahkan assertion `net_capital` eksplisit di kedua test.

### 4. Test Baru
Tambahkan di `tests/test_connections.py` / `tests/test_cash_flow.py`:
1. **Top-up tanpa trading:** deposit baseline 1.000, cash flow top-up +500, tanpa closed trade → `settled_pnl == 0.0`, `settled_pnl_percent == 0.0`, `net_capital == 1_500.0`.
2. **Penarikan setelah profit:** baseline 1.000, trade +200, withdrawal 400 → `settled_pnl == 200.0`, `net_capital == 600.0`, `settled_pnl_percent == 33.33` (return on net capital — sengaja dikunci).
3. **Baseline deal belum ter-ingest:** sensor `initial_deposit = 1.000`, `cash_flow_deals` hanya berisi top-up +500 → `net_capital == 1_500.0` (bukan `500.0`).
4. **Status offline:** setelah heartbeat timeout, response tetap membawa `net_capital` yang benar dengan `settled_pnl == 0.0`.
5. **Override dengan mutasi kas:** `custom_initial_deposit = 5.000`, top-up +500 → `net_capital == 5_500.0`.


---

## Verification

Jalankan rangkaian tes backend berikut:
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest tests/test_connections.py tests/test_cash_flow.py
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```

Kriteria Sukses:
- Seluruh pengujian pytest lulus (baseline 205; bertambah dengan test baru 14-01) dan assertion lama yang diperbarui tetap hijau.
- `lint-imports`: 6 kept, 0 broken.
- Akun dengan saldo bertambah karena deposit kedua tidak lagi melaporkan `settled_pnl` semu.

---

## Catatan Implementasi (2026-11-16)

Selesai. `BridgeStatusResponse.net_capital` ditambahkan; `get_status()` menghitung `settled_pnl` dari `trade_repository.sum_profit_between` dan `net_capital` **sebelum** cabang fresh/offline (payload offline tetap membawa `net_capital`, PnL `0.0`). Baris deposit paling awal hanya dikecualikan dari delta kas bila nominalnya cocok dengan `initial_deposit` sensor (toleransi 0.01); bila sensor tidak punya baseline, `net_funding` mentah dipakai, selain itu `deposit` efektif. Verifikasi: `pytest` **209 passed**, `lint-imports` **6 kept / 0 broken**.
