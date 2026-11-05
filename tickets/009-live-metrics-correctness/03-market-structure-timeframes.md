# Ticket 09-03: Market Structure M5 / M15 / H1 / H4

## Goal
Market structure bisa menampilkan **M5, M15, H1, dan H4** dengan data candle asli dari EA —
tanpa angka fabrikasi dan tanpa melabeli satu timeframe dengan data timeframe lain.

## Konteks (kenapa tiket ini ada)
Ini bukan filter UI yang kurang: datanya tidak pernah dikirim.
- `mt5-ea/PipstrideMonitor.mq5:677-684` hanya membangun `PERIOD_M15` dan `PERIOD_M5`.
- `mt5-ea/PipstrideMonitor.mq5:713-714` hanya mengirim `"candles"` (M15) dan `"candles_m5"`.
- `services/api/app/models/bridge.py:99-100` hanya punya dua field itu.
- `apps/web/src/components/MarketTab.jsx:328` karena itu hanya bisa menawarkan `['M5','M15']`.

Asal-usul: tiket `006-05:51-52` membuang cabang `H1` karena waktu itu H1 menampilkan candle M15
yang dilabeli H1 (pelanggaran data-integrity, audit §1.1.5). Keputusan itu benar — lebih baik tidak
ada daripada angka bohong — tetapi hasilnya hanya dua timeframe. Menambah H1/H4 adalah pekerjaan
plumbing data EA → API → web, bukan toggle.

## Scope

### 1. Sensor — `mt5-ea/PipstrideMonitor.mq5`
- Tambah dua cache: `g_cached_candles_h1`, `g_cached_candles_h4` (sejajar dengan M5/M15 di
  deklarasi global ~baris 36-38).
- Di blok rebuild 30 detik (`~677-684`), bangun juga `BuildCandlesJson(PERIOD_H1)` dan
  `BuildCandlesJson(PERIOD_H4)`.
- `BuildCandlesJson` menerima parameter jumlah bar: M5/M15 = 35 (perilaku sekarang), H1/H4 = 24
  (struktur hanya butuh 24 bar; hemat egress).
- Payload: tambah `"candles_h1"` dan `"candles_h4"` setelah `"candles_m5"`.
- **Salin file yang sama** ke `apps/web/public/PipstrideMonitor.mq5` (wajib byte-identik).

### 2. Model API — `services/api/app/models/bridge.py`
- `HeartbeatPayload`: tambah `candles_h1: List[Any] = Field(default_factory=list, max_length=500, …)`
  dan `candles_h4` dengan pola yang sama.
- Live payload otomatis meneruskan keduanya lewat `/bridge/status` (tidak ada perubahan
  `bridge_status_service`); `HEAVY_PAYLOAD_KEYS` tidak berubah karena candle dibaca dari live payload.

### 3. Web — `apps/web/src/components/MarketTab.jsx`
- `TIMEFRAMES = ['M5', 'M15', 'H1', 'H4']`; tombol dirender dari array itu.
- Sumber candle per TF:
  - `M5` → `metrics.candles_m5`
  - `M15` → `metrics.candles`
  - `H1` → `metrics.candles_h1`
  - `H4` → `metrics.candles_h4`
- `sliceCount`: M5 = 16, M15 = 24, H1 = 24, H4 = 24.
- TF tanpa data: tombol tetap tampil tetapi **disabled** dengan `title` yang menjelaskan
  (mis. "EA belum mengirim H1 — unduh ulang PipstrideMonitor.mq5"), dan bila user memilihnya
  kartu menampilkan state "belum tersedia" — **tanpa** high/low/change karangan (ADR 0004).
- Hapus sisa komentar/asumsi bahwa hanya M5/M15 yang tersedia.

### 4. i18n — `constants/translations.js`
- Kunci baru EN + ID: `market_tf_unavailable_title`, `market_tf_unavailable_body`,
  `market_tf_needs_new_ea` (dipakai sebagai tooltip tombol disabled).
- `market_no_candles_title`/`market_no_candles_body` disesuaikan agar menyebut nama TF.

## Files to Touch
- `mt5-ea/PipstrideMonitor.mq5`
- `apps/web/public/PipstrideMonitor.mq5` (salinan identik)
- `services/api/app/models/bridge.py`
- `apps/web/src/components/MarketTab.jsx`
- `apps/web/src/constants/translations.js`

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
node apps/web/scripts/check-i18n.cjs

cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest

cd ../..
if (Compare-Object (Get-Content mt5-ea/PipstrideMonitor.mq5) (Get-Content apps/web/public/PipstrideMonitor.mq5)) { "DIFFERENT" } else { "IDENTICAL" }
```
Expected: lint 0 warning; build exit 0; i18n seimbang; pytest pass (payload tanpa
`candles_h1`/`candles_h4` tetap valid karena default `[]`); kedua file EA **IDENTICAL**.

### Pemeriksaan manual
1. EA lama (tanpa H1/H4) → tombol H1/H4 disabled dengan tooltip; memilih M5/M15 tetap normal.
2. EA baru → keempat tombol aktif, dan H1/H4 menampilkan high/low/range dari candle H1/H4 asli.
3. Tidak ada angka yang muncul saat array kosong (state "belum tersedia" saja).

## Catatan kompatibilitas
- API baru + EA lama → field kosong, aman (default `[]`).
- EA baru + API lama → field di-drop Pydantic, aman.
- User **harus mengunduh ulang EA** agar H1/H4 muncul. Token dan preset tidak berubah.
- Egress: 2×35 bar → 2×35 + 2×24 bar ≈ +4,5 KB per heartbeat (masih di bawah 10 KB/tick).

## Depends on
- Tidak ada dependensi keras. Urutan fase menaruhnya setelah 09-02.

## Unblocks
- (menyelesaikan gate fase 009)

## Catatan implementasi

- **`BuildCandlesJson` diberi parameter `bars`** (default 35, jadi pemanggil lama tetap sah). H1/H4
  memakai 24 bar — struktur tidak butuh lebih, dan egress tetap kecil.
- **`TIMEFRAMES` adalah satu sumber daftar TF** di `MarketTab.jsx`, berisi `field` payload dan
  `bars`. Menambah TF ke depan cukup satu baris; tidak ada `if/else` per timeframe lagi.
- **`availableTfs` dipisah dari `tfMetrics`** supaya tombol bisa disabled tanpa harus menghitung
  metrik, dan state "belum tersedia" bisa membedakan "EA belum kirim TF ini" dari "simbol chart
  tidak cocok". Dua kegagalan itu butuh pesan berbeda.
- **Tombol TF yang tidak tersedia tetap bisa diklik** (bukan `disabled` HTML) agar user bisa
  membaca state kosong beserta penjelasannya; warnanya diredupkan dan `title` menjelaskan cara
  memperbaikinya. `disabled` akan menyembunyikan alasan di balik tombol mati.
- **`market_no_candles_body` kini memakai `{symbol}`** — teks lama menyebut "M5 dan M15" secara
  hardcode, yang jadi bohong begitu H1/H4 ada.

## Verification result

- `npm --prefix apps/web run lint` — 0 warning.
- `npm --prefix apps/web run lint:arch` — `no dependency violations found`.
- `npm --prefix apps/web run build` — 1976 modules, exit 0.
- `npm --prefix apps/web test` — 4 files, 56 tests passed.
- `node apps/web/scripts/check-i18n.cjs` — `i18n OK — 475 keys per language`.
- `pytest` — 121 passed (payload tanpa `candles_h1`/`candles_h4` tetap valid karena default `[]`).
- `lint-imports` — 6 kept, 0 broken.
- `Compare-Object` dua file EA — **IDENTICAL**.

## Status
done
