# Ticket 13-02: Cash Flow (Deposit & Withdrawal) as a Separate Stream

**Status:** in_progress — kode sensor + backend selesai dan hijau (2026-11-14); observasi `DEAL_ENTRY`/`DEAL_POSITION_ID` di akun demo belum dijalankan.
**Prasyarat:** 13-01  
**Membuka:** 13-03  
**Spesifikasi:** [`docs/specs/007-mql5-service-cashflow-and-dynamic-market.md`](../../docs/specs/007-mql5-service-cashflow-and-dynamic-market.md) §D2, §D2a, §D3, §3.2, §3.3

---

## Goal
Menambahkan arus kas (`DEAL_TYPE_BALANCE` → `DEPOSIT` / `WITHDRAWAL`) sebagai **stream data terpisah** dari posisi trading: sensor mengirim array `cash_flow`, backend menyimpannya di tabel sendiri, dan seluruh metrik trading (Win Rate, Profit Factor, PnL, day buckets, volume, source) tetap bersih secara struktural. Saldo/ekuitas dihitung dari initial deposit + cash flow + PnL trading.

---

## Konteks & Problem (terverifikasi 2026-11-14)

**Diagnosis awal spec (withdrawal masuk `closed_trades` sebagai trade kalah) belum terbukti.** Yang terbaca di kode:

1. `BuildClosedTradesJson()` (`mt5-ea/PipstrideMonitor.mq5:411-468`) hanya meloloskan `DEAL_ENTRY_OUT` (428). Balance deal secara tipikal tidak punya `DEAL_POSITION_ID`, jadi kemungkinan besar **tidak pernah** masuk `closed_trades`.
2. Balance deal saat ini hanya dibaca `GetAccountInitialDeposit()` (`:388-406`), yang mengambil **satu** balance deal positif pertama lalu `return` — bukan penjumlahan deposit, dan tidak melihat penarikan sama sekali.
3. `bridge_status_service` menghitung ekuitas sebagai `initial_deposit + Σ Trade.profit` (`:229-267`, `:478-491`), sehingga penarikan tidak pernah mengurangi ekuitas → **overstate**.
4. `metrics.py` tidak punya konsep cash flow; semua metrik dihitung dari row `trades` yang hanya berisi posisi.

**Verifikasi wajib sebelum menulis kode** (hasil 13-01): di akun demo, catat `DEAL_ENTRY`, `DEAL_POSITION_ID`, `DEAL_TYPE` untuk satu deposit dan satu penarikan.
- Bila balance deal ber-`DEAL_ENTRY_OUT` → balance deal **saat ini bocor** ke `closed_trades`; filter wajib ditambahkan di `BuildClosedTradesJson()`.
- Bila tidak → cukup tambahkan stream baru; jangan mengubah filter entry.
Tulis hasil observasi ini di tiket sebelum menutup status.

---

## Scope

### 1. Sensor: bangun array `cash_flow` (`mt5-ea/PipstrideMonitor.mq5`)
- Fungsi baru `string BuildCashFlowJson()`:
  - `HistorySelect(fromTime, TimeCurrent())`, `fromTime` memakai `InpHistoryDays` yang sama.
  - Iterasi deal; hanya `HistoryDealGetInteger(t, DEAL_TYPE) == DEAL_TYPE_BALANCE`.
  - `double p = HistoryDealGetDouble(t, DEAL_PROFIT)`; `category = (p >= 0 ? "DEPOSIT" : "WITHDRAWAL")`.
  - Emit: `{"ticket":%I64u,"category":"%s","profit":%.2f,"time":%I64d}` — **tanpa** `symbol`/`volume`/prices.
  - Batas 200 item terbaru (sama seperti `maxRecords` pada closed trades).
- Sertakan `cash_flow` di dua jalur kirim: heartbeat (`SendHeartbeat`) dan trade sync (`SendTradeSync`), karena reset jurnal memicu replay lewat `request_trade_resync`.
- Perbaiki/berhentikan `GetAccountInitialDeposit()`: backend yang menghitung deposit. Bila field `initial_deposit` masih dikirim, jangan pernah dipakai ketika baris cash flow sudah ada.
- Tambahkan komentar `// TODO(013+): DEAL_TYPE_CREDIT` agar tipe non-trading lain tidak diam-diam diabaikan.

### 2. Wire schema (`services/api/app/models/bridge.py`)
- `class CashFlowItem(BaseModel)`: `ticket: int`, `category: Literal["DEPOSIT","WITHDRAWAL"]`, `profit: float`, `time: int`.
- `HeartbeatPayload`: `cash_flow: List[CashFlowItem] = Field(default_factory=list, max_length=500)`.
- `SyncTradesRequest`: field yang sama.
- `TradeHistoryResponse`: tambah `cash_flow: List[CashFlowItem]`, `total_deposits: float`, `total_withdrawals: float`, `net_funding: float`.
- `services/api/app/services/telemetry_ingest_service.py:34`: tambahkan `"cash_flow"` ke `HEAVY_PAYLOAD_KEYS` (sudah dipersist ke DB, jangan di-echo tiap poll).

### 3. Persistensi (`services/api/app/db/models.py` + Alembic)
- Tabel baru `cash_flow_deals`:
  - `id` BIGINT PK autoincrement
  - `connection_id` String(36) FK `mt5_connections.id` `ondelete="CASCADE"` NOT NULL
  - `ticket` BigInteger NOT NULL
  - `category` String(12) NOT NULL (`DEPOSIT`/`WITHDRAWAL`)
  - `amount` Float NOT NULL (bertanda: negatif untuk penarikan)
  - `occurred_at` DateTime(timezone=True) NOT NULL
  - `created_at` DateTime(timezone=True) default `_now`
  - `UniqueConstraint("connection_id","ticket", name="uq_cash_flow_connection_ticket")`
  - `Index("ix_cash_flow_connection_time","connection_id","occurred_at")`
- Migrasi baru `services/api/migrations/versions/0005_cash_flow_deals.py`, `down_revision` = revisi terakhir (`0004_user_expires_at`). Wajib lolos `python scripts/check_migrations.py` (CI punya job drift).
- Repository baru `services/api/app/infrastructure/db/repositories/cash_flow_repository.py`:
  - `insert_cash_flow(db, connection_id, items)`
  - `existing_cash_flow_tickets(db, connection_id, tickets, chunk)`
  - `list_cash_flow(db, connection_id, since=None, until=None)`
  - `sum_cash_flow(db, connection_id, since=None, until=None) -> {deposits, withdrawals, net_funding}`
  - `delete_for_connection(db, connection_id)`
- Tidak menyentuh `count_trades`, `existing_tickets`, `uq_trade_connection_ticket`, atau `live_state` trade count.

### 4. Ingest (`telemetry_ingest_service.py`)
- `_persist_cash_flow(db, connection, payload)` mengikuti pola `_persist_trades`: dedupe per ticket → cek ticket yang sudah ada → insert.
- Panggil di `process_heartbeat()` (setelah `_persist_trades`) dan di `sync_trades()`.
- Sertakan `cash_flow_added` pada kondisi commit `if changed or snapshot_added or trades_added or cash_flow_added or db.new or db.dirty`.
- `IntegrityError` (race dua worker) ditangani seperti trades: rollback batch, jangan gagalkan heartbeat.
- `reset_journal()`: hapus `trades`, `snapshots`, **dan** `cash_flow_deals`; replay dari sensor wajib menyertakan cash flow.
- Respons `sync_trades`: tambah `cash_flow_inserted` (jangan mengubah arti `inserted`).

### 5. Domain & service
> Catatan: `app/services/journal_service.py` **tidak eksis** (dihapus di Fase 005). `/journal/stats` dibangun di `app/api/v1/journal.py` dari `trade_repository.list_trades()` + `domain/metrics.compute_stats()`.

- `domain/metrics.py`: fungsi murni baru
  ```python
  def compute_cash_flow(deals) -> dict:
      """Duck-typed on .amount and .category: {deposits, withdrawals, net_funding}."""
  ```
  `compute_totals()` / `compute_stats()` **tidak diubah** — beri docstring tegas bahwa keduanya trade-only dan tabel cash flow tidak boleh masuk ke sana.
- `services/api/app/api/v1/journal.py`: ambil cash flow pada window yang sama (`since` dari `RANGE_DAYS`), hitung `compute_cash_flow`, kirim sebagai `cash_flow` di response.
- `services/api/app/models/journal.py`: `class CashFlowSummary(BaseModel)` + field `cash_flow: CashFlowSummary` pada `JournalStatsResponse`.
- `services/api/app/services/bridge_status_service.py`:
  - `get_equity_curve()`: gabungkan event trading (`trade_repository.profit_points`) dengan event cash flow menjadi satu timeline `(timestamp, delta)`; `starting_equity` = initial deposit. Jangan double-count.
  - `get_initial_deposit_info()`: bila sudah ada baris cash flow, turunkan baseline dari deposit pertama; auto-detect sensor hanya fallback.
  - `get_trade_history()`: kirim `cash_flow` + `total_deposits` + `total_withdrawals` + `net_funding` (13-03 memakainya untuk tabel).
  - `get_risk_watchdog()` / drawdown: **tetap trade-only**, beri komentar eksplisit agar tidak "diperbaiki" jadi termasuk cash flow.
  - Agregat SQL pada `:136-139` (`Trade.profit > 0 / < 0`) tidak perlu filter category karena `trades` sekarang dijamin hanya posisi — verifikasi ulang setelah migrasi.

### 6. Tes (`services/api/tests/`)
- `test_domain_metrics.py`: `compute_cash_flow` (deposit, penarikan, campuran, kosong) + bukti `compute_totals` tidak berubah saat cash flow ada.
- `test_journal_stats.py`: response punya `cash_flow`; `totals` hanya menghitung trade; filter `period`/`symbol` konsisten.
- File baru `test_cash_flow.py`: ingest idempoten (duplikat ticket tidak menghasilkan baris ganda), `sync-trades` menyimpan cash flow, `reset` menghapus keduanya, dan `/bridge/history` mengembalikan dua array terpisah.
- `test_onboarding.py`: sesuaikan bila payload fixture heartbeat ditambah `cash_flow`.

---

## Files to Touch
- `mt5-ea/PipstrideMonitor.mq5`
- `apps/web/public/PipstrideMonitor.ex5` (rebuild)
- `services/api/app/models/bridge.py`
- `services/api/app/models/journal.py`
- `services/api/app/db/models.py`
- `services/api/app/infrastructure/db/repositories/cash_flow_repository.py` (baru)
- `services/api/app/infrastructure/db/repositories/telemetry_repository.py` (hanya bila reset ikut dipindah)
- `services/api/app/services/telemetry_ingest_service.py`
- `services/api/app/services/bridge_status_service.py`
- `services/api/app/api/v1/journal.py`
- `services/api/app/domain/metrics.py`
- `services/api/migrations/versions/0005_cash_flow_deals.py` (baru)
- `services/api/tests/test_domain_metrics.py`
- `services/api/tests/test_journal_stats.py`
- `services/api/tests/test_cash_flow.py` (baru)

---

## Konstrain & Keputusan yang Sudah Dikunci
1. **Dua stream, dua tabel.** Balance deal tidak pernah masuk `trades`. Kalau digabung, `count_trades`, `by_source` (magic 0 → "Manual"), `total_volume`, dan `uq_trade_connection_ticket` ikut tercemar dan setiap rumus butuh filter.
2. **Tidak ada `getattr(t,"category","TRADE")`** di `metrics.py`. Isolasi dilakukan di data layer, bukan filter kondisional.
3. **Tidak ada backfill.** Withdrawal historis tidak pernah tersimpan, jadi tidak ada yang perlu dimigrasikan; data baru mengalir setelah service versi baru terpasang.
4. Deposit/penarikan tidak memengaruhi `open_price`/`close_price`/`volume` karena field itu tidak ada di skema cash flow.

---

## Verification
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe

# drift migrasi (butuh PostgreSQL lokal)
../../.venv/Scripts/python.exe scripts/check_migrations.py
```

**Assertion yang harus ada di tes (angka konkret):**
| Skenario | Ekspektasi |
|---|---|
| 10 trade (9 win, 1 loss) + 3 penarikan | `totals.trades == 10`, `wins == 9`, `losses == 1`, `win_rate == 90.0`, `net_profit` = murni trading |
| 3 penarikan + 1 deposit | `cash_flow.deposits` = Σ deposit, `cash_flow.withdrawals` = Σ absolut, `net_funding = deposits - withdrawals` |
| Duplikat payload 2× | tabel cash flow tetap 1 baris per ticket |
| Reset jurnal | `trades` dan `cash_flow_deals` kosong; replay berikutnya mengisi keduanya |
| Equity curve | titik setelah penarikan lebih rendah sebesar nominal penarikan; drawdown tidak berubah karena penarikan |
| `/bridge/history` | `trades` tidak memuat ticket cash flow; `cash_flow` terpisah |

- `pytest` penuh lulus (bukan hanya `-k "metrics or journal"`: jalur ingest, migrasi, dan onboarding ikut terpengaruh).
- `lint-imports`: 6 kept, 0 broken.
- Checksum `apps/web/public/PipstrideMonitor.ex5` di modal diperbarui setelah rebuild sensor.

---

## Log Verifikasi (2026-11-14)

**Otomatis — hijau:**
- `pytest` → **185 passed** (baseline 177 + 8 tes baru di `tests/test_cash_flow.py`).
- `lint-imports` → **6 kept, 0 broken**.
- `alembic heads` → satu head, `0005_cash_flow_deals`; rantai `0004_user_expires_at -> 0005_cash_flow_deals` benar.
- `metaeditor64.exe /compile` → `Result: 0 errors, 0 warnings`; `mt5-ea/PipstrideMonitor.ex5` = 46.074 byte, SHA-256 `0c2b6f7d8abf75cd0b367a57e579f55593569b6ab29d39752ca712a135155700`, sudah disalin ke `apps/web/public/PipstrideMonitor.ex5` dan konstanta `EA_SHA256` di `Mt5ConnectModal.jsx` disamakan.
- Cakupan tes yang benar-benar ada: `compute_cash_flow` (dua arah + kosong), heartbeat idempoten per ticket, balance deal tidak pernah masuk tabel `trades`, `sync-trades` menyimpan dua stream, `/journal/stats` melaporkan `cash_flow` tanpa mengubah `totals`, kurva ekuitas memberi step pada penarikan, dan reset menghapus kedua tabel.

**Deviasi dari teks tiket (disepakati saat eksekusi):**
1. **Sensor hanya mengirim `cash_flow` lewat `POST /bridge/sync-trades`**, bukan heartbeat. Alasan: 200 baris balance deal pada setiap heartbeat 5 detik ≈ 12 KB egress per akun tanpa manfaat, karena `/bridge/history` sudah membaca dari SQL. Backend tetap **menerima** `cash_flow` di `HeartbeatPayload` (dipakai tes dan kompatibel mundur), jadi kontrak wire tidak menyempit.
2. **`BuildClosedTradesJson()` diberi guard eksplisit `DEAL_TYPE_BUY`/`DEAL_TYPE_SELL`**, bukan hanya `DEAL_ENTRY_OUT`. Guard ini menutup kedua kemungkinan hasil observasi `DEAL_ENTRY` pada balance deal, sehingga tidak perlu menunggu akun demo untuk mencegah kebocoran.
3. **Tes `compute_cash_flow` dan tes `/journal/stats` ditempatkan di `tests/test_cash_flow.py`** (bukan ditambahkan ke `test_domain_metrics.py`/`test_journal_stats.py`) agar seluruh perilaku dua-stream terbaca dalam satu file.
4. **Baseline ekuitas:** deposit paling awal (`cash_flow_repository.earliest_deposit`) dipakai sebagai baseline `initial_deposit` dan **dikecualikan** dari daftar event, supaya tidak dihitung dua kali. Konsekuensinya `all_time_pnl` pada `EquityCurveResponse` adalah delta saldo (termasuk funding), bukan PnL trading murni; metrik PnL trading tetap dari `trades`.
5. `get_initial_deposit_info()` **tidak diubah**: override manual tetap menang, lalu nilai sensor, lalu fallback saldo. Penurunan baseline dari baris cash flow belum diperlukan karena `earliest_deposit` menghasilkan angka yang sama pada data yang dikirim sensor.

**Belum dijalankan (utang verifikasi):**
- Observasi `DEAL_ENTRY`, `DEAL_POSITION_ID`, `DEAL_TYPE` untuk satu deposit dan satu penarikan di akun demo MT5 (butuh terminal pengguna). Guard pada butir 2 membuat hasil ini tidak lagi memblokir kode, tetapi tetap dicatat sebagai bukti.
- `python scripts/check_migrations.py` — butuh PostgreSQL; Docker Desktop tidak berjalan di mesin ini (`docker ps` → pipe tidak ditemukan). Sebagai gantinya hanya `alembic heads`/`history` yang diverifikasi.

---

## Amandemen Review (2026-11-15)

Self-review diff Fase 013 (model aktif, tanpa subagent) menemukan empat cacat pada bagian kas dan ekuitas; semuanya sudah diperbaiki dan diverifikasi ulang (`pytest` **193 passed**).

1. **Deposit baseline bisa lebih tua dari jendela sensor.** `BuildCashFlowJson()` hanya memindai `InpHistoryDays` (default 90 hari), sedangkan `GetAccountInitialDeposit()` memindai seluruh riwayat. Akun yang deposit awalnya lebih dari 90 hari lalu mengirim `initial_deposit = 1000` tetapi tidak pernah mengirim baris deposit tersebut, sehingga server memakai top-up berikutnya sebagai baseline dan kurva mulai dari angka yang salah. Sekarang sensor melakukan satu pemindaian penuh untuk balance deal positif pertama dan menambahkannya lewat helper baru `AppendCashFlowRecord()` bila waktunya lebih tua dari `fromTime`. Balance deal sangat jarang, jadi satu `HistorySelect(0, TimeCurrent())` tetap murah.
2. **Baseline hanya dikecualikan bila benar-benar berasal dari sensor dan tidak di-override.** `get_equity_curve()` sekarang membaca `has_override()` + helper baru `account_settings_service.get_sensor_initial_deposit()`, yang **tidak** jatuh ke `payload.balance`. Sebelumnya syaratnya hanya `deposit > 0`, padahal `get_effective_initial_deposit()` bisa jatuh ke saldo — dan saldo sudah memuat seluruh deposit/penarikan, sehingga mengecualikan deposit pertama terhadap baseline itu salah hitung. Dengan override manual, semua deposit dihitung sebagai event.
3. **Titik awal `range=ALL` mengikuti event paling awal.** `period_start_ts` dulu hanya melihat trade pertama, sehingga penarikan yang terjadi sebelum trade pertama menghasilkan titik bertimestamp lebih kecil daripada titik awal (kurva tidak monoton). Sekarang dipakai `min(trade pertama, event kas pertama) − 5 menit`.
4. **Tes penjaga baru** `test_equity_curve_counts_every_deposit_when_the_baseline_is_overridden`: override 5000 pada data yang sama → `[5000, 6000, 6050, 5750, 5950, 5930]` (deposit 1000 ikut dihitung sebagai step, bukan ditelan sebagai baseline).
