# Pipstride Admin Console

Standalone administrative telemetry console for Pipstride (`apps/admin`).
Built with React 19, Vite 8, pure CSS design tokens, and ADR 0009 layered architecture.

## Structure

```text
src/
├── app/            # Shell, providers, hash routing, guards
├── pages/          # Thin route components (Overview, Users, UserDetail, Audit, Support)
├── features/       # Verticals: auth, metrics, users, support, audit
├── domain/         # Pure business logic (formatting, support session countdowns)
├── lib/            # HTTP transport, JWT storage, API helpers
├── components/ui/  # Telemetry UI primitives (Card, Table, Badge, Button, Input, Modal)
└── styles/         # Tokens and global styling
```

## Commands

```bash
# Install dependencies
npm install

# Development server (port 5180, proxies /api -> http://localhost:8089)
npm run dev

# Linting
npm run lint

# Architecture boundary verification
npm run lint:arch

# Production bundle
npm run build

# Preview build
npm run preview
```

## Environment Variables

- `VITE_APP_URL`: The public URL of the trader web dashboard shown in the credential copy modal. Defaults to `https://app-pipstride.homever.my.id` if not set. Note that Vite bakes environment variables starting with `VITE_` at build time.

