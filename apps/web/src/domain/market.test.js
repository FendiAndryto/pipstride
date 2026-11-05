import { describe, expect, it } from 'vitest';

import { STRUCTURE, describeWindow, normalizeCandles } from './market';

// Regression for the bug where the Market tab read the EA's candle array
// backwards. The EA emits candles oldest-first (see `BuildCandlesJson`), but the
// component sliced `[0, bars]` and compared `last.open` to `first.close`, so a
// rising market was labelled "lower lows" and the bias contradicted the chart.

const candle = (time, open, high, low, close) => ({ time, open, high, low, close });

// 30 bars walking up by 1: structure is unambiguously bullish.
const rising = Array.from({ length: 30 }, (_, i) =>
  candle(1_700_000_000 + i * 300, 100 + i, 101 + i, 99 + i, 100.5 + i)
);

// 30 bars walking down by 1.
const falling = Array.from({ length: 30 }, (_, i) =>
  candle(1_700_000_000 + i * 300, 200 - i, 201 - i, 199 - i, 199.5 - i)
);

describe('normalizeCandles', () => {
  it('sorts oldest-first whatever the producer sent', () => {
    const shuffled = [rising[2], rising[0], rising[1]];

    expect(normalizeCandles(shuffled).map((c) => c.time)).toEqual([
      rising[0].time,
      rising[1].time,
      rising[2].time
    ]);
  });

  it('drops rows without a usable OHLC or time', () => {
    const candles = [
      candle(0, 1, 1, 1, 1),
      { time: 1_700_000_100, open: 0, high: 1, low: 1, close: 1 },
      candle(1_700_000_200, 1, 1, 1, 1),
      null,
      undefined
    ];

    expect(normalizeCandles(candles)).toHaveLength(1);
    expect(normalizeCandles(null)).toEqual([]);
  });
});

describe('describeWindow', () => {
  it('reports a rising series as bullish with an up-structure', () => {
    const read = describeWindow(rising, 24, 130);

    expect(read.hasData).toBe(true);
    expect(read.trend).toBe('BULLISH');
    expect(read.changePct).toBeGreaterThan(0);
    expect(read.structure).toBe(STRUCTURE.HIGHER_HIGHS);
  });

  it('reports a falling series as bearish with a down-structure', () => {
    const read = describeWindow(falling, 24, 175);

    expect(read.trend).toBe('BEARISH');
    expect(read.changePct).toBeLessThan(0);
    expect(read.structure).toBe(STRUCTURE.LOWER_LOWS);
  });

  it('measures the change over the window, not between two stray fields', () => {
    // Newest bar pulls back: open 129 -> close 120 while the window opened at 101.
    const withPullback = [...rising.slice(0, 29), candle(rising[29].time, 129, 130, 119, 120)];
    const read = describeWindow(withPullback, 24, 120);

    expect(read.open).toBe(withPullback[6].open);
    expect(read.close).toBe(120);
    expect(read.changePct).toBeCloseTo(((120 - withPullback[6].open) / withPullback[6].open) * 100, 6);
    expect(read.trend).toBe('BULLISH');
  });

  it('keeps the newest bars when the payload carries more than the window', () => {
    // 16-bar M5 window over 30 ascending bars: the oldest 14 must be ignored.
    const read = describeWindow(rising, 16, 130);

    expect(read.bars).toBe(16);
    expect(read.open).toBe(rising[14].open);
    expect(read.low).toBe(rising[14].low);
  });

  it('gives the same answer for a descending payload', () => {
    const ascending = describeWindow(rising, 24, 130);
    const descending = describeWindow([...rising].reverse(), 24, 130);

    expect(descending.trend).toBe(ascending.trend);
    expect(descending.structure).toBe(ascending.structure);
    expect(descending.open).toBe(ascending.open);
    expect(descending.close).toBe(ascending.close);
  });

  it('places the price marker inside the band and clamps it', () => {
    expect(describeWindow(rising, 24, 0).pricePositionPct).toBe(2);
    expect(describeWindow(rising, 24, 10_000).pricePositionPct).toBe(98);
    expect(describeWindow(rising, 24, null).pricePositionPct).toBe(50);
  });

  it('reports no data instead of a fake zero', () => {
    expect(describeWindow([], 24, 100).hasData).toBe(false);
    expect(describeWindow(null, 24, 100).hasData).toBe(false);
    expect(describeWindow([candle(1_700_000_000, 1, 1, 1, 1)], 24, 1).hasData).toBe(false);
  });
});
