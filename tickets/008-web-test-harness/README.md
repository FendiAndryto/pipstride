# Fase 008 — Test Harness `apps/web` (Paritas Domain Terjaga)

## Tujuan
Memberi `apps/web` test runner yang bisa mengimpor modul apa pun dengan resolver yang sama seperti
runtime, lalu mengunci paritas rumus frontend terhadap backend. Tanpa ini, gate fase 006
("tidak ada rumus berbeda") hanya dijaga review manusia.

Referensi: `docs/adr/0009-layered-architecture-and-dependency-rule.md` §2 (domain murni),
`tickets/006-web-feature-split/README.md` (gate 006), `tickets/006-web-feature-split/04-split-journal-tab.md`
(koreksi pasca-gate `dayBuckets`).

## Latar belakang (temuan audit 2026-11-05)
`features/journal/dayBuckets.js` menghitung ulang `win_rate`/`profit_factor` sendiri dan menyimpang
dari backend: PF `2.857142857142857` vs `2.86`, WR `66.666…` vs `66.67`, dan bucket breakeven-only
menghasilkan `0` (tampil `"0.00"`) sementara backend `None` (tampil `"—"`). Sudah diperbaiki di
commit `65ce042`, **tetapi tidak ada tes yang mencegah kekambuhan**. Klaim "parity PASS" di tiket
006-02 dulu dijalankan sebagai skrip sekali pakai.

## Prasyarat (kriteria masuk)
- Fase 006 selesai (modul `domain/` + `features/` sudah ada).
- Tidak ada prasyarat fase lain.

## Mengapa bukan `node:test` polos
Diukur, bukan diasumsikan:

| Uji | Hasil |
|---|---|
| `node:test` impor `domain/analytics.js` | PASS (4 modul `domain/` nol import) |
| `node:test` impor `features/journal/dayBuckets.js` | **FAIL** `ERR_MODULE_NOT_FOUND` |
| `--experimental-specifier-resolution=node` | tidak menolong |

**95 dari 96** relative import di `src/` tanpa ekstensi (konvensi Vite). `node:test` polos hanya
bisa menyentuh `domain/`, padahal bug yang terjadi ada di `features/`. Menambal dengan loader hook
buatan sendiri berarti merawat resolver kedua — ditolak.

Vitest dipilih karena memakai **resolver Vite yang sama** dengan aplikasi (`vite 8.3.5`,
peer range vitest `^6.4 || ^7 || ^8` cocok), semua peer lain opsional (tanpa jsdom), dan hanya
masuk `devDependencies` (tidak ke bundle produksi).

## Tiket
1. `01-vitest-harness-and-domain-tests.md`

## Gate (checklist audit keluar)
- [x] `npm --prefix apps/web test` exit 0 dan menjalankan tes (bukan "no test files found").
  → `vitest run`: **4 file, 54 tes, exit 0** (~550 ms).
- [x] Tes mengimpor `features/journal/dayBuckets.js` (bukti resolver Vite bekerja pada modul
      non-`domain/`), bukan hanya `domain/`.
  → `dayBuckets.test.js` mengimpor `./dayBuckets` yang sendiri mengimpor `../../domain/analytics`
      (extensionless). `node:test` gagal di sini; Vitest lolos.
- [x] Paritas `dayBuckets` vs `domain/analytics.computeTotals` terkunci: kasus all-wins, mixed,
      breakeven, all-losses → `win_rate`/`profit_factor`/`net_profit` identik.
- [x] `dayBuckets` breakeven-only menghasilkan `profit_factor === null` (bukan `0`) — regresi
      temuan audit harus **gagal** bila `round2`/null-semantics hilang.
- [x] `domain/validation` terkunci ke `user_service.validate_password_complexity`
      (min 8, huruf, angka) + `EMAIL_PATTERN`.
  → urutan `length → letter → digit` diverifikasi langsung ke `user_service.py:17-23`;
      regex JS `.source` diuji sama dengan `re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")`.
- [x] `domain/pnl` terkunci pada aturan "backend menang, fallback hanya bila field absen" dan
      aman untuk `null` (regresi commit `0365743`).
- [x] `npm --prefix apps/web run lint` 0 warning, `lint:arch` 0 pelanggaran, `build` exit 0.
  → lint 0 warning; arch 54 modul/156 dep, 0 pelanggaran; build 1976 modul, bundle tetap
      `index-DLR1m1qN.js` 415.121 B (**hash tidak berubah** dari sebelum tiket ini).
- [x] `vitest` **tidak** ada di `dependencies`/bundle produksi.
  → `grep -c vitest dist/assets/*.js` = 0; hanya `devDependencies`.
- [x] CI job `web` menjalankan `npm test` sebelum `npm run build`.
  → `.github/workflows/ci.yml`: `npm ci → lint → test → build`; `npm ci --dry-run` = up to date.

### Uji negatif (bukti tes benar-benar menangkap regresi)
1. Rumus lokal dikembalikan ke `dayBuckets` (tanpa `round2`, null-semantics lama) →
   **6 tes merah**: `expected 66.66666666666666 to be 66.67`, `expected +0 to be null`,
   `expected 2.857142857142857 to be 2.86`.
2. `round2` dibuat `(value) => value` di `domain/analytics` →
   **5 tes merah** (3 di `analytics`, 2 di `dayBuckets`).
3. Dipulihkan → **54/54 hijau**.

### Paritas vs backend (dibuktikan, bukan diasumsikan)
Fixture 5 trade yang sama dijalankan lewat `app.domain.metrics.compute_stats` Python:
`trades 5, wins 2, losses 2, breakeven 1, win_rate 40.0, net_profit 25, gross_profit 40,
gross_loss -15, profit_factor 2.67, expectancy 5.0, best_trade 25, worst_trade -10,
total_volume 0.8, avg_hold_minutes 5.0` — **identik** dengan nilai harapan di `analytics.test.js`.
Bucket `by_symbol`/`by_source`/`by_weekday` juga dicocokkan (`EURUSD` PF `null`, `GBPUSD` PF `0.0`,
`Mon` Monday-first, `EA` vs `Manual`).

## Dampak
- Membuka **007-05** (`apps/admin` memakai ulang `domain/` + `lib/http`): paritas lintas app
  punya penjaga, bukan sekadar konvensi.
- Utang teknis gate 006 ("parity diuji skrip sekali jalan") ditutup.

## Catatan lingkup
- **Tanpa** jsdom, tes komponen React, dan coverage gate — belum ada nilainya di fase ini.
- **Tanpa** mengubah `src/` produksi. Kalau sebuah tes menemukan bug, perbaikannya tiket terpisah
  (kecuali regresi yang sudah didokumentasikan di tiket 006-04).
- Mulai dari modul murni (`domain/` + `features/journal/dayBuckets`), bukan shell React.

## Status fase
`done` — tiket 01 selesai dan gate ditutup (2026-11-05). `npm test` = 4 file / 54 tes, terpasang
di CI job `web` sebelum `build`. Bundle produksi tidak berubah (`index-DLR1m1qN.js`, 415.121 B)
karena `vitest` hanya `devDependency`.
