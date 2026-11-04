# Ticket 02: Seed `plans` Table From Catalog

## Goal
Ganti literal plan di `main.py` dengan pembacaan `packages/pricing/catalog.json`, dan gagalkan
startup bila catalog hilang/malformed.

## Scope
1. Di `services/api/app/core/config.py`:
   - Tambah setting `PRICING_CATALOG_PATH` (default `packages/pricing/catalog.json`,
     diresolusi relatif ke root repo — bisa dioverride lewat env).
2. Buat loader kecil (mis. `services/api/app/services/pricing_catalog.py`) yang:
   - Membaca file JSON dari `PRICING_CATALOG_PATH`.
   - Memvalidasi tiap plan punya `code`/`name`/`max_connections`/`price_cents` bertipe benar.
   - Melempar error jelas (bukan `KeyError` mentah) bila file hilang/kosong/malformed.
3. Di `services/api/app/main.py`:
   - `_seed_defaults()` mengiterasi hasil loader, bukan tuple di baris `29-34`.
   - Hapus literal `("free", "Free", 1, 0), ...` sepenuhnya.
4. Tambah test di `services/api/tests/` yang menegakkan `plans` hasil seed == isi catalog.

## Files to Touch
- `services/api/app/core/config.py`
- `services/api/app/services/pricing_catalog.py` — new.
- `services/api/app/main.py`
- `services/api/tests/test_pricing_catalog.py` — new.

## Verification
```powershell
docker run --rm -v "${PWD}/services/api:/app" -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && pytest"
```
Expected: semua pass (baseline 58 + test baru), 0 fail.

```powershell
curl.exe -s http://localhost:8089/ready
```
Expected: `{"database":"ok","redis":"ok","status":"ready"}`.

## Depends on
- `tickets/002-pricing-single-source/01-create-pricing-catalog.md`

## Unblocks
- Fase 004 (marketing), yang mengimpor catalog yang sama.

## Catatan
- Jangan tambahkan npm workspace atau dependency baru; loader cukup `json` + `pathlib`.
- `main.py` masih punya masalah lain (seeding di app factory, SoC-24) — itu **di luar lingkup
  tiket ini**; jangan dikerjakan di sini. Lihat fase 005.

## Status
done

## Catatan audit (2026-11-05)
Semua scope terpasang dan diverifikasi ulang terhadap kode hari ini, bukan sekadar diwarisi:

| Scope | Bukti |
|---|---|
| `PRICING_CATALOG_PATH` di `config.py` | `config.py:26`, diresolusi dari root repo di `pricing_catalog.py:31-35` |
| Loader `pricing_catalog.py` | Validasi tipe per field; `PricingCatalogError` untuk file hilang, JSON rusak, versi salah, list kosong, `code` duplikat, tipe salah |
| `_seed_defaults()` pakai loader | `main.py:36` `plans = load_plans()`; literal tuple sudah tidak ada |
| Test seed == catalog | `tests/test_pricing_catalog.py::test_seeded_plans_match_catalog` |

Uji startup gagal (dijalankan manual, bukan hanya lewat unit test): catalog hilang, JSON terpotong,
`price_cents: "free"`, dan `code` duplikat — keempatnya menggagalkan boot dengan pesan yang
menyebut field bermasalah, mis. `plans[0].price_cents must be an integer >= 0`.

**Sisa temuan (di luar lingkup tiket ini, kandidat tiket baru):** dua literal masih menyalin
`max_connections` dari catalog, jadi mengubah catalog tidak ikut mengubahnya:
- `main.py:65` — entitlement admin di-seed sebagai `plan_code="pro", max_connections=5`
- `user_service.py:99` — user baru di-seed sebagai `plan_code="free", max_connections=1`

Keduanya bukan harga, jadi tidak melanggar gate fase ini, tapi kelas drift-nya sama dengan yang
ingin ditutup ADR 0007.

