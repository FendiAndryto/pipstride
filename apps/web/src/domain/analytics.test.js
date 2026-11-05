import { describe, expect, it } from 'vitest';

import { computeJournalStats, computeTotals, profitFactor, winRate } from './analytics';

// Ticket 008-01 — locks the deliberate mirror of services/api/app/domain/metrics.py
// (Fase 005). Expected values are frozen literals so the test proves parity
// without needing Python or the API running in CI.

describe('winRate', () => {
  it('returns 0 for an empty set instead of NaN', () => {
    expect(winRate(0, 0)).toBe(0);
  });

  it('rounds to 2 decimals, matching Python round(wins / total * 100.0, 2)', () => {
    expect(winRate(1, 3)).toBe(33.33);
    expect(winRate(2, 3)).toBe(66.67);
    expect(winRate(3, 3)).toBe(100);
  });
});

describe('profitFactor', () => {
  it('divides gross profit by the absolute gross loss', () => {
    expect(profitFactor(20, -7)).toBe(2.86);
  });

  it('returns null when there is no loss at all, never 0', () => {
    // Python: `round(...) if gross_loss else None` — an infinite ratio is not
    // plottable, and 0.0 would read as a terrible strategy.
    expect(profitFactor(60, 0)).toBeNull();
  });

  it('returns 0 when there is no profit but there are losses', () => {
    expect(profitFactor(0, -20)).toBe(0);
  });
});

describe('computeTotals', () => {
  const trades = [
    { close_time: 1_700_000_100, open_time: 1_700_000_000, profit: 25, symbol: 'EURUSD', direction: 'BUY', volume: 0.1, magic: 0 },
    { close_time: 1_700_000_200, open_time: 1_700_000_000, profit: -10, symbol: 'GBPUSD', direction: 'SELL', volume: 0.2, magic: 7 },
    { close_time: 1_700_000_300, open_time: 1_700_000_000, profit: 15, symbol: 'EURUSD', direction: 'BUY', volume: 0.1, magic: 0 },
    { close_time: 1_700_000_400, open_time: 1_700_000_000, profit: 0, symbol: 'USDJPY', direction: 'BUY', volume: 0.3, magic: 0 },
    { close_time: 1_700_000_500, open_time: 1_700_000_000, profit: -5, symbol: 'GBPUSD', direction: 'SELL', volume: 0.1, magic: 7 }
  ];

  it('matches the backend fixture totals exactly', () => {
    // Frozen from domain/metrics.py compute_stats on this same fixture.
    const totals = computeTotals(trades);

    expect(totals.trades).toBe(5);
    expect(totals.wins).toBe(2);
    expect(totals.losses).toBe(2);
    expect(totals.breakeven).toBe(1);
    expect(totals.win_rate).toBe(40);
    expect(totals.net_profit).toBe(25);
    expect(totals.gross_profit).toBe(40);
    expect(totals.gross_loss).toBe(-15);
    expect(totals.profit_factor).toBe(2.67);
    expect(totals.expectancy).toBe(5);
    expect(totals.best_trade).toBe(25);
    expect(totals.worst_trade).toBe(-10);
    expect(totals.total_volume).toBe(0.8);
  });

  it('treats an empty list as zeroed totals, not NaN', () => {
    const totals = computeTotals([]);

    expect(totals.trades).toBe(0);
    expect(totals.win_rate).toBe(0);
    expect(totals.net_profit).toBe(0);
    expect(totals.profit_factor).toBeNull();
    expect(totals.expectancy).toBe(0);
    expect(totals.payoff_ratio).toBeNull();
    expect(totals.avg_hold_minutes).toBeNull();
  });

  it('resets both streaks on a breakeven trade', () => {
    const streaks = computeTotals([
      { close_time: 1, profit: 5 },
      { close_time: 2, profit: 5 },
      { close_time: 3, profit: 0 },
      { close_time: 4, profit: -5 }
    ]);

    expect(streaks.max_win_streak).toBe(2);
    expect(streaks.max_loss_streak).toBe(1);
  });

  it('computes hold time in minutes and ignores negative durations', () => {
    const holds = computeTotals([
      { open_time: 0, close_time: 600, profit: 1 },
      { open_time: 600, close_time: 600, profit: 1 },
      { open_time: 100, close_time: 50, profit: 1 }
    ]);

    // 10 and 0 minutes count; the decreasing pair is dropped.
    expect(holds.avg_hold_minutes).toBe(5);
  });
});

describe('computeJournalStats', () => {
  const trades = [
    { close_time: 1_700_000_100, profit: 25, symbol: 'eurusd', direction: 'BUY', magic: 0 },
    { close_time: 1_700_000_200, profit: -10, symbol: 'GBPUSD', direction: 'SELL', magic: 7 },
    { close_time: 1_700_000_300, profit: 15, symbol: 'EURUSD', direction: 'BUY', magic: 0 }
  ];

  it('exposes the same six sections as GET /api/v1/journal/stats', () => {
    expect(Object.keys(computeJournalStats(trades)).sort()).toEqual(
      ['by_direction', 'by_hour', 'by_source', 'by_symbol', 'by_weekday', 'totals'].sort()
    );
  });

  it('normalises symbols to upper case and merges duplicates', () => {
    const bySymbol = computeJournalStats(trades).by_symbol;
    const eurusd = bySymbol.find((bucket) => bucket.key === 'EURUSD');

    expect(eurusd.trades).toBe(2);
    expect(eurusd.net_profit).toBe(40);
  });

  it('keeps the raw direction value instead of collapsing to BUY/SELL', () => {
    // Mirrors Python `_direction_key`: "BUY_LIMIT" must not bucket as "BUY".
    const stats = computeJournalStats([
      { close_time: 1, profit: 1, direction: 'BUY_LIMIT' },
      { close_time: 2, profit: 1, direction: 'BUY' }
    ]);
    const keys = stats.by_direction.map((bucket) => bucket.key);

    expect(keys).toContain('BUY_LIMIT');
    expect(keys).toContain('BUY');
  });

  it('buckets weekday Monday-first like Python .weekday()', () => {
    // 2023-11-13T00:00:00Z is a Monday.
    const monday = Date.UTC(2023, 10, 13, 12, 0, 0) / 1000;
    const stats = computeJournalStats([{ close_time: monday, profit: 1 }]);

    expect(stats.by_weekday[0].key).toBe('Mon');
  });

  it('labels EA trades by magic number and manual trades by zero magic', () => {
    const stats = computeJournalStats(trades);
    const ea = stats.by_source.find((bucket) => bucket.key === 'EA');
    const manual = stats.by_source.find((bucket) => bucket.key === 'Manual');

    expect(ea.trades).toBe(1);
    expect(manual.trades).toBe(2);
  });
});
