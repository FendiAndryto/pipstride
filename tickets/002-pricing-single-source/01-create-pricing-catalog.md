# Ticket 01: Create `packages/pricing/catalog.json`

## Goal
Buat satu file JSON sebagai sumber tunggal katalog plan.

## Scope
1. Buat folder `packages/pricing/`.
2. Buat `packages/pricing/catalog.json` dengan bentuk:
   ```json
   {
     "version": 1,
     "plans": [
       { "code": "free", "name": "Free", "max_connections": 1, "price_cents": 0 },
       { "code": "core", "name": "Core", "max_connections": 1, "price_cents": 5900 },
       { "code": "plus", "name": "Plus", "max_connections": 3, "price_cents": 12900 },
       { "code": "pro",  "name": "Pro",  "max_connections": 5, "price_cents": 19900 }
     ]
   }
   ```
   Nilai diambil persis dari `services/api/app/main.py:29-34` — jangan ubah angka.
3. Buat `packages/pricing/README.md` singkat: file ini sumber tunggal harga, dikonsumsi
   oleh `services/api` (saat startup) dan `apps/marketing` (saat build). Menambah plan = edit file ini.

## Files to Touch
- `packages/pricing/catalog.json` — new.
- `packages/pricing/README.md` — new.

## Verification
```powershell
Get-Content packages/pricing/catalog.json -Raw | ConvertFrom-Json | Select-Object -ExpandProperty plans
```
Expected: 4 plan tercetak, `code` = `free/core/plus/pro`.

## Depends on
None

## Unblocks
- `tickets/002-pricing-single-source/02-api-seed-from-catalog.md`
- Fase 004 (marketing import catalog saat build)

## Status
todo
