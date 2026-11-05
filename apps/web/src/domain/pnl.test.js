import { describe, expect, it } from 'vitest';

import { dailyDrawdownFallback, deriveDrawdownWatch, summarizeAccountPnl } from './pnl';

// Ticket 008-01 — locks the rule from ticket 006-02 (SoC-7): backend-provided
// values win, local formulas only run when the field is absent. Also locks the
// null-safety regression fixed in commit 0365743 ("tolerate null bridge/risk
// status in pnl domain helpers") — a bare `= {}` default let null through and
// crashed the whole dashboard render.

describe('summarizeAccountPnl', () => {
  const metrics = { balance: 1100, equity: 1150, initial_deposit: 1000 };

  it('prefers backend-provided PnL values over local derivation', () => {
    const result = summarizeAccountPnl(
      {
        initial_deposit: 1000,
        settled_pnl: 99,
        settled_pnl_percent: 9.9,
        all_time_pnl: 150,
        all_time_pnl_percent: 15
      },
      metrics
    );

    expect(result.settledPnl).toBe(99);
    expect(result.settledPnlPercent).toBe(9.9);
    expect(result.allTimePnl).toBe(150);
    expect(result.allTimePnlPercent).toBe(15);
  });

  it('falls back to balance/equity deltas when the fields are absent', () => {
    const result = summarizeAccountPnl({ initial_deposit: 1000 }, metrics);

    expect(result.settledPnl).toBe(100); // balance - deposit
    expect(result.settledPnlPercent).toBe(10);
    expect(result.allTimePnl).toBe(150); // equity - deposit
    expect(result.allTimePnlPercent).toBe(15);
  });

  it('falls back to the delta when a field is null, not just undefined', () => {
    // `provided()` must treat null as absent — this is the 0365743 regression.
    const result = summarizeAccountPnl(
      { initial_deposit: 1000, settled_pnl: null, all_time_pnl_percent: null },
      metrics
    );

    expect(result.settledPnl).toBe(100);
    expect(result.allTimePnlPercent).toBe(15);
  });

  it('does not throw when bridgeStatus and metrics are null', () => {
    expect(() => summarizeAccountPnl(null, null)).not.toThrow();

    const result = summarizeAccountPnl(null, null);
    expect(result.settledPnl).toBe(0);
    expect(result.allTimePnl).toBe(0);
    expect(result.initialDeposit).toBe(0);
  });

  it('returns 0 percent instead of Infinity when the deposit is zero', () => {
    const result = summarizeAccountPnl({ initial_deposit: 0 }, { balance: 100, equity: 100 });

    expect(result.settledPnlPercent).toBe(0);
    expect(Number.isFinite(result.settledPnlPercent)).toBe(true);
  });

  it('reports whether the deposit was overridden', () => {
    expect(summarizeAccountPnl({ is_deposit_overridden: true }, metrics).isDepositOverridden).toBe(true);
    expect(summarizeAccountPnl({}, metrics).isDepositOverridden).toBe(false);
  });
});

describe('dailyDrawdownFallback', () => {
  it('prefers the live watchdog value when present', () => {
    expect(dailyDrawdownFallback({ daily_drawdown_percent: 1.25 }, { balance: 1000, equity: 900 })).toBe(1.25);
  });

  it('derives floating loss as a percent of balance when absent', () => {
    expect(dailyDrawdownFallback({}, { balance: 1000, equity: 950 })).toBe(5);
  });

  it('returns 0 when equity is at or above balance', () => {
    expect(dailyDrawdownFallback({}, { balance: 1000, equity: 1000 })).toBe(0);
    expect(dailyDrawdownFallback({}, { balance: 1000, equity: 1200 })).toBe(0);
  });

  it('does not divide by zero when balance is missing', () => {
    const value = dailyDrawdownFallback(null, { equity: 900 });

    expect(value).toBe(0);
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('deriveDrawdownWatch', () => {
  it('defaults the limit to 3% and reports the used fraction', () => {
    const watch = deriveDrawdownWatch({ daily_drawdown_percent: 1.5 });

    expect(watch.max).toBe(3);
    expect(watch.limitUsed).toBe(50);
    expect(watch.alert).toBe(false);
  });

  it('clamps limitUsed at 100 when the daily drawdown exceeds the limit', () => {
    expect(deriveDrawdownWatch({ daily_drawdown_percent: 9, max_daily_drawdown_percent: 3 }).limitUsed).toBe(100);
  });

  it('passes the alert flag through', () => {
    expect(deriveDrawdownWatch({ is_alert_active: true }).alert).toBe(true);
  });

  it('does not divide by zero when the limit is zero', () => {
    expect(deriveDrawdownWatch({ daily_drawdown_percent: 2, max_daily_drawdown_percent: 0 }).limitUsed).toBe(0);
  });

  it('does not throw when riskStatus is null', () => {
    expect(() => deriveDrawdownWatch(null)).not.toThrow();
    expect(deriveDrawdownWatch(null)).toEqual({ daily: 0, max: 3, alert: false, limitUsed: 0 });
  });
});
