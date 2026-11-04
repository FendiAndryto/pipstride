# Ticket 05: Infra, Dockerfile & Reverse Proxy Routing for Marketing

## Goal
Containerize `apps/marketing` with a lightweight multi-stage Docker build, configure Docker Compose services, and map apex domain (`pipstride.homever.my.id` / `pipstride.com`) to the marketing site while routing the product dashboard to the subdomain (`app-pipstride.homever.my.id`).

---

## Scope

### 1. `apps/marketing/Dockerfile`
Multi-stage static build:
```dockerfile
# Stage 1: Build static assets
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production static server
FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
```

### 2. Docker Compose Integration (`infra/docker-compose.yml`)
Add `marketing` service:
```yaml
  marketing:
    build:
      context: ../apps/marketing
      dockerfile: Dockerfile
    container_name: pipstride_marketing
    restart: unless-stopped
    ports:
      - "${MARKETING_PORT:-3001}:80"
    networks:
      - pipstride_net
```

### 3. Domain Topology & Reverse Proxy Routing
- **Apex Domain (`pipstride.homever.my.id` / `pipstride.com`)**:
  - Serves static marketing container (`marketing:80` / port 3001).
  - Purely public, zero session cookies, zero product scripts.
- **Subdomain (`app-pipstride.homever.my.id` / `app.pipstride.com`)**:
  - Serves authenticated trading journal (`web:80` / port 3000).
- Update `infra/Caddyfile` and `infra/.env` to reflect `MARKETING_PORT=3001` and apex reverse proxying.

### 4. CI Workflow (`.github/workflows/ci.yml`)
- Add job `marketing-lint-build`:
  - `npm --prefix apps/marketing ci`
  - `npm --prefix apps/marketing run build`
- Ensure marketing container builds during Docker image checks.

---

## Files to Touch
- `apps/marketing/Dockerfile` — new.
- `infra/docker-compose.yml`
- `infra/docker-compose.prod.yml`
- `infra/Caddyfile`
- `infra/.env`
- `.github/workflows/ci.yml`

---

## Verification
```powershell
docker build -t pipstride-marketing:ci apps/marketing
docker compose -f infra/docker-compose.yml config
```
- Expected:
  1. Image builds cleanly without layer errors.
  2. Compose syntax passes validation.

```powershell
curl.exe -sI http://localhost:3001/
```
- Expected:
  1. HTTP 200 OK.
  2. `content-type: text/html`.
  3. No `set-cookie` header.

---

## Depends on
- `01-scaffold-astro-app.md`
- `02-landing-and-company-pages.md`

## Unblocks
- Deployment of Phase 004 to homeserver and production.

## Status
done
