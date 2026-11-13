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
| **008** | `008-web-test-harness/` | Test runner `apps/web` + paritas domain terjaga | 006 | 007-05 |
| **009** | `009-live-metrics-correctness/` | Daily DD hari broker, overall DD peak-to-trough, market structure 4 TF | 005, 006, 008 | 007 |
| **010** | `010-user-expiry-and-admin-creation/` | Expiry akun, default trial 3 hari, & create user admin | 007 | onboarding & monetisasi |

**Urutan eksekusi yang direkomendasikan:** `002 → 003 → 004 → 005 → 006 → 008 → 009 → 007 → 010`.

Alasan singkat (detail ada di masing-masing README):
- **004 (marketing) dikerjakan sebelum 005/006 (refactor)** — tidak memblokir siapa pun, risiko nol
  (bundle + origin terpisah), dan menutup gap funnel (hari ini user mendarat di halaman login).
  Refactor `apps/web` justru menunda nilai.
- **009 (metrik) sebelum 007 (admin)** — 007 menambah permukaan admin di atas angka metrik. Kalau
  admin dibangun dulu, bug drawdown ikut terwarisi ke layar support.
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

### Fase 003: Architecture Gates (Selesai)
- [x] **01-python-import-linter.md** (`done`): Enforcement layering arsitektur backend Python via `import-linter` (4 contract, 0 broken).
- [x] **02-ts-boundaries-and-api-drift.md** (`done`): Enforcement batas boundary dependency frontend via `dependency-cruiser`; drift OpenAPI deferred ke fase client-generation.

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

### Fase 005: Backend Domain Layer (Selesai)
- [x] **01-extract-domain-metrics-policies.md** (`done`): Ekstraksi domain model murni (drawdown policy, daily metrics) bebas dari framework.
- [x] **02-repositories-and-route-thinning.md** (`done`): Pemisahan repository data access dan perampingan route FastAPI.
- [x] **03-service-decoupling-and-transaction-boundary.md** (`done`): Pemisahan domain service dan penegasan boundary transaksi database.

### Fase 006: Web Feature Split (Selesai)
> **Catatan Implementasi (2026-11-05):** kelima tiket selesai; gate fase ditutup. Detail per tiket di
> `tickets/006-web-feature-split/`. Dua deviasi didokumentasikan: `api.js` 249 baris (bukan <150) dan
> `BucketBars` dipertahankan karena masih dipakai untuk `by_weekday`.
- [x] **01-split-api-client.md** (`done`): Pecah god-client `api.js` menjadi `lib/http` (transport + AbortController timeout), `lib/storage`, `lib/download`; `api.js` tipis.
- [x] **02-frontend-domain-module.md** (`done`): `domain/{analytics,validation,pnl,format}.js` murni; analitik MONTH 1:1 dari backend (fixture parity PASS); validasi & PnL backend-first satu salinan.
- [x] **03-split-profile-tab.md** (`done`): `ProfileTab` 803 → 91 baris (`features/profile/*`, 5 section) + `features/connections/useConnections` dipakai dua konsumen; `window.confirm` → `ConfirmInline`; rule depcruise `no-feature-to-feature` diperbaiki.
- [x] **04-split-journal-tab.md** (`done`): `JournalTab` 903 → 256 baris (`features/journal/*`, 5 modul + `lib/csv`); 5 effect fetch → satu hook polling; filter/search state pindah ke hook.
- [x] **05-remove-dead-code-and-guard-dev-bypass.md** (`done`): Dev bypass + kredensial demo dikompilasi keluar dari produksi (diverifikasi absen di `dist/`); guard zero-state data pasar.

### Fase 008: Web Test Harness (Selesai)
- [x] **01-vitest-harness-and-domain-tests.md** (`done`): Vitest (tanpa jsdom) + 4 file tes / 54 tes yang mengunci paritas `domain/` dan `features/journal/dayBuckets` terhadap backend; `npm test` masuk CI job `web`. Bundle produksi tidak berubah (vitest hanya devDependency).

### Fase 009: Live Metrics Correctness (Selesai)
> **Catatan Implementasi (2026-11-05):** tiga tiket selesai, gate fase ditutup. Detail per tiket di
> `tickets/009-live-metrics-correctness/`. Dua deviasi didokumentasikan: kartu drawdown dipindah ke
> halaman Journal (bukan Profile) atas permintaan produk, dan anchor harian memakai rung
> `session_start` (observasi pertama hari itu) alih-alih rekonstruksi dari saldo sekarang yang
> terbukti sirkular.
- [x] **01-daily-drawdown-broker-day.md** (`done`): Boundary hari broker (offset dari `TimeCurrent()`, clamp ±14 jam), anchor equity roll-forward dari snapshot, `daily_max_drawdown_percent` menahan trough intraday, overall DD peak-to-trough; `+15 tes` (104 → 119).
- [x] **02-overall-drawdown-and-single-formula.md** (`done`): `drawdownView` menggantikan `dailyDrawdownFallback` + `deriveDrawdownWatch`; kartu `DrawdownCard` di Journal setelah KPI; section risk Profile dihapus, `margin_level` pindah ke kartu Active Account; `is_data_available` mencegah 0,00% palsu.
- [x] **03-market-structure-timeframes.md** (`done`): EA mengirim `candles_h1`/`candles_h4` (24 bar, cache 30s), `HeartbeatPayload` meneruskannya, `MarketTab` menampilkan M5/M15/H1/H4 dengan state jujur untuk TF tanpa data; kedua file EA identik.

### Fase 007: Admin Console + Privilege Boundary (Selesai)
> **Catatan Implementasi (2026-11-12):** kelima tiket selesai, gate fase ditutup. Urutan ADR 0008
> (read-only → TOTP → mutasi → support mode) dijaga tes. Detail ada di
> `tickets/007-admin-console/README.md`; ringkasan: `require_role` + architecture test AST,
> migrasi `0002_admin_totp` (seed Fernet + `totp_enrolled_at`) dan `0003_support_sessions`,
> audit wajib pada setiap mutasi dengan kolom `target_user_id`, support mode 30 menit opt-in
> (`SUPPORT_MODE_ENABLED=false`), access log user `GET /api/v1/access-log` di Profile, dan
> `apps/admin` sebagai bundle/origin terpisah di balik allowlist Caddy.
- [x] **01-require-role-and-readonly-endpoints.md** (`done`): RBAC role DB (`admin`/`support`) dan endpoint query read-only.
- [x] **02-totp-enrollment.md** (`done`): Sistem pendaftaran 2FA / TOTP wajib untuk role admin & support.
- [x] **03-admin-mutations-and-audit.md** (`done`): Mutasi data user/entitlement dengan pencatatan audit log mutlak.
- [x] **04-support-mode-and-access-log.md** (`done`): Support mode time-boxed 30 menit & log akses transparan untuk user.
- [x] **05-admin-frontend-app.md** (`done`): Aplikasi web dashboard admin mandiri (`apps/admin`, React 19 + Vite di origin terpisah).

### Fase 010: User Expiry & Admin Account Creation (Selesai)
> **Catatan Fase:** Didefinisikan dalam `docs/specs/004-user-expiry-and-admin-creation.md`.
> Menyediakan fitur pendaftaran user baru langsung dari admin console, pengaturan masa aktif (durasi/expiration date), trial default 3 hari untuk registrasi mandiri via `.env`, penolakan login jelas untuk akun kedaluwarsa, dan dialog copy kredensial cepat.
- [x] **01-user-expiry-schema-and-policy.md** (`done`): Migrasi `expires_at`, config trial `.env`, guard login & bridge telemetri.
- [x] **02-admin-user-create-and-extend-api.md** (`done`): Endpoint `POST /admin/users` & `POST /admin/users/{id}/extend-expiry` + AuditLog.
- [x] **03-admin-frontend-create-user-modal.md** (`done`): UI Create User Modal & Copy Credentials Dialog di Admin Console.
- [x] **04-admin-frontend-user-expiry-management.md** (`done`): Badge status masa aktif & Modal Extend Expiry di Admin Console.
