import { describe, expect, it } from 'vitest';

import { drawdownTone, drawdownView, summarizeAccountPnl } from './pnl';

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

describe('drawdownView', () => {
  const full = {
    daily_drawdown_percent: 0.5,
    daily_max_drawdown_percent: 3.5,
    max_daily_drawdown_percent: 3,
    is_alert_active: true,
    daily_anchor_at: 1767225600,
    daily_anchor_source: 'snapshot_rollforward',
    overall_drawdown_percent: 4.2,
    max_drawdown_percent: 6.5,
    max_overall_drawdown_percent: 10,
    is_overall_alert_active: false,
    peak_equity: 12000,
    peak_equity_at: 1767220000
  };

  it('passes every backend value through unchanged', () => {
    const view = drawdownView(full);

    expect(view.available).toBe(true);
    expect(view.daily).toBe(0.5);
    expect(view.dailyMax).toBe(3.5);
    expect(view.dailyLimit).toBe(3);
    expect(view.overall).toBe(4.2);
    expect(view.maxOverall).toBe(6.5);
    expect(view.peakEquity).toBe(12000);
    expect(view.dailyAnchorSource).toBe('snapshot_rollforward');
  });

  it('scales each gauge against its own limit', () => {
    const view = drawdownView(full);

    // 3.5 / 3 is over the daily limit -> bar pinned at 100, alert flag passed through.
    expect(view.dailyUsed).toBe(100);
    expect(view.dailyAlert).toBe(true);
    expect(view.overallUsed).toBe(65);
    expect(view.overallAlert).toBe(false);
  });

  it('is unavailable when riskStatus is null, so the UI shows a dash', () => {
    const view = drawdownView(null);

    expect(view.available).toBe(false);
    expect(view.dailyMax).toBeNull();
    expect(view.maxOverall).toBeNull();
    expect(view.dailyUsed).toBe(0);
    expect(view.dailyAlert).toBe(false);
  });

  it('is unavailable when the payload predates the drawdown fields', () => {
    // An older backend (or a cached response) only carries margin_level.
    expect(drawdownView({ margin_level: 5225 }).available).toBe(false);
  });

  it('honours is_data_available=false even though the zeros look clean', () => {
    // No snapshot, no deposit, bridge down: the API still sends zeros for old
    // clients. The flag is what stops the card from claiming 0.00% is safe.
    const view = drawdownView({
      is_data_available: false,
      daily_drawdown_percent: 0,
      daily_max_drawdown_percent: 0,
      overall_drawdown_percent: 0,
      max_drawdown_percent: 0
    });

    expect(view.available).toBe(false);
  });

  it('treats null fields as absent instead of rendering 0', () => {
    const view = drawdownView({ daily_max_drawdown_percent: null, max_drawdown_percent: null });

    expect(view.available).toBe(false);
    expect(view.dailyMax).toBeNull();
  });

  it('does not divide by a zero limit', () => {
    const view = drawdownView({ daily_max_drawdown_percent: 2, max_daily_drawdown_percent: 0 });

    expect(view.dailyUsed).toBe(0);
    expect(Number.isFinite(view.dailyUsed)).toBe(true);
  });

  it('clamps a negative reading to zero usage', () => {
    expect(drawdownView({ daily_max_drawdown_percent: -1, max_daily_drawdown_percent: 3 }).dailyUsed).toBe(0);
  });

  it('does not throw when riskStatus is undefined', () => {
    expect(() => drawdownView(undefined)).not.toThrow();
  });
});

describe('drawdownTone', () => {
  it('stays green below 40% of the limit', () => {
    expect(drawdownTone(10, false)).toBe('var(--g)');
  });

  it('turns amber past 40% and red past 75%', () => {
    expect(drawdownTone(50, false)).toBe('var(--amber)');
    expect(drawdownTone(80, false)).toBe('var(--red)');
  });

  it('is red whenever the alert flag is on, even at low usage', () => {
    expect(drawdownTone(5, true)).toBe('var(--red)');
  });
});
