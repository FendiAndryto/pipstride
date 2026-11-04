# Ticket 03: Pricing & Specifications (Single-Source Catalog + Coming Soon)

## Goal
Render the pricing section and page in **English** from `packages/pricing/catalog.json` at build time. Show the three paid tiers with their catalog prices and terminal limits, marked **Coming Soon**, with no checkout and no advertised trial.

---

## Scope

### 1. Public tiers
- Three paid tiers only: `Core`, `Plus`, `Pro`. The `free` plan stays in the catalog for registration but is not advertised.
- Terminal limits come from `max_connections` (Core 1, Plus 3, Pro 5).
- Target prices come from `price_cents`, rendered as IDR (`5900000` → `IDR 59,000 / month`). `price_cents` is IDR minor units.
- Every card carries a `COMING SOON` badge. No checkout, card form, or payment-gateway script.
- Early-access copy states that the console is free while billing is under construction. No 14-day trial claim.

### 2. Single-Source Import
`apps/marketing/src/lib/pricing.js` imports `../../../../packages/pricing/catalog.json` and exposes `publicPlans`, `formatPrice`, and `formatTerminals`. `PricingSection.astro`, `index.astro`, and `pricing.astro` consume it; JSON-LD `lowPrice`, `highPrice`, and `offerCount` derive from the same file. No catalog copy lives inside the app (the old `apps/marketing/packages/` copy and its `predev`/`prebuild` script are removed).

---

## Files to Touch
- `apps/marketing/src/lib/pricing.js` — new.
- `apps/marketing/src/components/sections/PricingSection.astro`
- `apps/marketing/src/pages/pricing.astro`
- `apps/marketing/src/pages/index.astro`

---

## Verification
```powershell
npm --prefix apps/marketing run build
Select-String -Path apps/marketing/dist/pricing/index.html -Pattern "IDR 59,000|IDR 129,000|IDR 199,000|COMING SOON"
Select-String -Path apps/marketing/dist/**/*.html -Pattern "trial|14-day" -CaseSensitive:$false
```
- Expected:
  1. Build exits 0.
  2. Pricing page reflects the catalog prices and terminal limits in English.
  3. Three `COMING SOON` badges, no checkout scripts, no payment-gateway libraries, no trial copy.
  4. JSON-LD uses `priceCurrency: "IDR"` and `offerCount: "3"`.

---

## Depends on
- `01-scaffold-astro-app.md`
- `packages/pricing/catalog.json` (Fase 002-01)

## Unblocks
- `04-seo-and-structured-data.md`

## Status
done
