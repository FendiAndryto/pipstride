# Ticket 05: Infra + CI for Marketing

## Goal
Container marketing bisa di-deploy dan dibangun di CI, dengan routing apex yang benar.

## Scope
1. `apps/marketing/Dockerfile` — multi-stage: build Astro → serve `dist/` via `nginx:alpine`
   (atau `caddy` bila seragam dengan infra; pilih satu).
2. `infra/docker-compose.yml` + `infra/docker-compose.prod.yml` — tambah service `marketing`.
3. `infra/Caddyfile` — arahkan `pipstride.com` (apex) ke service marketing; pastikan `app.pipstride.com`
   tetap ke web dan `api.pipstride.com` tetap ke api. Apex **tanpa** cookie/session produk.
4. `.github/workflows/ci.yml` — job `marketing` (npm ci + build) dan tambahkan image-nya ke job `docker`.

## Files to Touch
- `apps/marketing/Dockerfile` — new.
- `infra/docker-compose.yml`, `infra/docker-compose.prod.yml`
- `infra/Caddyfile`
- `.github/workflows/ci.yml`

## Verification
```powershell
docker build -t pipstride-marketing:ci apps/marketing
docker compose -f infra/docker-compose.yml config
```
Expected: image terbangun; compose config valid.

```powershell
curl.exe -sI http://localhost:8089/  # atau port marketing
```
Expected: HTTP 200, `content-type: text/html`, tidak ada `set-cookie` produk.

## Depends on
- `01-scaffold-astro-app.md`

## Unblocks
- Deploy fase 004.

## Catatan
- Ini menambah satu build target + container (ADR 0007 Consequences). Diterima.
- Jangan ubah CSP web produk di tiket ini.

## Status
todo
