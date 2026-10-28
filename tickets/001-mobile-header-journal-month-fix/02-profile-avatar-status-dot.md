# Ticket 02: Integrate MT5 Connection Status Dot and Dropdown Details in PipstrideHeader

## Goal
Add MT5 telemetry status dot badge to the profile button and render MT5 connection status details in the profile dropdown.

## Scope
1. In `apps/web/src/components/PipstrideHeader.jsx`:
   - Inside `.header-profile-btn`, render `<span className={`header-profile-status-dot ${isConnected ? 'online' : 'offline'}`} />`.
   - Inside `.header-profile-dropdown`, add a dedicated `.header-profile-dropdown-mt5` section displaying `MT5 LIVE` / `MT5 OFFLINE`, host environment (`VPS` / `Local`), latency, and active account number.
   - Inside `.header-profile-dropdown`, add mobile language switcher row for screens where top bar switcher is hidden.
2. In `apps/web/src/index.css`:
   - Add `.header-profile-btn { position: relative; }`.
   - Add styling for `.header-profile-status-dot` (8px badge, green/red, positioned at bottom-right of avatar).
   - Add styling for `.header-profile-dropdown-mt5` and its badges.

## Files to Touch
- `apps/web/src/components/PipstrideHeader.jsx`
- `apps/web/src/index.css`

## Verification
```bash
npm --prefix apps/web run lint && npm --prefix apps/web run build
```
Expected: Clean exit code 0, 0 oxlint warnings, Vite build succeeds.

## Depends on
None

## Status
done
