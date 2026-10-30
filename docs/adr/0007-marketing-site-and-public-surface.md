# ADR 0007: Marketing Site & Public Surface

## Status

Accepted

## Context

Pipstride needs a public surface — company profile, feature overview, and subscription pricing — separate from the product dashboard (`apps/web`). Today there is no public site: prospective users land directly on the login screen.

Three facts constrain the options:

1. **`apps/web` is a client-rendered Vite SPA.** Its HTML shell is empty; content only appears once JavaScript runs. That is fine for an authenticated, high-interaction dashboard behind a login, but poor for a public, indexable marketing surface where organic search is the acquisition channel.
2. **Pricing already exists as data.** `plans` (`free`/`core`/`plus`/`pro`) is seeded in `app/main.py:26-50` with `price_cents`, and `Entitlement` assigns a plan to a user. Billing is not implemented (`GLOSSARY.md`), but the catalogue is real. A marketing page that hard-codes prices independently would drift from what the system enforces.
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
   - `services/api` seeds and validates the `plans` table from it at startup, resolving the path from the repository root (configurable via `PRICING_CATALOG_PATH`, default `packages/pricing/catalog.json`).
   - `apps/marketing` imports it **at build time** through a relative path; prices are baked into static HTML (good SEO, no client fetch, no flash of unstyled content).
   - `apps/admin` imports the same file through a relative path.

   No npm-workspace tooling is required for this file. Defining prices in more than one place is prohibited.

4. **Never advertise a price the system cannot enforce.** While billing is unimplemented, the page presents the tiers and their limits honestly, rather than promising checkout that does not exist.

5. **SEO is part of the deliverable**, not a follow-up: `sitemap.xml`, `robots.txt`, and `schema.org` `Product`/`Offer` structured data on the pricing page.

6. **`apps/marketing` is content-first and is explicitly exempt from the feature/domain layout of ADR 0009 §2.** A static content site has no business-rule layer and no per-feature verticals, so it uses Astro's idiomatic structure (`pages/ layouts/ components/ content/ lib/ styles/`). ADR 0009 records this exception.

## Consequences

- Positive: indexable public pages with correct prices; one place to change a price; product bundle never ships marketing code and vice versa; marketing can be redeployed without rebuilding the product.
- Positive: the signup funnel becomes marketing → `app.pipstride.com`, keeping the apex free of authenticated state.
- Negative / trade-offs: one more build target and container; a second frontend framework (Astro) to maintain alongside React. This is accepted because the SEO and content requirements of a public site are materially different from those of the dashboard.
- A dedicated marketing/CMS pipeline in a separate repository only becomes justified if a non-engineer owns the site with independent repo access. Until then it stays in this monorepo.

## References

- ADR 0006 — mobile/PWA distribution (unchanged; marketing does not affect the PWA).
- ADR 0009 — layered architecture and dependency rule.
- `docs/GLOSSARY.md` — Plan / Entitlement definition.
