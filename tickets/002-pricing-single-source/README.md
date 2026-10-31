# Fase 002 — Pricing Single-Source

## Tujuan
Menjadikan `packages/pricing/catalog.json` sebagai **satu-satunya** sumber katalog plan
(`free`/`core`/`plus`/`pro` + `max_connections` + `price_cents`), menggantikan literal yang
saat ini hard-coded di `services/api/app/main.py:29-34`.

Referensi: `docs/adr/0007-marketing-site-and-public-surface.md` §3.

## Prasyarat (kriteria masuk)
- Tidak ada. Ini fase pertama.

## Tiket
1. `01-create-pricing-catalog.md`
2. `02-api-seed-from-catalog.md`

## Gate (checklist audit keluar)
- [ ] `packages/pricing/catalog.json` ada dan valid JSON; 4 plan dengan `code`/`name`/`max_connections`/`price_cents`.
- [ ] `grep` tidak menemukan harga plan (`5900`, `12900`, `19900`) di luar `catalog.json`.
- [ ] `services/api` seed tabel `plans` dari file itu, path via `PRICING_CATALOG_PATH`.
- [ ] Startup **gagal** kalau catalog hilang/malformed (bukan diam-diam lolos).
- [ ] `pytest` hijau; ada test yang membandingkan plan hasil seed dengan isi catalog.
- [ ] `curl.exe -s http://localhost:8089/ready` → `{"status":"ready",...}`.

## Dampak
- Membuka **fase 004** (marketing mengimpor catalog ini saat build).
- Menutup risiko *price-drift* (ADR 0007 §Context, fakta 2).

## Catatan lingkup
- Plain JSON, **tanpa** npm workspace / published package (ADR 0007 §3, ADR 0009 §5).
- Jangan sentuh `apps/web` di fase ini.
