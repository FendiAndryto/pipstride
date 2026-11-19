# SPEC-011 · Periode dan histori Journal

Journal membuka `Semua Waktu` untuk menunjukkan histori akun yang telah tersinkron. Saat ini ringkasan menerapkan rentang relatif, sementara tabel bisa menampilkan transaksi di luar rentang itu. Ekspor juga dapat beralih ke histori tanpa filter saat tabel kosong.

## Perilaku

- Satu pilihan periode utama berlaku untuk KPI, analitik, tabel, dan ekspor. Pilihannya adalah `Semua Waktu`, `30 Hari`, `90 Hari`, `1 Tahun`, dan `Per Bulan`.
- Pencarian memfilter tabel dan ekspor. Simbol dan sumber trade juga berlaku untuk analitik dan kalender. Ringkasan arus kas tetap pada cakupan akun dan periode karena setoran dan penarikan tidak mempunyai simbol atau sumber trading.
- Drawdown mempertahankan cakupan hari trading broker dan sepanjang riwayat dengan label yang terlihat. Kalender P/L memakai bulan UTC tersendiri dan navigasinya hanya mengubah tampilan kalender. Mode `Per Bulan` dan waktu transaksi di tabel juga menggunakan UTC.
- Tabel memuat satu halaman dari server, mengurutkan trade dan arus kas bersama, serta menampilkan hitungan yang mencakup histori tersinkron. CSV hanya berisi trade yang sesuai dengan periode, simbol, sumber, dan pencarian. Hasil kosong tidak menghasilkan ekspor.

## Antarmuka

- `GET /api/v1/journal/rows` mengembalikan halaman, jumlah baris, jumlah trade, dan opsi simbol untuk koneksi aktif. Query mendukung batas Unix `start` (inklusif) dan `end` (eksklusif), sumber, simbol, pencarian, serta pagination. Ekspor mengambil halaman trade dengan filter yang sama.
- `GET /api/v1/journal/stats` menerima batas tanggal yang sama. Mode `MONTH` menghitung statistik di server dan permintaan kalender dapat meminta agregat P/L harian UTC. Endpoint histori bridge tetap tersedia bagi pemanggil lama.

## Kriteria penerimaan

- KPI, analitik, baris transaksi, dan CSV mengikuti periode yang dipilih, termasuk saat mengganti periode dengan cepat atau saat hasilnya kosong.
- Pengguna dapat membuka trade lama melebihi batas pengambilan frontend sebelumnya. Setoran dan penarikan tidak masuk ke statistik trading atau CSV trade.
- Navigasi bulan kalender tidak mengubah periode utama. Tes API dan web mengunci perilaku tanggal, pagination, serta ekspor.
