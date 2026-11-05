// Single copy of the account PnL / drawdown derivations (ticket 006-02, SoC-7).
// Rule: backend-provided values win; local formulas run only when the field is
// absent (a stale or non-connected bridge). Pure functions, no React/DOM.
//
// Callers pass `bridgeStatus` / `riskStatus` straight from Dashboard state,
// which is `null` until the first poll resolves. Default parameters only cover
// `undefined`, so every entry point normalises with `?? {}` — a bare `= {}`
// default let `null` through and crashed the whole dashboard render.

const provided = (value) => value !== undefined && value !== null;

const percentOfBase = (amount, base) => (base > 0 ? (amount / base) * 100 : 0);

/**
 * All-time performance of the active account.
 * bridgeStatus fields settle the ground truth; balance/equity deltas are the
 * fallback when the endpoint has not reported them yet.
 */
export function summarizeAccountPnl(bridgeStatus, metrics) {
  const status = bridgeStatus ?? {};
  const live = metrics ?? {};
  const balance = live.balance ?? 0;
  const equity = live.equity ?? 0;
  const initialDeposit = status.initial_deposit ?? live.initial_deposit ?? balance;
  const settledDelta = balance - initialDeposit;
  const allTimeDelta = equity - initialDeposit;
  return {
    initialDeposit,
    isDepositOverridden: status.is_deposit_overridden ?? false,
    settledPnl: provided(status.settled_pnl) ? status.settled_pnl : settledDelta,
    settledPnlPercent: provided(status.settled_pnl_percent)
      ? status.settled_pnl_percent
      : percentOfBase(settledDelta, initialDeposit),
    allTimePnl: provided(status.all_time_pnl) ? status.all_time_pnl : allTimeDelta,
    allTimePnlPercent: provided(status.all_time_pnl_percent)
      ? status.all_time_pnl_percent
      : percentOfBase(allTimeDelta, initialDeposit)
  };
}

/**
 * Daily drawdown used where the live watchdog value is missing: negative
 * floating loss (equity under balance) expressed as a percent of balance.
 */
export function dailyDrawdownFallback(riskStatus, metrics) {
  const risk = riskStatus ?? {};
  const live = metrics ?? {};
  const value = risk.daily_drawdown_percent;
  if (provided(value)) return value;
  const balance = live.balance ?? 0;
  const equity = live.equity ?? 0;
  return balance > 0 && equity < balance ? ((balance - equity) / balance) * 100 : 0;
}

/**
 * Passive risk-watchdog display state (ProfileTab). Read-only; the watchdog
 * never liquidates anything.
 */
export function deriveDrawdownWatch(riskStatus) {
  const risk = riskStatus ?? {};
  const daily = risk.daily_drawdown_percent ?? 0;
  const max = risk.max_daily_drawdown_percent ?? 3.0;
  return {
    daily,
    max,
    alert: risk.is_alert_active ?? false,
    limitUsed: max > 0 ? Math.min(100, (daily / max) * 100) : 0
  };
}
