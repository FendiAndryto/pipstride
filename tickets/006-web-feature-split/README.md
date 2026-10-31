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
- [ ] `apps/web/src/services/api.js` (421 baris) tidak ada lagi sebagai god-object; transport di `lib/http`.
- [ ] `domain/` TS berisi profit-factor/win-rate/drawdown + validasi password/email — **satu** salinan.
- [ ] Tidak ada komponen yang menghitung ulang PnL/drawdown dengan rumus berbeda (SoC-7).
- [ ] `ProfileTab.jsx` (855) dan `JournalTab.jsx` (814) terpecah; tidak ada file komponen > ~300 baris.
- [ ] `PositionsTable.jsx`, `MetricCard.jsx`, `BucketBars` (dead) dihapus.
- [ ] Dev auth bypass di `LoginPage.jsx:156-161` dibungkus `import.meta.env.DEV`.
- [ ] Data pasar sintetis di `MarketTab.jsx:123-148` **tidak** dirender sebagai angka nyata (SoC-5).
- [ ] `npm --prefix apps/web run lint && npm --prefix apps/web run build` exit 0.
- [ ] `node apps/web/scripts/check-i18n.cjs` → `i18n OK — 460 keys per language`.

## Dampak
- Membuka **fase 007** (frontend admin memakai `lib/http` + `domain` yang sama, tidak menduplikasi).

## Catatan lingkup
- Migrasi **inkremental**, bukan big-bang (ADR 0009 §7).
- Jangan bikin `packages/ui`/`packages/i18n` (rule-of-three).
- Jangan sentuh backend di fase ini.
