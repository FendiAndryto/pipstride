# ADR 0009: Layered Architecture & Dependency Rule

## Status

Accepted

## Context

Pipstride is growing from two bundles (`apps/web`, `services/api`) to three frontends — marketing (ADR 0007), web, and admin (ADR 0008). (Mobile is not a fourth bundle: ADR 0006 decides the mobile target is the `apps/web` PWA, same codebase, no native shell.) Without a shared structural convention, each bundle drifts and the codebase becomes hard to navigate.

The audit in `docs/audits/pilar1-clean-architecture.md` documents where the current code already leaks:

- **Business rules inside presentation components** — the journal analytics engine is re-implemented in `JournalTab.jsx:282-400`, duplicating `journal_service.py`; PnL/drawdown are recomputed in three views with divergent formulas.
- **A god-object transport module** — `apps/web/src/services/api.js` (421 lines) mixes HTTP transport, token persistence, DOM download, an event bus, and 20 endpoints.
- **A leaky service layer** — `bridge_service.py` raises `fastapi.HTTPException`, and `journal.py:31-51` runs an ORM query directly in the route.
- **Divergent domain logic** — profit factor returns `0.0` in `bridge_service` and `None` in `journal_service` for the same input.
- **Duplicated rules** — the password policy exists in three client files plus one server file; the email regex in three plus one.

Two bundles already show the correct direction (services never import `api/v1`; `db/models.py` is pure SQLAlchemy; typed domain exceptions map to HTTP at the route). The goal is to make that direction the enforced norm everywhere, and to do **only what the audit asks for** — no more.

## Decision

1. **One mental model in every bundle: vertical = feature, horizontal = layer.** A newcomer should find the same folder names and the same allowed import direction in marketing, web, and admin.

2. **Frontend layout (web, admin):**

   ```text
   src/
   ├── app/            # shell, providers, routing, guards, composition
   ├── pages/          # one file per route/tab (thin)
   ├── features/       # one folder per feature: components/ hooks/ api/
   ├── domain/         # pure business rules (no React, no DOM, no IO)
   ├── lib/            # http, storage, i18n, download
   ├── components/ui/  # design-system primitives
   └── styles/         # tokens
   ```

   Import direction (enforced): `pages → features, components/ui, lib`; `features/X → features/X, domain, lib, components/ui` (never another feature); `domain → nothing app-level`; `lib → domain`; `components/ui → styles, lib`.

   **Exception — content-first bundles.** `apps/marketing` (Astro) is explicitly exempt: it uses Astro's idiomatic `pages/ layouts/ components/ content/ lib/ styles/` and has no `domain/` layer. A static content site has no business rules and no per-feature verticals. Forcing the React-centric `features/domain` layout onto it would be ceremony.

3. **Backend layout — target is `domain` + `infrastructure/repositories` + thin `interfaces`, not a four-ring clean architecture:**

   ```text
   app/
   ├── domain/            # pure: entities, policies, metrics, errors (the audit's "domain package")
   ├── infrastructure/    # db (SQLAlchemy models + repositories), cache, email, telegram
   ├── interfaces/        # api/v1/ (thin routers), schemas/ (Pydantic DTO), deps.py
   └── main.py            # composition root
   ```

   Import direction (enforced): `interfaces → domain + infrastructure`; `infrastructure → domain`; `domain` imports no framework, no `sqlalchemy`, no `redis`, no `fastapi`; `main.py` is the only module aware of everything.

   **No `application/ports` layer.** The audit's recommendation (§2.3, §4.4) is a `domain/` package that `db/models.py` implements, plus repositories — it does **not** ask for use-case objects or Protocol-based ports. Adding them would exceed both the audit and the project's "smallest diff possible, zero unnecessary abstractions" rule. A `ports.py` interface is created **only** when a second implementation exists or is imminent (e.g. Redis vs in-memory cache — that abstraction is already justified by `core/live_state.py`). This is the rule, not a caveat on top of a heavier layout.

4. **Cross-bundle boundary rules:**

   | Rule | Enforced |
   | --- | --- |
   | `apps/A` must not import `apps/B` | yes |
   | `packages/*` must not import `apps/*` | yes |
   | `packages/domain` is pure (no React/DOM) | yes |
   | `mt5-ea/` must not import anything from `apps/`, `services/`, or admin | yes |
   | Operational scripts (`scripts/`) do not import `interfaces/api` | yes |

   (Frontends are browser bundles and cannot reach PostgreSQL directly; that rule is vacuous for apps and is pointed at the real actors — `mt5-ea/` and `scripts/`.)

5. **Single-source packages — priced in only when justified.**
   - **`packages/pricing`** — created now (ADR 0007 needs it); a plain JSON file consumed by relative path, no workspace tooling.
   - **`packages/api-client`**, **`packages/domain`** (shared TS rules), **`packages/i18n`** — deferred until the rule of three triggers (a second consumer genuinely needs them). Listing them now would be premature against the same rule-of-three this ADR invokes for extraction. The intent — one copy of the profit-factor rule and the password/email rules per language — is achieved first by placing them in a single `domain/` module within each bundle; cross-bundle sharing follows when duplication is real.

6. **Enforcement in CI.** `import-linter` for Python layer contracts and `dependency-cruiser` (or `no-restricted-imports`) for TypeScript, run as a dedicated `arch` job. A rule without enforcement is a comment, not a boundary. The admin-router guard dependency (ADR 0008 §2) is asserted here too.

7. **Pragmatism (operationalizing the "smallest diff" convention).**
   - Do **not** perform a big-bang rewrite. `apps/web` and `services/api` migrate incrementally; greenfield bundles (`apps/admin`) adopt the final layout from day one.
   - Do **not** extract `packages/ui` before there is real duplication that changes together (rule of three).
   - This ADR defines the target and the direction; it does not require moving code that is already thin and correct (e.g. `journal_service` is the cleanest module per the audit and needs no restructuring).

## Migration order

1. `packages/pricing` — smallest change; closes the price-drift risk (ADR 0007).
2. `arch`/`drift` CI jobs — `import-linter` (Python) + `dependency-cruiser` (TS) + OpenAPI client drift check.
3. Backend `domain/metrics.py` and `domain/policies.py`; services delegate to them (kills the `0.0` vs `None` split); pytest green.
4. Backend `infrastructure/db/repositories`; routes stop touching the ORM.
5. `apps/web`: split `api.js` into `lib/http` + `lib/storage`; move analytics/validation into `domain`.
6. `apps/web`: split `ProfileTab.jsx` and `JournalTab.jsx` into `features/*`.
7. `apps/admin` — built to the final layout directly.

`packages/ui` and `packages/i18n` appear only when a second consumer triggers them.

## Consequences

- Positive: one navigable mental model across the bundles that need it; business rules in one testable place; a mechanical, CI-enforced guard against the leaks the audit found; greenfield bundles start clean.
- Positive: the pure `domain` layer is trivially unit-testable (the audit already calls `journal_service` the cleanest module — this generalizes that property).
- Negative / trade-offs: the backend gains one indirection (`repositories`), which is exactly what the audit asked for; cross-language duplication of a rule (Python vs TypeScript) is unavoidable and is mitigated by keeping one copy per language plus a contract test comparing API output against the frontend function on identical fixtures.
- Negative: a small `arch` CI job adds build time; accepted as the cost of making the boundary real.

## References

- `docs/audits/pilar1-clean-architecture.md` — the evidence base for this decision.
- ADR 0006 — mobile distribution (PWA-first; mobile is not a separate bundle).
- ADR 0007 — marketing site and public surface (the content-first exception in §2).
- ADR 0008 — admin console surface and privilege boundary.
- `AGENTS.md` — "smallest diff possible, zero unnecessary abstractions".
