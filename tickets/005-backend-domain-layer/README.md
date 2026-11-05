# Fase 005 — Backend Domain Layer + Repositories

## Tujuan
Pindahkan logika domain murni keluar dari service/route ke `domain/`, dan isolasi akses ORM ke
`infrastructure/repositories` — mengikuti target ADR 0009 §3, menutup pelanggaran audit Pilar 1
(SoC-12 … SoC-25, Dep-1 … Dep-4).

Referensi: `docs/audits/pilar1-clean-architecture.md` §1.2-1.3, §2.4-2.5;
`docs/adr/0009-layered-architecture-and-dependency-rule.md` §3.

## Prasyarat (kriteria masuk)
- **Fase 003 wajib selesai** (gate `import-linter` aktif, supaya pelanggaran tertangkap).

## Tiket
1. `01-extract-domain-metrics-policies.md`
2. `02-repositories-and-route-thinning.md`
3. `03-service-decoupling-and-transaction-boundary.md`

## Gate (checklist audit keluar)
- [x] `app/domain/` hanya berisi pure Python: tidak ada `import fastapi / sqlalchemy / redis`.
- [x] Rumus profit-factor/win-rate **satu** salinan (di `domain/metrics`), bukan dua (mematikan SoC-22).
- [x] `app/api/v1/journal.py` tidak lagi import atau query `Trade` ORM langsung (SoC-18).
- [x] Route risk (`bridge.py:126-159`) mendelegasikan ke `domain/policies` (SoC-12).
- [x] `services/` tidak raise `fastapi.HTTPException` (SoC-19); exception domain di-map di boundary route.
- [x] `core/deps.py` tidak import `services/` (Dep-1) — bila masih harus, buat interface di `domain/`.
- [x] `_as_utc` satu salinan (SoC-23).
- [x] `pytest` hijau; gate `arch` hijau.

## Catatan implementasi
- `app/domain/` berisi `metrics.py` (satu definisi profit-factor/win-rate/bucketing), `policies.py`
  (drawdown → `reason_code`, format pesan di route), `time.py` (`as_utc`/`to_unix`), `errors.py`.
- `app/infrastructure/db/repositories/` menampung seluruh query ORM yang dipakai route/service
  (`trade`, `connection`, `telemetry`, `user`); `journal.py` tinggal memanggil `trade_repository`.
- `bridge_service.py` dipecah menjadi `telemetry_ingest_service` (tulis), `bridge_status_service`
  (baca/analytics), dan `account_settings_service` (initial deposit). Tidak ada lagi `HTTPException`
  di `services/`.
- `db.base.session_scope(db)` menjadi unit-of-work: menerima session request-scoped dan memiliki
  commit; `grep "db.commit(" services/` → 0.
- `core/deps.py` memakai repository langsung (Dep-1); heartbeat menerima `connection` hasil resolve
  route, bukan membuat instance service lain di dalam service (Dep-2). `bind_account` tetap
  didelegasikan ke `connection_service` (owned binding lock), bukan lookup token.
- Verifikasi: `104 passed` (termasuk `tests/test_domain_metrics.py`), `lint-imports` **6 kept, 0 broken**
  (termasuk dua contract baru: `no-frameworks-in-domain`, `domain-imports-no-app-layer`).

## Dampak
- Membuka **fase 006** (frontend domain TS bisa dipakai sebagai cermin pure domain Python).
- Membuka **fase 007** (admin router dipasang di atas repositories yang sama).

## Catatan lingkup
- **Jangan** sentuh `journal_service.py` selain memindahkan fungsinya — audit menyebutnya modul
  terbersih dan ADR 0009 §7 melarang merestrukturisasi kode yang sudah tipis dan benar.
- Tidak membuat `application/ports.py` (ADR 0009 §3 eksplisit: ports hanya saat implementasi kedua
  nyata; cache in-memory vs Redis sudah punya abstraksi di `core/live_state.py`).
- Pindah kode secara **inkremental**, bukan big-bang (ADR 0009 §7).
