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
- **Total Tiket:** 39 tiket
- **Selesai (`done`):** 39 tiket (Fase 001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012)
- **Belum Diimplementasikan (`todo`):** 0 tiket (100% selesai)

```
[============================================================] 100% Selesai
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

#### Fase 005: Backend Domain Layer (SELESAI)
> **Catatan Implementasi (2026-11-05):**
> - `app/domain/` murni: `metrics.py` (satu definisi profit-factor/win-rate), `policies.py` (drawdown),
>   `time.py` (`as_utc`/`to_unix`), `errors.py`. Contract baru `import-linter`:
>   `no-frameworks-in-domain`, `domain-imports-no-app-layer` (6 kept, 0 broken).
> - `app/infrastructure/db/repositories/` (`trade`, `connection`, `telemetry`, `user`); `journal.py`
>   tidak lagi import `sqlalchemy`/`Trade`.
> - `bridge_service.py`/`journal_service.py` dihapus, diganti `telemetry_ingest_service`,
>   `bridge_status_service`, `account_settings_service`.
> - `session_scope(db)` menjadi unit-of-work; `grep "db.commit(" services/` → 0; `HTTPException` di
>   `services/` → 0; `core/deps.py` memakai repository (Dep-1); heartbeat menerima `connection`
>   hasil resolve route (Dep-2); `bind_account` tetap didelegasikan ke `connection_service`.
> - Verifikasi: pytest `104 passed`; `lint-imports` `6 kept, 0 broken`.
- [x] **01-extract-domain-metrics-policies.md** (`done`): Ekstraksi core business logic drawdown & metrik jurnal murni.
- [x] **02-repositories-and-route-thinning.md** (`done`): Implementasi repository pattern dan perampingan router FastAPI.
- [x] **03-service-decoupling-and-transaction-boundary.md** (`done`): Pemisahan service dependencies dan batas transaksi database eksplisit.

#### Fase 006: Web Feature Split (SELESAI)
> **Catatan Implementasi (2026-11-05):**
> - Tiket 01 & 02 selesai: `lib/{http,storage,download}.js` + `api.js` tipis (249 baris), dan
>   `domain/{analytics,validation,pnl,format}.js` murni. Analitik MONTH di-port 1:1 dari
>   `app/domain/metrics.py` — fixture Python-vs-JS identik (totals, by_symbol, by_direction,
>   by_weekday, by_hour); profit_factor tanpa-loss kini `null` ('∞'), bukan `0`.
> - 3 warning oxlint lawas (HomeTab/JournalTab) dibersihkan; `lint:arch` tetap 0 pelanggaran.
> - Tiket 03: `ProfileTab` 803 → 91 baris (`features/profile/*` 5 section +
>   `features/connections/useConnections.js` dipakai dua konsumen). `window.confirm` dihapus →
>   `components/ConfirmInline.jsx`. Rule `no-feature-to-feature` di depcruise diperbaiki (lookahead
>   `(?!\1$)` tak didukung → semua import intra-feature ikut merah) dan diuji negatif.
> - Tiket 04: `JournalTab` 903 → 256 baris (`features/journal/*` 6 modul + `lib/csv.js`); 5 effect
>   fetch digabung jadi satu hook polling; filter/search state pindah ke hook; `monthStats` dihapus.
> - Tiket 05: bypass auth dev + kredensial demo dikompilasi keluar dari produksi (diverifikasi
>   `dev-demo-token-offline` absen di `dist/`); data pasar sintetis diberi guard zero-state.
> - **Deviasi:** `api.js` 249 baris (target lunak <150; 30 endpoint + kontrak 409 per-endpoint) dan
>   `BucketBars` **dipertahankan** karena masih dipakai untuk `by_weekday` — premis "dead" di audit
>   tidak terbukti. `PreferencesSection` tidak pernah ada di `ProfileTab` asal, jadi tidak dibuat.
- [x] **01-split-api-client.md** (`done`): Pemecahan file monolith `api.js` menjadi `lib/http` (transport + timeout AbortController), `lib/storage`, `lib/download`; api.js tipis 249 baris.
- [x] **02-frontend-domain-module.md** (`done`): `domain/` frontend murni — port rumus backend 1:1 (terverifikasi fixture), validasi password/email satu salinan, PnL/drawdown backend-first, formatter tunggal.
- [x] **03-split-profile-tab.md** (`done`): Modularisasi `ProfileTab.jsx` → `features/profile/*` + hook koneksi bersama; konfirmasi destruktif non-blocking.
- [x] **04-split-journal-tab.md** (`done`): Modularisasi `JournalTab.jsx` → `features/journal/*` + `lib/csv`; polling tunggal di `useJournalData`.
- [x] **05-remove-dead-code-and-guard-dev-bypass.md** (`done`): Bypass token dev dikompilasi keluar dari build produksi; guard zero-state data pasar.

#### Fase 008: Web Test Harness (SELESAI)
> **Catatan Implementasi:** `vitest@5.1.0` dipilih (bukan `node:test`) karena 95 dari 96 relative
> import di `src/` tanpa ekstensi — `node:test` gagal `ERR_MODULE_NOT_FOUND` di luar `domain/`.
> 4 file tes / 54 tes; paritas `computeTotals` diverifikasi langsung ke `metrics.py` Python.
> Uji negatif membuktikan tes menangkap regresi (6 dan 5 tes merah). Tanpa jsdom, tanpa coverage gate.
- [x] **01-vitest-harness-and-domain-tests.md** (`done`): Vitest (devDependency) + tes paritas `domain/{analytics,pnl,validation}` & `features/journal/dayBuckets`; `npm test` masuk CI job `web`.

#### Fase 009: Live Metrics Correctness (SELESAI)
> **Catatan Implementasi:** hotfix produksi untuk tiga keluhan metrik. Kartu drawdown dipindah ke
> halaman **Journal** (tepat setelah KPI cards) atas permintaan produk, dan Profile dibersihkan dari
> section "Risk Watchdog" (`margin_level` pindah ke kartu Active Account). Anchor harian memakai rung
> `snapshot_exact → snapshot_rollforward → session_start → deposit_reconstruction → current_fallback`;
> rekonstruksi dari saldo sekarang dibuang karena sirkular (menghasilkan `floating/balance` sebagai
> DD harian — persis bug yang diperbaiki). EA wajib diunduh ulang agar H1/H4 muncul; token & preset
> tidak berubah. Verifikasi: pytest 121 passed, lint-imports 6/0, vitest 57 passed, lint + lint:arch
> bersih, build exit 0, i18n 476 keys, dua file EA identik.
- [x] **01-daily-drawdown-broker-day.md** (`done`): Boundary tengah malam **waktu broker** (offset dari `TimeCurrent()`, clamp ±14 jam, cache 1 jam), anchor equity roll-forward, `daily_max_drawdown_percent` menahan trough intraday, `get_overall_drawdown` peak-to-trough.
- [x] **02-overall-drawdown-and-single-formula.md** (`done`): `drawdownView` di `domain/pnl.js` (satu sumber, tanpa fallback lokal); `DrawdownCard` di Journal; `RiskWatchdogSection` dihapus; margin level pindah ke Active Account.
- [x] **03-market-structure-timeframes.md** (`done`): `candles_h1`/`candles_h4` (24 bar, cache 30s) dari EA → `HeartbeatPayload` → `MarketTab` 4 timeframe, dengan state jujur untuk TF tanpa data.

#### Fase 007: Admin Console + Privilege Boundary (SELESAI)
> **Catatan Implementasi:** urutan internal ADR 0008 (read-only → TOTP → mutasi → support mode)
> diikuti dan tiap langkah dijaga tes. `require_role(*roles)` membaca role dari DB tiap request;
> `tests/test_admin_guard.py` memeriksa AST setiap router di `api/v1/admin/` (kontrol negatif: router
> polos → merah) dan membuktikan demote/deactivate langsung berlaku pada JWT yang masih valid.
> TOTP wajib untuk admin/support: migrasi `0002_admin_totp` menambah `users.totp_secret` (Fernet,
> bukan hash) + `totp_enrolled_at`; login tanpa kode → 401, akun belum enroll → 403, dan enrollment
> memakai re-auth password (`/auth/totp/enroll/start|verify`) supaya admin tidak terkunci.
> Setiap mutasi (entitlement, deactivate/activate, revoke koneksi, grant/revoke support) menulis
> `audit_logs` dengan kolom baru `target_user_id`; migrasi `0003_support_sessions` menambah tabel
> `support_sessions`. Support mode 30 menit, alasan wajib, opt-in lewat `SUPPORT_MODE_ENABLED=false`
> sampai access log user terpasang: `GET /api/v1/access-log` + `AccessLogSection` di `ProfileTab`
> (`apps/web`). `apps/admin` adalah bundle & origin terpisah (React 19 + Vite, hash routing, oxlint +
> dependency-cruiser), dilayani Caddy di `ADMIN_DOMAIN` dengan allowlist `ADMIN_ALLOWED_IPS` (di luar
> allowlist → 404); tidak ada route `/admin` di `apps/web`. Verifikasi: pytest penuh hijau,
> `lint-imports` 6/0, web lint/test/build + i18n hijau, admin `lint`/`lint:arch`/`build` hijau.
> **Belum diverifikasi di mesin ini:** docker image build dan drift migrasi Postgres (Docker Desktop
> tidak berjalan) — divalidasi job CI `migrations` dan `docker`.
- [x] **01-require-role-and-readonly-endpoints.md** (`done`): `require_role(*roles)` + router admin read-only (users/connections/audit/metrics) dengan architecture test.
- [x] **02-totp-enrollment.md** (`done`): TOTP wajib untuk admin/support; seed terenkripsi Fernet + jalur enrollment password-only.
- [x] **03-admin-mutations-and-audit.md** (`done`): Mutasi entitlement/deactivate/activate/revoke koneksi, semuanya menulis `audit_logs` beserta IP aktor.
- [x] **04-support-mode-and-access-log.md** (`done`): Sesi support 30 menit dengan alasan wajib; detail elevated satu-satunya jalur ke isi trade/settings, plus access log `GET /api/v1/access-log` untuk trader.
- [x] **05-admin-frontend-app.md** (`done`): `apps/admin` (React 19 + Vite) di origin terpisah, gating IP di Caddy, job CI `admin`, dan layanan compose baru.

#### Fase 010: User Expiry & Admin Account Creation (SELESAI)
> **Catatan Fase:** Didefinisikan dalam `docs/specs/004-user-expiry-and-admin-creation.md`.
> Menyediakan fitur pembuatan akun pengguna baru langsung dari dashboard admin, konfigurasi masa aktif (durasi/expiration date), trial default 3 hari untuk registrasi mandiri via `.env`, penolakan login yang jelas untuk akun kedaluwarsa, proteksi telemetri MT5, serta dialog salin kredensial cepat.
- [x] **01-user-expiry-schema-and-policy.md** (`done`): Migrasi `expires_at`, config trial `.env`, guard login & bridge telemetri.
- [x] **02-admin-user-create-and-extend-api.md** (`done`): Endpoint `POST /admin/users` & `POST /admin/users/{id}/extend-expiry` + AuditLog.
- [x] **03-admin-frontend-create-user-modal.md** (`done`): UI Create User Modal & Copy Credentials Dialog di Admin Console.
- [x] **04-admin-frontend-user-expiry-management.md** (`done`): Badge status masa aktif & Modal Extend Expiry di Admin Console.

#### Fase 011: Dashboard Polish & Data Consistency (SELESAI)
> **Catatan Fase:** Didefinisikan dalam `docs/specs/005-dashboard-currency-equity-branding-fixes.md`.
> Menyelesaikan inkonsistensi visual simbol mata uang (`USC` vs `$`), eliminasi bug minus ganda `−$-1009.00`, sinkronisasi real-time ekuitas di kartu vs footer kurva grafik, serta pembersihan class warisan `.tradegear-header`.
- [x] **01-currency-formatting-and-double-minus-fix.md** (`done`): Formatter dynamic currency `formatCurrency`/`formatSignedMoney` (+ `fractionDigits`), helper `formatGrossLoss` pengganti minus ganda di `HomeTab.jsx`, dan 19 unit test baru di `format.test.js`.
- [x] **02-journal-currency-propagation.md** (`done`): Propagasi mata uang akun aktif ke `JournalTab`, `KpiCards`, `JournalAnalytics` (termasuk `BucketBars`), `TradeTable`, dan `MonthCalendar`.
- [x] **03-home-equity-live-state-synchronization.md** (`done`): `liveEquity` masuk dependency `useMemo`, titik ujung kurva SVG di-override ke ekuitas live, fallback snapshot saat offline.
- [x] **04-header-branding-cleanup.md** (`done`): Kelima selector `.tradegear-header` → `.pipstride-header` di `index.css` + markup header; 0 sisa selector lama.

#### Fase 012: Public Registration Closure & Discord Onboarding (SELESAI)
> **Catatan Fase:** Didefinisikan dalam `docs/specs/006-public-registration-closure-and-discord-contact.md`.
> Menutup pendaftaran mandiri publik pada `app-pipstride.homever.my.id` baik di level UI maupun API backend tanpa menghapus kode registrasi, serta menyediakan jalur onboarding langsung via akun Discord administrator (`ID: 757954690037186580`).
- [x] **01-backend-registration-toggle.md** (`done`): `ENABLE_PUBLIC_REGISTRATION` (default `False`) + guard HTTP 403 pada `POST /api/v1/auth/register`, flag test harness dan test negatif 403 (177 passed, 6 contract kept).
- [x] **02-web-registration-closure-and-discord-cta.md** (`done`): Flag non-destruktif `PUBLIC_REGISTRATION_ENABLED`, tab registrasi disembunyikan, kartu akses terbatas + CTA Discord, 3 key bilingual baru (494 key/bahasa, 88 test, build 1979 modules).
