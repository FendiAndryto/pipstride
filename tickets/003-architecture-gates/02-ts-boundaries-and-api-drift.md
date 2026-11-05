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
done

## Implementation notes (2026-11-05)

### Mechanism chosen: `dependency-cruiser`

`oxlint`'s `no-restricted-imports` can express "do not import path X" but not
"features/X may import features/X but not features/Y" (a graph rule keyed on
the importing file's directory). Since the feature boundary is exactly that
shape, `dependency-cruiser` is the correct tool. It is installed as a
`devDependency` (`dependency-cruiser ^18.7.2`).

Config: `apps/web/.dependency-cruiser.cjs` (`.cjs`, not `.js`, because
`package.json` sets `"type": "module"`).

Script: `npm run lint:arch` → `depcruise src --config .dependency-cruiser.cjs`.

Rules installed:
- `no-cross-app-imports` — `src/**` may not reach another app bundle
  (npm dependencies excluded).
- `domain-pure` — `src/domain/**` may not import React / React DOM /
  `lucide-react` / CSS.
- `no-feature-to-feature` — `src/features/X/**` may not import
  `src/features/Y/**`.
- `pages-only-import-approved-layers` — `src/pages/**` may import only
  `features/`, `components/ui/`, `lib/`, plus existing shell folders
  (`constants/`, `context/`, `hooks/`, `assets/`) and CSS.

The last three are dormant today because `domain/`, `features/`, and `pages/`
do not exist yet. They activate the moment Fase 006 creates those folders;
no config change is needed then. This is the "baseline for the old flat
layout + TODO Fase 006" the ticket asked for.

### OpenAPI drift: deferred (documented, not silently skipped)

The client is still hand-written (`apps/web/src/services/api.js`) and the
backend does not emit a checked-in OpenAPI document (`openapi.json`); the
schema is generated at runtime by FastAPI. A drift script comparing 20
hand-written methods against a runtime-generated schema would be brittle and
would need a booted API in CI. Deferred to the phase that generates a client
(`packages/api-client`, ADR 0009 §5 rule-of-three). The ticket explicitly
allows deferring this section.

### Verification

```text
$ npm run lint:arch
✔ no dependency violations found (25 modules, 73 dependencies cruised)

$ npm run lint
0 errors (3 pre-existing react warnings in HomeTab/JournalTab)

$ npm run build
✓ built in 1.97s
```

Negative test: created `src/features/foo/a.js` importing `../bar/b.js`
→ `lint:arch` failed with:

```text
error no-feature-to-feature: src/features/foo/a.js → src/features/bar/b.js
x 1 dependency violations (1 errors, 0 warnings)
```

Directories were removed afterwards and the green run repeated.
