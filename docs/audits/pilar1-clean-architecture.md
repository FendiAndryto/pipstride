# Pilar 1 — Clean Architecture & Best Practices Audit

Repo: `C:\Users\pendi\Repository\pipstride`
Scope: `apps/web/src/**`, `services/api/app/**`, `services/api/scripts/**`
Method: full read of every file cited below (no speculation).

---

## 1. Separation of Concerns

### 1.1 UI layer (`apps/web/src/components`)

**Status: MOSTLY CLEAN — all network access goes through `services/api.js`. No raw `fetch()` in any component.**

Verified: a repo-wide grep for `fetch(` in `apps/web/src/components/*.jsx` returns **zero** hits. Every component
imports the singleton client (`import { api } from '../services/api'`). That is exactly right.

Remaining leaks are of a different kind: **business/domain logic living in presentation components.**

#### 1.1.1 `persistActiveConnectionId()` — the API client is also the persistence layer
`apps/web/src/services/api.js:37-47`
```js
export const getActiveConnectionId = () => localStorage.getItem(CONNECTION_KEY) || null;

export const setActiveConnectionId = (connectionId) => {
  if (connectionId) {
    localStorage.setItem(CONNECTION_KEY, connectionId);
```
`services/api.js` mixes three concerns: HTTP transport, auth-token persistence, and domain state (active connection).
`Dashboard` cannot "select a connection" without also writing to `localStorage` — no seam for tests or SSR.

#### 1.1.2 Business rule "which connection is active" implemented in a UI file
`apps/web/src/components/Dashboard.jsx:16-26`
```js
function applyConnections(list, setConnections, setActiveConnectionId) {
  const safeList = Array.isArray(list) ? list : [];
  setConnections(safeList);
  const stored = getActiveConnectionId();
  const stillValid = stored && safeList.some((c) => c.id === stored);
  if (!stillValid) {
    const fallback = safeList[0]?.id || null;
    persistActiveConnectionId(fallback);
    setActiveConnectionId(fallback);
  }
}
```
This is a domain invariant (valid active connection must exist and be persisted). It is untestable without mounting React.

#### 1.1.3 The same network call is issued twice in two different `useEffect`s
`apps/web/src/components/Dashboard.jsx:43-53` (`loadConnections` → `api.getConnections()`), then again at
`Dashboard.jsx:79-93`:
```js
useEffect(() => {
  let active = true;
  api.getConnections()
    .then((list) => { ... })
```
`loadConnections` already exists but is not used by the mount effect → duplicate request on first paint.

#### 1.1.4 **Analytics engine re-implemented inside a presentation component** (largest SoC violation)
`apps/web/src/components/JournalTab.jsx:282-400` — 119 lines computing gross profit, loss, profit factor, win rate,
avg win/loss, payoff ratio, expectancy, max win/loss streak, total volume, avg hold minutes, per-symbol buckets and
per-direction buckets:
```js
const monthStats = useMemo(() => {
  if (period !== 'MONTH') return null;
  const count = monthTrades.length;
  const wins = monthTrades.filter((t) => t.profit > 0);
  ...
  const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
  ...
  let maxWinStreak = 0;
  ...
}, [period, monthTrades]);
```
This is a **duplicate implementation of the backend domain service** `services/api/app/services/journal_service.py:105-164`
(`compute_totals`, `compute_stats`, `_bucketize`). Two copies of the same financial formula that can drift:
the backend returns `profit_factor: None` when no losses (`journal_service.py:141`), the frontend returns `null` or `0`
in two different places (`JournalTab.jsx:290`, `JournalTab.jsx:350`), and `JournalAnalytics.jsx:10` renders `null` as `'∞'`.
The frontend already has the correct answer from the API at `JournalTab.jsx:107` (`api.getJournalStats`) and ignores it
whenever `period === 'MONTH'`.

#### 1.1.5 **Fabricated market data derived in a presentation component** (data-integrity violation)
`apps/web/src/components/MarketTab.jsx:123-148`
```js
} else {
  // Relative timeframe scaling when candles for non-chart symbol are not directly loaded
  const totalSpan = activeQuote.high > activeQuote.low ? activeQuote.high - activeQuote.low : activeQuote.bid * 0.005;
  if (activeTf === 'M5') {
    high = activeQuote.bid + (totalSpan * 0.20);
    low = Math.max(0, activeQuote.bid - (totalSpan * 0.15));
    changePct = activeQuote.daily_change_pct * 0.35;
    structureLabel = changePct >= 0 ? 'M5 Micro Breakout' : 'M5 Micro Pullback';
  } else if (activeTf === 'M15') {
    ...
```
When candles are unavailable the component **invents synthetic highs/lows/percentage changes** and labels them
`HIGH OPEN`/`STRUCTURE BIAS`/`KEY SUPPORT`/`KEY RESISTANCE` (`MarketTab.jsx:368-395`). The audit trail even admits it:
`MarketTab.jsx:124` "Relative timeframe scaling" and `MarketTab.jsx:66` "Calculate dynamic timeframe metrics".
This directly contradicts the project's stated read-only/no-invention posture documented in
`services/api/app/services/journal_service.py:1-7` ("nothing is invented and nothing is extrapolated") and
`AGENTS.md` ADR 0004. Note also `MarketTab.jsx:78-80`: `activeTf === 'H1'` reuses the **M15** candle array
(`rawCandlesM15`), so the H1 chart is mislabelled M15 data even on the happy path.

#### 1.1.6 Business metrics recomputed from raw trades inside three different views
- `apps/web/src/components/HomeTab.jsx:49-63` — recomputes `settledPnl`, `settledPnlPercent`, `allTimePnl`,
  `allTimePnlPercent` client-side **with fallbacks** when the backend already supplies them
  (`services/api/app/services/bridge_service.py:205-208`):
  ```js
  const settledPnl = bridgeStatus?.settled_pnl !== undefined && bridgeStatus?.settled_pnl !== null
    ? bridgeStatus.settled_pnl
    : (balance - initialDeposit);
  ```
- `apps/web/src/components/HomeTab.jsx:499-503` — recomputes drawdown:
  ```js
  const ddPct = riskStatus?.daily_drawdown_percent ?? (
    balance > 0 && equity < balance ? ((balance - equity) / balance) * 100 : 0
  );
  ```
  This is a *different formula* from the backend (`bridge_service`/`bridge.py:134-140` uses
  `(initial_deposit - equity) / initial_deposit`), so the Home card and the Profile card can disagree.
- `apps/web/src/components/JournalTab.jsx:69-74` — a third copy of the same all-time P/L computation.
- `apps/web/src/components/ProfileTab.jsx:64-68` — computes `limitUsed` (risk-budget consumption) in the component.

#### 1.1.7 Password policy duplicated on the client (business rule in the UI)
- `apps/web/src/components/LoginPage.jsx:90-98`
  ```js
  if (p.length < 8) { setError('Password minimal 8 karakter.'); return; }
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) { setError('Password wajib kombinasi huruf dan angka.'); return; }
  ```
- `apps/web/src/components/ProfileTab.jsx:153-161` — identical rules again.
- `apps/web/src/components/ResetPasswordPage.jsx:34-41` — identical rules a third time.

Authoritative rule: `services/api/app/services/user_service.py:15-22` (`validate_password_complexity`).
Three client copies + one server copy = four places to update.

#### 1.1.8 Email regex duplicated on the client
`apps/web/src/components/LoginPage.jsx:80`, `LoginPage.jsx:128`, `ProfileTab.jsx:199`:
```js
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
```
Authoritative rule: `services/api/app/services/user_service.py:12` + `normalize_email` (`user_service.py:34-43`).

#### 1.1.9 Component reaches into env/localStorage (composition leak in the API client)
`apps/web/src/services/api.js:3, 8, 37` read `import.meta.env`, `localStorage` and `sessionStorage` at module scope.
`downloadPreset` (`api.js:54-66`) creates DOM elements — a **browser-API concern inside the transport layer**.

#### 1.1.10 Auth bypass helper ships in production code
`apps/web/src/components/LoginPage.jsx:156-161`
```js
const handleOfflineDevBypass = () => {
  setToken('dev-demo-token-offline', rememberMe);
  if (onLoginSuccess) onLoginSuccess({ username: username || 'Admin', is_authenticated: true });
};
```
No `import.meta.env.DEV` guard. It writes a fake JWT into `localStorage`/`sessionStorage` and flips the app into an
authenticated state. (Also present: hard-coded demo credentials `LoginPage.jsx:491`
`onClick={() => handleQuickDemo('admin', 'change_this_password')}`.)

#### 1.1.11 i18n layer bypassed almost everywhere
`useLanguage()` exists (`apps/web/src/context/LanguageContext.jsx:55`) with `translations.js` (196 lines, EN + ID).
Yet copy is hard-coded Indonesian inside components: `ProfileTab.jsx:225-227, 259-261, 410-432, 650-665`,
`JournalTab.jsx:14-28, 466-470, 665-672`, `Mt5ConnectModal.jsx:22-24, 538-579`, `LoginPage.jsx:248-271`.
`t()` is called only for a handful of keys (`PipstrideHeader.jsx`, `PipstrideBottomNav.jsx`). Result: switching the
header language toggle to **EN** leaves most of the dashboard in Indonesian.

#### 1.1.12 Dead components
- `apps/web/src/components/PositionsTable.jsx` (110 lines) — **never imported**. Confirmed: its only occurrence in
  `apps/web/src` is its own `export default` (line 14). HomeTab renders its own inline positions list instead
  (`HomeTab.jsx:359-401`).
- `apps/web/src/components/MetricCard.jsx` (43 lines) — **never imported** (only occurrence is line 3).
- `apps/web/src/components/JournalAnalytics.jsx:34-95` — `BucketBars` is defined but **never rendered**; the component
  draws its own `by_symbol` / `by_direction` tables instead (lines 184-276).

#### 1.1.13 Presentation inconsistency / stale token
`LoginPage.jsx:16` imports `setToken` and writes a token directly, bypassing `api`.

---

### 1.2 Routes layer (`services/api/app/api/v1`)

**Status: MIXED — most handlers delegate cleanly, but two handlers contain real business logic and one performs
DB deletion outside the service.**

Good examples (thin, correct): `connections.py:46-117`, `bridge.py:62-123`, `journal.py:18-61` (except the query),
`auth.py:310-317`.

#### 1.2.1 Risk-watchdog domain logic lives in the route handler
`services/api/app/api/v1/bridge.py:126-159`
```python
@router.get("/risk", response_model=RiskWatchdogStatusResponse, tags=["Risk Watchdog"])
def get_risk_watchdog(connection: Mt5Connection = Depends(get_active_connection), db: Session = Depends(get_db)):
    from app.core.config import settings          # <- function-local re-import; settings already imported at line 7

    status_response = bridge_service.get_status(db, connection)
    drawdown = 0.0
    if status_response.initial_deposit and status_response.metrics:
        drawdown = max(
            0.0,
            ((status_response.initial_deposit - status_response.metrics.equity)
             / status_response.initial_deposit) * 100.0,
        )

    return RiskWatchdogStatusResponse(
        is_alert_active=drawdown >= settings.MAX_DAILY_DRAWDOWN_PERCENT,
        alert_reason=(
            f"Equity drawdown {drawdown:.2f}% melampaui batas "
            ...
```
A drawdown threshold rule, a formatted Indonesian user-facing alert string, and a threshold comparison all sit in
the HTTP layer. There is no `risk_service.py` — the domain has no home, so it defaults to the endpoint.

#### 1.2.2 Documentation/observability concern implemented in the route
`services/api/app/api/v1/user-agent`-equivalent logic: `services/api/app/api/v1/auth.py:36-41`
```python
def _client_ip(request: Request) -> str:
    # Trust Cloudflare / reverse-proxy forwarding headers first.
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
```
Trusting `cf-connecting-ip` unconditionally means **any** client can spoof its IP and evade every rate limit keyed on
`_client_ip(...)` (`auth.py:95`, `auth.py:129`, `auth.py:163`). Transport/infra concern in the route module.

#### 1.2.3 Email-link construction in the route module
`services/api/app/api/v1/auth.py:44-47, 68-80, 188-197`
```python
def _app_base(request: Request) -> str:
    configured = (settings.PUBLIC_APP_URL or settings.PUBLIC_BASE_URL or "").strip().rstrip("/")
    return configured or str(request.base_url).rstrip("/")
...
link = f"{_app_base(request)}/?verify_email={raw}"
```
URL composition for emailed links (a notification concern) lives in the HTTP layer while `email_service` only
receives a finished string.

#### 1.2.4 Token-issuance policy in the route (TTL selection)
`auth.py:71-73`, `auth.py:188-190`
```python
raw = auth_token_service.issue(db, user, PURPOSE_RESET, timedelta(minutes=settings.EMAIL_RESET_TTL_MINUTES))
```
The service takes a raw `timedelta` instead of owning "how long is a reset token valid" — the policy is split across
route and config.

#### 1.2.5 Raw `db.commit()` in a handler
`services/api/app/api/v1/auth.py:241-244`
```python
if user.email_verified_at is None:
    user_service.mark_email_verified(db, user)
else:
    db.commit()
```
An `else: db.commit()` that commits an empty transaction to consume a burned token — a persistence detail decided by
the endpoint.

#### 1.2.6 Request schemas defined inside the route module
`services/api/app/api/v1/telegram.py:11-16`
```python
class TelegramTestAlertRequest(BaseModel):
    message: Optional[str] = Field(None, description="Optional custom test message")

class TelegramToggleRequest(BaseModel):
    enabled: bool = Field(..., description="Enable or disable Telegram push notifications")
```
Every other router imports its schemas from `app/models/*` (`auth.py:13-24`, `bridge.py:13-23`, `journal.py:12`).
This one defines them inline — the schema layer has a hole.

#### 1.2.7 Endpoint response assembly duplicated (two "projections" of the same entity)
`connections.py:19-30` (`_project`) and `connections.py:33-43` (`_preset`) build dicts by hand instead of using
`ConnectionResponse`/`PresetFileResponse` (`app/models/auth.py:63-89`). Two response models exist and are bypassed.

---

### 1.3 Services layer (`services/api/app/services`)

**Status: SERVICE LAYER = DE FACTO REPOSITORY + DOMAIN + TRANSACTION MANAGER + HTTP ERROR MAPPER.**

There is **no repository layer and no unit-of-work**. `db/base.py:25-30` exposes `get_db` (the FastAPI dependency) and
`db/base.py:33-43` exposes `session_scope` — but `session_scope` has **zero callers** in `app/` (verified by grep:
only its definition and the `db/__init__.py:1` re-export). Every service therefore does `db.commit()` itself.

#### 1.3.1 Nine `db.commit()` calls inside services (transactions owned by business logic)
`bridge_service.py:110`, `bridge_service.py:381`, `bridge_service.py:390`, `connection_service.py:101`,
`connection_service.py:116`, `connection_service.py:125`, `user_service.py:100`, `user_service.py:115`,
`user_service.py:121`, `user_service.py:130`, `user_service.py:141`, `user_service.py:146`,
`auth_token_service.py:60`.

Consequence, visible at `auth.py:227-250`: `verify-email` burns the token (`auth_token_service.consume` → its own
`db.execute(update(...))`) but the **commit happens in a different module** (`user_service.mark_email_verified`,
`user_service.py:119-123`). The contract is only documented in a docstring:
`auth_token_service.py:64-68` — *"The caller owns the transaction"* — which is the exception, not the rule
(`issue()` at line 60 commits by itself).

#### 1.3.2 `bridge_service.py` mixes six responsibilities
| Concern | Evidence |
|---|---|
| HTTP error mapping | `bridge_service.py:13` `from fastapi import HTTPException, status`; `:76-79`, `:91-94`, `:400-404` |
| Telemetry ingest / persistence | `:68-166` (`process_heartbeat`, `_persist_snapshot`, `_persist_trades`) |
| Cache orchestration | `:17` `from app.core import live_state`; `:102-108` |
| Analytics | `:205-208`, `:274-293` (win rate, profit factor) |
| Account settings CRUD | `:337-383` |
| Bulk data deletion | `:385-395` |

The `fastapi.HTTPException` in a service is the clearest framework leak:
```python
# bridge_service.py:398-404
def submit_order(self, *args, **kwargs):
    """Pure read-only enforcement: execution is permanently disabled."""
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Pipstride is a 100% ...")
```
The service now knows about HTTP. It is also **dead code** — `bridge.py:167-172` raises its own `HTTPException`
and never calls `bridge_service.submit_order()`.

And the inconsistent exception style inside the same class:
- typed domain exceptions: `connection_service.py:19-24` (`ConnectionLimitReached`, `ConnectionBindingError`)
- swallowed by bare `except Exception`: `bridge_service.py:89-94`
  ```python
  except Exception as exc:  # ConnectionBindingError
      db.rollback()
      raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
  ```
  The comment names the type that should have been caught.

#### 1.3.3 Raw ORM manipulation in the service, bypassing the model API
`bridge_service.py:126-165` constructs `TelemetrySnapshot(...)` and `Trade(...)` field-by-field; `bridge_service.py:96-97`
mutates `connection.last_seen_at` / `connection.status` directly — there is no `TelemetryRepository` /
`TradeRepository` / `ConnectionRepository` anywhere in the codebase.

#### 1.3.4 Legacy `Query`-style API used in one place (SQLAlchemy 2.0 inconsistency)
`bridge_service.py:386-389`
```python
db.query(Trade).filter(Trade.connection_id == connection.id).delete()
db.query(TelemetrySnapshot).filter(
    TelemetrySnapshot.connection_id == connection.id
).delete()
```
Every other query in the file uses `select(...)` / `db.scalars(...)` / `db.scalar(...)` (e.g. `:115-120`, `:231-235`,
`:250-256`). `db.query()` is the 1.x legacy API.

#### 1.3.5 Domain logic duplicated across services
Profit-factor / win-rate are computed in `bridge_service.py:274-293` **and** `journal_service.py:105-152`:

```python
# bridge_service.py:274-285
gross_profit = round(sum(t.profit for t in trades if t.profit > 0), 2)
gross_loss = round(sum(t.profit for t in trades if t.profit < 0), 2)
net_pnl = round(gross_profit + gross_loss, 2)
wins = sum(1 for t in trades if t.profit > 0)
...
profit_factor=round(gross_profit / abs(gross_loss), 2) if gross_loss else 0.0,
```
```python
# journal_service.py:109-141
gross_profit = sum(wins)
gross_loss = sum(losses)
...
"profit_factor": round(gross_profit / abs(gross_loss), 2) if gross_loss else None,
```
Note the semantic divergence: `bridge_service` → `0.0`, `journal_service` → `None`. The frontend then has to handle
both (`HomeTab.jsx:488`, `JournalAnalytics.jsx:10`).

#### 1.3.6 Time-normalisation helper copy-pasted three times
- `bridge_service.py:47-58` `_as_utc`
- `journal_service.py:20-26` `_as_utc`
- `auth_token_service.py:31-32` `_as_utc`

Three identical/overlapping implementations of the same timezone rule in the same package.

---

### 1.4 DB layer (`services/api/app/db`)

**Status: CORRECT BOUNDARY — but seeding and readiness probes bypass it.**

`db/base.py:21-22` (engine + sessionmaker) and `db/models.py:1-213` (declarative models) are clean: **no FastAPI, no
HTTP, no business rules.** Good.

#### 1.4.1 Schema-level business rules live in `main.py`, not in migrations
`services/api/app/main.py:26-50`
```python
def _seed_defaults() -> None:
    """Seed the plan catalogue and the initial admin account."""
    with SessionLocal() as db:
        for code, name, max_conn, price in (
            ("free", "Free", 1, 0), ("core", "Core", 1, 5900), ("plus", "Plus", 3, 12900), ("pro", "Pro", 5, 19900),
        ):
            if db.get(Plan, code) is None:
                db.add(Plan(code=code, name=name, max_connections=max_conn, price_cents=price))
        admin = db.scalar(select(User).where(User.username == settings.ADMIN_USERNAME.strip()))
        ...
        db.add(Entitlement(user_id=admin.id, plan_code="pro", max_connections=5))
```
Pricing/product catalogue (`price_cents`) and default entitlements are **domain data hard-coded inside the ASGI app
module**. It also opens a second, independent session (`SessionLocal()`) instead of the request-scoped `get_db`.
The migration `migrations/versions/0001_initial.py` is the correct place (or a dedicated seeder).

#### 1.4.2 Readiness probe bypasses the DB layer
`services/api/app/main.py:117-151`
```python
with SessionLocal() as db:
    db.execute(select(1)).scalar()
...
import redis
client = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=1.0)
```
`main.py` imports `sqlalchemy.select`, `SessionLocal`, `engine` and `redis` directly — an infrastructure concern
embedded in the composition root.

#### 1.4.3 Direct SQLAlchemy in a route handler (skipping the service layer)
`services/api/app/api/v1/journal.py:31-51`
```python
from sqlalchemy import func, select            # line 6
...
now = datetime.now(timezone.utc)
since = now - timedelta(days=RANGE_DAYS[period]) if period in RANGE_DAYS else None
moment = func.coalesce(Trade.closed_at, Trade.opened_at, Trade.created_at)
conditions = [Trade.connection_id == connection.id]
if since is not None:
    conditions.append(moment >= since)
if symbol:
    conditions.append(func.upper(Trade.symbol) == symbol.strip().upper())
if direction:
    conditions.append(func.upper(Trade.direction) == direction)
if source == "ea":
    conditions.append(Trade.magic > 0)
elif source == "manual":
    conditions.append(Trade.magic == 0)
rows = list(db.scalars(select(Trade).where(*conditions)))
```
**This is the one handler that queries the ORM directly.** The filter/bucketing split is arbitrary: `journal_service`
owns the aggregation (`compute_stats`) but the *query* lives in the route. `Trade` (an ORM model) is imported into the
API layer at `journal.py:11`. An identical filter is re-implemented again on the client (`JournalTab.jsx:270-280`).

#### 1.4.4 DB-adjacent orchestration in `main.py` / `scripts`
`scripts/prune_snapshots.py:50-69` and `scripts/backup_db.py:57-79` open sessions / parse URLs themselves — acceptable
for operational scripts, but it means the "how do I get a session" rule now exists in 4 places
(`db/base.py:26`, `db/base.py:35`, `scripts/prune_snapshots.py:50`, `main.py:28`).

---

## 2. Dependency Rule

### 2.1 Actual import graph (from `grep` of every `^(from|import)` in `services/api/app`)

```
main.py ──────────► api.v1.{auth,bridge,connections,journal,telegram}
                     ├──► core.deps ──► core.security, db.base, db.models, services.{connection,user}_service
                     ├──► services.*  ──► core.*, db.models, app.models.*   (+ fastapi in bridge_service)
                     └──► db.*        ──► core.config

services/* ──► core.*, db.models, app.models.*        (NO import of app.main / app.api.v1 anywhere)
db/*       ──► core.config                             (NO import of services/ or api/)
models/*   ──► pydantic only                           (NO import of db/, core/, services/)
```

### 2.2 "Does `services/` import from `api/v1`?" — **NO. Dependency rule holds.**

Verified by explicit search for `from app.api` / `import app.api` across `services/api/**/*.py`: the **only 5 hits**
are all in `services/api/app/main.py:10-14` (the composition root, which is supposed to do this).

`services/` never reaches back into the HTTP layer. ✅

### 2.3 "Does `db/models.py` import from infrastructure?" — **NO.**

`db/models.py:1-17` imports `uuid`, `datetime`, `sqlalchemy`, `app.db.base`. No Redis, no config, no services, no
FastAPI. ✅

**However** the layering is *flat inside* `app/` rather than domain→infra: `app/models/` is **not** the domain — it is
the Pydantic DTO package (`models/auth.py`, `models/bridge.py`, `models/journal.py`, `models/risk.py`, all
`pydantic.BaseModel` only, zero ORM). The actual domain entities are the ORM classes in `app/db/models.py`.
So a service that needs a domain object imports **from the DB layer**:

```python
# services/journal_service.py:14
from app.db.models import Trade
# services/bridge_service.py:19
from app.db.models import AccountSettings, Mt5Connection, TelemetrySnapshot, Trade
# services/connection_service.py:16
from app.db.models import AuditLog, Entitlement, Mt5Connection, User
# services/user_service.py:9
from app.db.models import Entitlement, User
# core/deps.py:9
from app.db.models import Mt5Connection, User
```
The domain entity and the persistence mapping are the same class, so "dependency points inward" is satisfied only
because **inward == `db/`**. A `domain/` package that `db/models.py` implements would be the textbook layout.

### 2.4 Reverse dependency: `core/` depends on `services/` (inner ring depends on outer ring)

`services/api/app/core/deps.py:10-11`
```python
from app.services.connection_service import connection_service
from app.services.user_service import user_service
```
`core/` is meant to be the innermost, framework-agnostic ring (config, security, tokens). `core/deps.py` is a FastAPI
module that imports the *outermost* service layer. `deps.py:40` calls `user_service.get_user(db, username)` and
`deps.py:62,70` call `connection_service.get_connection/list_connections` — i.e. **a FastAPI dependency is doing
business-layer data access**. (Also `auth.py:207-211` has the route call `validate_password_complexity` from
`user_service`, then call `auth_token_service.consume`, then `user_service.reset_password` — a 3-service
orchestration in the HTTP layer.)

### 2.5 Service → Service coupling

`bridge_service.py:32`
```python
from app.services.connection_service import connection_service
```
`BridgeService.process_heartbeat` (`:74`, `:82`) and `get_status` (`:180`) call `ConnectionService` directly rather
than receiving a connection object. Service-to-service instantiation makes `BridgeService` untestable without a real
`ConnectionService` + DB.

### 2.6 Circular imports — **none found.**

Manually traced the three highest-risk cycles:
- `core.deps → services.connection_service / user_service → core.tokens / core.security / db.models` → **no path back
  to `core.deps`** (services import `app.core` only as `live_state`, `config`, `security`, `tokens`, never `deps`).
- `bridge_service → connection_service → db.models` → `bridge_service` is not re-imported. ✅
- `services.email_service`, `services.telegram_service`, `services.mt5_package` import only `core.config`. ✅

The codebase currently papers over import order with a **function-local import** that suggests a real design smell:
`services/api/v1/bridge.py:131`
```python
def get_risk_watchdog(...):
    from app.core.config import settings     # settings is ALREADY imported at module level (line 7)
```
Not a cycle, but a redundant late import inside a handler.

And `db/base.py:55` uses the same trick for a genuine reason (metadata registration):
```python
def init_db() -> None:
    ...
    from app.db import models  # noqa: F401  (register metadata)
```
This is the standard workaround, but it is only needed because `db/models.py` and `db/base.py` are mutually
dependent at import time (`models.py:17` imports `Base` from `base.py`).

### 2.7 Frontend dependency directions

`components/ → services/api.js`, `components/ → context/LanguageContext`, `components/ → constants/nav`.
**No violations** — components never import each other's internals, all share `services/api`.
The only structural oddity is that `Dashboard.jsx` is a **container + 6 children + 2 modals**, and children reach
back up via prop callbacks (`ProfileTab` → `onConnectionsChanged` → `Dashboard.handleConnectionsChanged` →
`fetchStatus`; `Dashboard.jsx:118-122`).

**Missing abstraction:** no `hooks/` directory. Five components independently implement polling:
- `Dashboard.jsx:95-109` (`setInterval(runPoll, pollInterval)`)
- `HomeTab.jsx:105-112` (`setInterval(..., 5000)`)
- `JournalTab.jsx:183-194` (`setInterval(..., 4000)` + every 4th tick stats)
- `JournalTab.jsx:132-179` (three separate effects that each call `api.getJournalStats` / `api.getTradeHistory`)
- `MarketTab.jsx:46-58`

Each has its own `isMounted`/`active` guard and its own race-condition workaround (`HomeTab.jsx:86-96`,
`JournalTab.jsx:87-90`). A single `usePolling` / `useApiResource` hook would remove ~150 lines of duplication.

---

## 3. God Classes / SRP Violations

Line counts verified with `Get-Content | Measure-Object`; inline-style counts are `style={{` occurrences.

| # | File path | Lines | Inline styles | Responsibilities mixed | Severity |
|---|---|---|---|---|---|
| 1 | `apps/web/src/components/ProfileTab.jsx` | **855** | 100 | MT5 account CRUD UI + token reveal/copy + preset download + active-account telemetry card + risk-drawdown gauge + email change form + password change form (with its own policy) + Telegram test trigger + polling-rate control; 4 independent `useState` clusters (connection: 71-75, password: 136-142, email: 186-192); 5 `api.*` calls; `window.confirm` (106, 120) | **CRITICAL** |
| 2 | `apps/web/src/components/JournalTab.jsx` | **814** | 49 | Full analytics engine (`:282-400`, duplicates `journal_service.py`) + trade table + CSV export (`:433-460`) + month calendar (`:750-811`) + month stepper state machine (`:202-252`) + 5 fetch effects (`:79-194`) + period/filter/search + KPI cards | **CRITICAL** |
| 3 | `apps/web/src/components/LoginPage.jsx` | **751** | 67 | Three distinct forms (login/register/forgot) in one file + client-side password & email validation duplicated from backend + dev auth bypass (`:156-161`) + demo credentials (`:491`) + a nested duplicate language toggle | **HIGH** |
| 4 | `apps/web/src/components/Mt5ConnectModal.jsx` | **606** | 51 | Connection CRUD + token reveal + preset download + EA download + URL copy + invented-data risk (`:60`) + 3-step instruction copy + duplicate of ProfileTab's connection manager (`:237-379` ≈ ProfileTab `:258-433`) | **HIGH** |
| 5 | `apps/web/src/components/HomeTab.jsx` | **522** | 62 | KPI computation + inline SVG chart rendering (`:277-341`, 65 lines of path/coordinate math inside a render IIFE) + positions list + market feed + performance snapshot + 5s polling + account-switch reset | **HIGH** |
| 6 | `apps/web/src/services/api.js` | **421** | 0 | Transport + JWT persistence + active-connection persistence + session-expiry event bus (`:68-74`) + DOM file download (`:54-66`) + 20 endpoint methods in one object (`:107-421`). No timeout, no retry, no `AbortController`; `authFetch` (`:95-105`) silently swallows 401 by dispatching a `CustomEvent`. | **HIGH** |
| 7 | `services/api/app/services/bridge_service.py` | **407** | — | Ingest + snapshot throttling + trade de-dup + Redis cache + status assembly + analytics + account-settings CRUD + bulk delete + `fastapi.HTTPException` mapping + dead `submit_order` guard | **HIGH** |
| 8 | `apps/web/src/components/MarketTab.jsx` | **404** | 50 | Watchlist render + **synthetic OHLC/change fabrication** (`:123-148`) + timeframe stat computation (`:67-165`) + structure-bias labelling + sparkline/range bar. Violates the project's own "nothing is extrapolated" rule. | **HIGH** |
| 9 | `apps/web/src/components/PipstrideHeader.jsx` | **363** | 3 | Brand + desktop nav + connection switcher + mobile account chip + MT5 modal trigger + status pill + latency display + language switcher (**twice**: `:181-200` and `:303-326`) + profile dropdown (account switcher again, `:237-260`) + logout. Three separate "select MT5 account" controls in one component (`:108`, `:243`, `:247`). | MEDIUM |
| 10 | `apps/web/src/components/JournalAnalytics.jsx` | **300** | 57 | Metric tiles + per-symbol table + long/short cards + two `BucketBars` that are **never rendered** (`:34-95`, dead) | MEDIUM |
| 11 | `services/api/app/api/v1/auth.py` | **327** | — | 9 auth endpoints + rate-limit key derivation + proxy-IP parsing (`:36-41`) + email link construction (`:44-47,68-80`) + DTO↔response mappers (`:50-65`) + reset-token orchestration (`:206-224`) | MEDIUM |
| 12 | `services/api/app/main.py` | **151** | — | App factory + CORS + lifespan + SQLite `create_all` + **product catalogue & admin seeding** (`:26-50`) + `/ready` infra probe (`:117-151`) | MEDIUM |
| 13 | `apps/web/src/components/ResetPasswordPage.jsx` | **250** | ~14 | Reset form + password policy duplicate (`:34-41`) + full-page duplicated layout chrome from LoginPage (`:59-106` ≈ `LoginPage.jsx:164-212`) | MEDIUM |

### Files at/over the ~300-line threshold (complete list, from an automated scan)

Frontend: `ProfileTab.jsx` (855), `JournalTab.jsx` (814), `LoginPage.jsx` (751), `Mt5ConnectModal.jsx` (606),
`HomeTab.jsx` (522), `services/api.js` (421), `MarketTab.jsx` (404), `PipstrideHeader.jsx` (363).
Backend: `bridge_service.py` (407), `api/v1/auth.py` (327), `main.py` (151 — listed for responsibility, not size),
`scripts/backup_db.py` (329 — acceptable: a CLI script).

**Total frontend component lines: 4,760 across 13 components**, of which **only 4 are under 300 lines**
(`ComingSoonTab` 128, `PipstrideBottomNav` 27, `MetricCard` 43 [dead], `PositionsTable` 110 [dead]).

### Specific SRP evidence worth calling out

**`ProfileTab.jsx`** — the file has no single reason to change; it has six. Its own section markers prove it:
`:258` "MT5 Connections", `:435` "Active Account Telemetry", `:521` "Passive Risk Watchdog",
`:560` "Account Email & Recovery", `:793` "Preferences & Telemetry". Every one of these should be its own component.

**`JournalTab.jsx:282-400`** — an entire `compute_totals`/`_bucketize` re-implementation inside `useMemo`. Compare
directly with `services/api/app/services/journal_service.py:105-152`.

**`LoginPage.jsx:156-161`** — a security-relevant bypass inside a presentational form component.

**`api.js:107-421`** — a 315-line object literal with 20 methods and 6 concerns. No `AbortController`, no timeout,
no retry/backoff, no request cancellation on unmount (the components compensate with `isMounted` flags).

---

## 4. Notable Good Practices

1. **No `fetch()` in any component.** 100% of network calls flow through `services/api.js` (`grep fetch(` in
   `apps/web/src/components/*.jsx` → 0 hits). This is the single strongest architectural property of the frontend.

2. **Dependency rule holds in the direction that matters.** `services/` never imports `api/v1/` (only
   `main.py:10-14` does, correctly, as the composition root). Zero circular imports.

3. **`db/models.py` is pure SQLAlchemy** — no FastAPI, no HTTP, no service imports (`models.py:1-17`). Pydantic DTOs
   (`app/models/*.py`) are likewise pure: `auth.py`, `bridge.py`, `journal.py`, `risk.py` import only `pydantic`.

4. **`journal_service.py` is the cleanest module in the repo** — pure functions over `Sequence[Trade]`
   (`:105-164`), zero session, zero IO, trivially unit-testable. This is the pattern `bridge_service` should follow.

5. **Typed domain exceptions exist and are used by the route layer**:
   `connection_service.py:19-24` defines `ConnectionLimitReached` / `ConnectionBindingError`; `connections.py:69-70`
   maps them to HTTP status codes at the boundary — the correct direction. (`bridge_service.py:89-94` is the
   counter-example.)

6. **Secrets are never persisted in plaintext.** `core/tokens.py:15-22` stores only SHA-256 digests;
   `db/models.py:96` persists `token_hash` + `token_prefix`; `models/auth.py:85-89` (`ConnectionCreatedResponse`)
   returns the raw token exactly once. `auth_token_service.py:63-92` burns tokens with a **conditional UPDATE**
   (`WHERE used_at IS NULL`, then `if burned.rowcount != 1: return None`) — a genuinely race-safe single-use token.

7. **Fail-open infrastructure adapters.** `core/live_state.py:62-101` and `core/rate_limit.py:105-118` degrade to
   in-process backends when Redis is down instead of failing the request:
   ```python
   except Exception as exc:  # pragma: no cover - infra failure path
       logger.warning("Redis rate limiter unavailable (%s); using local counter", exc)
   return getattr(_memory, method)(key, *args)
   ```
   Redis access is confined to `core/` — no service or route touches `redis` directly.

8. **Production config guard.** `core/config.py:84-109` (`validate_runtime`) refuses to boot with a default
   `SECRET_KEY`, weak `ADMIN_PASSWORD`, `ALLOWED_HOSTS="*"`, or SQLite in production.

9. **Timing-attack mitigation on login.** `user_service.py:62-71` runs a dummy bcrypt even for unknown users:
   ```python
   hash_password("dummy-password-timing-pad")
   ```

10. **Read-only invariant is enforced twice structurally** — `bridge.py:162-172` returns 403 on `/order`, `main.py:108`
    advertises `"mode": "read-only"`, and there is no execution code path anywhere in `services/`.

11. **Structured JSON logging with request correlation** — `core/logging.py:30-47, 67-96` emits one line per request
    with `X-Request-ID`, and mutes noisy paths (`NOISE_PATHS`).

12. **Session-expiry is centralised** — `api.js:95-105` intercepts every 401 once and broadcasts
    `pipstride:session-expired`, consumed in a single place (`App.jsx:76-77`).

13. **Deterministic, sorted analytics buckets.** `journal_service.py:57-79` forces `_bucketize` ordering
    (weekdays Mon–Sun, hours 00–23, BUY before SELL) so charts never reorder between responses.

14. **Token rotation invalidates live cache.** `connection_service.py:105-118` calls
    `live_state.clear_live_payload(connection.id)` on rotate/revoke so a leaked token cannot resurrect stale telemetry.

---

## Appendix — Consolidated issue index

| ID | File:Line | Issue |
|---|---|---|
| SoC-1 | `apps/web/src/services/api.js:37-47` | API client also owns `localStorage` domain state |
| SoC-2 | `apps/web/src/components/Dashboard.jsx:16-26` | Active-connection invariant implemented in UI |
| SoC-3 | `apps/web/src/components/Dashboard.jsx:43-53, 79-93` | Duplicate `api.getConnections()` on mount |
| SoC-4 | `apps/web/src/components/JournalTab.jsx:282-400` | Analytics engine duplicated in a component |
| SoC-5 | `apps/web/src/components/MarketTab.jsx:123-148` | Synthetic market data fabricated in the UI |
| SoC-6 | `apps/web/src/components/MarketTab.jsx:78-80` | H1 timeframe reuses M15 candles (mislabelled) |
| SoC-7 | `HomeTab.jsx:49-63,499-503` / `JournalTab.jsx:69-74` / `ProfileTab.jsx:64-68` | PnL & drawdown recomputed 3× with divergent formulas |
| SoC-8 | `LoginPage.jsx:90-98`, `ProfileTab.jsx:153-161`, `ResetPasswordPage.jsx:34-41` | Password policy duplicated 3× (+1 backend) |
| SoC-9 | `LoginPage.jsx:80,128`, `ProfileTab.jsx:199` | Email regex duplicated 3× (+1 backend) |
| SoC-10 | `LoginPage.jsx:156-161` | Dev auth bypass, not `import.meta.env.DEV`-guarded |
| SoC-11 | `ProfileTab.jsx:225-261`, `JournalTab.jsx:14-28` etc. | i18n bypassed; EN toggle has almost no effect |
| SoC-12 | `api/v1/bridge.py:126-159` | Drawdown rule + alert string in the route handler |
| SoC-13 | `api/v1/auth.py:36-41` | Spoofable `cf-connecting-ip` defeats rate limiting |
| SoC-14 | `api/v1/auth.py:44-47,68-80,188-197` | Email-link construction in the HTTP layer |
| SoC-15 | `api/v1/auth.py:241-244` | `db.commit()` inside a handler |
| SoC-16 | `api/v1/telegram.py:11-16` | Request schemas defined in the router (not `app/models/`) |
| SoC-17 | `api/v1/connections.py:19-43` | Hand-built dict projections bypassing response models |
| SoC-18 | `api/v1/journal.py:6,11,31-51` | **ORM query in the route handler** (`select(Trade)` + filters) |
| SoC-19 | `services/bridge_service.py:13,76-79,91-94,398-404` | `fastapi.HTTPException` raised from a service |
| SoC-20 | `services/bridge_service.py:89-94` | `except Exception` swallowing a typed domain error |
| SoC-21 | `services/bridge_service.py:386-389` | Legacy `db.query().delete()` (SQLAlchemy 1.x API) |
| SoC-22 | `bridge_service.py:274-293` vs `journal_service.py:105-152` | Profit-factor/win-rate implemented twice, `0.0` vs `None` |
| SoC-23 | `bridge_service.py:47-58`, `journal_service.py:20-26`, `auth_token_service.py:31-32` | `_as_utc` copy-pasted 3× |
| SoC-24 | `main.py:26-50` | Product catalogue + admin seeding + pricing in the app factory |
| SoC-25 | `main.py:117-151` | Readiness probe queries DB/Redis outside `db/` |
| Dep-1 | `core/deps.py:10-11,40,62,70` | Inner `core/` ring imports outer `services/` ring |
| Dep-2 | `services/bridge_service.py:32,74,82` | Service instantiates another service directly |
| Dep-3 | `services/*` → `app.db.models` | Domain entities only exist as ORM models (no `domain/`) |
| Dep-4 | `api/v1/bridge.py:131` | Redundant function-local `from app.core.config import settings` |
| SRP-1 | `ProfileTab.jsx` (855) | 6 unrelated sections, 4 state clusters, 5 API calls |
| SRP-2 | `JournalTab.jsx` (814) | Analytics engine + table + calendar + 5 fetch effects |
| SRP-3 | `LoginPage.jsx` (751) | 3 forms + duplicated validation + auth bypass |
| SRP-4 | `Mt5ConnectModal.jsx` (606) | Duplicate of ProfileTab's connection manager |
| SRP-5 | `HomeTab.jsx` (522) | Inline 65-line SVG chart math in JSX |
| SRP-6 | `services/api.js` (421) | Transport + storage + event bus + DOM + 20 endpoints |
| SRP-7 | `bridge_service.py` (407) | 6 responsibilities + framework coupling |
| SRP-8 | `MarketTab.jsx` (404) | Fabricated data + 5 concerns |
| SRP-9 | `PipstrideHeader.jsx` (363) | 3 separate account-selection controls |
| SRP-10 | `JournalAnalytics.jsx:34-95` | Dead `BucketBars` component |
| Dead-1 | `apps/web/src/components/PositionsTable.jsx` | Never imported (110 lines) |
| Dead-2 | `apps/web/src/components/MetricCard.jsx` | Never imported (43 lines) |
| Dead-3 | `services/bridge_service.py:398-404` | `submit_order()` never called |
| Dead-4 | `services/api/app/db/base.py:33-43` | `session_scope()` never used (services commit themselves) |
