import { describe, expect, it } from 'vitest';
import { journalWindow } from './journalPeriod';

const NOW = Date.UTC(2026, 10, 19, 12) / 1000;

describe('journalWindow', () => {
  it('leaves the entire synced history unbounded', () => {
    expect(journalWindow('ALL', null, null, NOW)).toEqual({});
  });

  it.each([['1M', 30], ['3M', 90], ['1Y', 365]])(
    'uses a rolling UTC cutoff for %s', (period, days) => {
      expect(journalWindow(period, null, null, NOW)).toEqual({ start: NOW - days * 86400 });
    }
  );

  it('uses UTC midnight bounds across a year boundary', () => {
    expect(journalWindow('MONTH', 2025, 11, NOW)).toEqual({
      start: Date.UTC(2025, 11, 1) / 1000,
      end: Date.UTC(2026, 0, 1) / 1000
    });
  });
});
