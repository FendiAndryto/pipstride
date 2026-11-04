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
- [x] `packages/pricing/catalog.json` ada dan valid JSON; 4 plan dengan `code`/`name`/`max_connections`/`price_cents`.
- [x] `grep` tidak menemukan harga plan (`5900`, `12900`, `19900`) di luar `catalog.json`.

  > Catatan: angka di gate ini 1000× lebih kecil dari nilai sebenarnya di `catalog.json`
  > (`price_cents` = minor unit IDR, jadi 5.900.000 = Rp59.000). Yang diuji adalah
  > "tidak ada harga di luar catalog", dan itu lulus — `git grep` untuk ketiga angka itu hanya
  > menemukan dokumen historis, bukan kode. Gate-nya tetap sah; angkanya yang perlu dibaca
  > sebagai contoh, bukan nilai.
- [x] `services/api` seed tabel `plans` dari file itu, path via `PRICING_CATALOG_PATH`.
- [x] Startup **gagal** kalau catalog hilang/malformed (bukan diam-diam lolos).
- [x] `pytest` hijau; ada test yang membandingkan plan hasil seed dengan isi catalog.
- [x] `curl.exe -s http://localhost:8089/ready` → `{"status":"ready",...}`.

Audit 2026-11-05 (dijalankan ulang, bukan warisan centang):
- Startup diuji dengan 4 catalog rusak (hilang, JSON terpotong, `price_cents` bertipe string,
  `code` duplikat) — semuanya gagal boot dengan `PricingCatalogError` yang menyebut field-nya.
- Tabel `plans` di PostgreSQL produksi dibandingkan baris-per-baris dengan `catalog.json`: identik.
- `/ready` di server mengembalikan `{"status":"ready","database":"ok","redis":"ok"}`.
- `pytest` 99 passed (baseline 58 + tes Fase 002 + tes ops).


## Dampak
- Membuka **fase 004** (marketing mengimpor catalog ini saat build).
- Menutup risiko *price-drift* (ADR 0007 §Context, fakta 2).

## Catatan lingkup
- Plain JSON, **tanpa** npm workspace / published package (ADR 0007 §3, ADR 0009 §5).
- Jangan sentuh `apps/web` di fase ini.
