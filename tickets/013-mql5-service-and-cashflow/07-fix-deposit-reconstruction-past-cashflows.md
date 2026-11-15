# Ticket 13-07: Fix Deposit Reconstruction Historical Cash Flows & Zero-Equity Drawdown

**Status:** done  
**Prasyarat:** 13-06  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/009-deposit-reconstruction-drawdown-fix.md`](../../docs/specs/009-deposit-reconstruction-drawdown-fix.md)

---

## Goal

Mengeliminasi lonjakan palsu 100.00% Daily Drawdown (dan peringatan keliru LIMIT BREACHED) saat pergantian hari broker pada akun yang pernah melakukan penarikan dana di masa lalu atau akun yang bersaldo nol/ditarik habis, dengan cara mengikutsertakan seluruh mutasi kas historis sebelum boundary pada alur `deposit_reconstruction` dan menerapkan guard aman pada evaluasi ekuitas nol.

---

## Konteks & Problem (Temuan Akun #452024626)

1. **Mekanisme Bug Rekonstruksi:**
   - Pada `bridge_status_service.get_daily_anchor()`, jika tidak ada snapshot telemetri yang valid di sekitar pergantian hari broker (misal akhir pekan pasar tutup atau akun offline), sistem memakai `deposit_reconstruction`:
     ```python
     realized = trade_repository.sum_profit_between(db, connection.id, until=boundary)
     reconstructed = round(float(deposit) + realized, 2)
     ```
   - Formula di atas mengasumsikan modal akun hanyalah `initial_deposit + realized_profit`.
   - **Bug:** Mutasi penarikan kas (seperti penarikan -1,700 USC pada 13 November) dan deposit tambahan sebelum `boundary` sama sekali tidak diperhitungkan.
   - Sistem merekonstruksi anchor awal hari menjadi `1,694.30 USC`, padahal saldo riil yang tersisa saat itu adalah `0.00 USC`.

2. **Mekanisme Bug Evaluasi Ekuitas Nol:**
   - Ketika anchor fiktif `1,694.30 USC` dibandingkan dengan ekuitas live `0.00 USC`:
     $$\text{Daily Drawdown} = \frac{1,694.30 - 0.00}{1,694.30} \times 100\% = 100.00\%$$
   - Hal ini langsung memicu status merah **LIMIT BREACHED** di web dashboard pada hari di mana pengguna sama sekali tidak membuka maupun menutup trade.

---

## Scope Pekerjaan

### 1. Backend Service Layer (`services/api/app/services/bridge_status_service.py`)

1. **Sertakan Mutasi Kas Historis Sebelum `boundary`**:
   - Di `get_daily_anchor()` cabang `deposit_reconstruction`:
     - Hitung akumulasi cash flow hingga `boundary` menggunakan `cash_flow_repository.sum_cash_flow(db, connection.id, until=boundary)`.
     - Jika tanpa deposit override, modal rekonsiliasi adalah `net_funding (until boundary) + realized_profit (until boundary)`.
     - Jika dengan deposit override, kurangkan deal baseline deposit pertama agar tidak terhitung ganda.
   - Jika `reconstructed <= 0`:
     - Jangan tetapkan anchor positif semu. Akun tidak memiliki modal dipertaruhkan, sehingga harus jatuh ke `current_fallback` aman (atau anchor `equity = None`).

2. **Guard Ekuitas dan Saldo Nol pada `current_fallback`**:
   - Jika `current_balance <= 0` dan `current_equity <= 0`:
     - Tetapkan `anchor["balance"] = None` dan `anchor["equity"] = None`.
     - Jangan biarkan angka 0 dievaluasi sebagai pembanding yang menghasilkan drawdown 100%.

### 2. Domain Policy Layer (`services/api/app/domain/policies.py`)

1. Pastikan `evaluate_drawdown` mengembalikan `0.00%` (`is_alert_active=False`) jika `anchor_equity` adalah `None` atau $\le 0$, atau saat `current_equity == 0.0` dan tidak ada aktivitas kerugian trading harian baru.

### 3. Test Suite Tambahan (`services/api/tests/test_connections.py` & `test_domain_metrics.py`)

1. **Test `test_deposit_reconstruction_accounts_for_prior_withdrawals`**:
   - Akun deposit 1,103, profit 591.30, withdraw 1,700 sebelum boundary, saldo live 0.
   - Verifikasi daily drawdown adalah `0.0%`, bukan 100%, dan alert tidak aktif.
2. **Test `test_deposit_reconstruction_with_partial_withdrawal`**:
   - Akun deposit 1,000, withdraw 400 kemarin, profit 100, tidak ada snapshot hari ini.
   - Anchor awal hari terhitung tepat `700.0` (bukan `1,100.0`).

---

## Verification

Jalankan rangkaian pengujian verifikasi wajib:
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest tests/test_connections.py tests/test_domain_metrics.py
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```
Hasil yang diharapkan:
- Seluruh pengujian (termasuk kasus penarikan masa lalu) `PASSED`.
- `lint-imports`: 6 kept, 0 broken.

---

## Implementation Notes (lokal, 2026-11-15)

| File | Perubahan |
| --- | --- |
| `app/services/bridge_status_service.py` | `get_daily_anchor()` cabang `deposit_reconstruction` memanggil helper baru `_reconstruct_capital()` (net funding ≤ boundary + realized ≤ boundary); cabang `current_fallback` menahan `balance`/`equity` tetap `None` saat saldo/ekuitas ≤ 0 |
| `app/infrastructure/db/repositories/cash_flow_repository.py` | `sum_cash_flow()` menerima `exclude_id` opsional (dipakai agar deposit baseline tidak dihitung dua kali saat ada manual override) |
| `app/domain/policies.py` | `evaluate_drawdown()` mengabaikan `current_equity`/`lowest_equity` yang ≤ 0 (pembacaan nol = tidak ada data akun / modal ditarik, bukan akun hancur) |
| `tests/test_connections.py` | helper `drop_snapshots()` + 3 tes: penarikan penuh (akun `#452024626`), penarikan sebagian (anchor 700), tanpa riwayat cash flow |
| `tests/test_domain_metrics.py` | 2 tes batas: anchor kosong + ekuitas 0, serta ekuitas live 0 vs anchor positif |

Bukti verifikasi:
- `pytest tests/test_connections.py tests/test_domain_metrics.py` → 55 passed.
- `pytest` penuh → **205 passed** (200 sebelum tiket ini, 5 tes baru), 1 warning Starlette pra-ada.
- `lint-imports` → **6 kept, 0 broken**.

Catatan desain yang perlu diketahui reviewer:
- Baseline deposit adalah bagian dari `net_funding` karena `initial_deposit` sensor *memang* deal saldo pertama. Saat manual override aktif, deal pertama dikecualikan (`exclude_id`) karena override menggantikannya (sesuai SPEC-009 D1). Perlu diketahui reviewer: `get_equity_curve()` pada kondisi override justru menerapkan **semua** deal sebagai step (perilaku lama) — perbedaan ini sengaja dibiarkan agar anchor mengikuti D1; menyamakan keduanya butuh tiket tersendiri.
- Bila tidak ada baris `cash_flow_deals` sama sekali (riwayat belum tersinkron), rekonstruksi kembali ke `deposit + realized` supaya akun lama tidak kehilangan anchor.
- Rekonstruksi ≤ 0 tidak dipaksakan positif: anchor `balance`/`equity` menjadi `None`, sehingga `/bridge/risk` melaporkan `daily_drawdown_percent: 0.0` dan `is_alert_active: false`.
- Guard ekuitas nol berada di `evaluate_drawdown` (daily), bukan `evaluate_overall_drawdown`: akun yang benar-benar ludes tetap wajar terlihat pada peak-to-trough, sedangkan badge harian yang menyala tiap pergantian hari adalah bug yang dilaporkan.
- Belum diverifikasi pada akun produksi `#452024626` (butuh deploy + heartbeat live); verifikasi otomatis sudah hijau.
