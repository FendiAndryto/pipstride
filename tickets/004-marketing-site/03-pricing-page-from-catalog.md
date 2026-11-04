# Ticket 03: Specifications & Pricing Matrix (Single-Source Catalog + Coming Soon)

## Goal
Build the pricing and technical specifications page in **English** at `src/pages/pricing.astro`. Reads tier configurations from `packages/pricing/catalog.json` at build time, rendered as a high-precision **Technical Specification Matrix** marked **Coming Soon** (skeleton UI with early preview access, zero fake checkout).

---

## Scope

### 1. English Copywriting & Technical Matrix Layout
- **Page Title**: "Specifications & Subscription Tiers"
- **Subtitle**: "Engineered for disciplined traders. Pick the capacity your portfolio requires."
- **Early Preview Banner**:
  ```text
  [ EARLY PREVIEW ACCESS: BILLING INTEGRATION COMING SOON ]
  Pipstride is currently available in open community preview.
  All account monitoring, telemetry ingestion, and journal analytics
  are free to test with zero billing or payment gateway required.
  ```
- **Technical Spec Matrix (Comparison Table)**:
  - Columns: `Free`, `Core`, `Plus`, `Pro`.
  - Rows:
    - **Active MT5 Accounts**: `1 Terminal` | `3 Terminals` | `5 Terminals` | `Unlimited Terminals`
    - **History Retention**: `30 Days` | `90 Days` | `180 Days` | `1 Year`
    - **Telemetry Polling Rate**: `5s Heartbeat` across all tiers
    - **Drawdown Watchdog**: `Standard` | `Real-Time Alert` | `Real-Time Alert` | `Multi-Account Aggregate`
    - **Target Price**: `IDR 0` | `IDR 59,000 /mo` | `IDR 129,000 /mo` | `IDR 199,000 /mo`
    - **Status**: All marked with an elegant technical badge: `[ CURRENTLY FREE IN PREVIEW ]` or `[ COMING SOON ]`.
- **Primary Action (CTA)**:
  - Button text: `Launch Free Console [↗]`
  - Target URL: `https://app-pipstride.homever.my.id` (or apex/subdomain config).
  - **Zero Checkout / Payment Gateway**: No credit card forms, no checkout buttons, no misleading purchase flows.

### 2. Single-Source Import
Import catalog at build time:
```ts
import catalog from '../../../packages/pricing/catalog.json';
```
The page maps `catalog.plans` dynamically so that changing `price_cents` or `max_connections` in `catalog.json` instantly updates the static HTML on rebuild.

---

## Files to Touch
- `apps/marketing/src/pages/pricing.astro` — new.

---

## Verification
```powershell
npm --prefix apps/marketing run build
Select-String -Path apps/marketing/dist/pricing/index.html -Pattern "59,000|129,000|199,000|Preview"
```
- Expected:
  1. Build exits 0.
  2. Pricing table reflects catalog prices and features in English.
  3. No checkout scripts or payment gateway libraries loaded.

---

## Depends on
- `01-scaffold-astro-app.md`
- `packages/pricing/catalog.json` (Fase 002-01)

## Unblocks
- `04-seo-and-structured-data.md`

## Status
done
