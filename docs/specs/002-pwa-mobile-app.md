# SPEC-002: PWA Mobile App — Installable Surface, Shell Caching, Poll Visibility Guard

## Goal

Turn the existing responsive web app into an installable PWA (home-screen icon, standalone display, splash, resilience to short connection drops) without adding a second codebase, a refresh-token flow, or any native shell. Scope deliberately excludes offline data caching and store distribution.

Reference: `docs/adr/0006-mobile-distribution-pwa-first.md`.

## Requirements

### 1. Web App Manifest
- Add `apps/web/public/manifest.webmanifest` with:
  - `name`: "Pipstride", `short_name`: "Pipstride" (truncate-safe).
  - `theme_color` and `background_color`: `#080f14` (matches existing `index.html` meta `theme-color`).
  - `display`: `standalone`. **Not** `fullscreen` — fullscreen hides the iOS status bar and breaks the `viewport-fit=cover` safe-area insets already handled in `index.css`.
  - `start_url`: `/`.
  - `scope`: `/`.
  - `orientation`: `any` (portrait preferred is acceptable but not enforced).
  - `icons`: PNG 192×192 and 512×512 for normal rendering (`purpose: "any"`), plus a separate 512×512 with extra padding (`purpose: "maskable"`). Two separate files, not one file declaring `"any maskable"`: the maskable variant needs the brand mark inside the 80% safe zone, which would make the normal icon look undersized.
- Add a 180×180 PNG `apple-touch-icon` and the standard `<link rel="apple-touch-icon">` tag (iOS does not read the manifest for the icon).

### 2. Icons
- Repository currently has only `favicon.svg` and `icons.svg` — **no raster icons exist**.
- Produce PNG icons at 192, 512 (maskable-safe, key content inside the safe zone), and 180 (`apple-touch-icon`).
- Source the icon from the existing brand mark; do not redesign.

### 3. Service Worker (`apps/web/public/sw.js`)
- Hand-written, ~90 lines. **Do not add Workbox.**
- **Navigations (HTML):** network-first. A stale `index.html` would reference bundle hashes that no longer exist after a deploy, so the cache is only an offline fallback. On success the response is written to the cache; on failure the cached shell is served.
- **Static assets (CSS, JS, fonts, icons):** stale-while-revalidate. Serve cached immediately, refresh in the background.
- **API (`/api/*`), `/health`, `/ready`:** **not intercepted at all.** No cache read, no cache write, no timeout race — the request goes straight to the network exactly as it does today. MT5 telemetry must never be served from a cache.
- **Versioning:** `sw.js` declares a `CACHE_VERSION` constant. Bump on every deploy that changes the shell. The activate step deletes caches whose name does not match the current version, then calls `clients.claim()`; install calls `skipWaiting()`.
- Register in `apps/web/src/main.jsx` after `createRoot().render()`, guarded by `import.meta.env.PROD` and `'serviceWorker' in navigator` (a worker would fight Vite HMR in dev).

### 4. HTML head additions (`apps/web/index.html`)
- `<link rel="manifest" href="/manifest.webmanifest">`.
- `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`.
- `<meta name="apple-mobile-web-app-capable" content="yes">`.
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`.
- `<meta name="apple-mobile-web-app-title" content="Pipstride">`.
- Do **not** remove or modify the existing `<meta name="viewport" content="..., viewport-fit=cover">`.

### 5. nginx cache bypass for `sw.js` (`apps/web/nginx.conf`)
- The existing `location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff2?|mq5)$ { expires 7d; ... }` block would serve a stale service worker for a week.
- Add a `location = /sw.js { add_header Cache-Control "no-cache"; }` block **before** the regex static-asset block so nginx matches it first.
- `manifest.webmanifest` is **not** matched by the existing regex block (no `.webmanifest` in the pattern), so it currently falls through to `location /` and is served without a long-lived cache. Adding `location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }` is therefore optional, only for explicitness.

### 6. CSP adjustment (`apps/web/nginx.conf`) — optional hardening, not a blocker
- The current `set $csp` has no explicit `worker-src` or `manifest-src`.
- **This does not currently block anything.** Both directives fall back through `child-src` → `script-src` → `default-src`, and `default-src 'self'` is already set, so same-origin service worker registration and manifest fetch are permitted today.
- Therefore: add `worker-src 'self';` and `manifest-src 'self';` **only** as explicit hardening (removes reliance on fallback, survives a future tightening of `default-src`). Do not treat a missing `worker-src` as the cause if registration fails — diagnose elsewhere.

### 7. Poll visibility guard (`apps/web/src/components/Dashboard.jsx`)
- Inside `runPoll` (currently `if (!isMounted) return; await fetchStatus();`), add:
  - `if (document.hidden) return;` — skip the fetch when the tab is not visible.
- In the interval effect, add adaptive backoff:
  - Foreground: use `pollInterval` (default 1000ms) as today.
  - Background: recompute interval to a backoff value (start at 15s; a constant 15–30s is acceptable, no exponential needed).
  - On `visibilitychange` → visible: clear the backoff, fire one immediate `runPoll`, and resume the foreground interval.
- Guard against overlap: do not start a new `runPoll` if a previous one is still in flight. Track an `inFlightRef`.
- Apply the same `document.hidden` guard and overlap protection to the HomeTab and JournalTab polling intervals.

### 8. Idle logout (token exposure bound)
- Add an idle timer that clears the JWT and redirects to login after 15 minutes of no user interaction and no successful poll response.
- Reset the timer on: any pointer/keyboard event, any successful API response (poll counts).
- Do **not** move JWT storage from `localStorage` to `sessionStorage`. `sessionStorage` does not persist across PWA launches, which would force a login on every open — worse than the status quo.
- Implementation lives in a small hook (e.g. `apps/web/src/hooks/useIdleLogout.js`) consumed by `App.jsx`.

## Acceptance Criteria
- `npm --prefix apps/web run lint` exits 0.
- `npm --prefix apps/web run build` exits 0.
- `node apps/web/scripts/check-i18n.cjs` reports `i18n OK — 460 keys per language`.
- Lighthouse "Installable" check passes for the production build.
- Installing the PWA on Android Chrome produces a standalone app with the correct icon, theme color, and splash.
- Installing via iOS Safari "Add to Home Screen" produces a standalone app with the apple-touch-icon and no Safari chrome.
- After installing and backgrounding for >30 seconds, reopening does not show data older than the last foreground poll plus one backoff window (no silent staleness).
- `document.hidden === true` produces zero `/api/v1/bridge/*` requests from the dashboard poll.
- In-flight overlap protection: no two concurrent `runPoll` calls for the same data source.
- `sw.js` and `manifest.webmanifest` are served with `Cache-Control: no-cache` (verifiable via `curl -I`).
- Service worker registers successfully on the production build (verifiable via DevTools → Application → Service Workers, `activated and is running`).
- Idle for 15 minutes while no interaction occurs: JWT is cleared and the app shows the login screen.

## Impact Analysis (Files Touched)
- `apps/web/public/manifest.webmanifest` — new.
- `apps/web/public/sw.js` — new.
- `apps/web/public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — new binary assets.
- `apps/web/index.html` — manifest link, apple-touch-icon, apple-mobile-web-app meta tags.
- `apps/web/nginx.conf` — `location = /sw.js { add_header Cache-Control "no-cache"; }` before the regex static-asset block; optional `location = /manifest.webmanifest`; optional explicit `worker-src 'self'; manifest-src 'self';` in CSP.
- `apps/web/src/main.jsx` — service worker registration (prod only).
- `apps/web/src/components/Dashboard.jsx` — visibility guard, adaptive backoff, in-flight guard.
- `apps/web/src/components/HomeTab.jsx` — same visibility/in-flight guards.
- `apps/web/src/components/JournalTab.jsx` — same visibility/in-flight guards.
- `apps/web/src/hooks/useIdleLogout.js` — new.
- `apps/web/src/App.jsx` — consumes `useIdleLogout`.

## Edge Cases
- **iOS standalone suspends timers after ~30s background.** On resume, the `visibilitychange` handler fires one immediate poll; the user sees "reconnecting" briefly rather than stale data. Acceptable.
- **Network failure on first load (cold start offline).** Service worker has no shell cached yet → browser shows its native offline page. Acceptable; not a supported flow.
- **Service worker update deployed.** New `sw.js` is fetched because nginx serves it `no-cache`. `clients.claim()` on activate and a `CACHE_VERSION` bump evict the old shell cache. The user sees the new version on next navigation.
- **User has `remember me` off (sessionStorage token).** Idle logout still fires. On next launch, sessionStorage is empty → login screen. No regression vs. today.
- **Poll in flight when tab is hidden.** The in-flight request completes and updates state; the next scheduled `runPoll` is skipped because `document.hidden`. No overlap.
- **CSP change blocks an existing inline style.** Current CSP already allows `style-src 'self' 'unsafe-inline'`; the additions are additive (`worker-src`, `manifest-src`) and do not tighten existing policy.
- **Service worker registration fails on first deploy.** Most likely cause is the stale-cache problem in §5 (old `sw.js` served from the 7-day immutable static rule), not CSP. Check `Cache-Control` on `/sw.js` first.

## Out of Scope
- Refresh-token flow (deferred until Capacitor/store commitment — see ADR 0006).
- SSE / WebSocket for real-time push (deferred until polling + visibility proves insufficient at real user count).
- Capacitor native shell, app-store signing, developer accounts.
- React Native / Expo codebase.
- Web Push (iOS foreground-only limitation; Telegram bot already covers async alerts).
- Offline-first data caching in the service worker.
- Redesigning the icon or brand mark.
- `display: fullscreen` (breaks iOS safe-area insets).
