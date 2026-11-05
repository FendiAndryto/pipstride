# Ticket 09-02: Overall Drawdown di Journal + Satu Rumus Drawdown

## Goal
Menampilkan drawdown **keseluruhan (peak-to-trough)** dan drawdown **harian** dalam satu kartu di
halaman **Journal** (tepat setelah KPI cards), menghapus kartu risk dari Profile, dan menghapus
rumus drawdown cadangan di frontend supaya hanya ada satu sumber kebenaran.

## Konteks (kenapa tiket ini ada)
- `RiskWatchdogSection.jsx:16` memakai `deriveDrawdownWatch(riskStatus)` — itu **daily** DD, padahal
  copy kartunya (`translations.js:450`) menjanjikan "drawdown against the deposit baseline" dan
  footer menampilkan `initial_deposit` sebagai "Deposit baseline". Angka yang ditampilkan harian,
  yang dijanjikan keseluruhan.
- Tidak ada field overall/max DD di `models/risk.py`; `peak_equity` yang sudah dihitung di
  `bridge_status_service.py:279` tidak pernah dipakai frontend.
- `domain/pnl.js:45-53` (`dailyDrawdownFallback`) menghitung `(balance − equity) / balance` saat
  `/bridge/risk` gagal. Itu floating loss, bukan drawdown harian → kartu Home bisa 0,0% saat
  harinya merah, dan Home ≠ Profile.
- Drawdown adalah metrik **performansi**, sejajar realized P/L dan profit factor. Tempatnya di
  Journal, bukan di halaman koneksi/akun.

## Scope

### 1. Backend (melengkapi 09-01)
- Pastikan `/bridge/risk` mengembalikan `overall_drawdown_percent`, `max_drawdown_percent`,
  `peak_equity`, `peak_equity_at`, `max_overall_drawdown_percent`, `is_overall_alert_active`
  dari `get_overall_drawdown()` (fungsi sudah dibuat di 09-01).
- `is_overall_alert_active = max_drawdown_percent >= MAX_OVERALL_DRAWDOWN_PERCENT`.

### 2. Frontend domain — `apps/web/src/domain/pnl.js`
- **Hapus** `dailyDrawdownFallback` dan `deriveDrawdownWatch`.
- Tambah `drawdownView(riskStatus)` (murni, tanpa rumus lokal):

```js
{
  available: boolean,        // false bila riskStatus null / tidak punya field DD
  daily: number|null,        // daily_drawdown_percent
  dailyMax: number|null,     // daily_max_drawdown_percent
  dailyLimit: number|null,   // max_daily_drawdown_percent
  dailyUsed: number,         // clamp(dailyMax / dailyLimit * 100, 0, 100)
  dailyAlert: boolean,       // is_alert_active
  dailyAnchorAt: number|null,
  dailyAnchorSource: string|null,
  overall: number|null,      // overall_drawdown_percent
  maxOverall: number|null,   // max_drawdown_percent
  overallLimit: number|null, // max_overall_drawdown_percent
  overallUsed: number,
  overallAlert: boolean,     // is_overall_alert_active
  peakEquity: number|null,
  peakEquityAt: number|null
}
```
- Tidak ada lagi angka turunan sendiri: kalau `available === false`, UI menampilkan `—`.
- `pnl.test.js`: ganti tes `dailyDrawdownFallback`/`deriveDrawdownWatch` dengan tes `drawdownView`
  (null-safe, clamp 0–100, `available=false` saat `riskStatus` null, limit 0 tidak membagi nol).

### 3. Kartu baru — `apps/web/src/features/journal/DrawdownCard.jsx`
- Dua gauge berdampingan (grid responsif, satu kolom di mobile):
  - **Overall**: nilai utama `maxOverall` (peak-to-trough), bar `overallUsed` terhadap limit 10%,
    sub-baris `overall` saat ini dari puncak + `peakEquity`.
  - **Daily**: nilai utama `dailyMax`, bar `dailyUsed` terhadap limit 3%, sub-baris `daily` saat ini
    + waktu anchor hari broker.
- Baris pembanding "vs modal awal": `initial_deposit` dari `bridgeStatus` (bukan label DD harian).
- Warna bar mengikuti pola lama: hijau < 40%, amber > 40%, merah > 75% atau alert aktif.
- Read-only: tidak ada tombol aksi, tidak ada mutasi (ADR 0004).
- Bila `available === false`: tampilkan state "belum tersedia" dengan penjelasan singkat,
  **tanpa** angka karangan.

### 4. Penempatan di Journal
- `JournalTab.jsx`: sisipkan `<DrawdownCard bridgeStatus={bridgeStatus} riskStatus={riskStatus} />`
  tepat setelah `<KpiCards … />`, sebelum `<JournalAnalytics … />`.
- `JournalTab` menerima prop `riskStatus` baru; `Dashboard.jsx` meneruskannya
  (`riskStatus` sudah ada di state Dashboard, jadi tidak ada request/polling tambahan).

### 5. Bersihkan Profile
- **Hapus** `apps/web/src/features/profile/RiskWatchdogSection.jsx`.
- `ProfileTab.jsx`: hapus `<SectionHeading>{t('profile_risk_section')}</SectionHeading>` dan
  `<RiskWatchdogSection … />`; hapus import-nya.
- `ActiveAccountSection.jsx`: tambah baris kecil `margin level` (dari
  `riskStatus.margin_level ?? metrics.margin_level`) supaya info itu tidak hilang.

### 6. HomeTab
- Kartu "Daily Drawdown" memakai `drawdownView` — tampilkan `dailyMax` sebagai angka utama
  (bukan `daily`), dengan sub-baris `daily` saat ini. Tidak ada fallback lokal.

### 7. i18n
- Kunci baru EN + ID seimbang: `journal_drawdown_title`, `journal_drawdown_overall`,
  `journal_drawdown_daily`, `journal_drawdown_limit`, `journal_drawdown_peak`,
  `journal_drawdown_anchor`, `journal_drawdown_vs_deposit`, `journal_drawdown_unavailable`,
  `journal_drawdown_current`, `journal_drawdown_source_*` (4 sumber anchor).
- Hapus kunci yang jadi mati: `profile_risk_section`, `profile_drawdown_monitor`,
  `profile_risk_tag`, `profile_risk_desc`, `profile_baseline` (verifikasi dengan
  `check-i18n.cjs` bahwa tidak ada kunci yatim).
- Perbarui `home_daily_dd_desc` agar menyebut angka maksimum.

## Files to Touch
- `services/api/app/api/v1/bridge.py`, `services/api/app/models/risk.py`
- `apps/web/src/domain/pnl.js`, `apps/web/src/domain/pnl.test.js`
- `apps/web/src/features/journal/DrawdownCard.jsx` (baru)
- `apps/web/src/features/journal/JournalTab.jsx`, `apps/web/src/components/Dashboard.jsx`
- `apps/web/src/features/profile/RiskWatchdogSection.jsx` (hapus)
- `apps/web/src/components/ProfileTab.jsx`, `apps/web/src/features/profile/ActiveAccountSection.jsx`
- `apps/web/src/components/HomeTab.jsx`
- `apps/web/src/constants/translations.js`

## Verification
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest

cd ../..
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run build
node apps/web/scripts/check-i18n.cjs
```
Expected: pytest pass; vitest pass dengan tes `drawdownView` baru; lint 0 warning; build exit 0;
`i18n OK — <n> keys per language` tanpa kunci yatim.

### Pemeriksaan manual
1. Journal menampilkan kartu Drawdown tepat di bawah KPI cards, dua gauge (Overall + Daily).
2. Profile tidak lagi punya section "Risk Watchdog"; margin level muncul di kartu Active Account.
3. Matikan bridge (heartbeat berhenti) → kartu menampilkan state "belum tersedia", bukan 0,00%
   atau angka turunan.
4. `grep -rn "dailyDrawdownFallback\|deriveDrawdownWatch" apps/web/src` → **0 hasil**.
5. `grep -rn "profile_risk_section" apps/web/src` → **0 hasil**.

## Depends on
- `01-daily-drawdown-broker-day.md` (field backend + `get_overall_drawdown`).

## Unblocks
- `03-market-structure-timeframes.md` (tidak wajib, hanya urutan fase)

## Catatan implementasi

- **`drawdownView` menggantikan dua fungsi**, bukan menambah: `dailyDrawdownFallback` dan
  `deriveDrawdownWatch` dihapus total (diverifikasi `grep` → 0 hasil di `apps/web/src`, hanya
  komentar riwayat di `pnl.js`).
- **`available` adalah pembeda utama.** Payload lama (hanya `margin_level`) atau `null` → `false`,
  sehingga Home menampilkan `—` dan Journal menampilkan state "belum tersedia". Ini yang membuat
  angka 0,00% palsu tidak bisa muncul lagi.
- **`drawdownTone(used, alert)` diekspor** supaya ambang warna (40% / 75% / alert) hanya ada di satu
  tempat dan bisa diuji tanpa merender komponen.
- **Home memakai `dailyMax` sebagai angka utama** dan `daily` sebagai sub-baris. Membalik urutannya
  akan mengembalikan bug "rugi pagi pulih siang terbaca 0,0%".
- **`profile_drawdown_monitor` dihapus** (bukan dibiarkan yatim). `check-i18n.cjs` hanya memeriksa
  paritas EN/ID, bukan kunci tak terpakai, jadi kunci mati harus dicari manual dengan `grep`.
- **`ProfileTab` tetap menerima prop `riskStatus`** — sekarang hanya untuk `ActiveAccountSection`
  (margin level). Tidak ada prop mati.

## Verification result

- `npm --prefix apps/web test` — **4 files, 57 tests passed** (+3 tes `drawdownView`/`drawdownTone`
  termasuk kasus `is_data_available: false`).
- `npm --prefix apps/web run lint` — 0 warning.
- `npm --prefix apps/web run lint:arch` — `no dependency violations found (54 modules)`.
- `npm --prefix apps/web run build` — 1976 modules, exit 0.
- `node apps/web/scripts/check-i18n.cjs` — `i18n OK — 476 keys per language`.
- `pytest` — 121 passed.

## Status
done
