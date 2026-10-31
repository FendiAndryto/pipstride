# Fase 004 — Marketing Site (`apps/marketing`)

## Tujuan
Permukaan publik yang indexable: profil perusahaan, ringkasan fitur, dan harga — terpisah dari
produk (`apps/web`), di origin apex.

Referensi: `docs/adr/0007-marketing-site-and-public-surface.md`.

## Prasyarat (kriteria masuk)
- Fase 002 selesai (`packages/pricing/catalog.json` ada).

## Tiket
1. `01-scaffold-astro-app.md`
2. `02-landing-and-company-pages.md`
3. `03-pricing-page-from-catalog.md`
4. `04-seo-and-structured-data.md`
5. `05-infra-and-ci.md`

## Gate (checklist audit keluar)
- [ ] `apps/marketing` build statis sukses (`astro build`), output HTML berisi konten **tanpa JS**.
- [ ] Harga di halaman pricing **identik** dengan `packages/pricing/catalog.json` (build-time import, bukan hard-code).
- [ ] Tidak ada klaim checkout/billing yang belum ada (ADR 0007 §4).
- [ ] `sitemap.xml` + `robots.txt` + schema.org `Product`/`Offer` ada di output build.
- [ ] `apps/marketing` **tidak** mengimpor dari `apps/web` (ADR 0007/0009 boundary).
- [ ] Image container terbangun; Caddy mengarahkan apex ke marketing, `app.` ke web.

## Dampak
- Funnel: `pipstride.com` → `app.pipstride.com`. Apex bebas state autentikasi.
- Tidak memblokir fase lain; boleh dikerjakan sebelum 005/006.

## Catatan lingkup
- Layout Astro idiomatik (`pages/ layouts/ components/ content/ lib/ styles/`) — **dikecualikan**
  dari layout `features/domain` (ADR 0007 §6, ADR 0009 §2 exception).
- Jangan bikin `packages/ui`/`packages/i18n` dulu (rule-of-three).
