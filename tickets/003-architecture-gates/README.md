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
- [ ] Job CI `arch` jalan di `.github/workflows/ci.yml`, dan **gagal** bila ada pelanggaran arah import.
- [ ] Contract Python menegakkan: `interfaces → domain + infrastructure`, `infrastructure → domain`,
      `domain` tanpa `fastapi`/`sqlalchemy`/`redis`; `services/` tidak pernah import `api/v1`.
- [ ] Contract TS menegakkan: `pages → features + components/ui + lib`, `features/X` tidak import
      `features/Y`, `domain` tanpa React/DOM, `apps/A` tidak import `apps/B`.
- [ ] (Opsional, kalau client di-generate) drift OpenAPI terdeteksi.
- [ ] Gate terbukti bekerja: satu pelanggaran sengaja dibuat → CI merah → dikembalikan.

## Dampak
- Membuka **005** (domain/repositories), **006** (pecah web), **007** (admin).

## Catatan lingkup
- **Jangan** memindahkan kode di fase ini. Hanya memasang penjaga. Pindah kode = fase 005/006.
- Untuk kode yang sudah melanggar hari ini, pakai baseline/allowlist eksplisit yang menyusut tiap
  fase — jangan matikan rule-nya.
