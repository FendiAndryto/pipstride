# Fase 003 — Architecture Gates (Import Direction Enforcement)

## Tujuan
Membuat arah import yang dideklarasikan di ADR 0009 benar-benar ditegakkan di CI — bukan sekadar
komentar. Tanpa gate ini, refactor fase 005/006/007 akan kembali bocor.

Referensi: `docs/adr/0009-layered-architecture-and-dependency-rule.md` §6.

## Prasyarat (kriteria masuk)
- Fase 002 selesai (catalog ada; tidak wajib, tapi urutan direkomendasikan).

## Tiket
1. `01-python-import-linter.md`
2. `02-ts-boundaries-and-api-drift.md`

## Gate (checklist audit keluar)
- [x] Job CI `arch` jalan di `.github/workflows/ci.yml`, dan **gagal** bila ada pelanggaran arah import.
- [x] Contract Python menegakkan: `services/` tidak pernah import `api/v1`, `db/` tidak import
      `services/`, `models/` tidak import `db/`/`services/`, dan `services/` tidak import `fastapi`.
      Contract `domain`/`infrastructure` dijadwalkan aktif di Fase 005 (paketnya belum ada).
- [x] Contract TS menegakkan: `pages → features + components/ui + lib`, `features/X` tidak import
      `features/Y`, `domain` tanpa React/DOM, `apps/A` tidak import `apps/B`. Tiga rule pertama
      dorman sampai folder target dibuat di Fase 006.
- [x] (Opsional, kalau client di-generate) drift OpenAPI **deferred** dengan alasan tertulis di tiket 02
      (client masih tangan, belum ada OpenAPI doc yang di-check-in).
- [x] Gate terbukti bekerja: pelanggaran sengaja (Python + TS) membuat gate merah; keduanya dikembalikan.

**Status fase: SELESAI (2026-11-05).** Verifikasi lengkap ada di masing-masing tiket.

## Dampak
- Membuka **005** (domain/repositories), **006** (pecah web), **007** (admin).

## Catatan lingkup
- **Jangan** memindahkan kode di fase ini. Hanya memasang penjaga. Pindah kode = fase 005/006.
- Penjaga hanya menegakkan batas yang **sudah ada hari ini**; jangan membuat package/layer baru agar gate
  bisa dipasang. Lapisan yang belum ada ditegakkan saat lapisan itu lahir (005/006/007).
- Untuk kode yang sudah melanggar hari ini, pakai baseline/allowlist eksplisit yang menyusut tiap
  fase — jangan matikan rule-nya.
