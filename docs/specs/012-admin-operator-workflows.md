# SPEC-012 · Alur kerja Admin Console

Admin Console perlu menunjukkan status akses support yang sesuai dengan server, menjaga hasil pencarian sesuai filter, dan mendukung pengelolaan akun melalui keyboard dan layar kecil.

## Akses dan data

- Simpan seluruh grant support operator. Detail keuangan terikat ke ID grant dan pengguna, ditutup ketika grant berakhir atau dicabut, dan dimuat ulang melalui endpoint audit saat dibuka kembali. Abaikan respons untuk grant atau layar yang sudah berubah.
- Sinkronkan grant saat tab kembali aktif dan secara berkala saat terbuka. Pencabutan hanya mengubah grant yang dipilih dan memberi umpan balik bila gagal.
- Hanya admin melihat kontrol pembuatan akun. Daftar dan detail mengabaikan respons dari pencarian, halaman, atau akun yang sudah ditinggalkan.

## Tampilan operator

- Overview menunjukkan waktu snapshot serta pintasan ke pengguna yang akan kedaluwarsa dalam tujuh hari, pengguna dengan koneksi pending, dan ledger support. Pengguna `enabled` dan koneksi belum dicabut diberi label sesuai definisi basis data.
- Daftar pengguna menyediakan tautan keyboard dan memprioritaskan nama, status, dan masa aktif pada layar kecil. Modal memindahkan, menahan, dan memulihkan fokus.
- Audit menyediakan pilihan aksi dan tanggal UTC. API menerima `start` inklusif dan `end` eksklusif sehingga hitungan dan daftar menggunakan batas yang sama. Tampilan menyebut riwayat ini sebagai audit trail.

## Kriteria penerimaan

- Grant untuk target berbeda tetap terlihat dan dapat dicabut secara mandiri. Detail sensitif kosong saat grant berakhir, berubah, atau tidak dapat dikonfirmasi server.
- Navigasi keyboard dapat membuka detail pengguna, menjalankan dialog tanpa fokus keluar, dan kembali ke pemicu setelah dialog ditutup.
- Pintasan Overview membuka daftar yang sesuai dengan penghitung. Filter Audit memberi hasil konsisten saat berpindah halaman atau mengganti periode.
