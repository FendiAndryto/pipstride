# Ticket 13-06: Cash-Flow-Neutralized Drawdown Calculation (Trade-Only Risk Watchdog)

**Status:** in_progress  
**Prasyarat:** 13-02, 13-03  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/008-cash-flow-neutralized-drawdown.md`](../../docs/specs/008-cash-flow-neutralized-drawdown.md)

---

## Goal
Mengeliminasi lonjakan drawdown palsu (*false daily drawdown*, misal 88.3% saat penarikan kas $1,700) dan kerugian tersembunyi (*hidden drawdown* saat deposit) dengan menetralkan mutasi arus kas (`DEPOSIT` dan `WITHDRAWAL`) dari perhitungan *daily anchor*, *daily trough*, dan *overall peak-to-trough drawdown*, sehingga seluruh metrik pada pengawas risiko (*Risk Watchdog*) 100% murni mencerminkan performa risiko trading (*trade-only risk*).

---

## Konteks & Problem (terverifikasi 2026-11-15)

1. **Mekanisme Bug Daily Drawdown:**
   - Modul `bridge_status_service.get_daily_anchor()` (Fase 009, SPEC-003) dirancang sebelum isolasi arus kas (`cash_flow_deals`, SPEC-007) diimplementasikan.
   - Anchor ekuitas harian (`anchor["equity"]`) dibentuk dari snapshot awal hari broker (misal $1,925.39).
   - Ketika pengguna menarik dana $1,700 pada siang hari, saldo dan ekuitas live di terminal MT5 langsung menjadi $225.39.
   - `evaluate_drawdown(anchor_equity=1925.39, current_equity=225.39)` menghasilkan:
     $$\text{Daily Drawdown} = \frac{1925.39 - 225.39}{1925.39} \times 100\% = \mathbf{88.29\%}$$
   - Akun langsung terpicu status breach (melebihi batas toleransi 3%), memunculkan alert merah palsu di web dashboard.

2. **Mekanisme Bug Overall Drawdown:**
   - Pada `bridge_status_service.get_overall_drawdown()`, puncak ekuitas akumulatif (`peak_equity`) direkonstruksi hanya dari `deposit + trade_repository.profit_points`. Mutasi penarikan dana kas sama sekali tidak diperhitungkan.
   - Nilai puncak (misal $1,925.39) kemudian dibandingkan dengan `current_equity` live ($225.39) yang telah berkurang akibat penarikan.
   - Akibatnya, penarikan dana kas terbaca sebagai kerugian permanen *peak-to-trough overall drawdown* sebesar 88.31%.

3. **Mekanisme Bug Daily Realized:**
   - Di `app/api/v1/bridge.py:328`:
     ```python
     daily_realized = round(float(metrics.balance) - float(anchor["balance"]), 2)
     ```
   - Nilai penarikan $1,700 langsung terbaca sebagai kerugian terealisasi hari ini (`-$1700.00`) meskipun tidak ada order yang ditutup rugi.

---

## Scope

### 1. Backend Service Layer (`services/api/app/services/bridge_status_service.py`)

#### A. Penyesuaian `get_daily_anchor()`
- `get_daily_anchor()` punya **lima** cabang sumber, bukan dua. Setiap cabang menetapkan
  `anchor_moment` (saat nilai anchor benar), lalu penyesuaian kas diterapkan sekali lewat
  helper privat `_apply_cash_flow()`:

  | `source` | `anchor_moment` |
  | --- | --- |
  | `snapshot_exact` | `snapshot.captured_at` |
  | `snapshot_rollforward` | `boundary` |
  | `session_start` | `first_today.captured_at` |
  | `deposit_reconstruction` | `boundary` |
  | `current_fallback` | **tidak disesuaikan** (`net_cash_flow = 0.0`) |

  `current_fallback` wajib dilewati: anchor-nya adalah ekuitas live, sehingga penyesuaian
  akan mengembalikan sifat sirkular yang dihapus ticket 09-01.
- Ambil akumulasi arus kas sejak titik anchor:
  ```python
  cash_summary = cash_flow_repository.sum_cash_flow(db, connection.id, since=anchor_moment)
  net_cash = cash_summary["net_funding"] # (deposits - withdrawals)
  ```
- Sesuaikan basis anchor untuk ekuitas dan saldo:
  ```python
  anchor["raw_equity"] = round(float(anchor["equity"]), 2)
  anchor["equity"] = max(0.0, round(anchor["raw_equity"] + net_cash, 2))
  anchor["balance"] = max(0.0, round(float(anchor["balance"]) + net_cash, 2))
  anchor["net_cash_flow"] = net_cash
  ```
- Kunci `anchor_moment`, `net_cash_flow`, dan `raw_equity` harus ada di dict anchor untuk
  **semua** cabang (default `boundary`, `0.0`, `None`) karena route dan trough membacanya
  tanpa `get()`.
- Guard: jika `adjusted_equity <= 0` (misal seluruh saldo ditarik), anchor di-guard agar
  drawdown dilaporkan bersih `0.0%` (`policies._percent_from` sudah menangani anchor <= 0).

#### B. Penyesuaian `get_daily_trough()` — sadar-segmen
- Signature berubah: `get_daily_trough(db, connection, anchor)` (butuh `raw_equity`,
  `anchor_moment`, dan ekuitas yang sudah disesuaikan). Update pemanggil di `bridge.py`.
- Jika tidak ada arus kas hari ini, hasilnya identik dengan minimum snapshot historis
  (`equity_minimum_since` digantikan `equity_minimum_between`; perilaku tanpa kas sama).
- Jika ada arus kas hari ini, bagi hari menjadi segmen di setiap mutasi kas:
  - Segmen 0 = `[anchor_moment, kas_1)`, segmen *i* = `[kas_i, kas_{i+1})`, terakhir sampai `now`.
  - Modal segmen = `raw_equity + akumulasi kas sebelum segmen`.
  - `min(equity)` per segmen via fungsi repository baru
    `telemetry_repository.equity_minimum_between(db, connection_id, start, end)`.
  - `worst = max((modal - min) / modal * 100)`.
  - Kembalikan `adjusted_equity * (1 - worst / 100)` sehingga
    `policies.evaluate_drawdown()` mereproduksi `worst` tanpa perubahan domain.
- Alasan minimum **per segmen**, bukan satu minimum global: deposit di awal hari lalu loss
  lebih dalam setelahnya akan menyembunyikan palung riil kalau hanya min global yang dipakai.

#### C. Penyesuaian `get_overall_drawdown()` — basis trade-only
- Gabungkan timeline trade (`profit_points`) dan kas (`cash_flow_events`) secara
  kronologis, dengan deal deposit paling awal dikecualikan sebagai baseline — persis logika
  `get_equity_curve()` (`has_override` / `get_sensor_initial_deposit` / `earliest_deposit`)
  agar deposit pertama tidak dihitung dua kali.
- Evaluasi setiap titik pada basis trade-only: `trade_only = equity - cum_cash`. `peak`,
  `trough`, `peak_equity_at`, dan `current_equity` semuanya memakai basis ini.
- Konsekuensi yang harus didokumentasikan: `peak_equity` berarti **puncak performa netral kas**,
  bukan puncak saldo mentah; penarikan menggeser baseline turun, deposit tidak menaikkan puncak.

---

### 2. API Route Verification (`services/api/app/api/v1/bridge.py`)
- Pastikan perhitungan `daily_realized` menggunakan `anchor["balance"]` yang telah disesuaikan arus kas, sehingga penarikan kas tidak muncul sebagai kerugian harian (`daily_realized = 0.00` saat tidak ada trade).

---

### 3. Automated Tests (`services/api/tests/test_cash_flow.py`)
Semua test dijalankan **lewat endpoint** `GET /api/v1/bridge/risk` (bukan hanya memanggil
fungsi service), dengan menyemai baris `telemetry_snapshots` + `cash_flow_deals` bertimestamp
eksplisit lalu satu heartbeat untuk metrik live. Test ditempatkan di `test_cash_flow.py`
karena seluruh helper cash flow sudah ada di sana; tidak ada duplikasi fixture di
`test_connections.py`.

1. `test_daily_drawdown_neutral_on_withdrawal`:
   - Saldo awal hari $1,925.39, penarikan $1,700.00 hari ini, live equity $225.39 tanpa trade ➔ Daily drawdown wajib `0.0%`, `is_alert_active=False`, `daily_anchor_adjusted=225.39`.
2. `test_daily_drawdown_on_withdrawal_with_trading_loss`:
   - Saldo awal $1,000, penarikan $200 (modal sisa $800), loss floating $40 (ekuitas $760) ➔ Daily drawdown wajib `5.0%` ($(800-760)/800$).
3. `test_daily_drawdown_on_deposit_with_trading_loss`:
   - Saldo awal $1,000, deposit $500 (modal aktif $1,500), loss $150 (ekuitas $1,350) ➔ Daily drawdown wajib `10.0%` ($(1500-1350)/1500$), bukan 0%.
4. `test_overall_drawdown_neutral_on_withdrawal`:
   - Penarikan dana tidak memicu lonjakan overall drawdown (`peak_equity` tetap $1,925.39, 0.0%).
5. `test_daily_realized_neutral_on_cash_flow`:
   - `daily_realized_pnl` mencerminkan laba rugi trading tertutup hari ini (+50) tanpa tercampur penarikan kas (-300).
6. `test_daily_max_drawdown_keeps_the_intraday_trough_after_withdrawal`:
   - Penarikan $200 lalu dip ke $760 dan recovery ke $790 ➔ current `1.25%`, tetapi `daily_max_drawdown_percent` tetap `5.0%` dan alert aktif. Ini yang menjaga palung intraday per-segmen tidak hilang saat harga pulih.

---

### 4. Deploy & Verifikasi Live
- Jalankan test suite `pytest` dan architecture gate `lint-imports`.
- Commit dengan format conventional: `fix(api): neutralize daily and overall drawdown against cash flow`.
- Push ke remote `main`.
- Deploy ke server produksi (`100.68.87.58`) via Ansible playbook:
  `ansible-playbook site.yml --tags pipstride`.
- Verifikasi via `curl.exe` atau log live bahwa daily drawdown akun riil pengguna tidak lagi 88.3%.

---

## Verification Checklist
- [x] `services/api/tests/test_cash_flow.py` memuat 6 test skenario cash flow drawdown neutralization (withdrawal netral, withdrawal+loss, deposit+loss, overall netral, daily_realized netral, trough intraday per-segmen).
- [x] Seluruh test baru memanggil endpoint `GET /api/v1/bridge/risk` (bukan hanya fungsi service), jadi wiring route + schema ikut teruji.
- [x] `pytest` penuh lulus: **200 passed, 0 failed** (baseline 194 + 6 baru).
- [x] `lint-imports` **6 kept, 0 broken** (`app.domain` tetap pure tanpa dependency DB/framework).
- [ ] Deploy Ansible ke homeserver sukses (`changed > 0`, all containers healthy).
- [ ] Endpoint `/api/v1/bridge/risk` pada akun live melaporkan `daily_drawdown_percent: 0.0` (eliminasi alert merah palsu).

---

## Implementation Notes (lokal, 2026-11-15)

Perubahan yang sudah mendarat di working tree (belum commit, belum deploy):

| File | Perubahan |
| --- | --- |
| `app/services/bridge_status_service.py` | `_apply_cash_flow()` + `_cash_flow_timeline()`; lima cabang `get_daily_anchor()` disesuaikan; `get_daily_trough()` sadar-segmen (signature baru); `get_overall_drawdown()` basis trade-only dengan baseline deposit dikecualikan |
| `app/infrastructure/db/repositories/telemetry_repository.py` | fungsi baru `equity_minimum_between(db, connection_id, start, end)` |
| `app/api/v1/bridge.py` | `get_daily_trough(db, connection, anchor)`; expose `daily_anchor_adjusted` + `daily_cash_flow` |
| `app/models/risk.py` | dua field opsional transparansi (default `None`, backward compatible) |
| `tests/test_cash_flow.py` | 6 test endpoint + helper `seed_snapshot` / `seed_cash` |

Catatan desain yang perlu diketahui reviewer:
- `daily_starting_equity` / `daily_starting_balance` kini **nilai yang sudah disesuaikan**, bukan snapshot mentah. Nilai mentah = `daily_anchor_adjusted - daily_cash_flow`.
- `peak_equity` pada respons berarti **puncak performa netral kas**, bukan puncak saldo mentah.
- Denominator metrik berbeda secara sengaja: daily memakai modal aktif pada segmen terjadinya loss, overall memakai modal awal (trade-only). Contoh deposit $500 lalu loss $150: daily 10.0%, overall 15.0%.
