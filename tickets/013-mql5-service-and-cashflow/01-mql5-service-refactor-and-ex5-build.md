# Ticket 13-01: MQL5 Background Service (.ex5) Refactor & Single Input Token

**Status:** in_progress — bagian otomatis hijau (2026-11-14), checklist manual MT5 belum dijalankan.
**Prasyarat:** —  
**Membuka:** 13-02, 13-04  
**Spesifikasi:** [`docs/specs/007-mql5-service-cashflow-and-dynamic-market.md`](../../docs/specs/007-mql5-service-cashflow-and-dynamic-market.md) §D1

---

## Goal
Mengonversi sensor `PipstrideMonitor` dari Expert Advisor (.mq5) yang terikat chart menjadi **MQL5 Service** mandiri yang berjalan di background terminal MT5 tanpa bergantung pada chart, menyederhanakan jendela konfigurasi menjadi **hanya 1 input field (`InpBridgeToken`)**, dan mendistribusikan file biner terkompilasi **`PipstrideMonitor.ex5`** ke user tanpa menyertakan source.

---

## Konteks & Problem (terverifikasi pada kode 2026-11-14)

1. `mt5-ea/PipstrideMonitor.mq5` masih `#property version "1.00"` (baris 8) dan memakai siklus hidup EA:
   - `OnInit()` (140) — sanitasi token/URL, `EventSetTimer` (158), heartbeat awal + seed trade sync.
   - `OnTimer()` (195) — safety-net sync 30 menit, dirty sync, heartbeat.
   - `OnTradeTransaction()` (223) — set `g_trades_dirty` saat `TRADE_TRANSACTION_DEAL_ADD`.
   - `OnDeinit()` (185) — `EventKillTimer()` + `Comment("")`.
2. Terikat chart: `UpdateChartHUD()` memakai `Comment()` (161), `BuildCandlesJson()` memakai `_Symbol` (536), payload `chart_symbol` = `_Symbol` (732), `FindBrokerSymbol()` fallback `return _Symbol` (296).
3. Tujuh variabel input teknis (21-27): `InpBackendUrl`, `InpBridgeToken`, `InpHostEnv`, `InpMonitoredSymbols`, `InpHistoryDays`, `InpHeartbeatInterval`, `InpVerboseLog`.
4. `.ex5` **di-gitignore** (`.gitignore:58` = `*.ex5`), sehingga rencana "taruh biner di `apps/web/public/`" tidak akan ikut repo/CI/image. `mt5-ea/PipstrideMonitor.ex5` ada tapi untracked.
5. `apps/web/public/PipstrideMonitor.mq5` masih tracked dan diunduh user (`Mt5ConnectModal.jsx:464-465`) — selama file ini ada, tujuan "source terkunci" tidak tercapai.
6. `services/api/app/services/mt5_package.py:19,70-86` membuat preset `.set` dengan 5 input yang akan dihapus oleh tiket ini, dan `tests/test_onboarding.py:21,52` meng-assert nama file preset.

---

## Scope

### 1. Siklus hidup Service (`mt5-ea/PipstrideMonitor.mq5`)
- Properti program:
  ```mql5
  #property service
  #property copyright "Pipstride"
  #property link      "https://pipstride.com"
  #property version   "2.00"
  #property description "Pipstride Pure Read-Only MT5 Telemetry Background Service (Zero Trade Execution - Tamper Proof)"
  ```
- **Ganti `OnTimer` dengan loop `OnStart()`** — tapi jangan pindahkan isi `OnTimer` apa adanya. Pemetaan wajib:

| EA | Service | Catatan |
|---|---|---|
| `OnInit()` | blok init di awal `OnStart()` | sanitasi token, resolve backend URL, resolve default symbol, seed trade sync |
| `EventSetTimer(interval)` | dihapus | diganti `Sleep(interval*1000)` di loop |
| `OnTimer()` | isi loop `while(!IsStopped())` | sync + heartbeat |
| `OnDeinit()` | dihapus (atau `OnStop()` bila didukung versi build — verifikasi) | — |
| `OnTradeTransaction()` | **polling diff** | lihat poin berikut |
| `UpdateChartHUD()` / `Comment()` | `Print()` saja pada error | service tidak punya chart |

- **Wajib: ganti event-driven sync dengan polling diff.** MQL5 Service tidak menerima `OnTradeTransaction`, sehingga `g_trades_dirty` tidak akan pernah di-set dan `/sync-trades` hanya terpanggil oleh safety-net 30 menit. Implementasi: simpan `g_last_seen_deal_ticket` (ulong) + `ulong lastTotalDeals`; setiap tick lakukan `HistorySelect(fromTime, TimeCurrent())` lalu bandingkan `HistoryDealsTotal()`/ticket terbesar. Bila ada ticket baru → set dirty dan kirim sync pada tick itu juga. Latensi maksimum = interval heartbeat (5 s) — tulis eksplisit di komentar file.
- Kunci parameter teknis menjadi `const` di level file:
  ```mql5
  const string InpBackendUrl        = "https://app-pipstride.homever.my.id";
  const int    InpHeartbeatInterval = 5;
  const int    InpHistoryDays       = 90;
  const bool   InpVerboseLog        = false;
  ```
  `InpHostEnv` dihapus; resolve host type dari token/URL yang sudah ada agar backend tetap menerima `host_type` (cek `SanitizeBackendUrl` dan payload field `host_type` — bila info ini hilang, backend harus fallback ke nilai default, jangan kirim field kosong).
- Satu-satunya input:
  ```mql5
  input string InpBridgeToken = ""; // Pipstride Connection Token (from Web Dashboard)
  ```
- **Eliminasi `_Symbol`:** tambahkan `string g_default_symbol` yang di-resolve sekali (simbol pertama yang tersedia di broker, fallback `"XAUUSD"` hanya bila broker benar-benar kosong) dan pakai di `FindBrokerSymbol()` fallback (296), `BuildCandlesJson()` (536), serta `chart_symbol` payload (732). Pemilihan simbol per-request datang di 13-04 — di tiket ini cukup tidak lagi memakai chart.
- Pertahankan seluruh quirk yang sudah terdokumentasi di file (header `Content-Type`, body kosong → `WebRequest` berubah jadi GET, `4014 URL not allowed`). Service berjalan di thread berbeda tapi constraint-nya sama.

### 2. Build & distribusi biner (keputusan terkunci)
- `.gitignore`: tambahkan negasi setelah baris `*.ex5`:
  ```
  !apps/web/public/PipstrideMonitor.ex5
  ```
- Hapus `apps/web/public/PipstrideMonitor.mq5` dari repo (dan dari disk) agar source tidak lagi bisa diunduh. Source kanonik tetap `mt5-ea/PipstrideMonitor.mq5` (repo adalah source of truth; repo privat).
- Langkah build (Windows, MetaEditor CLI) — tulis command persisnya di komentar atas file atau di `docs/`:
  ```powershell
  & "C:\Program Files\MetaTrader 5\metaeditor64.exe" `
      /compile:"C:\Users\pendi\Repository\pipstride\mt5-ea\PipstrideMonitor.mq5" `
      /log:"C:\Users\pendi\Repository\pipstride\mt5-ea\compile.log"
  ```
  Syarat lulus: `compile.log` berakhir `Result: 0 errors, 0 warnings`. Commit `compile.log` sebagai bukti build (sudah tracked).
- Salin `mt5-ea/PipstrideMonitor.ex5` → `apps/web/public/PipstrideMonitor.ex5`, lalu update konstanta checksum SHA-256 di `Mt5ConnectModal.jsx` (saat ini hardcoded `07aeb16c…`) dengan `Get-FileHash -Algorithm SHA256`.
- Verifikasi biner ikut ter-build: `npm --prefix apps/web run build` lalu cek `apps/web/dist/PipstrideMonitor.ex5` ada (Vite menyalin `public/`).

### 3. Preset & config backend (`services/api`)
- `mt5_package.build_preset()`: `EA_FILENAME = "PipstrideMonitor.ex5"`; isi preset hanya komentar + `InpBridgeToken=<token>`. Hapus baris `InpBackendUrl`, `InpMonitoredSymbols`, `InpHistoryDays`, `InpHeartbeatInterval`, `InpVerboseLog`. `backend_url` boleh tetap dikembalikan untuk display, tapi jangan ditulis ke file.
- Hentikan pemakaian `settings.MT5_MONITORED_SYMBOLS` di sini (penghapusan config penuh menyusul di 13-04).
- Update `services/api/tests/test_onboarding.py` (assert nama file `.set` tetap, isi preset berubah).

### 4. Modal & i18n web (`apps/web`)
- `Mt5ConnectModal.jsx`: link download → `/PipstrideMonitor.ex5` (`download="PipstrideMonitor.ex5"`, id tombol `btn-download-monitor-ex5`), checksum diperbarui.
- Langkah instalasi baru:
  1. Copy `PipstrideMonitor.ex5` ke `MQL5/Services/` (bukan `Experts/`).
  2. Navigator → **Services** → klik kanan `PipstrideMonitor` → **Add Service**.
  3. Tab **Inputs** → tempel `InpBridgeToken` (atau **Load** preset `.set`) → OK.
  4. Tools → Options → Expert Advisors → **Allow WebRequest for listed URL** dan tambahkan origin backend. *(Service tetap butuh whitelist URL; instruksi "Allow Algo Trading" harus dihapus karena tidak relevan.)*
- Kunci i18n yang wajib diubah (EN + ID): `modal_download_ea`, `modal_download_ea_tip`, `modal_step1_body`, `modal_step2_body`, `modal_step3_title`, `modal_step3_body`, `modal_preset_note`, `market_tf_unavailable_body`, `market_tf_needs_new_ea` (ganti "attach EA" → "Add Service").

---

## Files to Touch
- `mt5-ea/PipstrideMonitor.mq5`
- `mt5-ea/compile.log`
- `apps/web/public/PipstrideMonitor.ex5` (baru, biner)
- `apps/web/public/PipstrideMonitor.mq5` (dihapus)
- `.gitignore`
- `apps/web/src/components/Mt5ConnectModal.jsx`
- `apps/web/src/constants/translations.js`
- `services/api/app/services/mt5_package.py`
- `services/api/tests/test_onboarding.py`

---

## Verification

**Manual di MT5 (tidak bisa di-CI — wajib dilampirkan hasilnya di tiket):**
- [ ] Service muncul di Navigator → Services, jendela input hanya menampilkan `InpBridgeToken`.
- [ ] Install → status `/bridge/status` `connected` tanpa chart apa pun terbuka.
- [ ] Tutup semua chart / ganti profile / apply template → telemetri tetap jalan (tidak `Offline`).
- [ ] Tutup & buka ulang terminal → service auto-start tanpa input ulang token.
- [ ] Buka lalu tutup satu posisi → baris baru muncul di jurnal dalam ≤ 1 interval heartbeat (membuktikan polling diff menggantikan `OnTradeTransaction`).
- [ ] Deposit kecil & penarikan kecil di akun demo → catat nilai `DEAL_ENTRY` / `DEAL_POSITION_ID` balance deal (input untuk 13-02).

**Build & distribusi:**
```powershell
Get-Content mt5-ea\compile.log | Select-Object -Last 3          # Result: 0 errors, 0 warnings
Get-FileHash apps\web\public\PipstrideMonitor.ex5 -Algorithm SHA256
npm --prefix apps/web run build
Get-ChildItem apps\web\dist\PipstrideMonitor.ex5                # harus ada
```

**Web & backend:**
```powershell
node apps/web/scripts/check-i18n.cjs
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web test
npm --prefix apps/web run build

cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```

**Kriteria lulus tambahan:**
- `apps/web/dist/PipstrideMonitor.mq5` tidak ada, dan `http://localhost:3000/PipstrideMonitor.mq5` (dev server setelah `npm --prefix apps/web run dev`) mengembalikan 404.
- Checksum di modal = hash `apps/web/public/PipstrideMonitor.ex5`.

---

## Log Verifikasi (2026-11-14)

**Otomatis — hijau:**
- `metaeditor64.exe /compile` → `Result: 0 errors, 0 warnings, 2928 ms elapsed`.
- `mt5-ea/PipstrideMonitor.ex5` = 45.622 byte, SHA-256 `3d31b12b617ea1c0565f6068226fd00d0129a486b1c7203605fca094cd1c0cd9`; konstanta `EA_SHA256` di `Mt5ConnectModal.jsx` sudah disamakan.
- `apps/web/public/PipstrideMonitor.ex5` ada (ter-track lewat negasi `.gitignore`); `apps/web/public/PipstrideMonitor.mq5` dihapus.
- `node apps/web/scripts/check-i18n.cjs` → `i18n OK — 494 keys per language, 436 static keys resolved.`
- `npm --prefix apps/web run lint` exit 0; `npm --prefix apps/web test` 6 files / 88 tests; `npm --prefix apps/web run build` sukses — `apps/web/dist/PipstrideMonitor.ex5` ada, `.mq5` tidak ada.
- `pytest` → 177 passed; `lint-imports` → 6 kept, 0 broken.

**Belum dijalankan (butuh terminal MT5, dicatat sebagai utang verifikasi):**
- Service muncul di Navigator → Services dengan satu input `InpBridgeToken`.
- Telemetri tetap `connected` tanpa chart, saat semua chart ditutup, dan setelah profile switch.
- Trade baru masuk jurnal ≤ 1 interval heartbeat (bukti polling diff).
- Observasi `DEAL_ENTRY`/`DEAL_POSITION_ID` pada balance deal untuk tiket 13-02.
