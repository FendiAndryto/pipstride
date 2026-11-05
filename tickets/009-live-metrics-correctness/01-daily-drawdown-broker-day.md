# Ticket 09-01: Daily Drawdown — Broker Day Anchor + Max Intraday

## Goal
`GET /api/v1/bridge/risk` menghitung drawdown harian terhadap **tengah malam waktu server
broker**, dengan anchor yang di-roll-forward dari snapshot terbaru, dan melaporkan drawdown
**maksimum** intraday (bukan hanya titik saat ini) sebagai dasar alert.

## Konteks (kenapa tiket ini ada)
Empat bug di jalur yang sama, semuanya terverifikasi di kode:
1. `domain/policies.py:36` membandingkan **balance** (anchor) dengan **equity** (pembilang) →
   floating loss saat pergantian hari langsung jadi drawdown palsu.
2. `bridge_status_service.py:323-324` memakai tengah malam **UTC**, bukan hari broker
   (broker umumnya UTC+2/+3) → reset jam 02:00–03:00 waktu trader.
3. `telemetry_repository.balance_at_or_before()` mengembalikan snapshot ≤ tengah malam
   **berapa pun tuanya**, tanpa roll-forward → EA yang mati membuat P&L kemarin masuk hari ini.
4. Tidak ada max intraday → rugi −3% pagi lalu pulih siang terbaca 0,00%, alert tidak pernah nyala.

## Scope

### 1. Domain murni — `app/domain/time.py`
- `broker_utc_offset_seconds(payload_timestamp, now_utc) -> int`
  - `offset = payload_timestamp - now_utc`; bulatkan ke 15 menit terdekat; clamp ±14 jam.
  - `payload_timestamp` tidak ada/0 → `0` (UTC).
- `broker_day_start_utc(now_utc, offset_seconds) -> datetime`
  - tengah malam pada waktu broker, dikembalikan sebagai `datetime` UTC tz-aware.

### 2. Domain murni — `app/domain/policies.py`
- Ganti `evaluate_daily_drawdown(starting_balance, equity, threshold)` menjadi
  `evaluate_drawdown(anchor_equity, current_equity, lowest_equity, threshold)`:
  - `current_pct = max(0, (anchor_equity - current_equity) / anchor_equity * 100)`
  - `max_pct = max(0, (anchor_equity - min(current_equity, lowest_equity)) / anchor_equity * 100)`
  - alert memakai `max_pct >= threshold`; `reason_code` tetap `DRAWDOWN_ALERT_REASON`.
  - anchor `None`/`<= 0` → semua nol, tanpa alert (perilaku lama dipertahankan).
- Tambah `evaluate_overall_drawdown(peak_equity, current_equity, max_trough_equity, threshold)`
  dengan bentuk hasil sama (dipakai tiket 09-02, ditulis sekarang agar satu tempat).
- `DrawdownEvaluation` tetap: `drawdown_pct` (dipakai = max), `is_alert_active`,
  `threshold_percent`, `reason_code`, plus field baru `current_pct` dan `max_pct`.

### 3. Repository — `telemetry_repository.py`
- `snapshot_at_or_before(db, connection_id, moment)` → row `(captured_at, balance, equity, floating_pnl)`,
  bukan hanya `balance` (dipakai untuk roll-forward).
- `equity_minimum_since(db, connection_id, moment)` → `min(equity)` snapshot sejak `moment`.
- Pertahankan `balance_at_or_before` bila masih dipakai di tempat lain; kalau tidak, hapus.

### 4. Service — `bridge_status_service.py`
- `get_daily_anchor(db, connection, metrics)` → `(anchor_at, anchor_balance, anchor_equity, source)`:
  1. Hitung `offset` dari `metrics.timestamp` vs `now`; boundary = `broker_day_start_utc`.
  2. Snapshot ≤ boundary:
     - bila `boundary - captured_at <= 90s` → `source = "snapshot_exact"`, anchor = nilai snapshot;
     - selain itu → roll-forward: `anchor_balance = snapshot.balance + Σ profit(closed_at ∈ (captured_at, boundary])`,
       `anchor_equity = snapshot.equity + Σ profit(...)`, `source = "snapshot_rollforward"`.
  3. Tanpa snapshot ≤ boundary: snapshot **pertama ≥ boundary** (EA baru hidup hari itu) →
     `source = "session_start"`, anchor = snapshot itu apa adanya.
  4. Tanpa snapshot sama sekali → `deposit + Σ profit(closed_at ≤ boundary)`, `source = "deposit_reconstruction"`.
  5. Tanpa snapshot dan tanpa deposit → equity sekarang, `source = "current_fallback"` (laporan 0% jujur).
- **Anchor tidak boleh diturunkan dari balance sekarang.** `balance_sekarang − profit_hari_ini`
  terlihat benar tetapi menghasilkan `floating/balance` sebagai "DD harian" — persis bug yang
  tiket ini hapus. Karena itu langkah 3 memakai observasi nyata, bukan rekonstruksi sirkular.
- `get_overall_drawdown(db, connection, current_equity, deposit)` → `(peak, peak_at, max_trough, overall_pct, max_pct)`
  - Rekonstruksi `deposit + Σ profit` berurutan (`closed_at` asc, `id` asc), jalankan peak/trough.
  - Sisipkan titik equity live terakhir sebagai titik terakhir.
  - Ini dipakai tiket 09-02, tetapi fungsi + tesnya masuk tiket ini.
- Hapus `get_daily_starting_balance()` (digantikan `get_daily_anchor`).
- Cache offset per koneksi di `live_state` (TTL 1 jam) supaya satu heartbeat berjam salah tidak
  menggeser boundary berulang kali; helper `save_broker_offset` / `load_broker_offset`.

### 5. Route — `api/v1/bridge.py`
- `get_risk_watchdog()` tidak lagi menyusun logika; panggil service dan rakit response.
- Pertahankan semua field lama; tambah field baru sesuai spek D7.

### 6. Model + config
- `models/risk.py`: `daily_max_drawdown_percent`, `daily_realized_pnl`,
  `daily_starting_equity`, `daily_anchor_at`, `daily_anchor_source`,
  `overall_drawdown_percent`, `max_drawdown_percent`, `peak_equity`, `peak_equity_at`,
  `max_overall_drawdown_percent`, `is_overall_alert_active` — semua dengan default.
- `core/config.py`: `MAX_OVERALL_DRAWDOWN_PERCENT: float = 10.0`,
  `BROKER_OFFSET_CACHE_SECONDS: int = 3600`.

## Files to Touch
- `services/api/app/domain/time.py`, `services/api/app/domain/policies.py`
- `services/api/app/infrastructure/db/repositories/telemetry_repository.py`
- `services/api/app/services/bridge_status_service.py`
- `services/api/app/api/v1/bridge.py`
- `services/api/app/models/risk.py`, `services/api/app/core/config.py`
- `services/api/app/core/live_state.py` (helper offset)
- `services/api/tests/test_domain_metrics.py`, `services/api/tests/test_connections.py`

## Verification
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```
Expected: seluruh suite pass (termasuk tes baru di bawah); `lint-imports` tetap `0 broken`
(`domain/` tidak boleh mengimpor `sqlalchemy`/`fastapi`).

### Tes baru yang wajib ada
1. `broker_utc_offset_seconds` — payload +7200s → offset 7200; +4980s → dibulatkan 5400;
   nilai ekstrem (±20 jam) → di-clamp ±14 jam; timestamp 0 → 0.
2. `broker_day_start_utc` — offset +2 jam pada 2026-01-02T01:00Z → boundary 2026-01-01T22:00Z
   (yaitu 2026-01-02T00:00 waktu broker); offset +5:30 juga diuji.
3. **Floating saat rollover tidak menghasilkan DD** — anchor equity = equity snapshot;
   posisi floating −200 pada balance 10.000 → `daily_drawdown_percent == 0`.
4. **Snapshot tua di-roll-forward** — snapshot 2 hari lalu + trade hari ini di antara snapshot dan
   boundary; P&L kemarin tidak muncul sebagai drawdown hari ini, dan
   `daily_anchor_source == "snapshot_rollforward"`.
5. **Max intraday menahan nilai** — equity sempat turun ke −3,5% lalu pulih ke −0,5%;
   `daily_drawdown_percent` ≈ 0,5 tetapi `daily_max_drawdown_percent` ≈ 3,5 dan
   `is_alert_active is True`.
6. **Anchor = equity, bukan balance** — akun tumbuh 10.000 → 12.000, equity jatuh ke 11.640
   → 3,0% dan alert (bukan 0% seperti kalau diukur dari deposit).
7. `evaluate_drawdown` anchor nol/None → nol tanpa alert; equity di atas anchor → 0, bukan negatif.
8. `evaluate_overall_drawdown` peak 12.000 → trough 10.800 → 10,0% dan alert.

## Catatan implementasi

- **Anchor rung final** (berbeda dari draf awal tiket): `snapshot_exact` →
  `snapshot_rollforward` → `session_start` → `deposit_reconstruction` → `current_fallback`.
  Rung `balance_reconstruction` (`balance_sekarang − profit_hari_ini`) sempat ditulis lalu
  **dibuang**: anchor itu sirkular dan mengembalikan `floating/balance` sebagai DD harian, yaitu
  bug aslinya. Tes `test_daily_max_drawdown_holds_an_intraday_trough` yang menangkapnya.
- **`anchor_equity` roll-forward memakai `snapshot.equity + drift`**, bukan
  `anchor_balance + floating_pnl`. Hasilnya sama bila tidak ada trade di antaranya, tetapi
  bentuk ini tetap benar ketika ada trade (floating saat itu sudah termasuk di `snapshot.equity`).
- **`tests/conftest.py`**: `heartbeat_payload()` kini mengirim `timestamp = int(time.time())`.
  Nilai lama (`1_700_000_100`, Nov 2023) membuat offset broker ter-clamp ke −14 jam sehingga
  boundary bukan tengah malam — tes risk jadi tidak deterministik.
- **`balance_at_or_before` dihapus** dari `telemetry_repository.py`; satu-satunya pemakai
  (`get_daily_starting_balance`) sudah diganti `get_daily_anchor`. Diverifikasi dengan grep
  sebelum dihapus.
- **`profit_series` diganti `profit_points`** agar overall DD bisa melaporkan `peak_equity_at`,
  bukan hanya angkanya.

## Verification result

- `pytest` — **121 passed, 1 warning** (sebelumnya 104; +17 tes).
- `lint-imports` — **6 kept, 0 broken**.
- `ruff check app tests` — bersih (satu temuan lama di `tests/test_reset_admin_password.py`
  sudah ada sebelum fase ini).

## Depends on
- Fase 005 (`domain/` + repositories) dan Fase 003 (import-linter).

## Unblocks
- `02-overall-drawdown-and-single-formula.md`

## Status
done
