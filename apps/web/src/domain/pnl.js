// Single copy of the account PnL / drawdown derivations (ticket 006-02, SoC-7).
// Rule: backend-provided values win; local formulas run only when the field is
// absent (a stale or non-connected bridge). Pure functions, no React/DOM.
//
// Callers pass `bridgeStatus` / `riskStatus` straight from Dashboard state,
// which is `null` until the first poll resolves. Default parameters only cover
// `undefined`, so every entry point normalises with `?? {}` — a bare `= {}`
// default let `null` through and crashed the whole dashboard render.
//
// Ticket 09-02 removed the local drawdown formula (`dailyDrawdownFallback`,
// `deriveDrawdownWatch`). It derived `(balance - equity) / balance`, which is a
// floating loss, not a drawdown: on a red day it reported ~0% and disagreed with
// the backend. Drawdown is now read-only from `/bridge/risk`; when the backend
// cannot answer, the UI says so instead of inventing a number.

const provided = (value) => value !== undefined && value !== null;

const percentOfBase = (amount, base) => (base > 0 ? (amount / base) * 100 : 0);

/** Fraction of a limit already used, clamped to 0-100; a zero limit uses none. */
const usedFraction = (value, limit) => {
  if (!provided(value) || !provided(limit) || limit <= 0) return 0;
  return Math.min(100, Math.max(0, (value / limit) * 100));
};

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
 * Drawdown view for the Journal card and the Home tile.
 *
 * Pure shaping only — every number comes from `/bridge/risk`:
 *   daily   = equity now vs the broker-day anchor equity
 *   dailyMax= worst reading of the day (alerts key off this, not `daily`)
 *   overall = equity now vs the all-time peak
 *   maxOverall = worst peak-to-trough ever
 *
 * `available` is false when the endpoint has not answered (or predates the
 * fields), so the caller renders a dash instead of a fabricated 0.00%.
 */
export function drawdownView(riskStatus) {
  const risk = riskStatus ?? {};
  const hasAny =
    risk.is_data_available === false
      ? false
      : provided(risk.daily_drawdown_percent) ||
        provided(risk.daily_max_drawdown_percent) ||
        provided(risk.overall_drawdown_percent) ||
        provided(risk.max_drawdown_percent);

  const dailyMax = provided(risk.daily_max_drawdown_percent) ? risk.daily_max_drawdown_percent : null;
  const maxOverall = provided(risk.max_drawdown_percent) ? risk.max_drawdown_percent : null;
  const dailyLimit = provided(risk.max_daily_drawdown_percent) ? risk.max_daily_drawdown_percent : null;
  const overallLimit = provided(risk.max_overall_drawdown_percent) ? risk.max_overall_drawdown_percent : null;

  return {
    available: hasAny,
    daily: provided(risk.daily_drawdown_percent) ? risk.daily_drawdown_percent : null,
    dailyMax,
    dailyLimit,
    dailyUsed: usedFraction(dailyMax, dailyLimit),
    dailyAlert: risk.is_alert_active ?? false,
    dailyAnchorAt: provided(risk.daily_anchor_at) ? risk.daily_anchor_at : null,
    dailyAnchorSource: provided(risk.daily_anchor_source) ? risk.daily_anchor_source : null,
    overall: provided(risk.overall_drawdown_percent) ? risk.overall_drawdown_percent : null,
    maxOverall,
    overallLimit,
    overallUsed: usedFraction(maxOverall, overallLimit),
    overallAlert: risk.is_overall_alert_active ?? false,
    peakEquity: provided(risk.peak_equity) ? risk.peak_equity : null,
    peakEquityAt: provided(risk.peak_equity_at) ? risk.peak_equity_at : null
  };
}

/** Bar colour band shared by both gauges: <40% green, <75% amber, else red. */
export function drawdownTone(used, alert) {
  if (alert || used > 75) return 'var(--red)';
  if (used > 40) return 'var(--amber)';
  return 'var(--g)';
}
