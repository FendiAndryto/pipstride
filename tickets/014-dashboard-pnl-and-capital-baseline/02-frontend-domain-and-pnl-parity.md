# Ticket 14-02: Frontend Domain Parity for Net Capital and Realized PnL

**Status:** done  
**Prasyarat:** 14-01  
**Membuka:** 14-03  
**Spesifikasi:** [`docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md`](../../docs/specs/010-dashboard-realized-pnl-and-capital-baseline.md)

---

## Goal

Menyelaraskan kalkulasi domain frontend pada `apps/web/src/domain/pnl.js` agar memiliki paritas 1:1 dengan aturan baru backend dari tiket 14-01, serta memperbarui unit test `pnl.test.js` untuk memastikan modul ini mampu menghitung P/L dan Net Capital secara presisi baik saat respons bridge status lengkap maupun dalam kondisi fallback saat bridge offline.

---

## File yang Terlibat

| File | Tindakan | Deskripsi Perubahan |
|---|---|---|
| `apps/web/src/domain/pnl.js` | Edit | Dukung `status.net_capital`, prioritaskan `status.settled_pnl` dari backend, serta gunakan basis kapital yang tepat untuk persentase return. |
| `apps/web/src/domain/pnl.test.js` | Edit / Tambah Test | Tambahkan unit test skenario top-up, penarikan, dan evaluasi fallback offline. |

---

## Rincian Implementasi

### 1. Perbarui `summarizeAccountPnl` (`apps/web/src/domain/pnl.js`)

Aturan kontrak (selaras SPEC-010 §3.3):
- `netCapital` berasal dari `status.net_capital`, fallback `initialDeposit`.
- `settledPnl` **hanya** dari backend. Tidak ada fallback `balance - deposit` / `balance - netCapital`: selisih saldo adalah formula yang SPEC ini hapus, dan akan menampilkan angka semu saat cash flow belum lengkap.
- `allTimePnl` fallback = `settledPnl + floatingPnl`.
- Persentase memakai `baseCapital = netCapital > 0 ? netCapital : initialDeposit`.

```javascript
export function summarizeAccountPnl(bridgeStatus, metrics) {
  const status = bridgeStatus ?? {};
  const live = metrics ?? {};
  const balance = live.balance ?? 0;
  const equity = live.equity ?? 0;
  const floatingPnl = live.floating_pnl ?? (equity - balance);

  const initialDeposit = status.initial_deposit ?? live.initial_deposit ?? balance;
  const netCapital = provided(status.net_capital) ? status.net_capital : initialDeposit;

  const settledPnl = provided(status.settled_pnl) ? status.settled_pnl : 0;
  const allTimePnl = provided(status.all_time_pnl) ? status.all_time_pnl : settledPnl + floatingPnl;

  const baseCapital = netCapital > 0 ? netCapital : initialDeposit;

  return {
    initialDeposit,
    netCapital,
    isDepositOverridden: status.is_deposit_overridden ?? false,
    settledPnl,
    settledPnlPercent: provided(status.settled_pnl_percent)
      ? status.settled_pnl_percent
      : percentOfBase(settledPnl, baseCapital),
    allTimePnl,
    allTimePnlPercent: provided(status.all_time_pnl_percent)
      ? status.all_time_pnl_percent
      : percentOfBase(allTimePnl, baseCapital)
  };
}
```

### 2. Perbarui Test Lama (WAJIB — mengunci perilaku usang)
`apps/web/src/domain/pnl.test.js` baris 32–49 saat ini mengharapkan fallback `balance - deposit`:
- `it('falls back to balance/equity deltas when the fields are absent')` → ganti nama menjadi *"returns zero realized PnL when the backend field is absent"* dan harapkan `settledPnl === 0`, `settledPnlPercent === 0`; `allTimePnl === 50` (floating `1150 - 1100`), `allTimePnlPercent === 5`.
- `it('falls back to the delta when a field is null, not just undefined')` → pertahankan tujuan null-safety, tetapi harapkan `settledPnl === 0` dan `allTimePnlPercent === 5`.

### 3. Tambahkan Pengujian Baru di `apps/web/src/domain/pnl.test.js`
1. **Skenario Top-Up:**
   - Status: `initial_deposit: 1000`, `net_capital: 1500`, `settled_pnl: 0`, saldo live `1500`.
   - `settledPnl` harus `0` (bukan `500`), `netCapital` harus `1500`.
2. **Skenario Penarikan Parsial:**
   - Status: `initial_deposit: 1000`, `net_capital: 600`, `settled_pnl: 200`, saldo live `800`.
   - `settledPnl` harus `200` (bukan `-200`), `settledPnlPercent` ≈ `33.333…` (gunakan `toBeCloseTo(33.33, 2)`; helper `percentOfBase` tidak membulatkan). Ini return on net capital dan sengaja dikunci sebagai perilaku yang disengaja.
3. **Backend field absen tetapi `net_capital` ada:**
   - Status: `net_capital: 600`, tanpa `settled_pnl` → `settledPnl === 0` (tidak menurunkan `balance - netCapital`).
4. **Persentase Return:**
   - Verifikasi pembagi memakai `baseCapital` (net capital bila > 0, selain itu `initialDeposit`).


---

## Verification

Jalankan rangkaian tes frontend:
```powershell
npm --prefix apps/web test
npm --prefix apps/web run lint
```

Kriteria Sukses:
- `vitest`: seluruh unit test `apps/web` lulus tanpa error (baseline saat ini **99 test / 7 file**; tambahan test 14-02 tidak boleh menurunkan angka itu).
- `oxlint`: 0 warnings, 0 errors.

---

## Catatan Implementasi (2026-11-16)

Selesai. `summarizeAccountPnl` kini mengembalikan `netCapital`; `settledPnl` hanya dari `status.settled_pnl` (fallback `0`, tanpa `balance - deposit` / `balance - netCapital`), `floatingPnl` boleh diturunkan dari `equity - balance` dan itu satu-satunya fallback lokal, lalu persentase memakai basis `netCapital > 0 ? netCapital : initialDeposit`. Dua test lama yang mengunci fallback delta ditulis ulang + 4 skenario baru (top-up, penarikan sebagian 33.33%, `settled_pnl` absen, basis nol). Verifikasi: `vitest` **7 file / 103 test passed**, `oxlint` **0 warning**.
