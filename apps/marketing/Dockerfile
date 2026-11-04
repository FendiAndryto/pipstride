# Build context is the repository root so the shared pricing catalog is available.
FROM node:22-alpine AS builder
WORKDIR /repo
COPY apps/marketing/package.json apps/marketing/package-lock.json ./apps/marketing/
RUN npm ci --prefix apps/marketing
COPY apps/marketing ./apps/marketing
COPY packages/pricing ./packages/pricing
RUN npm --prefix apps/marketing run build

# Stage 2: Production static server
FROM nginx:alpine AS runner
COPY apps/marketing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/marketing/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
