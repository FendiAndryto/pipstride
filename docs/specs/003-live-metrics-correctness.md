# SPEC-003: Live Metrics Correctness — Daily Drawdown, Overall Drawdown, Market Structure Timeframes

**Status:** approved (2026-11-06)
**Prioritas:** hotfix sebelum Fase 007 (`007-admin-console`)
**Referensi:** ADR 0004 (read-only), ADR 0009 (layering), `docs/audits/pilar1-clean-architecture.md` §1.1.5–1.1.6

---

## Problem

Tiga keluhan dari produksi (homeserver) setelah Fase 001–006 + 008 naik:

### P1 — Daily drawdown di dashboard tidak mencerminkan "hari"

`GET /api/v1/bridge/risk` mengembalikan angka yang secara teknis dihitung, tetapi
basisnya salah di empat titik:

1. **Basis campur.** Anchor memakai *balance*, pembilang memakai *equity*
   (`domain/policies.py:36`). Posisi yang masih floating saat pergantian hari
   menghasilkan drawdown "harian" palsu di detik pertama hari baru — floating
   −200 pada balance 10.000 terbaca 2,00% tanpa satu order pun ditutup.
2. **Batas hari memakai UTC.** `bridge_status_service.py:323-324` memakai
   `now.replace(hour=0, ...)` di UTC. Broker MT5 umumnya rollover 00:00 waktu
   server (UTC+2/+3), sehingga reset terjadi 02:00–03:00 waktu trader dan trade
   yang ditutup 23:30 server masuk hitungan hari yang salah.
3. **Snapshot dipakai tanpa batas kesegaran dan tanpa roll-forward.**
   `telemetry_repository.balance_at_or_before()` mengembalikan snapshot terakhir
   ≤ tengah malam *berapa pun tuanya*, lalu P&L antara snapshot itu dan tengah
   malam tidak dijumlahkan. EA yang sempat mati/restart membuat baseline menjadi
   saldo berhari-hari lalu, sehingga P&L kemarin terhitung sebagai drawdown hari ini.
4. **Tidak ada drawdown intraday.** Nilai yang dilaporkan hanya
   "equity sekarang vs anchor". Rugi −3% pagi lalu pulih siang terbaca 0,00% dan
   alert 3% tidak pernah menyala, padahal drawdown harian harus dikalkulasi pada
   setiap penutupan order.
5. **Frontend punya rumus cadangan yang berbeda.** `domain/pnl.js:45-53` jatuh ke
   `(balance − equity) / balance` saat `/bridge/risk` gagal (409/timeout) — itu
   floating loss, bukan drawdown harian. Kartu Home bisa 0,0% saat harinya merah,
   dan angka Home ≠ angka Profile.

### P2 — Market structure hanya M5 dan M15

Bukan filter UI: datanya tidak pernah ada. EA hanya mengirim dua array
(`mt5-ea/PipstrideMonitor.mq5:677-684` → `candles` M15, `candles_m5` M5), dan
`HeartbeatPayload` hanya punya dua field itu (`models/bridge.py:99-100`).
Tombol `['M5','M15']` di `MarketTab.jsx:328` adalah konsekuensi.

Asal-usul: tiket `006-05:51-52` membuang cabang `H1` karena waktu itu H1
menampilkan candle M15 yang dilabeli H1 (pelanggaran data-integrity). Keputusan
itu benar (lebih baik tidak ada daripada angka bohong), tetapi hasilnya hanya dua
timeframe. Menambah H1/H4 adalah pekerjaan plumbing data, bukan toggle.

### P3 — "Drawdown keseluruhan" di Profile tidak pernah dihitung, dan tempatnya salah

`RiskWatchdogSection.jsx:16` memakai `deriveDrawdownWatch(riskStatus)` yang
isinya **daily** drawdown. Copy kartu (`translations.js:450`) menjanjikan
"equity drawdown against the deposit baseline" dan footer menampilkan
`initial_deposit` sebagai "Deposit baseline", tetapi angka dan bar-nya harian.
Tidak ada field overall/max drawdown di `RiskWatchdogStatusResponse`
(`models/risk.py`), dan `peak_equity` yang sudah dihitung
(`bridge_status_service.py:279`) tidak pernah dipakai frontend.

Selain angkanya salah, **tempatnya juga salah**: drawdown adalah metrik
performansi, sejajar dengan realized P/L dan profit factor — bukan metrik
koneksi/akun. Karena itu kartu drawdown dipindahkan ke halaman **Journal**,
tepat setelah KPI cards. Halaman Profile kembali murni ke koneksi MT5, akun
aktif, email, dan password; `margin_level` yang sebelumnya hanya ada di kartu
risk dipindahkan sebagai baris kecil di kartu Active Account agar tidak hilang.

---

## Keputusan Desain

### D1 — Batas hari = waktu server broker

Offset broker harus berasal dari **jam server**, dan MT5 punya dua jam yang mudah
tertukar: `TimeCurrent()` (server broker, yang menentukan hari trading) dan
`TimeLocal()` (jam PC trader). Sumber offset, berurutan:

1. `broker_time` — `TimeCurrent()` yang dikirim eksplisit oleh build EA terbaru.
2. Timestamp candle (`MqlRates.time`, selalu waktu server) — dipakai build EA lama
   yang belum mengirim `broker_time`.
3. Cache per koneksi (Redis/in-process, TTL 1 jam) saat bridge senyap.
4. `0` (UTC) bila tidak ada sumber yang bisa dipakai.

`payload.timestamp` **tidak** dipakai untuk offset: nilainya `TimeLocal()`, jam PC
trader. Memakainya menempatkan boundary di tengah malam PC — 7 jam meleset untuk
trader UTC+7 di server UTC — yaitu bug yang justru ingin dicegah (lihat D9). Field
itu tetap dikirim untuk dokumentasi/diagnostik.

```text
offset_seconds = broker_clock - now_utc
offset_seconds = round(offset_seconds / 900) * 900     # 15 menit terdekat
offset_seconds = clamp(offset_seconds, -14h, +14h)
```

Boundary harian = tengah malam pada waktu broker, dikonversi kembali ke UTC.
Offset di-cache per koneksi supaya fluktuasi jam antar-heartbeat tidak menggeser
boundary. Fallback ke UTC bila tidak ada sumber (bridge offline).

Fungsi murni baru di `app/domain/time.py`:

- `broker_utc_offset_seconds(payload_timestamp, now_utc)` — offset 15-menit terdekat, di-clamp.
- `broker_offset_from_bars(candles, now_utc)` — offset dari bar tertua/terbaru yang server-stamped.
- `broker_day_start_utc(now_utc, offset_seconds)` — boundary hari dalam UTC.

### D2 — Anchor = (balance, equity) di boundary, di-roll-forward

Snapshot yang dipakai sebagai anchor **bukan** snapshot mentah, melainkan hasil
roll-forward ke boundary:

```text
anchor_balance = snapshot.balance + Σ profit(closed_at ∈ (snapshot.captured_at, boundary])
anchor_equity  = anchor_equity(snapshot) + Σ profit(closed_at ∈ (snapshot.captured_at, boundary])
```

Konsekuensi: snapshot tua tetap berguna (tidak perlu menunggu EA hidup tepat di
tengah malam), tetapi P&L yang terjadi setelah snapshot itu tidak lagi hilang.
Sumber anchor dicatat di response (`daily_anchor_source`), urut dari yang paling
dipercaya:

| source | arti |
|---|---|
| `snapshot_exact` | snapshot dalam 90 detik dari boundary (tidak perlu roll-forward) |
| `snapshot_rollforward` | snapshot ≤ boundary yang lebih tua; equity-nya di-roll-forward dengan trade sampai boundary |
| `session_start` | tidak ada snapshot di boundary (EA baru hidup hari itu); snapshot **pertama hari itu** dipakai apa adanya |
| `deposit_reconstruction` | tidak ada snapshot sama sekali; `deposit + Σ profit(closed_at ≤ boundary)` |
| `current_fallback` | tidak ada snapshot dan tidak ada deposit; anchor = equity sekarang → laporan jujur 0%, bukan turunan |

Anchor **tidak pernah** diturunkan dari balance sekarang. Rumus
`balance_sekarang − profit_hari_ini` terlihat masuk akal, tetapi menghasilkan
`floating/balance` sebagai "drawdown harian" — persis angka salah yang tiket ini
hapus. Karena itu `session_start` (observasi nyata) dipakai sebagai ganti
rekonstruksi sirkular.

### D3 — Drawdown dibanding equity ke equity

Semua drawdown harian dihitung dari **equity anchor** ke **equity sekarang**,
bukan balance ke equity. Floating loss saat pergantian hari tidak lagi
menciptakan drawdown palsu.

### D4 — Dua angka harian, alert memakai yang maksimum

| field | arti |
|---|---|
| `daily_drawdown_percent` | equity sekarang vs anchor equity (≥ 0), bisa turun lagi kalau pulih |
| `daily_max_drawdown_percent` | titik terendah equity hari ini (dari snapshot sejak boundary + equity sekarang) |

`is_alert_active` dan `alert_reason` memakai `daily_max_drawdown_percent`.
Drawdown harian yang benar tidak boleh turun setelah kena — kalau pagi −3,5% lalu
siang pulih ke −0,5%, alert tetap menyala sampai pergantian hari. Ini yang
memenuhi "dikalkulasi setiap penutupan order".

**Resolusi:** max intraday dibatasi interval snapshot
(`SNAPSHOT_MIN_INTERVAL_SECONDS = 30`). Trade yang ditutup lalu langsung pulih
dalam < 30 detik bisa terlewat. Ini keterbatasan yang didokumentasikan, bukan bug.

**Bug pasca-deploy (akun baru):** EA heartbeat sebelum MT5 selesai login dan
mengirim `balance=0`/`equity=0`. Baris itu dipakai sebagai anchor fallback
(`session_start` gagal, jatuh ke `deposit_reconstruction`) **dan** sebagai trough
intraday, sehingga akun yang baru connect terbaca "drawdown harian 100,00%"
sampai pergantian hari. Data produksi 2026-11-05: 20 snapshot nol pada
15:28–15:39 UTC menghasilkan 100,00%; setelah baris nol diabaikan, angka yang
benar untuk hari itu adalah 7,89%. Query snapshot sekarang mengabaikan baris
dengan balance/equity ≤ 0 — nol berarti "belum ada data akun", bukan akun habis
(MT5 stop out jauh sebelum equity menyentuh nol).

### D5 — Overall drawdown = peak-to-trough

"Drawdown keseluruhan" yang diminta adalah **max peak-to-trough ekuitas sejak
awal**, ditambah drawdown saat ini dari puncak:

```text
peak_equity            = max(equity sepanjang riwayat yang bisa direkonstruksi)
overall_drawdown_pct   = (peak_equity − equity_sekarang) / peak_equity × 100
max_overall_drawdown_pct = max((peak_running − equity_running) / peak_running × 100)
```

Rekonstruksi memakai basis yang sama dengan equity curve: `deposit + Σ profit`
per trade, plus titik equity live terakhir. Ambang alert overall terpisah:
`MAX_OVERALL_DRAWDOWN_PERCENT = 10.0` (config baru).

`initial_deposit` tetap ditampilkan di kartu drawdown sebagai **baris
pembanding** ("vs modal awal"), tidak lagi dipakai sebagai label drawdown harian.

### D6 — Penempatan UI: drawdown tinggal di Journal, Profile dibersihkan

| Sebelum | Sesudah |
|---|---|
| Kartu "Risk Watchdog" (daily DD) di `ProfileTab` | Kartu "Drawdown" di `JournalTab`, tepat setelah `KpiCards` |
| `margin_level` hanya di kartu risk | Baris kecil di `ActiveAccountSection` (Profile) |
| `initial_deposit` sebagai "Deposit baseline" untuk DD harian | Baris pembanding "vs modal awal" di kartu drawdown Journal |

Alasan: drawdown adalah metrik performansi (sejajar realized P/L, win rate,
profit factor), bukan metrik koneksi. Menempatkannya di Journal membuat trader
melihat hasil dan risiko dalam satu pandangan. Section `profile_risk_section` di
Profile dihapus beserta `RiskWatchdogSection.jsx` dan `deriveDrawdownWatch`.

Kartu drawdown Journal berisi **dua gauge terpisah**:
- **Overall** — `max_drawdown_percent` (peak-to-trough) terhadap
  `max_overall_drawdown_percent` (10%), plus `overall_drawdown_percent` saat ini
  dari puncak dan nilai `peak_equity`.
- **Daily** — `daily_max_drawdown_percent` terhadap
  `max_daily_drawdown_percent` (3%), plus `daily_drawdown_percent` saat ini dan
  waktu anchor hari broker.

Data diambil dari `/bridge/risk` yang sudah dipoll `Dashboard` (`riskStatus`),
jadi tidak ada request baru dan tidak ada polling tambahan.


### D7 — Kontrak API (aditif, backward compatible)

`GET /api/v1/bridge/risk` — semua field baru punya default, sehingga bundle web
lama tetap jalan:

```json
{
  "daily_drawdown_percent": 1.24,
  "daily_max_drawdown_percent": 2.87,
  "daily_realized_pnl": -184.5,
  "daily_starting_balance": 12000.0,
  "daily_starting_equity": 11940.0,
  "daily_anchor_at": 1735689600,
  "daily_anchor_source": "snapshot_rollforward",
  "overall_drawdown_percent": 4.12,
  "max_drawdown_percent": 7.85,
  "peak_equity": 12450.0,
  "peak_equity_at": 1735000000,
  "max_overall_drawdown_percent": 10.0,
  "is_overall_alert_active": false,
  "is_alert_active": false
}
```

Field lama (`daily_drawdown_percent`, `daily_starting_balance`,
`max_daily_drawdown_percent`, `margin_level`, `is_alert_active`) dipertahankan
dengan semantik yang diperbaiki.

### D8 — Market structure M5/M15/H1/H4

- **EA:** tambah `BuildCandlesJson(PERIOD_H1)` dan `(PERIOD_H4)` di cache 30 detik
  yang sama (`PipstrideMonitor.mq5:677-684`), kirim sebagai `candles_h1` /
  `candles_h4`. Jumlah bar: M5/M15 tetap 35, H1/H4 = 24 (struktur hanya butuh 24).
- **API:** `HeartbeatPayload` menambah `candles_h1` dan `candles_h4`
  (default `[]`, `max_length=500`). Live payload otomatis meneruskannya lewat
  `/bridge/status`.
- **Web:** tombol `['M5','M15','H1','H4']`. TF tanpa data → tombol disabled dan
  state jujur ("EA belum mengirim H1 — perbarui PipstrideMonitor.mq5"), **tanpa**
  angka fabrikasi (ADR 0004, audit §1.1.5).
- **Kompatibilitas:** API baru + EA lama → field kosong (aman). EA baru + API lama
  → field di-drop Pydantic (aman).
- **Operasional:** user harus **unduh ulang EA**; token dan preset tidak berubah.
  `mt5-ea/PipstrideMonitor.mq5` dan `apps/web/public/PipstrideMonitor.mq5` wajib
  tetap identik (gotcha AGENTS.md).
- **Egress:** candle naik dari 2×35 ke 2×35 + 2×24 bar ≈ +4,5 KB per heartbeat.
  Diterima (masih di bawah 10 KB/tick); opsi lanjutan bila perlu: kirim HTF hanya
  saat rebuild 30 detik dan merge di `live_state`.
- **Kontrak urutan (bug pasca-deploy):** `BuildCandlesJson` mengirim candle
  **oldest-first** (loop `copied-1 → 0`), dan API meneruskannya apa adanya. Versi
  pertama Market tab mengasumsikan newest-first: ia mengambil `slice(0, bars)`
  (bar **tertua**) lalu membandingkan `last.open` dengan `first.close`, sehingga
  XAUUSD yang naik terbaca "BEARISH −2,13%" di H1 dan "−6,23%" di H4. Sekarang
  urutan dinormalisasi di `src/domain/market.js` (`normalizeCandles`) dan window
  diambil dari ujung terbaru (`slice(-bars)`). Konsumen baru **wajib** memakai
  helper ini, bukan mengasumsikan urutan dari EA.
- **Definisi bias (bug pasca-deploy kedua):** net change seluruh window (H4 = 24
  bar = 4 hari) membuat badge tetap BULLISH saat harga sudah jatuh — H1 +1,44%
  padahal 6 candle terakhir −0,54%. Bias sekarang = arah **6 candle terakhir**
  (`BIAS_BARS`), struktur = high/low 6 candle terakhir vs 6 sebelumnya
  (`STRUCTURE_BARS`), dan range/support/resistance tetap dari seluruh window.
  Dengan data 2026-11-05 14:50 UTC: H1 BEARISH (−0,54%, lower lows), H4 BULLISH
  (+1,38%, higher highs) — sedangkan window H1 masih +1,44% dan H4 +5,69%.
  Menurunkan `BIAS_BARS` membuat badge lebih cepat berbalik (lebih berisik);
  menaikkannya membuat lebih lambat.
- **Suffix broker (bug pasca-deploy ketiga):** watchlist memakai nama dasar
  (`XAUUSD`) sedangkan chart Exness melaporkan `XAUUSDc`. Perbandingan literal
  membuat **semua** timeframe "TANPA DATA" pada akun yang baru connect.
  `isSameInstrument` di `src/domain/market.js` meniru `FindBrokerSymbol` di EA
  (nama sama, atau prefix + maksimal 4 karakter tambahan), dan tab Market
  mengikuti simbol chart sampai user memilih simbol lain.

### D9 — `broker_time` menggantikan `timestamp` sebagai sumber offset

Bug produksi pasca-deploy: offset diturunkan dari `payload.timestamp`, padahal EA
mengirim `TimeLocal()` — jam PC trader. Pada akun Exness (server UTC) milik trader
UTC+7, boundary harian jatuh di `17:00 UTC` (tengah malam WIB), bukan `00:00 UTC`.

- **EA:** kirim field baru `broker_time = TimeCurrent()` di samping `timestamp =
  TimeLocal()`. `timestamp` dipertahankan untuk diagnostik; bukan sumber offset.
- **API:** `HeartbeatPayload.broker_time` opsional (build lama tetap jalan).
  Prioritas sumber: `broker_time` → candle (`broker_offset_from_bars`) → cache → 0.
- **Kompatibilitas:** EA lama tanpa `broker_time` tetap benar karena timestamp
  candle selalu server-stamped.
- **Verifikasi:** `daily_anchor_at` untuk akun UTC harus `00:00 UTC` (kelipatan
  86 400), bukan `17:00 UTC`.

---

## Acceptance Criteria

1. `GET /bridge/risk` memakai boundary tengah malam **waktu broker**; trade yang
   ditutup 23:30 server masuk hari yang benar.
2. Floating loss saat pergantian hari **tidak** menghasilkan drawdown harian
   (anchor equity, bukan balance).
3. Snapshot tua di-roll-forward dengan trade; P&L kemarin tidak muncul sebagai
   drawdown hari ini.
4. Rugi intraday yang pulih tetap tercatat di `daily_max_drawdown_percent` dan
   menahan `is_alert_active = true` sampai pergantian hari.
5. `overall_drawdown_percent` dan `max_drawdown_percent` (peak-to-trough) tersedia
   dan ditampilkan di **halaman Journal** (kartu setelah KPI), bukan Profile.
6. Tidak ada lagi rumus drawdown lokal di `apps/web`; bila backend tidak tersedia,
   UI menampilkan `—`, bukan angka salah.
7. Market structure menampilkan M5, M15, H1, H4; TF tanpa data menampilkan state
   "belum tersedia" tanpa angka karangan.
8. Section risk di Profile dihapus; `margin_level` tetap terlihat di kartu Active Account.
9. `pytest`, `lint-imports`, `npm --prefix apps/web test`, `lint`, `build`,
   `check-i18n.cjs` hijau; kedua file EA identik.

---

## Out of Scope

- EA mengirim candle multi-simbol (candle tetap hanya untuk simbol chart).
- Backfill candle historis; H1/H4 tampil setelah EA versi baru heartbeat.
- Mengubah retensi snapshot 180 hari (ADR 0005).
- Mengubah perilaku read-only: tidak ada order, close, atau modifikasi SL/TP.
- Seluruh pekerjaan Fase 007 (`007-admin-console`).

---

## Impact Analysis (Files Touched)

**Backend**
- `services/api/app/domain/time.py` — offset broker + boundary hari.
- `services/api/app/domain/policies.py` — evaluasi drawdown equity-ke-equity + overall.
- `services/api/app/infrastructure/db/repositories/telemetry_repository.py` — snapshot di sekitar boundary, ekstrem equity sejak boundary.
- `services/api/app/services/bridge_status_service.py` — anchor roll-forward, cache offset, rekonstruksi overall.
- `services/api/app/api/v1/bridge.py` — route `/risk` memakai service, bukan logika lokal.
- `services/api/app/models/risk.py`, `services/api/app/models/bridge.py`, `services/api/app/core/config.py`.
- `services/api/tests/{test_connections,test_domain_metrics}.py`.

**Frontend**
- `apps/web/src/domain/pnl.js` (+ `pnl.test.js`) — `drawdownView`, tanpa fallback lokal;
  `deriveDrawdownWatch` dihapus.
- `apps/web/src/features/journal/DrawdownCard.jsx` (baru) — dua gauge (overall + daily).
- `apps/web/src/features/journal/JournalTab.jsx` — sisipkan `DrawdownCard` setelah `KpiCards`.
- `apps/web/src/features/profile/RiskWatchdogSection.jsx` — **dihapus**.
- `apps/web/src/components/ProfileTab.jsx` — hapus section risk.
- `apps/web/src/features/profile/ActiveAccountSection.jsx` — tambah baris margin level.
- `apps/web/src/components/HomeTab.jsx`, `apps/web/src/components/MarketTab.jsx`.
- `apps/web/src/constants/translations.js` (EN/ID seimbang).

**Sensor**
- `mt5-ea/PipstrideMonitor.mq5` + `apps/web/public/PipstrideMonitor.mq5` (identik).

**Docs**
- `docs/specs/003-live-metrics-correctness.md`, `tickets/009-live-metrics-correctness/`,
  `tickets/README.md`, `docs/TICKET_TRACKER.md`, `AGENTS.md`.

---

## Edge Cases

- **Bridge offline / payload tidak ada:** offset jatuh ke UTC, anchor jatuh ke
  `session_start` bila ada snapshot hari itu, lalu `deposit_reconstruction`, dan
  terakhir `current_fallback`. Response tetap 200 dengan angka yang jujur (0 bila
  tidak bisa dihitung).
- **Broker dengan offset setengah jam (mis. UTC+5:30):** pembulatan 15 menit
  menanganinya.
- **EA baru dipasang di tengah hari:** tidak ada snapshot ≤ boundary; snapshot
  pertama hari itu dipakai sebagai anchor (`session_start`), jadi hari diukur
  sejak monitoring benar-benar mulai, bukan sejak tengah malam yang tidak
  teramati.
- **Trade tanpa `closed_at`:** dikecualikan dari rekonstruksi harian (tidak bisa
  ditempatkan di hari mana pun) tetapi tetap dihitung di overall.
- **Deposit/withdrawal mid-day:** tidak terdeteksi sebagai trade; anchor bisa
  bergeser. Dicatat sebagai keterbatasan (deposit bukan trade dan tidak dikirim EA).
- **`metrics.timestamp` dari EA yang jamnya salah:** clamp ±14 jam membatasi
  kerusakan; offset di-cache sehingga satu heartbeat aneh tidak menggeser boundary
  berulang kali.
