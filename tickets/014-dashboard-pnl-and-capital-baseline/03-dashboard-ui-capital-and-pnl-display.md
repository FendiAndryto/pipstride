# Ticket 14-03: Dashboard UI Capital and Pure Realized PnL Display

**Status:** done  
**Prasyarat:** 14-02  
**Membuka:** 14-04  
**Spesifikasi:** [`docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md`](../../docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md)

---

## Goal

Memperbarui antarmuka pengguna pada kartu KPI Dashboard (`HomeTab.jsx`) untuk menampilkan **Modal Bersih (*Net Capital*)** dan **P/L Riil Trading** yang akurat, memperjelas sumber data modal (apakah akun murni setoran awal atau memiliki akumulasi mutasi kas), serta memperbarui kamus bahasa (`translations.js`) untuk bahasa Indonesia dan Inggris.

---

## File yang Terlibat

| File | Tindakan | Deskripsi Perubahan |
|---|---|---|
| `apps/web/src/components/HomeTab.jsx` | Edit | Tampilkan `netCapital` di kartu Saldo, ganti label P/L jadi "P/L Riil Trading", dan perbarui label kartu Ekuitas menjadi "Total Hasil (Riil + Floating)". |
| `apps/web/src/constants/translations.js` | Edit | Tambah key modal bersih/P/L riil/total hasil (EN & ID); hapus key yang tidak lagi dipakai. |
| `apps/web/scripts/check-i18n.cjs` | Jalankan | Verifikasi paritas key EN/ID. |

---

## Rincian Implementasi

### 1. Perbarui Kamus Terjemahan (`apps/web/src/constants/translations.js`)
Tambahkan key baru untuk kedua bahasa (EN & ID), dan hapus key yang setelah perubahan tidak lagi dipakai:
* EN:
  - `home_net_capital`: `'Net Capital:'`
  - `home_realized_trading_pl`: `'Realized Trading P/L:'`
  - `home_total_result`: `'Total Result (Realized + Floating):'`
* ID:
  - `home_net_capital`: `'Modal Bersih:'`
  - `home_realized_trading_pl`: `'P/L Riil Trading:'`
  - `home_total_result`: `'Total Hasil (Riil + Floating):'`
* Hapus dari **kedua** bahasa (tidak lagi direferensikan): `home_initial_balance`, `home_all_time_pl`, `home_realized_vs_initial`.
* Jangan menambahkan `home_net_funding_badge` (tidak dipakai di markup; akan menjadi key mati).
* `home_manual` / `home_from_mt5` tetap dipakai sebagai badge sumber modal.

### 2. Perbarui `HomeTab.jsx` (`apps/web/src/components/HomeTab.jsx`)
`balance`, `equity`, dan `floatingPnl` **sudah** dideklarasikan di scope komponen (baris 50–62) dan **tidak** dikembalikan oleh `summarizeAccountPnl`. Jangan menambah destructuring untuk ketiganya — akan terjadi `Identifier has already been declared`. Yang berubah hanya baris destructuring yang sudah ada:
```jsx
const {
  initialDeposit,        // tetap dipakai kurva ekuitas (baris 142)
  netCapital,            // BARU
  isDepositOverridden,
  settledPnl,
  settledPnlPercent,
  allTimePnl,
  allTimePnlPercent
} = summarizeAccountPnl(bridgeStatus, metrics);
```

Kartu `home-kpi-balance`:
```jsx
<div style={{ color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
  <span>{t('home_net_capital')}</span>
  <span style={{ fontWeight: 600, color: '#e6f1f2' }}>
    {formatCurrency(netCapital, currency)}
    <small style={{ marginLeft: '4px', fontSize: '9px', color: isDepositOverridden ? 'var(--amber)' : 'var(--muted)' }}>
      {isDepositOverridden ? t('home_manual') : t('home_from_mt5')}
    </small>
  </span>
</div>
<div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
  <span style={{ color: 'var(--muted)' }}>{t('home_realized_trading_pl')}</span>
  <span style={{ color: settledPnl >= 0 ? 'var(--g)' : 'var(--red)' }}>
    {settledPnl >= 0 ? '+' : ''}{formatCurrency(settledPnl, currency)} ({settledPnlPercent >= 0 ? '+' : ''}{settledPnlPercent.toFixed(1)}%)
  </span>
</div>
```

Kartu `home-kpi-equity` (SPEC §D3.2 — wajib, bukan opsional): ganti label baris pertama menjadi `t('home_total_result')` dengan nilai `allTimePnl` / `allTimePnlPercent`; baris `home_floating_risk` tetap. Ini menghilangkan label menyesatkan *"Realized vs Initial"* yang sekarang membandingkan total hasil terhadap modal bersih.

---

## Verification

Jalankan rangkaian verifikasi frontend:
```powershell
node apps/web/scripts/check-i18n.cjs
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

Kriteria Sukses:
- `check-i18n.cjs`: Key-parity OK (tidak ada key yang timpang antara EN dan ID).
- `vitest`: Lulus seluruh pengujian.
- `oxlint`: 0 warnings, exit 0.
- `npm run build`: Kompilasi Vite sukses menghasilkan bundle `dist/`.

---

## Catatan Implementasi (2026-11-16)

Selesai. Kartu Saldo menampilkan **Modal Bersih** (`home_net_capital`) dan **P/L Riil Trading** (`home_realized_trading_pl`); kartu ekuitas memakai `home_total_result`. Key `home_initial_balance`, `home_all_time_pl`, dan `home_realized_vs_initial` dihapus dari EN/ID. Di `HomeTab.jsx`, `netCapital` sengaja diturunkan sebagai ekspresi biasa (`bridgeStatus?.net_capital ?? initialDeposit`) alih-alih di-destructure dari `summarizeAccountPnl`, agar bentuk dependensi memo kurva ekuitas tidak berubah dan `oxlint` tidak memunculkan warning React Compiler `preserve-manual-memoization`. Verifikasi: `check-i18n` **500 key/bahasa, 440 static key resolved**, `vitest` **103 passed**, `oxlint` **0 warning**, `build` sukses.
