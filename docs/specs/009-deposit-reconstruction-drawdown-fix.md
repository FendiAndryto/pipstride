# SPEC-009: Deposit Reconstruction Historical Cash Flow & Zero-Equity Drawdown Fix

**Status:** approved  
**Prioritas:** High (Integritas Metrik Risiko & Eliminasi False 100% Daily Drawdown)  
**Referensi:** ADR 0004 (Strictly Read-Only), ADR 0009 (Layered Architecture), SPEC-003 (Daily & Overall Drawdown), SPEC-007 (Cash Flow Isolation), SPEC-008 (Cash-Flow-Neutralized Drawdown)

---

## 1. Problem Statement

Pada SPEC-008 (Fase 013 Tiket 06), alur netralisasi mutasi kas pada hari berjalan (`_apply_cash_flow`, `since=boundary`) telah diimplementasikan untuk mencegah lonjakan drawdown palsu akibat penarikan dana di tengah hari.

Namun, pengujian pada akun produksi riil (`#452024626` di server `Exness-MT5Real48`) menemukan **anomali kritis pada kalkulasi anchor awal hari (`deposit_reconstruction`) dan evaluasi saat ekuitas nol**:

### P1 — `deposit_reconstruction` Mengabaikan Mutasi Arus Kas Historis Sebelum Boundary
1. **Mekanisme Anomali:**
   - Pada `bridge_status_service.get_daily_anchor()`, jika akun tidak memiliki snapshot telemetri yang valid di sekitar pergantian hari broker (misal saat akhir pekan pasar tutup, terminal MT5 mati, atau akun baru dihubungkan kembali), sistem fallback ke metode `deposit_reconstruction`:
     ```python
     realized = trade_repository.sum_profit_between(db, connection.id, until=boundary)
     reconstructed = round(float(deposit) + realized, 2)
     ```
   - Nilai `deposit` diambil dari `initial_deposit` pertama (misal `1,103.00 USC`).
   - Nilai `realized` adalah total profit trading hingga batas hari (misal `+591.30 USC`).
   - **Bug:** Formula ini **sama sekali tidak memperhitungkan penarikan dana maupun deposit tambahan** yang terjadi di antara deposit awal dan batas hari `boundary`!
   - Pada akun `#452024626`, pengguna telah melakukan penarikan dana sebesar `-1,700.00 USC` pada 13 November (dua hari sebelum hari evaluasi).
   - Akibatnya, `reconstructed` dihitung menjadi:
     $$\text{Reconstructed Anchor} = 1,103.00 + 591.30 = \mathbf{1,694.30\text{ USC}}$$
     Sistem secara keliru menganggap akun memulai hari dengan modal `1,694.30 USC`, mengabaikan kenyataan bahwa `1,700.00 USC` telah ditarik keluar.

### P2 — Akun Bersaldo/Ekuitas Nol Dilaporkan 100.00% Daily Drawdown (Limit Breached)
1. **Mekanisme Anomali:**
   - Setelah penarikan dana `-1,700.00 USC` dan beberapa trade loss penutup, saldo dan ekuitas live akun di terminal MT5 adalah `0.00 USC`.
   - Hari ini (Minggu) pasar tutup dan **tidak ada satu pun transaksi trading baru**.
   - Namun, sistem membandingkan anchor fiktif (`1,694.30 USC`) dengan ekuitas live (`0.00 USC`):
     $$\text{Daily Drawdown} = \frac{1,694.30 - 0.00}{1,694.30} \times 100\% = \mathbf{100.00\%}$$
   - Status risiko langsung menyala merah dengan badge **LIMIT BREACHED**, menciptakan alarm palsu yang sangat fatal bagi trader/prop trader.
   - Selain itu, ketika ekuitas akun mencapai `0.00` karena penarikan modal habis (*withdrawn*) atau likuidasi lampau, membandingkannya dengan anchor historis dan melaporkan 100% trading loss harian adalah kesalahan interpretasi risiko.

---

## 2. Keputusan Desain (Design Decisions)

### D1 — Rekonstruksi Anchor Wajib Memperhitungkan Seluruh Mutasi Kas Hingga Boundary
Dalam metode `deposit_reconstruction`, ekuitas awal hari yang jujur sebelum rollover broker harus merefleksikan posisi kas riil:
$$\text{Reconstructed Equity} = \text{Effective Initial Capital} + \Delta CF_{\le \text{boundary}} + \text{Profit}_{\le \text{boundary}}$$

Di mana:
1. Jika akun menggunakan *sensor initial deposit* (tanpa manual override):
   - Deal deposit pertama di tabel `cash_flow_deals` merepresentasikan `initial_deposit`.
   - Mutasi kas bersih sebelum batas hari dihitung dari:
     $$\text{Net Funding}_{\le \text{boundary}} = \sum_{t \le \text{boundary}} (\text{Deposits} - \text{Withdrawals})$$
   - Sehingga modal kas + hasil trading adalah:
     $$\text{Reconstructed Equity} = \text{Net Funding}_{\le \text{boundary}} + \text{Profit}_{\le \text{boundary}}$$
2. Jika akun menggunakan *manual deposit override*:
   - Mutasi kas dihitung dari seluruh cash flow selain baseline deposit pertama, ditambah nilai override.

### D2 — Guard Nilai Anchor Non-Positif
* Jika hasil rekonstruksi ekuitas $\le 0.00$ (misalnya modal telah ditarik habis sebelum hari ini):
  - Akun tidak memiliki modal aktif yang dipertaruhkan hari ini.
  - Anchor `equity` dan `balance` tidak boleh dipaksakan bernilai positif semu.
  - Sesuai prinsip SPEC-008: Anchor non-positif tidak dapat mengevaluasi drawdown trading dan harus fallback ke pelaporan aman `drawdown = 0.0%` tanpa memicu alert breach.

### D3 — Guard Ekuitas Nol Tanpa Aktivitas Trading Harian
* Pada `evaluate_drawdown`:
  - Jika ekuitas live bernilai `0.0` (atau saldo kosong) dan tidak ada trade yang berjalan/terbuka hari ini, serta tidak ada kerugian intraday baru:
    $$\text{Daily Drawdown} = 0.0\% \quad (\text{Alert Active} = \text{False})$$
  - Ini memastikan bahwa akun yang memang kosong/ditarik tidak pernah memicu alarm harian 100% terus-menerus setiap hari baru berganti.

---

## 3. Spesifikasi Teknis

### 3.1 Backend Service Layer (`services/api/app/services/bridge_status_service.py`)

1. **Perbaikan Cabang `deposit_reconstruction` pada `get_daily_anchor()`**:
   ```python
   if deposit and deposit > 0:
       realized = trade_repository.sum_profit_between(db, connection.id, until=boundary)
       
       # Hitung seluruh mutasi kas (deposit & penarikan) sebelum boundary
       has_override = account_settings_service.has_override(db, connection)
       if not has_override:
           # Baseline deposit adalah bagian dari net_funding
           cash_summary = cash_flow_repository.sum_cash_flow(db, connection.id, until=boundary)
           reconstructed = round(float(cash_summary["net_funding"]) + realized, 2)
       else:
           # Manual override menggantikan deal pertama
           baseline_deal = cash_flow_repository.earliest_deposit(db, connection.id)
           baseline_ticket = baseline_deal.ticket if baseline_deal else None
           cash_summary = cash_flow_repository.sum_cash_flow(
               db, connection.id, until=boundary, exclude_ticket=baseline_ticket
           )
           reconstructed = round(float(deposit) + float(cash_summary["net_funding"]) + realized, 2)

       if reconstructed > 0:
           anchor.update(
               balance=reconstructed,
               equity=reconstructed,
               source="deposit_reconstruction",
           )
           return self._apply_cash_flow(db, connection, anchor)
   ```

2. **Perbaikan `current_fallback`**:
   - Jika `current_balance <= 0` dan `current_equity <= 0`:
     Anchor menetapkan `balance = None` dan `equity = None`.
   - Dengan anchor `equity = None`, `policies.evaluate_drawdown` otomatis mengembalikan `0.0%` dan `is_alert_active = False`.

### 3.2 Domain Policy Layer (`services/api/app/domain/policies.py`)

1. **Evaluasi Aman pada `evaluate_drawdown`**:
   - Pastikan bahwa jika `current_equity == 0.0` dan `anchor_equity` tidak valid atau bernilai nol, hasil drawdown tidak pernah membagi dengan nol atau menghasilkan 100% tanpa adanya kerugian riil hari ini.
   - Tambahkan unit test boundary untuk kasus akun ditarik habis (saldo 0) agar selalu menghasilkan drawdown 0.0%.

---

## 4. Kriteria Sukses & Verifikasi

1. **Unit Test API (`services/api/tests`)**:
   - Test kasus: Akun deposit 1,103, profit 591.30, withdraw 1,700 sebelum hari H, saldo hari H = 0 ➔ Daily drawdown hari H terlaporkan **0.00%**, bukan 100.00%.
   - Test kasus: Akun deposit 1,000, withdraw 400 kemarin, hari ini rollover tanpa snapshot ➔ `deposit_reconstruction` menghasilkan anchor 600, bukan 1,000.
   - Seluruh test suite (`pytest`) lulus 100%.
2. **Arsitektur & Lint**:
   - `lint-imports` tetap 6 kept, 0 broken.
3. **Web Dashboard**:
   - Kartu Drawdown pada akun `#452024626` menampilkan Daily Drawdown **0.00%** (atau —) tanpa tag merah `LIMIT BREACHED`.
