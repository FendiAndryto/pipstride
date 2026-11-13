# Ticket 03: Home Tab Equity Live State Synchronization

## Goal
Menyelaraskan nilai ekuitas antara kartu KPI *Account Equity* dengan footer grafik *Account Performance* (`Actual Equity:`) dan titik ujung kurva performa di `HomeTab.jsx`, sehingga semuanya selalu membaca dan merefleksikan state telemetry live yang sama secara real-time dan tidak tertinggal pada snapshot REST API historis.

## Scope

1. **Akar Masalah**:
   - Di `apps/web/src/components/HomeTab.jsx` baris 132:
     ```javascript
     const currentVal = activeCurve?.current_equity ?? equity;
     ```
   - Objek `activeCurve?.current_equity` berasal dari respons endpoint REST `GET /api/v1/bridge/equity-curve` yang hanya di-fetch sekali pada saat inisialisasi tab atau pergantian range waktu (Day/Week/Month).
   - Nilai live `metrics.equity` terus diperbarui oleh heartbeat polling/telemetri MT5 seiring pergerakan floating P/L.
   - Karena `activeCurve?.current_equity` diprioritaskan sebelum `equity`, footer grafik `Actual Equity:` membeku pada angka lama (misal: `USC 1,603.20`), sedangkan kartu Account Equity menampilkan angka live (misal: `USC 1,617.20`).
   - Selain itu, ketika `activeCurve.points` ada (`points.length > 0`), titik terakhir `points[points.length - 1]` masih menyimpan nilai snapshot REST API lama, sehingga garis visual SVG kurva berakhir di posisi Y yang berbeda dari angka ekuitas riil.

2. **Perbaikan State Derivation di `HomeTab.jsx`**:
   - Tambahkan pembacaan eksplisit **di luar** `useMemo` (dekat baris 43–47, setelah `const metrics = ...`):
     ```javascript
     // Live telemetry equity, null saat bridge belum pernah melapor.
     const liveEquity = metrics.equity ?? null;
     ```
     Alasan: `metrics` tidak masuk daftar dependency `useMemo` (baris 183 hanya memuat `equity, balance, ...`). Membaca `metrics.equity` langsung di dalam memo membuat dependency-nya tidak terlihat oleh pembaca maupun tooling (`oxlint` di repo ini tidak mengaktifkan `exhaustive-deps`), sehingga rawan jadi bug senyap saat kode diubah.
   - Dalam `useMemo` pembuatan `performanceChart`:
     ```javascript
     // Prioritaskan live telemetry saat terhubung
     const currentVal = (isConnected && liveEquity !== null)
       ? liveEquity
       : (activeCurve?.current_equity ?? startVal);
     ```
   - Tambahkan `liveEquity` dan `isConnected` ke array dependency `useMemo` (baris 183).
   - Perbarui kalkulasi `netVal = currentVal - startVal`.

3. **Sinkronisasi Titik Ujung Kurva SVG**:
   - Saat `activeCurve.points` ada, kloning array (jangan mutasi state) dan override titik terakhir agar selaras dengan `currentVal`:
     ```javascript
     let points = activeCurve?.points ? [...activeCurve.points] : [];
     if (points.length > 0 && isConnected && liveEquity !== null) {
       points[points.length - 1] = {
         ...points[points.length - 1],
         equity: currentVal,
         // `balance` di HomeTab adalah angka (`metrics.balance ?? 0`), jadi `balance || ...`
         // akan menimpa titik dengan 0 setiap kali saldo benar-benar 0. Pakai ?? atau
         // langsung balance karena nilainya sudah numerik.
         balance
       };
     }
     ```
   - Jalur fallback `historyData` (baris 151) sudah menyertakan `currentVal`, sehingga kedua cabang kini konsisten.
   - Hal ini memastikan garis kurva visual SVG di koordinat X=600 berakhir tepat pada nilai `currentVal` yang ditampilkan di teks `Actual Equity:` dan kartu KPI.
   - Titik historis lain **tidak** boleh diubah: hanya elemen terakhir yang di-override.

4. **Verifikasi Non-Regresi**:
   - Pastikan kurva tetap tampil wajar saat koneksi MT5 offline (menggunakan fallback `activeCurve?.current_equity ?? startVal`).
   - Pastikan tidak terjadi glitch layout atau render loop pada SVG chart.

## Files to Touch
- `apps/web/src/components/HomeTab.jsx`

## Verification
```powershell
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run lint:arch
npm --prefix apps/web run build
```
Expected: Tidak ada regresi fungsional, 0 lint warning, 0 build error.

## Depends on
- Tidak ada (mandiri).

## Unblocks
- Gate Fase 011

## Status
done
