# Inventaris Tiket Pipstride & Panduan Penyesuaian Domain

Dokumen ini memuat status implementasi seluruh tiket tugas di repositori Pipstride beserta konfigurasi pemisahan domain antara **Dashboard Jurnal Trading** dan **Landing Page / Marketing Site**.

---

## 1. Konfigurasi Pemisahan Domain

Berdasarkan keputusan arsitektur (`docs/adr/0007-marketing-site-and-public-surface.md`), surface dibagi menjadi domain apex dan subdomain produk:

| Layanan | Domain / Host | Deskripsi & Autentikasi |
|---|---|---|
| **Marketing Site / Landing Page** | `https://pipstride.homever.my.id` | Publik, SEO-friendly, tanpa autentikasi (statis Astro) |
| **Journal Trading (Product Web)** | `https://app-pipstride.homever.my.id` | Dashboard interaktif MT5, autentikasi JWT di browser |
| **Backend API Service** | `https://app-pipstride.homever.my.id/api` | Reverse proxy `/api` langsung ke FastAPI (`api:8000`) |

### Penyesuaian Konfigurasi yang Telah Diterapkan:
1. **Sensor MQL5 (`mt5-ea/PipstrideMonitor.mq5` & `apps/web/public/PipstrideMonitor.mq5`)**:
   - `InpBackendUrl` diubah ke default `https://app-pipstride.homever.my.id` (agar EA di MT5 langsung menyasar endpoint dashboard).
2. **Preset & Modal Web (`apps/web/src/components/Mt5ConnectModal.jsx`)**:
   - Fallback origin diarahkan ke `https://app-pipstride.homever.my.id`.
3. **Environment Host & Backend (`infra/.env` & `.env.example`)**:
   - `PIPSTRIDE_DOMAIN=app-pipstride.homever.my.id`
   - `PUBLIC_BASE_URL=https://app-pipstride.homever.my.id`
   - `PUBLIC_APP_URL=https://app-pipstride.homever.my.id`
   - `CORS_ORIGINS=https://app-pipstride.homever.my.id,https://pipstride.homever.my.id,http://localhost:3000,http://127.0.0.1:3000`

---

## 2. Inventaris Status Tiket

### Ringkasan Status
- **Total Tiket:** 25 tiket
- **Selesai (`done`):** 12 tiket (Fase 001, 002, 003, 004)
- **Belum Diimplementasikan (`todo`):** 13 tiket (Fase 005, 006, 007)

```
[========================>----------------------------------] 48% Selesai
```

---

### Rincian Tiket per Fase

#### Fase 001: Mobile Header & Journal Month Fix (SELESAI)
- [x] **01-fix-journal-month-selector.md** (`done`): Fix navigasi & filter bulan pada jurnal trading tampilan mobile.
- [x] **02-profile-avatar-status-dot.md** (`done`): Status dot indikator koneksi MT5 pada avatar profil mobile header.
- [x] **03-mobile-header-responsive-styling.md** (`done`): Polish CSS responsif header mobile.

#### Fase 002: Pricing Single Source (SELESAI)
- [x] **01-create-pricing-catalog.md** (`done`): Inisialisasi `packages/pricing/catalog.json` (free/core/plus/pro).
- [x] **02-api-seed-from-catalog.md** (`done`): Sinkronisasi seed database `plans` saat API startup dari file katalog JSON.

#### Fase 003: Architecture Gates (SELESAI)
> **Catatan Implementasi:**
> - Job CI baru: `arch` (`.github/workflows/ci.yml`) menjalankan `lint-imports` dan `npm run lint:arch`; `docker` job menunggu `arch`.
> - Python: `services/api/.importlinter` — 4 contract aktif (services↛api/v1, db↛services/api, models↛db/services/api, services↛fastapi). Contract domain/infrastructure menunggu Fase 005.
> - TypeScript: `apps/web/.dependency-cruiser.cjs` + script `lint:arch`. Rule `pages/`, `features/`, `domain/` dorman sampai folder itu lahir di Fase 006; rule `no-cross-app-imports` aktif sekarang.
> - Baseline `fastapi` di service dihapus dengan membuang dead `submit_order()` dan memetakan typed domain error (`ConnectionTokenInvalidError`, `ConnectionBindingError`) ke 401/409 di route.
> - Gate diuji negatif (Python: service import `api/v1` → MERAH; TS: `features/foo` import `features/bar` → MERAH), lalu dikembalikan ke hijau.
> - Drift OpenAPI di-defer: client masih tangan dan belum ada dokumen OpenAPI yang di-check-in.
- [x] **01-python-import-linter.md** (`done`): Enforcement layering arsitektur backend Python via `import-linter` (4 kept, 0 broken).
- [x] **02-ts-boundaries-and-api-drift.md** (`done`): Enforcement batas boundary dependency frontend via `dependency-cruiser`; drift OpenAPI deferred.

#### Fase 004: Marketing Site / Landing Page (SELESAI)
> **Catatan Khusus Pengembang & Arahan Desain:**
> - Bahasa default: **English (EN)** untuk seluruh copy, heading, dan metadata.
> - Gaya visual: **Precision Telemetry Console** (dark obsidian `#080f14`, hairline gridlines, **zero generic icons** digantikan dengan bespoke **vector schematics & blueprints**).
> - Animasi: **Lightweight motion** (CSS keyframes, flowing data packets, radar ping status).
> - Price list diberi penanda **Coming Soon** dalam bentuk **Technical Specification Matrix** (kerangka UI preview, tanpa checkout/payment gateway).
> - Telegram alert ditiadakan.
> - Target domain: `pipstride.homever.my.id` (apex publik) ──► CTA ke `app-pipstride.homever.my.id` (dashboard).
- [x] **01-scaffold-astro-app.md** (`done`): Inisialisasi project `apps/marketing` Astro + token visual presisi + stylesheet animasi CSS (`motion.css`).
- [x] **02-landing-and-company-pages.md** (`done`): Halaman landing utama ber-Bahasa Inggris dengan 3 vektor teknis: `VectorPipeline`, `VectorCodeAudit`, dan `VectorJournalLedger`.
- [x] **03-pricing-page-from-catalog.md** (`done`): Tabel matriks spesifikasi teknis 4 tier (Free/Core/Plus/Pro) terhubung single-source katalog bertanda Coming Soon.
- [x] **04-seo-and-structured-data.md** (`done`): Konfigurasi SEO English, sitemap.xml, robots.txt, dan schema.org `SoftwareApplication` & `Product`.
- [x] **05-infra-and-ci.md** (`done`): Multi-stage Dockerfile Astro, konfigurasi routing domain apex pada Caddy/Nginx, dan pipeline build CI.

#### Fase 005: Backend Domain Layer (Belum Diimplementasikan)
- [ ] **01-extract-domain-metrics-policies.md** (`todo`): Ekstraksi core business logic drawdown & metrik jurnal murni.
- [ ] **02-repositories-and-route-thinning.md** (`todo`): Implementasi repository pattern dan perampingan router FastAPI.
- [ ] **03-service-decoupling-and-transaction-boundary.md** (`todo`): Pemisahan service dependencies dan batas transaksi database eksplisit.

#### Fase 006: Web Feature Split (Belum Diimplementasikan)
- [ ] **01-split-api-client.md** (`todo`): Pemecahan file monolith `api.js` menjadi modul-modul klien per fitur.
- [ ] **02-frontend-domain-module.md** (`todo`): Ekstraksi domain model & fungsi kalkulasi di sisi web.
- [ ] **03-split-profile-tab.md** (`todo`): Modularisasi komponen raksasa `ProfileTab.jsx`.
- [ ] **04-split-journal-tab.md** (`todo`): Modularisasi komponen `JournalTab.jsx`.
- [ ] **05-remove-dead-code-and-guard-dev-bypass.md** (`todo`): Pembersihan dead code & proteksi bypass token dev.

#### Fase 007: Admin Console + Privilege Boundary (Belum Diimplementasikan - Urutan Terakhir)
- [ ] **01-require-role-and-readonly-endpoints.md** (`todo`): Validasi role admin via database & endpoint analitik read-only.
- [ ] **02-totp-enrollment.md** (`todo`): Wajib autentikasi dua faktor (TOTP / 2FA) untuk admin & support.
- [ ] **03-admin-mutations-and-audit.md** (`todo`): Mutasi akun user dengan kewajiban audit log terstruktur.
- [ ] **04-support-mode-and-access-log.md** (`todo`): Sesi support mode 30 menit & log akses transparan untuk trader.
- [ ] **05-admin-frontend-app.md** (`todo`): Aplikasi web terpisah `apps/admin` (React 19 + Vite di `admin.pipstride.com`).
