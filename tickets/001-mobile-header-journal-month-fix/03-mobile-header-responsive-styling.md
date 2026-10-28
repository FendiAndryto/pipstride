# Ticket 03: Responsive Mobile Header Layout and Viewport Optimization

## Goal
Optimize responsive media queries for `.tradegear-header` so navbar elements never overflow or collide with the brand logo on mobile devices (<640px and <400px).

## Scope
1. In `apps/web/src/index.css`:
   - Under `@media (max-width: 639.98px)`:
     - Hide `.status-pill` (`display: none`).
     - Display `.header-profile-status-dot` (`display: block`).
     - Ensure `.brand-group` and `.header-right` have proper spacing without line-wrapping or collision.
   - Under `@media (max-width: 400px)`:
     - Hide top-bar `.header-lang-switcher` (`display: none`), with fallback in dropdown active.
     - Ensure MT5 GUI button and avatar fit cleanly alongside logo.
   - Under `@media (min-width: 640px)`:
     - Ensure `.header-profile-status-dot` remains `display: none` while `.status-pill` remains visible.

## Files to Touch
- `apps/web/src/index.css`

## Verification
```bash
npm --prefix apps/web run lint && npm --prefix apps/web run build
```
Expected: Clean exit code 0, 0 oxlint warnings, Vite build succeeds.

## Depends on
- `tickets/001-mobile-header-journal-month-fix/02-profile-avatar-status-dot.md`

## Status
done
