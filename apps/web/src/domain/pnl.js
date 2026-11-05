// Single copy of the account PnL / drawdown derivations (ticket 006-02, SoC-7).
// Rule: backend-provided values win; local formulas run only when the field is
// absent (a stale or non-connected bridge). Pure functions, no React/DOM.

const provided = (value) => value !== undefined && value !== null;

const percentOfBase = (amount, base) => (base > 0 ? (amount / base) * 100 : 0);

/**
 * All-time performance of the active account.
 * bridgeStatus fields settle the ground truth; balance/equity deltas are the
 * fallback when the endpoint has not reported them yet.
 */
export function summarizeAccountPnl(bridgeStatus = {}, metrics = {}) {
  const balance = metrics.balance ?? 0;
  const equity = metrics.equity ?? 0;
  const initialDeposit = bridgeStatus.initial_deposit ?? metrics.initial_deposit ?? balance;
  const settledDelta = balance - initialDeposit;
  const allTimeDelta = equity - initialDeposit;
  return {
    initialDeposit,
    isDepositOverridden: bridgeStatus.is_deposit_overridden ?? false,
    settledPnl: provided(bridgeStatus.settled_pnl) ? bridgeStatus.settled_pnl : settledDelta,
    settledPnlPercent: provided(bridgeStatus.settled_pnl_percent)
      ? bridgeStatus.settled_pnl_percent
      : percentOfBase(settledDelta, initialDeposit),
    allTimePnl: provided(bridgeStatus.all_time_pnl) ? bridgeStatus.all_time_pnl : allTimeDelta,
    allTimePnlPercent: provided(bridgeStatus.all_time_pnl_percent)
      ? bridgeStatus.all_time_pnl_percent
      : percentOfBase(allTimeDelta, initialDeposit)
  };
}

/**
 * Daily drawdown used where the live watchdog value is missing: negative
 * floating loss (equity under balance) expressed as a percent of balance.
 */
export function dailyDrawdownFallback(riskStatus, metrics = {}) {
  const value = riskStatus?.daily_drawdown_percent;
  if (provided(value)) return value;
  const balance = metrics.balance ?? 0;
  const equity = metrics.equity ?? 0;
  return balance > 0 && equity < balance ? ((balance - equity) / balance) * 100 : 0;
}

/**
 * Passive risk-watchdog display state (ProfileTab). Read-only; the watchdog
 * never liquidates anything.
 */
export function deriveDrawdownWatch(riskStatus = {}) {
  const daily = riskStatus.daily_drawdown_percent ?? 0;
  const max = riskStatus.max_daily_drawdown_percent ?? 3.0;
  return {
    daily,
    max,
    alert: riskStatus.is_alert_active ?? false,
    limitUsed: max > 0 ? Math.min(100, (daily / max) * 100) : 0
  };
}
