# Ticket 03: Split `ProfileTab.jsx` (855 → `features/profile/*`)

## Goal
Pecah file 855 baris dengan 6 bagian tak berhubungan menjadi fitur terpisah (SRP-1, CRITICAL).

## Scope
1. Buat `apps/web/src/features/profile/` dengan komponen per bagian (penanda section di file lama):
   - `Mt5ConnectionsSection.jsx` (`:258` "MT5 Connections")
   - `ActiveAccountSection.jsx` (`:435` "Active Account Telemetry")
   - `RiskWatchdogSection.jsx` (`:521` "Passive Risk Watchdog")
   - `AccountEmailSection.jsx` (`:560` "Account Email & Recovery")
   - `PreferencesSection.jsx` (`:793` "Preferences & Telemetry")
   - `PasswordSection.jsx` (form password, pakai `domain/validation`)
   - `ProfileTab.jsx` menjadi komposisi tipis (< ~120 baris).
2. Pisahkan 4 cluster `useState` (connection `71-75`, password `136-142`, email `186-192`) ke
   masing-masing section.
3. Ganti `window.confirm` (`:106,120`) dengan konfirmasi in-UI (bukan blocking dialog).
4. `Mt5ConnectModal.jsx` (606) berbagi logika connection manager dengan `Mt5ConnectionsSection`
   — ekstrak satu `features/connections/useConnections.js` hook, dipakai keduanya (SRP-4).
5. Pindahkan string hard-code Indonesia ke `translations.js` (SoC-11) untuk bagian yang disentuh.

## Files to Touch
- `apps/web/src/features/profile/*` — new.
- `apps/web/src/features/connections/*` — new.
- `apps/web/src/components/{ProfileTab,Mt5ConnectModal}.jsx`
- `apps/web/src/constants/translations.js`

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
node apps/web/scripts/check-i18n.cjs
```
Expected: exit 0; `i18n OK`; tidak ada file > ~300 baris di `features/profile/`.

## Depends on
- `02-frontend-domain-module.md` (validasi password sudah di `domain/`)

## Unblocks
- (tidak memblokir; menyelesaikan gate fase 006)

## Status
todo
