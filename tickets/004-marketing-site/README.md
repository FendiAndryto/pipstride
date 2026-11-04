# Phase 004 — Marketing Site (`apps/marketing`)

## Objective
Build a fast, SEO-indexable public landing page and company showcase in English for Pipstride.
Built with **Astro** (static HTML, zero JavaScript runtime by default) on the apex domain (`pipstride.homever.my.id` / `pipstride.com`), completely decoupled from the authenticated product dashboard (`apps/web` on `app-pipstride.homever.my.id`).

Reference: `docs/adr/0007-marketing-site-and-public-surface.md`.

---

## Design Directives & Core Philosophy

1. **Language**: **English by default** for all copy, headlines, metadata, and structured data.
2. **Aesthetic — "Precision Telemetry Console"**:
   - Dark Obsidian & Charcoal palette (`#080f14`, `#111e26`, radial `#164035`) matching `apps/web`.
   - **Zero generic icons/emojis** (no generic feather/lucide icons). Replaced with bespoke **vector schematics**, technical blueprints, and wireframe data flows.
   - Hairline grid accents (`1px solid rgba(41, 64, 74, 0.4)`) with technical coordinate markings (`+`, `01`, `02`).
   - Typography: **Outfit** for clean editorial headings and **JetBrains Mono** for data packets, latency metrics, and terminal code.
3. **Lightweight Motion & Animations**:
   - Hardware-accelerated CSS keyframes and SVG stroke animations (`stroke-dashoffset`).
   - Pulsing telemetry data packet moving along the conduit vector.
   - Radar ping live status dot (`@keyframes radar-ping`).
   - Smooth hover micro-interactions on vector cards (subtle border glow, zero heavy JavaScript animation libraries).
4. **Honest Scope**:
   - Strictly read-only value prop (zero execution risk, zero trading credentials stored).
   - No Telegram alerts mentioned (removed from active UI).
   - Pricing section presented as a **Technical Specification Matrix** marked **Coming Soon** with preview access disclosure (no checkout buttons, payment gateway skeleton).
   - Direct CTA links to `https://app-pipstride.homever.my.id`.

---

## Prerequisites (Entry Criteria)
- `packages/pricing/catalog.json` available (Fase 002-01).

---

## Tickets in Phase 004
1. `01-scaffold-astro-app.md` — Scaffold minimal Astro app with brand tokens and motion CSS.
2. `02-landing-and-company-pages.md` — Vector schematics, hero, features, and company story in English.
3. `03-pricing-page-from-catalog.md` — Technical specification matrix (Coming Soon / preview mode).
4. `04-seo-and-structured-data.md` — SEO metadata, OpenGraph, sitemap, and JSON-LD schema.
5. `05-infra-and-ci.md` — Multi-stage Dockerfile, compose service, reverse proxy routing, and CI.

---

## Exit Audit Gate
- [x] Static build succeeds (`astro build`), output HTML in `dist/` readable without client JS.
- [x] English copy across all pages without grammar or formatting errors.
- [x] Bespoke SVG vectors rendered (Pipeline Schematic, Binary Code Audit, Journal Ledger). Zero generic icons.
- [x] Lightweight CSS motion functions cleanly without jank or CPU spikes.
- [x] Pricing matrix imports from `packages/pricing/catalog.json` at build time; marked "Coming Soon" with zero checkout claims.
- [x] `sitemap-index.xml` + `robots.txt` + JSON-LD structured data present in build.
- [x] Zero imports from `apps/web` (strict boundary enforced).
- [x] Docker image builds and routes cleanly via reverse proxy.
