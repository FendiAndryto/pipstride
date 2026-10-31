# Ticket 05: `apps/admin` Frontend App

## Goal
Frontend admin terpisah (origin + bundle sendiri), memakai layout final ADR 0009 sejak hari pertama.

## Scope
1. Scaffold `apps/admin` (React 19 + Vite, mengikuti pola `apps/web` untuk tooling/oxlint).
2. **Layout final ADR 0009 §2 dari awal** (greenfield, tidak ada baseline):
   `app/ pages/ features/ domain/ lib/ components/ui/ styles/`.
   - `lib/http` & `domain` di-share dari pola `apps/web` (bukan import lintas-app, ADR 0009 §4;
     ekstrak ke `packages/*` hanya bila rule-of-three terpenuhi).
3. Halaman: daftar user, detail user (metadata default), audit trail, metrics, banner support mode.
4. Origin terpisah: `admin.pipstride.com` (ADR 0007 §2, ADR 0008 §7). **Tidak** ada route `/admin`
   di dalam `apps/web`.
5. Bundle admin tidak boleh masuk ke `apps/web` (guard dependency-cruiser dari fase 003).
6. Infra: Dockerfile + service compose + entry Caddy `admin.pipstride.com` + job CI.

## Files to Touch
- `apps/admin/**` — new.
- `infra/docker-compose.yml`, `infra/docker-compose.prod.yml`
- `infra/Caddyfile`
- `.github/workflows/ci.yml`

## Verification
```powershell
npm --prefix apps/admin install
npm --prefix apps/admin run lint
npm --prefix apps/admin run build
docker build -t pipstride-admin:ci apps/admin
```
Expected: lint/build exit 0; image terbangun.

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8089/api/v1/admin/users   # anon
```
Expected: bukan 200 (401/403) — endpoint dilindungi.

## Depends on
- `04-support-mode-and-access-log.md` (banner support mode + audit trail)
- Fase 003, Fase 006 (pola `lib/`+`domain/`)

## Unblocks
- (mengakhiri fase 007)

## Status
todo
