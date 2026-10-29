# ADR 0006: Mobile Distribution — PWA First, Native Shell Only On Trigger

## Status
Accepted

## Context

Pipstride today is a responsive React web app with a bottom navigation bar and a mobile-specific header. There is no `manifest.json`, no service worker, and no installable surface. Users who want "the app on their phone" currently open a browser tab.

Three paths existed:

| Path | Realistic effort | Ongoing cost | Reuse of existing frontend |
|---|---|---|---|
| **A. PWA** (manifest + service worker) | 2–4 days | ~0 | 100% |
| **B. Capacitor** (native shell around the same bundle) | 1–2 weeks + refresh tokens + signing + 2 store reviews | Permanent: plugin/OS/build churn, resubmits | ~95% web, new native config and storage |
| **C. React Native / Expo** | 6–12 weeks to reach parity | Foremost: two of everything | ~0% |

The decisive factor is not effort but what has to be duplicated. Two assets are deliberately single-source today:

1. **The CSS design system** — hand-written classes and tokens in `src/index.css` and `src/App.css`. No Tailwind, no CSS-in-JS, nothing that ports to another renderer.
2. **The i18n dictionary** — `src/constants/translations.js`, 460 keys per language with enforced key parity (`apps/web/scripts/check-i18n.cjs`). This was built specifically so that no screen is ever half-translated.

Neither exists in a React Native or Flutter codebase. Choosing C means rebuilding both, then keeping them in lockstep forever, on a product whose entire visible surface is a dashboard reading one REST API.

Push notifications are already solved outside the browser: the backend ships a Telegram bot (`services/api/app/api/v1/telegram.py`) with per-user token and chat id. Any option that claims push as its advantage is competing with a channel that already works and needs no app at all.

## Decision

1. **No app store, no native shell, for now.** The mobile target is a **PWA**: home-screen install, standalone display, splash, and resilience to short connectivity drops. Scope is defined in `docs/specs/002-pwa-mobile-app.md`.

2. **The service worker caches the app shell only.** Stale-while-revalidate for static assets; network-first for `/api/*`. No offline data cache, no background sync. MT5 telemetry is time-sensitive: a cached equity figure presented as current is worse than a visible "reconnecting" state.

3. **No refresh-token flow for the PWA.** A 24-hour JWT expiring mid-session is the behaviour the web app already has, so it is not a regression. The installed-client margin, if wanted, is `ACCESS_TOKEN_EXPIRE_MINUTES=4320` — a configuration value, not a new auth flow. A refresh token becomes mandatory only when app-store submission is committed (the store reviewer rejects daily re-login, and native background push needs a long-lived credential).

4. **Polling must respect visibility before any install surface ships.** `Dashboard.jsx` polls every second regardless of tab visibility. An installed PWA throttles timers when backgrounded (Android ~once per minute) or suspends them entirely (iOS standalone, after ~30s), producing stale data and a catch-up burst. The fix is client-side only: skip work while `document.hidden`, back off to 15–30s in the background, resume immediately on visibility, and allow at most one in-flight poll.

5. **Escalation is trigger-based, not preference-based.**
   - **A → B** when a missed risk-watchdog alert that silent native push would have delivered causes a user-facing incident, or when App Store / Play Store presence becomes an acquisition requirement.
   - **B → C** only when a capability is natively unavailable: measurable sub-60fps scrolling on the target lowest device, TradingView mobile SDK or Apple Charts, or native in-app purchases.
   - "React Native is more modern" is explicitly not a trigger.

## Consequences

- One codebase, one i18n dictionary, one design system, one build. The 460-key parity guard keeps holding.
- iOS Web Push is not adopted. It is foreground-only for installed PWAs, and Telegram already covers asynchronous alerting.
- A PWA is not listed in any store. Discovery has to come from the web, until trigger A→B fires.
- Token storage stays in `localStorage`. The mitigation is bounded exposure (idle logout) and the existing strict CSP, not a storage-location change; moving to `sessionStorage` would force a login on every launch, which is worse than the status quo.
- If escalation to B happens, the work already sequenced is: refresh-token flow (~3–5 backend days), Capacitor shell, SecureStorage migration, push registration, signing, two store reviews. None of it is thrown away by starting with A.

## Supersedes

- `docs/specs/001-mobile-header-journal-month-fix.md` §4, second bullet: the language switcher is no longer moved into the profile dropdown at `< 400px`. A compact globe toggle is rendered in the header for all viewports `< 640px`, so the dropdown fallback is dead and was removed.
