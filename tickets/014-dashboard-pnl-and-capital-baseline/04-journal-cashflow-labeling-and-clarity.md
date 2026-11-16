# Ticket 14-04: Journal Cash Flow Labeling, Period Scope Transparency, and Drawdown Alignment

**Status:** done  
**Prasyarat:** 14-03  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md`](../../docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md)

---

## Goal

Memperjelas konteks waktu pada kartu Arus Kas (`KpiCards.jsx`) di tab Journal agar pengguna tidak lagi bingung membedakan antara deposit yang terjadi pada periode aktif (misal 30 hari terakhir / bulan kalender) dengan total deposit akumulatif seumur hidup akun, serta menyelaraskan baseline deposit pada kartu Drawdown (`DrawdownCard.jsx`).

---

## File yang Terlibat

| File | Tindakan | Deskripsi Perubahan |
|---|---|---|
| `apps/web/src/features/journal/KpiCards.jsx` | Edit | Berikan label periode yang lebih tegas pada kartu Arus Kas (`Total Deposit`, `Total Penarikan`, `Arus Kas Bersih`) dan hint periode kosong. |
| `apps/web/src/features/journal/JournalTab.jsx` | Edit | Teruskan prop `period` ke `KpiCards` untuk kondisi hint. |
| `apps/web/src/features/journal/DrawdownCard.jsx` | Edit | Tampilkan keterangan modal acuan baseline drawdown yang konsisten dengan mutasi kas. |
| `apps/web/src/constants/translations.js` | Edit | Tambahkan string terjemahan pembantu konteks periode pada kartu arus kas jika dibutuhkan. |

---

## Rincian Implementasi

### 0. Koreksi Scope (temuan audit)
Sebagian niat tiket ini **sudah ada** di kode dan tidak perlu ditulis ulang:
- `KpiCards.jsx:59/64/69` sudah merender subteks `periodLabel` di ketiga kartu kas.
- `periodLabel` sudah berasal dari `JournalTab.jsx:50-53`; untuk filter `ALL` nilainya sudah `all time` / `semua waktu` (`translations.js:279/811`).

Karena itu pekerjaan nyata tiket ini adalah: (a) menaikkan periode ke **judul metrik** agar tidak terbaca sebagai angka seumur hidup, (b) hint periode kosong, dan (c) caption baseline drawdown. Jangan mengklaim "menambahkan label periode" seolah belum ada.

### 1. Judul Kartu Arus Kas (`apps/web/src/features/journal/KpiCards.jsx`)
Gunakan key berparameter agar cakupan periode menempel pada judul:
```jsx
<div className="label">{t('journal_stat_total_deposits_period', { period: periodLabel })}</div>
```
Berlaku untuk ketiga kartu (`journal_stat_total_deposits_period`, `journal_stat_total_withdrawals_period`, `journal_stat_net_funding_period`). Subteks `periodLabel` yang sudah ada boleh dipertahankan atau dihapus — jangan menduplikasi info yang sama. Setelah ketiga kartu memakai key berparameter, hapus key lama `journal_stat_total_deposits` / `journal_stat_total_withdrawals` / `journal_stat_net_funding` dari EN & ID (hanya dipakai di `KpiCards.jsx`); `check-i18n.cjs` tidak mendeteksi orphan, jadi ini harus dicek manual.

Tambahkan prop `period` dari `JournalTab.jsx` (baris 198–203, di samping `periodLabel={periodLabel}`) agar KpiCards tidak perlu menebak dari string label. Hint hanya tampil saat periode aktif bukan `ALL` dan tidak ada deposit/penarikan pada periode itu:
```jsx
{period !== 'ALL' && cashFlow.deposits === 0 && cashFlow.withdrawals === 0 && (
  <div className="tiny" style={tinyStyle}>{t('journal_cashflow_period_hint')}</div>
)}
```
Key baru (EN & ID, tiga pasang + satu hint):
- `journal_stat_total_deposits_period`: `'Total Deposits ({period})'` / `'Total Deposit ({period})'`
- `journal_stat_total_withdrawals_period`: `'Total Withdrawals ({period})'` / `'Total Penarikan ({period})'`
- `journal_stat_net_funding_period`: `'Net Funding ({period})'` / `'Arus Kas Bersih ({period})'`
- `journal_cashflow_period_hint`: `'Only this range is shown. Choose All-Time for lifetime funding.'` / `'Hanya rentang ini yang ditampilkan. Pilih Semua Waktu untuk akumulasi modal seumur hidup.'`

### 2. Caption Baseline Drawdown (`apps/web/src/features/journal/DrawdownCard.jsx`)
Baris bawah kartu hanya **caption**, bukan input perhitungan. Drawdown tetap trade-only dan cash-flow-neutralized (SPEC-007 D3, SPEC-008/009) — jangan menyentuh `drawdownView` atau rumus backend.
```jsx
<span>
  {t('journal_drawdown_vs_deposit', {
    amount:
      bridgeStatus?.net_capital !== null && bridgeStatus?.net_capital !== undefined
        ? formatCurrency(bridgeStatus.net_capital, currency)
        : (bridgeStatus?.initial_deposit ? formatCurrency(bridgeStatus.initial_deposit, currency) : '—')
  })}
</span>
```
Perbarui teks key yang sudah ada (bukan key baru): EN `'Net capital baseline: {amount}'`, ID `'Baseline modal bersih: {amount}'`.


---

## Verification

Jalankan seluruh rangkaian verifikasi:
```powershell
node apps/web/scripts/check-i18n.cjs
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm --prefix apps/web run lint:arch
```

Kriteria Sukses:
- `check-i18n.cjs`: Key-parity OK.
- `vitest`: Seluruh unit test lulus.
- `oxlint`: 0 warnings.
- `dependency-cruiser` (`lint:arch`): 0 violations.
- Kompilasi Vite sukses.

---

## Catatan Implementasi (2026-11-16)

Selesai. Judul kartu arus kas memakai key `journal_stat_*_period` (mis. `Total Deposit (Last 30 Days)`), ditambah hint `journal_cashflow_period_hint` yang muncul saat periode aktif tidak punya mutasi kas; `KpiCards` menerima prop `period` dari `JournalTab`. Caption `DrawdownCard` kini memakai `net_capital` (fallback `initial_deposit`) tanpa mengubah perhitungan drawdown yang tetap trade-only. Verifikasi: `check-i18n` **500 key/bahasa**, `vitest` **103 passed**, `oxlint` **0 warning**, `build` sukses, `lint:arch` **0 violations (61 modul / 174 dependensi)**.
