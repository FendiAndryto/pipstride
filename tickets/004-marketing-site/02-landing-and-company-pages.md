# Ticket 02: Landing + Company / Feature Pages

## Goal
Halaman publik: beranda, profil perusahaan, ringkasan fitur — konten statis, jujur, tanpa klaim palsu.

## Scope
1. `src/pages/index.astro` — hero + value prop (read-only telemetry & journal, privacy-first).
   CTA menuju `app.pipstride.com` (login/daftar).
2. `src/pages/features.astro` — ringkasan fitur nyata yang sudah ada: live telemetry MT5,
   journal analytics, risk watchdog, Telegram alerts, PWA.
3. `src/pages/about.astro` (atau `company.astro`) — profil singkat.
4. Konten diambil dari `docs/GLOSSARY.md` + ADR 0004 (read-only) agar tidak overclaim.
5. **Dilarang** mengklaim fitur yang belum ada (billing/checkout, trading eksekusi, SSE/WebSocket).

## Files to Touch
- `apps/marketing/src/pages/index.astro`
- `apps/marketing/src/pages/features.astro`
- `apps/marketing/src/pages/about.astro`
- `apps/marketing/src/components/*` (seperlunya)

## Verification
```powershell
npm --prefix apps/marketing run build
```
Expected: build sukses; ketiga halaman ada di `dist/` sebagai HTML statis.

Audit manual: tidak ada kata "checkout", "bayar sekarang", "trading otomatis" di output.

## Depends on
- `01-scaffold-astro-app.md`

## Unblocks
- `04-seo-and-structured-data.md` (butuh halaman yang diindeks)

## Status
todo
