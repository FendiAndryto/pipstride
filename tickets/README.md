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

---

## Inventaris & Status Semua Tiket

### Fase 001: Mobile Header & Journal Month Fix (Selesai)
- [x] **01-fix-journal-month-selector.md** (`done`): Perbaikan month selector jurnal mobile.
- [x] **02-profile-avatar-status-dot.md** (`done`): Avatar status dot indikator koneksi di mobile.
- [x] **03-mobile-header-responsive-styling.md** (`done`): Penyesuaian responsif header mobile.

### Fase 002: Pricing Single Source (Selesai)
- [x] **01-create-pricing-catalog.md** (`done`): Buat katalog tunggal `packages/pricing/catalog.json` (free/core/plus/pro).
- [x] **02-api-seed-from-catalog.md** (`done`): Sinkronisasi seed tabel `plans` backend dari `catalog.json` saat startup.

### Fase 003: Architecture Gates (Belum Diimplementasikan)
- [ ] **01-python-import-linter.md** (`todo`): Enforcement layering arsitektur backend Python via `import-linter`.
- [ ] **02-ts-boundaries-and-api-drift.md** (`todo`): Enforcement batas boundary dependency frontend via `dependency-cruiser`.

### Fase 004: Marketing Site / Landing Page (Selesai)
> **Catatan Pengembang:**
> - Domain publik landing page: `pipstride.homever.my.id` (apex).
> - Domain journal trading / app: `app-pipstride.homever.my.id`.
> - Price list diberi label **Coming Soon**; payment gateway masih berupa kerangka kosong (skeleton UI / tanpa checkout langsung).
- [x] **01-scaffold-astro-app.md** (`done`): Scaffold project `apps/marketing` berbasis Astro (HTML statis, zero-JS default).
- [x] **02-landing-and-company-pages.md** (`done`): Halaman profil brand, pengenalan fitur telemetri read-only, dan value proposition.
- [x] **03-pricing-page-from-catalog.md** (`done`): Halaman harga terhubung katalog, badge Coming Soon, kerangka UI tier.
- [x] **04-seo-and-structured-data.md** (`done`): Implementasi `sitemap.xml`, `robots.txt`, dan schema.org `Product`/`Offer`.
- [x] **05-infra-and-ci.md** (`done`): Dockerfile Astro, konfigurasi Caddy/Nginx reverse proxy, dan pipeline build CI.

### Fase 005: Backend Domain Layer (Belum Diimplementasikan)
- [ ] **01-extract-domain-metrics-policies.md** (`todo`): Ekstraksi domain model murni (drawdown policy, daily metrics) bebas dari framework.
- [ ] **02-repositories-and-route-thinning.md** (`todo`): Pemisahan repository data access dan perampingan route FastAPI.
- [ ] **03-service-decoupling-and-transaction-boundary.md** (`todo`): Pemisahan domain service dan penegasan boundary transaksi database.

### Fase 006: Web Feature Split (Belum Diimplementasikan)
- [ ] **01-split-api-client.md** (`todo`): Pecah god-client `api.js` menjadi per-domain HTTP client modular.
- [ ] **02-frontend-domain-module.md** (`todo`): Ekstraksi kalkulasi metrik & tipe domain di frontend.
- [ ] **03-split-profile-tab.md** (`todo`): Refactor dan modularisasi komponen `ProfileTab.jsx`.
- [ ] **04-split-journal-tab.md** (`todo`): Refactor dan modularisasi komponen `JournalTab.jsx`.
- [ ] **05-remove-dead-code-and-guard-dev-bypass.md** (`todo`): Pembersihan dead code & proteksi bypass mode autentikasi dev.

### Fase 007: Admin Console + Privilege Boundary (Belum Diimplementasikan - Urutan Terakhir)
- [ ] **01-require-role-and-readonly-endpoints.md** (`todo`): RBAC role DB (`admin`/`support`) dan endpoint query read-only.
- [ ] **02-totp-enrollment.md** (`todo`): Sistem pendaftaran 2FA / TOTP wajib untuk role admin & support.
- [ ] **03-admin-mutations-and-audit.md** (`todo`): Mutasi data user/entitlement dengan pencatatan audit log mutlak.
- [ ] **04-support-mode-and-access-log.md** (`todo`): Support mode time-boxed 30 menit & log akses transparan untuk user.
- [ ] **05-admin-frontend-app.md** (`todo`): Aplikasi web dashboard admin mandiri (`apps/admin`, React 19 + Vite di `admin.pipstride.com`).
