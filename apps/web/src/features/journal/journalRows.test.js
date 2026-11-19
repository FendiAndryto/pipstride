import { describe, expect, it } from 'vitest';
import { joinJournalRows, loadJournalTradePages } from './journalRows';

describe('joinJournalRows', () => {
  it('interleaves trades and cash from one server page, keeping trades first on a tie', () => {
    const trades = [
      { ticket: 20, close_time: 300 },
      { ticket: 10, close_time: 100 }
    ];
    const cash = [
      { ticket: 40, time: 400, category: 'DEPOSIT', profit: 1000 },
      { ticket: 30, time: 300, category: 'WITHDRAWAL', profit: -200 }
    ];

    const rows = joinJournalRows(trades, cash);

    expect(rows.map(({ ticket }) => ticket)).toEqual([40, 20, 30, 10]);
    expect(rows[0]).toMatchObject({ kind: 'CASH', close_time: 400, profit: 1000 });
  });
});

describe('loadJournalTradePages', () => {
  it('exports matching trades beyond the old 2,000-trade limit', async () => {
    const trades = Array.from({ length: 2002 }, (_, ticket) => ({ ticket }));
    const offsets = [];

    const result = await loadJournalTradePages(async (offset) => {
      offsets.push(offset);
      return { trades: trades.slice(offset, offset + 1000), total: trades.length };
    });

    expect(offsets).toEqual([0, 1000, 2000]);
    expect(result).toEqual(trades);
  });

  it('keeps an empty result empty', async () => {
    expect(await loadJournalTradePages(async () => ({ trades: [], total: 0 }))).toEqual([]);
    expect(await loadJournalTradePages(async () => null)).toEqual([]);
  });

  it('rejects a shifted page instead of exporting duplicate trades', async () => {
    await expect(loadJournalTradePages(async () => ({
      trades: [{ ticket: 1 }],
      total: 2
    }))).rejects.toThrow('Journal page shifted during export');
  });

  it('rejects a partial export when the remaining rows are unavailable', async () => {
    await expect(loadJournalTradePages(async (offset) => offset === 0
      ? { trades: [{ ticket: 1 }], total: 2 }
      : null)).rejects.toThrow('Journal history changed during export');
  });
});
