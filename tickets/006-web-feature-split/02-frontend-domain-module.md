# Ticket 02: Frontend `domain/` Module

## Goal
Satu salinan aturan bisnis di frontend: analytics + validasi. Tidak ada React/DOM/IO.

## Scope
1. `apps/web/src/domain/analytics.js` — pindahkan mesin analytics dari `JournalTab.jsx:282-400`
   (SoC-4). **Buang** implementasi duplikat; frontend memakai hasil `api.getJournalStats`.
   Fungsi di sini hanya untuk periode yang memang belum dilayani backend, dan harus identik
   rumusnya dengan `domain/metrics.py` (fase 005).
2. `apps/web/src/domain/validation.js` — satu salinan:
   - Password: min 8, kombinasi huruf+angka (samakan `user_service.validate_password_complexity`).
   - Email regex.
   Ganti 3 salinan di `LoginPage.jsx:90-98,80,128`, `ProfileTab.jsx:153-161,199`,
   `ResetPasswordPage.jsx:34-41` (SoC-8, SoC-9).
3. `apps/web/src/domain/pnl.js` — satu definisi `settledPnl`/`drawdown` yang **memakai nilai backend
   bila ada**, fallback hanya bila field absen. Ganti `HomeTab.jsx:49-63,499-503`,
   `JournalTab.jsx:69-74`, `ProfileTab.jsx:64-68` (SoC-7).
4. Hapus `null`→`'∞'` ganda: satu formatter di `domain/`.

## Files to Touch
- `apps/web/src/domain/{analytics,validation,pnl,format}.js` — new.
- `apps/web/src/components/{LoginPage,ProfileTab,ResetPasswordPage,HomeTab,JournalTab,JournalAnalytics}.jsx`

## Verification
```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
```
Expected: exit 0.

Kontrak silang (ADR 0009 Consequences): buat fixture trade yang sama, bandingkan output
`domain/analytics.js` dengan respons `/api/v1/journal/stats` → profit_factor, win_rate identik.

## Depends on
- `01-split-api-client.md`
- Fase 005 `01-extract-domain-metrics-policies.md` (rumus acuan)

## Unblocks
- `03-split-profile-tab.md`, `04-split-journal-tab.md`

## Status
done

**Catatan implementasi (2026-11-05):**
- `domain/analytics.js` — port 1:1 dari `app/domain/metrics.py` untuk window MONTH (backend tetap melayani 1M/3M/1Y/ALL). Perbedaan lama dihapus: profit_factor tanpa-loss kini `null` (bukan 0), streak reset saat breakeven, rounding per backend, avg_loss negatif, simbol bucket di-upper-kan.
- Kontrak silang: fixture 5 trade identik dijalankan lewat `compute_stats` (Python, .venv) vs `computeJournalStats` (node) → totals + 4 bucket **identik** (drove out off-by-one weekday: JS `getUTCDay()` Sun-first vs Python `.weekday()` Mon-first). Cross-check HTTP runtime (server hidup) tetap defer — Docker tidak berjalan.
- `domain/validation.js` — mirror `user_service.validate_password_complexity` (min 8 + huruf + angka) & EMAIL_PATTERN; 3 duplikat diganti (LoginPage ×2, ProfileTab, ResetPasswordPage).
- `domain/pnl.js` — `summarizeAccountPnl`/`dailyDrawdownFallback`/`deriveDrawdownWatch` backend-first; `domain/format.js` — satu `formatRatio` '∞' + money formatter.
- `dayBuckets` & CSV export tetap di JournalTab (lintasannya ke tiket 04).
