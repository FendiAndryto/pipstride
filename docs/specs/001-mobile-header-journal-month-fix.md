# SPEC-001: Mobile Header Layout Restructuring & Journal Month Selector Bug Fix

## Goal
Fix the month selector behavior in the Journal tab (broken picker overlay, hardcoded Indonesian locale, missing future month guard) and restructure the mobile header layout by integrating the MT5 connection signal into the profile avatar to eliminate navbar overcrowding and logo collisions on mobile devices.

## Requirements

### 1. Journal Tab Month Selector Fix
- Trigger native month picker reliably on `.journal-month-display` click using `showPicker()` with fallback to focus/steppers.
- Reset webkit calendar picker indicator and cross-browser appearance in CSS.
- Format `monthName` according to the active language from `useLanguage` (`en-US` vs `id-ID`).
- Prevent navigating into future months (`handleNextMonth` upper-bounded by current year and month).
- Preserve existing stepper controls and trade filtering by month.

### 2. Profile Avatar MT5 Status Dot
- Add a status dot badge (8px circle, green for online, red for offline) to `.header-profile-btn` at the bottom-right corner.
- Show status dot on mobile viewports (`< 640px`) and hide on desktop (`≥ 640px`) where the full `.status-pill` is already rendered.
- Real-time reactivity matching `isConnected` telemetry prop.

### 3. MT5 Telemetry Details in Profile Dropdown
- Add an MT5 connection status row inside `.header-profile-dropdown` showing connection state (`MT5 LIVE` / `MT5 OFFLINE`), host environment (`VPS` / `Local`), latency, and active account number.
- Ensure smooth fallback if no account or telemetry is available.

### 4. Responsive Mobile Header Streamlining
- On screens `< 640px`: Hide `.status-pill` to give full breathing room for the brand logo, MT5 GUI trigger button, and profile avatar.
- On screens `< 400px`: Hide `.header-lang-switcher` from top bar and render language toggle inside the profile dropdown to prevent collision at 320px–360px viewports.

## Acceptance Criteria
- Clicking month display in Journal tab triggers native picker on Chromium/Edge and doesn't break on Firefox/Safari.
- Month stepper prev/next works properly and disables or blocks next navigation past the current month.
- Month name label reflects English or Indonesian based on the active header language toggle.
- On screen widths `< 640px`, no element collides or wraps awkwardly with `.brand-group`.
- Avatar button displays green status dot when `isConnected=true` and red when `isConnected=false`.
- Profile dropdown displays complete MT5 status info.
- `npm --prefix apps/web run lint` exits clean with code 0.
- `npm --prefix apps/web run build` compiles with code 0.

## Impact Analysis (Files Touched)
- `apps/web/src/components/JournalTab.jsx`: Month display ref, click handler, `useLanguage` locale hook, `handleNextMonth` boundary check.
- `apps/web/src/components/PipstrideHeader.jsx`: Avatar status badge markup, profile dropdown MT5 info section and mobile language switcher.
- `apps/web/src/index.css`: Styles for `.journal-month-input-overlay`, `.header-profile-status-dot`, `.header-profile-dropdown-mt5`, and responsive breakpoints `< 640px` and `< 400px`.

## Edge Cases
- `isConnected` changes while profile dropdown is open: UI updates immediately without closing dropdown.
- Browser does not support `showPicker()`: Falls back cleanly to focus/click, stepper arrows remain 100% functional.
- Zero MT5 connections exist: Dropdown shows `MT5 OFFLINE` with no account number or latency.
- Viewport resized between mobile and desktop: CSS media queries cleanly toggle between full pill and avatar dot without layout flash.

## Out of Scope
- Bottom navigation redesign.
- Replacing `<input type="month">` with an invented multi-component calendar modal.
- Light mode theme adjustments.
