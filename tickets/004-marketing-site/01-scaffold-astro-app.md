# Ticket 01: Scaffold `apps/marketing` (Astro + Precision Design Tokens + Lightweight Motion)

## Goal
Scaffold the minimal, high-performance static Astro app in `apps/marketing` with English as the default language, dark obsidian design tokens identical to `apps/web`, and a lightweight CSS motion system.

---

## Scope

### 1. Project Initialization
- Initialize Astro in `apps/marketing` with TypeScript support:
  ```powershell
  npm create astro@latest apps/marketing -- --template minimal --typescript strict --no-install --no-git
  ```
- Configure `astro.config.mjs`:
  ```js
  import { defineConfig } from 'astro/config';

  export default defineConfig({
    site: 'https://pipstride.homever.my.id', // or production https://pipstride.com
    output: 'static',
    build: {
      format: 'directory'
    }
  });
  ```

### 2. File & Directory Layout
```text
apps/marketing/
├── public/
│   ├── favicon.svg          # Copied from apps/web/public/favicon.svg
│   └── robots.txt
├── src/
│   ├── components/
│   │   ├── Header.astro     # Precision technical navbar with live telemetry indicator
│   │   ├── Footer.astro     # Terminal-style footer with legal read-only disclaimer
│   │   └── vectors/         # Vector schematic components (Ticket 02)
│   ├── layouts/
│   │   └── BaseLayout.astro # Base shell, English metadata, Google Fonts (Outfit & JetBrains Mono)
│   ├── pages/
│   │   └── index.astro      # Minimal entry point
│   └── styles/
│       ├── tokens.css       # Color, spacing, and typography tokens from apps/web
│       └── motion.css       # Lightweight CSS keyframes (pulsing data packets, radar pings)
├── package.json
└── tsconfig.json
```

### 3. Design Tokens (`src/styles/tokens.css`)
Exact alignment with `apps/web/src/index.css`:
- Palette:
  - `--bg: #080f14` (Deep obsidian)
  - `--surface-card: #111e26`
  - `--surface-card-hover: #172b35`
  - `--border-subtle: #29404a`
  - `--g: #45e0ad` (Emerald phosphor accent)
  - `--blue: #83bdff` (Cyan telemetry accent)
  - `--red: #ff7180` (Rose drawdown accent)
  - `--text: #eff7f5` (Bright white/slate)
  - `--muted: #91a7ae` (Subtle metadata)
- Typography:
  - `--font-main: 'Outfit', system-ui, -apple-system, sans-serif`
  - `--font-mono: 'JetBrains Mono', monospace`
- Coordinates & Gridlines:
  - Subtle technical grid backgrounds (`linear-gradient` with 32px or 48px pitch) and hairline borders (`1px solid var(--border-subtle)`).

### 4. Lightweight Motion System (`src/styles/motion.css`)
Hardware-accelerated CSS animations (zero JavaScript animation overhead):
- `@keyframes flow-packet`: animates SVG stroke-dashoffset to simulate telemetry flowing from MT5 terminal to the Pipstride engine.
- `@keyframes pulse-glow`: creates a subtle glowing beacon on active status chips.
- `@keyframes radar-ping`: gentle radiating wave on the live telemetry indicator.
- Micro-interactions: `transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease` on technical cards.
- Respect `prefers-reduced-motion: reduce` by disabling loops for accessibility.

### 5. `BaseLayout.astro`
- `<html lang="en">`
- Single comprehensive `<head>`: English title, description, canonical link, OpenGraph tags, favicon.
- Font imports: Google Fonts (`Outfit:wght@300;400;500;600;700;800` & `JetBrains+Mono:wght@400;500;600`).
- Header with links: `Features`, `Architecture`, `Specifications`, and primary CTA `Launch Console [↗]` linking to `https://app-pipstride.homever.my.id`.

---

## Files to Touch
- `apps/marketing/**` (new scaffold).
- `.gitignore` (ensure `apps/marketing/dist` and `apps/marketing/node_modules` are ignored).

---

## Verification
```powershell
npm --prefix apps/marketing install
npm --prefix apps/marketing run build
```
- Expected:
  1. `apps/marketing/dist/index.html` exists.
  2. Opening `dist/index.html` displays valid English HTML with typography tokens and zero JavaScript required to read content.
  3. No CSS errors or broken font links.

---

## Depends on
None

## Unblocks
- `02-landing-and-company-pages.md`
- `05-infra-and-ci.md`

## Status
done
