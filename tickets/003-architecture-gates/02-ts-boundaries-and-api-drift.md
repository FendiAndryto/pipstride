# Ticket 02: TypeScript Boundaries + API Drift Guard

## Goal
Tegakkan arah import frontend dan deteksi drift antara client API dan OpenAPI backend.

## Scope
1. Pilih satu mekanisme (keputusan ada di tiket ini, bukan di ADR): `dependency-cruiser`
   **atau** `eslint` `no-restricted-imports` + `oxlint` rules. Repo memakai `oxlint`, jadi
   utamakan `no-restricted-imports` bila cukup; `dependency-cruiser` hanya bila butuh graph.
2. Rules minimum (ADR 0009 §2):
   - `pages/*` → hanya `features/*`, `components/ui/*`, `lib/*`.
   - `features/X/*` → hanya `features/X/*`, `domain/*`, `lib/*`, `components/ui/*` (tidak boleh
     `features/Y/*`).
   - `domain/*` → tanpa React/DOM.
   - `apps/A` tidak import `apps/B`.
   - Terapkan baseline untuk layout lama (`components/` flat) + TODO fase 006.
3. Jalankan sebagai bagian job `arch` di `.github/workflows/ci.yml`.
4. **Drift OpenAPI (opsional, tandai skip bila belum relevan):** selama client masih tangan
   (`apps/web/src/services/api.js`), bandingkan daftar method/path di client dengan
   `services/api/app/api/v1/openapi.json` lewat script kecil; gagal bila ada path backend tanpa
   method client. Bila terlalu rapuh, dokumentasikan sebagai deferred dan tutup tiket tanpa bagian ini.

## Files to Touch
- `apps/web/.dependency-cruiser.js` **atau** update config lint `apps/web` — pilih satu.
- `.github/workflows/ci.yml`
- (opsional) `apps/web/scripts/check-api-drift.cjs` — new.

## Verification
```powershell
npm --prefix apps/web run lint
```
Expected: exit 0.

Uji negatif: import `../features/other/x` dari dalam sebuah `features/foo/` → rule gagal → kembalikan.

## Depends on
- `tickets/003-architecture-gates/01-python-import-linter.md` (agar job `arch` sudah ada)

## Unblocks
- Fase 006, 007 (frontend layout)

## Status
todo
