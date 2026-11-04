# Ticket 04: SEO + Structured Data (English Metadata + Technical Schema)

## Goal
Optimize organic discoverability and indexing with comprehensive **English metadata**, `@astrojs/sitemap`, `robots.txt`, and schema.org `SoftwareApplication` + `Product` structured data.

---

## Scope

### 1. English Meta Tags & OpenGraph per Page
Configure in `BaseLayout.astro`:
- **Default Site Name**: "Pipstride"
- **Homepage Meta**:
  - Title: `Pipstride — Pure Read-Only MT5 Telemetry & Automated Journal`
  - Description: `High-frequency MetaTrader 5 telemetry streaming and automated trade journaling. Engineered strictly read-only with zero order execution capabilities.`
- **Features Meta**:
  - Title: `Technical Architecture & Features — Pipstride`
  - Description: `Explore the unidirectional MT5 telemetry pipeline, sub-second heartbeat sync, and passive drawdown risk safeguards.`
- **Pricing Meta**:
  - Title: `Specifications & Subscription Tiers — Pipstride`
  - Description: `Compare Pipstride terminal limits, telemetry retention, and technical capacities in early preview.`
- OpenGraph & Twitter Card attributes:
  - `og:type`: `website`
  - `og:locale`: `en_US`
  - `twitter:card`: `summary_large_image`

### 2. Structured Data (JSON-LD)
Embed structured JSON-LD into `src/pages/index.astro` and `src/pages/pricing.astro`:
- **`SoftwareApplication`**:
  ```json
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Pipstride",
    "operatingSystem": "MetaTrader 5, Windows, Web",
    "applicationCategory": "FinanceApplication",
    "offers": {
      "@type": "AggregateOffer",
      "priceCurrency": "IDR",
      "lowPrice": "0",
      "offerCount": "4"
    }
  }
  ```
- **`Product` / `Offer` on Pricing**:
  Generated dynamically from `packages/pricing/catalog.json` with `priceCurrency: "IDR"` and `price: plan.price_cents / 100`.

### 3. Sitemap & Robots
- Integrate `@astrojs/sitemap` in `astro.config.mjs`.
- Create `apps/marketing/public/robots.txt`:
  ```text
  User-agent: *
  Allow: /

  Sitemap: https://pipstride.homever.my.id/sitemap-index.xml
  ```

---

## Files to Touch
- `apps/marketing/astro.config.mjs`
- `apps/marketing/public/robots.txt` — new.
- `apps/marketing/src/layouts/BaseLayout.astro`
- `apps/marketing/src/pages/pricing.astro`

---

## Verification
```powershell
npm --prefix apps/marketing run build
Select-String -Path apps/marketing/dist/pricing/index.html -Pattern '"@type": "SoftwareApplication"|"@type": "Product"'
Get-ChildItem apps/marketing/dist -Filter "sitemap*"
```
- Expected:
  1. Build exits 0.
  2. JSON-LD structured data in English present in HTML.
  3. `sitemap-index.xml` and `robots.txt` generated in `dist/`.

---

## Depends on
- `03-pricing-page-from-catalog.md`

## Unblocks
- `05-infra-and-ci.md`

## Status
done
