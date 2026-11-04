# ADR 0007: Marketing Site & Public Surface

## Status

Accepted

## Context

Pipstride needs a public surface — company profile, feature overview, and subscription pricing — separate from the product dashboard (`apps/web`). Today there is no public site: prospective users land directly on the login screen.

Three facts constrain the options:

1. **`apps/web` is a client-rendered Vite SPA.** Its HTML shell is empty; content only appears once JavaScript runs. That is fine for an authenticated, high-interaction dashboard behind a login, but poor for a public, indexable marketing surface where organic search is the acquisition channel.
2. **Pricing already exists as data.** `plans` (`free`/`core`/`plus`/`pro`) is seeded from the catalog in `app/main.py:35-62` with `price_cents`, and `Entitlement` assigns a plan to a user. `price_cents` holds IDR minor units: `5900000` renders as `IDR 59,000`. Billing is not implemented (`GLOSSARY.md`), but the catalogue is real. A marketing page that hard-codes prices independently would drift from what the system enforces.
3. **The product is SaaS.** Domain layout, SEO, and pricing honesty are first-class concerns, not afterthoughts.

The repository has no `packages/` directory and no root workspace tooling today. This decision must not assume one.

## Decision

1. **A separate frontend app, `apps/marketing`, built with Astro (static, content-first).** It lives in the same monorepo, not a separate repository, so brand tokens and the pricing catalogue stay single-source. Astro emits content as static HTML — no JavaScript required to read the page — which is what the public surface needs.

2. **Domain topology: apex is marketing, product lives on a subdomain.**

   | Host | Serves |
   | --- | --- |
   | `pipstride.com` | `apps/marketing` (public, no auth) |
   | `app.pipstride.com` | `apps/web` (product) |
   | `admin.pipstride.com` | `apps/admin` (see ADR 0008) |
   | `api.pipstride.com` | `services/api` |

   The apex carries no session state and no product JavaScript. (Product auth is a JWT in `localStorage`, per ADR 0006 — there are no product cookies.)

3. **Pricing is single-source in `packages/pricing/catalog.json`** — a plain JSON file, not a published package and not a workspace dependency.
   - `services/api` seeds and validates the `plans` table from it at startup, resolving the path from the repository root (configurable via `PRICING_CATALOG_PATH`, default `packages/pricing/catalog.json`). The table is a projection of the file: rows are inserted or updated, never deleted, and a plan removed from the catalog keeps its row until a migration retires it.
   - `apps/marketing` imports it **at build time** through a relative path; prices are baked into static HTML (good SEO, no client fetch, no flash of unstyled content).
   - `apps/admin` imports the same file through a relative path.

   No npm-workspace tooling is required for this file. Defining prices in more than one place is prohibited. The API fails to start if the file is missing or malformed; the marketing build imports it through `apps/marketing/src/lib/pricing.js`, so no copied catalog lives inside the app.

4. **Never advertise a price the system cannot enforce.** Billing is unimplemented, so the public page shows the three paid tiers (`core`, `plus`, `pro`) with their catalog prices and `max_connections`, explicitly labelled **Coming Soon**, and offers no checkout. The internal `free` plan is not advertised because registration assigns it directly. No free trial is advertised until trial provisioning exists.

5. **Money representation.** Catalog prices are integers in IDR minor units, named `price_cents` for historical reasons (IDR has two decimal places: `5900000` = `IDR 59,000`). Floats may appear only in telemetry/analytics aggregates and must be documented as such; persisted prices and billing amounts stay integer minor units.

6. **SEO is part of the deliverable**, not a follow-up: `sitemap.xml`, `robots.txt`, and `schema.org` `Product`/`Offer` structured data on the pricing page. Because billing is unimplemented, each offer is emitted with `availability: https://schema.org/PreOrder` — structured data must not claim a purchasable offer.

7. **`apps/marketing` is content-first and is explicitly exempt from the feature/domain layout of ADR 0009 §2.** A static content site has no business-rule layer and no per-feature verticals, so it uses Astro's idiomatic structure (`pages/ layouts/ components/ content/ lib/ styles/`). ADR 0009 records this exception.

## Consequences

- Positive: indexable public pages with correct prices; one place to change a price; product bundle never ships marketing code and vice versa; marketing can be redeployed without rebuilding the product.
- Positive: the signup funnel becomes marketing → `app.pipstride.com`, keeping the apex free of authenticated state.
- Negative / trade-offs: one more build target and container; a second frontend framework (Astro) to maintain alongside React. This is accepted because the SEO and content requirements of a public site are materially different from those of the dashboard.
- A dedicated marketing/CMS pipeline in a separate repository only becomes justified if a non-engineer owns the site with independent repo access. Until then it stays in this monorepo.

## References

- ADR 0006 — mobile/PWA distribution (unchanged; marketing does not affect the PWA).
- ADR 0009 — layered architecture and dependency rule.
- `docs/GLOSSARY.md` — Plan / Entitlement definition.
