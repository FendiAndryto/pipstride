# Ticket 01: Fix Journal Tab Month Selector, Locale, and Future Guard

## Goal
Fix month picker overlay triggering via `showPicker()`, synchronize `monthName` locale with `useLanguage()`, and cap future month stepper navigation.

## Scope
1. In `apps/web/src/components/JournalTab.jsx`:
   - Import `useLanguage` from `../context/LanguageContext`.
   - Add `monthInputRef = useRef(null)` and `handleMonthClick` calling `input.showPicker()` with fallback.
   - Attach `handleMonthClick` to `.journal-month-display` and bind ref to the overlay input.
   - Update `monthName` `Intl.DateTimeFormat` to use `lang === 'en' ? 'en-US' : 'id-ID'`.
   - Update `handleNextMonth` to prevent navigating past the current calendar month.
2. In `apps/web/src/index.css`:
   - Style `.journal-month-input-overlay` with explicit appearance reset and `::-webkit-calendar-picker-indicator` full overlay rules.

## Files to Touch
- `apps/web/src/components/JournalTab.jsx`
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
