# Ticket 01: Scaffold `apps/marketing` (Astro)

## Goal
Bangun kerangka situs statis Astro di `apps/marketing` dengan brand token yang sama dengan produk.

## Scope
1. `npm create astro@latest apps/marketing` (template minimal, TypeScript, tanpa integrasi berat).
2. Struktur idiomatik Astro: `src/pages/`, `src/layouts/`, `src/components/`, `src/styles/`, `public/`.
3. `src/styles/tokens.css` — salin token warna/typografi dari `apps/web/src/index.css` dan `App.css`
   (sumber kebenaran visual hari ini). Jangan mendesain ulang brand.
4. `src/layouts/BaseLayout.astro` — `<head>` tunggal (title, description, canonical, OG), slot konten.
5. Script `npm --prefix apps/marketing run build` mengeluarkan `dist/`.
6. `.gitignore` untuk `apps/marketing/dist`, `node_modules`.

## Files to Touch
- `apps/marketing/**` — new (scaffold).
- Root `.gitignore` bila perlu.

## Verification
```powershell
npm --prefix apps/marketing install
npm --prefix apps/marketing run build
```
Expected: `apps/marketing/dist/index.html` ada; membuka file itu menampilkan teks tanpa butuh JS.

## Depends on
None

## Unblocks
- `02-landing-and-company-pages.md`
- `05-infra-and-ci.md`

## Status
todo
