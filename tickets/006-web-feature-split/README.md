# Fase 006 — Pecah `apps/web` (Feature Split)

## Tujuan
Menghilangkan god-class dan duplikasi domain di frontend: pecah `api.js`, pindahkan analytics/validasi
ke `domain/`, pecah `ProfileTab`/`JournalTab` ke `features/*`.

Referensi: `docs/audits/pilar1-clean-architecture.md` §1.1, §3 (SRP-1…SRP-10);
`docs/adr/0009-layered-architecture-and-dependency-rule.md` §2, §Migration order 5-6.

## Prasyarat (kriteria masuk)
- **Fase 003 selesai** (gate boundary TS aktif).
- **Fase 005 selesai** (domain Python adalah cermin untuk `domain/` TS; hindari dua rumus berbeda).

## Tiket
1. `01-split-api-client.md`
2. `02-frontend-domain-module.md`
3. `03-split-profile-tab.md`
4. `04-split-journal-tab.md`
5. `05-remove-dead-code-and-guard-dev-bypass.md`

## Gate (checklist audit keluar)
- [x] `apps/web/src/services/api.js` tidak ada lagi sebagai god-object; transport di `lib/http`.
  → `api.js` kini 249 baris (30 endpoint + kontrak 409 per-endpoint); lihat catatan tiket 01.
- [x] `domain/` berisi profit-factor/win-rate/drawdown + validasi password/email — **satu** salinan.
  → `domain/{analytics,validation,pnl,format}.js`; paritas diuji terhadap `compute_stats` Python.
- [x] Tidak ada komponen yang menghitung ulang PnL/drawdown dengan rumus berbeda (SoC-7).
  → `ProfileTab` memakai `deriveDrawdownWatch`; `JournalTab` memakai `domain/analytics` / backend.
- [x] `ProfileTab.jsx` dan `JournalTab.jsx` terpecah; tidak ada file komponen > ~300 baris.
  → ProfileTab 91 baris, JournalTab 256 baris; modul terbesar `useJournalData.js` 265 baris.
- [x] `PositionsTable.jsx`, `MetricCard.jsx` dihapus (sudah tidak ada sebelum fase ini).
  → **Deviasi:** `BucketBars` **tetap** — masih dipakai hidup untuk `by_weekday`
  (`JournalAnalytics.jsx:289`), jadi premis "dead" di audit tidak terbukti.
- [x] Dev auth bypass di `LoginPage.jsx` dibungkus `import.meta.env.DEV`.
  → `dev-demo-token-offline` diverifikasi **absen** dari `dist/`.
- [x] Data pasar sintetis di `MarketTab.jsx` **tidak** dirender sebagai angka nyata (SoC-5).
  → guard zero-state; label data demo tetap eksplisit.
- [x] `npm --prefix apps/web run lint && npm --prefix apps/web run build` exit 0.
  → lint **0 warning**, `lint:arch` 0 pelanggaran.
- [x] `node apps/web/scripts/check-i18n.cjs` → `i18n OK — 457 keys per language`.
  → 457, bukan 460: baseline 455 + 2 key baru (`common_confirm`, `common_cancel`).

## Dampak
- Membuka **fase 007** (frontend admin memakai `lib/http` + `domain` yang sama, tidak menduplikasi).

## Catatan lingkup
- Migrasi **inkremental**, bukan big-bang (ADR 0009 §7).
- Jangan bikin `packages/ui`/`packages/i18n` (rule-of-three).
- Jangan sentuh backend di fase ini.
