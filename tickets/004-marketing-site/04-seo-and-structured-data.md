# Ticket 04: SEO + Structured Data

## Goal
Daya tarik organik: sitemap, robots, dan structured data `Product`/`Offer` — bagian dari deliverable,
bukan follow-up (ADR 0007 §5).

## Scope
1. Integrasi `@astrojs/sitemap` (atau generate manual) → `sitemap-index.xml` di `dist/`.
2. `apps/marketing/public/robots.txt` — izinkan crawl, tunjuk sitemap.
3. JSON-LD `Product` + `Offer` di halaman pricing, di-generate dari catalog yang sama
   (loop plan → `offers[]`), `priceCurrency: "IDR"`, `price` dari `price_cents/100`.
4. Meta per halaman: `title`, `description`, canonical, OG/Twitter card.
5. `astro.config.mjs`: set `site: "https://pipstride.com"`.

## Files to Touch
- `apps/marketing/astro.config.mjs`
- `apps/marketing/public/robots.txt` — new.
- `apps/marketing/src/pages/pricing.astro` (JSON-LD)
- `apps/marketing/src/layouts/BaseLayout.astro` (meta)

## Verification
```powershell
npm --prefix apps/marketing run build
Select-String -Path apps/marketing/dist/pricing/index.html -Pattern '"@type": "Product"'
Get-ChildItem apps/marketing/dist -Filter "sitemap*"
```
Expected: JSON-LD `Product` hadir, `sitemap-index.xml` ada, `robots.txt` ter-copy.

## Depends on
- `03-pricing-page-from-catalog.md`

## Unblocks
- (tidak memblokir; melengkapi fase 004)

## Status
todo
