# Tickets (`tickets/`)

Tempat tiket tugas dan unit eksekusi mandiri Pipstride.

Alur:
1. Tiket dihasilkan dari dokumen spesifikasi di `docs/specs/` atau keputusan di `docs/adr/`.
2. Setiap tiket berfokus pada pekerjaan terkecil yang dapat diverifikasi (lint, build, test).
3. Setelah selesai dan diverifikasi, tiket ditandai closed/selesai sebelum merge/commit.

---

## Roadmap berfase

Pengerjaan dipecah per fase. Setiap folder fase punya `README.md` yang mendefinisikan **Gate**:
kriteria masuk, checklist audit keluar, dan fase yang dibuka. **Jangan mulai fase berikutnya
sebelum gate fase sebelumnya lulus.** Ini yang membuat tiap tahap mudah diaudit.

| Fase | Folder | Tujuan | Prasyarat | Membuka |
|---|---|---|---|---|
| **002** | `002-pricing-single-source/` | Satu sumber harga (`packages/pricing/catalog.json`) | — | 004 |
| **003** | `003-architecture-gates/` | CI arch guard (arah import) — boundary jadi nyata | — | 005, 006, 007 |
| **004** | `004-marketing-site/` | Permukaan publik (`apps/marketing`, Astro) | 002 | akuisisi + SEO |
| **005** | `005-backend-domain-layer/` | `domain/` + `infrastructure/repositories` | 003 | 006 |
| **006** | `006-web-feature-split/` | Pecah god-class `apps/web` | 003, 005 | 007 (frontend) |
| **007** | `007-admin-console/` | Admin console + privilege boundary | 003, 005, 006 | ops/support |

**Urutan eksekusi yang direkomendasikan:** `002 → 003 → 004 → 005 → 006 → 007`.

Alasan singkat (detail ada di masing-masing README):
- **004 (marketing) dikerjakan sebelum 005/006 (refactor)** — tidak memblokir siapa pun, risiko nol
  (bundle + origin terpisah), dan menutup gap funnel (hari ini user mendarat di halaman login).
  Refactor `apps/web` justru menunda nilai.
- **007 (admin) paling akhir** — ADR 0008 menaruh kerja keamanan (TOTP, role re-check, audit,
  support mode, access log) sebagai **prasyarat**, bukan follow-up. Bangun saat sudah ada user
  yang perlu di-support.

Referensi keputusan: `docs/adr/0006`–`0009`, `docs/audits/pilar1-clean-architecture.md`.

---

## Cara audit antar-fase (checklist generik)

Sebelum menandai sebuah fase selesai dan lanjut:
1. Semua tiket fase itu `Status: done`.
2. `Verification` tiap tiket dijalankan, output bersih (exit 0 / jumlah pass).
3. Checklist **Gate** di `README.md` fase itu dicentang.
4. `git status` bersih, commit fase sudah ada.
5. Baru buka tiket fase berikutnya.

## Status tiket

- `todo` — belum dikerjakan.
- `in_progress` — sedang dikerjakan.
- `done` — selesai dan terverifikasi.
- `blocked` — menunggu prasyarat (tulis alasannya).
