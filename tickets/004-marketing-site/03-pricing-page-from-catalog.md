# Ticket 03: Pricing Page From Single-Source Catalog

## Goal
Halaman harga yang membaca `packages/pricing/catalog.json` **saat build**, sehingga tidak mungkin
drift dari yang ditegakkan backend.

## Scope
1. `apps/marketing/src/pages/pricing.astro`.
2. Import catalog lewat relative path build-time:
   ```ts
   import catalog from '../../../packages/pricing/catalog.json';
   ```
   (sesuaikan kedalaman path; tidak ada npm workspace).
3. Render tiap plan: `name`, `max_connections`, `price_cents` (format Rupiah), dan batasan.
4. Catatan jujur: "Billing belum tersedia — harga ini mencerminkan tier yang berlaku" (ADR 0007 §4).
   **Tidak ada** tombol checkout.
5. CTA: daftar → `app.pipstride.com`.

## Files to Touch
- `apps/marketing/src/pages/pricing.astro` — new.

## Verification
```powershell
npm --prefix apps/marketing run build
Select-String -Path apps/marketing/dist/pricing/index.html -Pattern "9.900|59.000|129.000|199.000"
```
Expected: build sukses; harga dari catalog muncul; ubah satu `price_cents` di catalog → rebuild →
halaman ikut berubah (bukti single-source).

## Depends on
- `01-scaffold-astro-app.md`
- Fase 002 `packages/pricing/catalog.json`

## Unblocks
- `04-seo-and-structured-data.md`

## Status
todo
