import { describe, expect, it } from 'vitest';

import { buildDayBuckets } from './dayBuckets';
import { computeTotals } from '../../domain/analytics';

// Ticket 008-01 — the guard for the post-gate correction in ticket 006-04.
//
// dayBuckets used to re-derive win_rate/profit_factor locally, without round2
// and with different null semantics. Real divergences that reached production:
//   mixed     : PF 2.857142857142857 vs 2.86, WR 66.666... vs 66.67
//   breakeven : PF 0 (rendered "0.00") vs None (rendered the em dash)
// The backend renders the same bucket shape via domain/metrics.py `_bucket`,
// so a day bucket and a by_weekday bucket of identical trades must match.

const NOW = 1_700_000_000;

const options = (overrides = {}) => ({
  period: 'ALL',
  filter: 'All',
  selectedSymbol: 'ALL',
  monthTrades: [],
  nowSec: NOW,
  locale: 'en-US',
  ...overrides
});

// close_time within the same local day so each fixture yields exactly one bucket.
const dayStart = new Date(NOW * 1000);
dayStart.setHours(12, 0, 0, 0);
const at = (minutesAgo) => Math.floor(dayStart.getTime() / 1000) - minutesAgo * 60;

const trade = (profit, minutesAgo) => ({
  close_time: at(minutesAgo),
  profit,
  magic: 0,
  symbol: 'EURUSD'
});

const only = (trades, overrides) => {
  const buckets = buildDayBuckets(trades, options(overrides));
  expect(buckets).toHaveLength(1);
  return buckets[0];
};

describe('dayBuckets parity with domain/analytics.computeTotals', () => {
  const cases = {
    'all wins (no loss at all)': [trade(10, 3), trade(20, 2), trade(30, 1)],
    'mixed wins and losses': [trade(10, 3), trade(10, 2), trade(-7, 1)],
    'breakeven only': [trade(0, 1)],
    'all losses': [trade(-5, 2), trade(-15, 1)]
  };

  for (const [label, trades] of Object.entries(cases)) {
    it(`matches win_rate, profit_factor and net_profit for ${label}`, () => {
      const bucket = only(trades);
      const totals = computeTotals(trades);

      expect(bucket.win_rate).toBe(totals.win_rate);
      expect(bucket.profit_factor).toBe(totals.profit_factor);
      expect(bucket.net_profit).toBe(totals.net_profit);
    });
  }

  it('rounds profit_factor to 2 decimals instead of leaking the raw ratio', () => {
    const bucket = only([trade(10, 3), trade(10, 2), trade(-7, 1)]);

    // 20 / 7 = 2.857142857142857 — the pre-fix value that reached the UI.
    expect(bucket.profit_factor).toBe(2.86);
    expect(bucket.profit_factor).not.toBe(20 / 7);
  });

  it('rounds win_rate to 2 decimals instead of leaking the raw percentage', () => {
    const bucket = only([trade(10, 3), trade(10, 2), trade(-7, 1)]);

    // 2 / 3 * 100 = 66.66666666666666 — the pre-fix value.
    expect(bucket.win_rate).toBe(66.67);
    expect(bucket.win_rate).not.toBe((2 / 3) * 100);
  });

  it('returns null profit_factor for a breakeven-only bucket, never 0', () => {
    const bucket = only([trade(0, 1)]);

    // Regression guard: the pre-fix code returned 0 here, and formatRatio(0)
    // renders "0.00" where the backend renders the em dash for None.
    expect(bucket.profit_factor).toBeNull();
    expect(bucket.profit_factor).not.toBe(0);
  });

  it('returns null profit_factor when every trade won', () => {
    expect(only([trade(10, 1), trade(5, 2)]).profit_factor).toBeNull();
  });

  it('returns 0 profit_factor when every trade lost', () => {
    expect(only([trade(-10, 1), trade(-5, 2)]).profit_factor).toBe(0);
  });

  it('returns no buckets for an empty trade list', () => {
    expect(buildDayBuckets([], options())).toEqual([]);
  });

  it('keeps gross profit and loss out of the returned shape', () => {
    const bucket = only([trade(10, 1), trade(-4, 2)]);

    // The chart consumes only the bucket contract; internal accumulators must
    // not leak into the payload the component receives.
    expect(bucket).not.toHaveProperty('gross_profit');
    expect(bucket).not.toHaveProperty('gross_loss');
    expect(Object.keys(bucket).sort()).toEqual(
      ['key', 'losses', 'net_profit', 'profit_factor', 'trades', 'win_rate', 'wins'].sort()
    );
  });

  it('sorts buckets newest first', () => {
    const older = trade(10, 60 * 24);
    const newer = trade(20, 1);
    const buckets = buildDayBuckets([older, newer], options());

    expect(buckets).toHaveLength(2);

    // Bucket keys are locale-formatted dates, so derive the expected labels the
    // same way a reader would: format each trade's day and compare positions.
    const label = (unixSeconds) =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      }).format(new Date(unixSeconds * 1000));

    expect(buckets[0].key).toBe(label(newer.close_time));
    expect(buckets[1].key).toBe(label(older.close_time));
  });
});
