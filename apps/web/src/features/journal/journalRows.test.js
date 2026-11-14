import { describe, expect, it } from 'vitest';

import { calculateCashFlow, computeJournalStats } from '../../domain/analytics';
import { joinJournalRows } from './journalRows';

// Ticket 013-03 fixture: 10 closed trades (9 wins, 1 loss) plus 1 deposit and
// 3 withdrawals. It proves the two streams are joined for rendering only.

const DAY = 86_400;

const trades = Array.from({ length: 10 }, (_, index) => ({
  ticket: 9000 + index,
  symbol: index % 2 === 0 ? 'XAUUSD' : 'EURUSD',
  type: index % 2 === 0 ? 'BUY' : 'SELL',
  direction: index % 2 === 0 ? 'BUY' : 'SELL',
  volume: 0.1,
  close_price: 2400 + index,
  profit: index === 9 ? -25 : 10,
  magic: index < 6 ? 12 : 0,
  open_time: 1_700_000_000 + index * DAY,
  close_time: 1_700_000_000 + index * DAY
}));

const cashFlow = [
  { ticket: 1001, category: 'DEPOSIT', profit: 1000, time: 1_699_000_000 },
  { ticket: 1002, category: 'WITHDRAWAL', profit: -300, time: 1_700_050_000 },
  { ticket: 1003, category: 'WITHDRAWAL', profit: -150, time: 1_700_150_000 },
  { ticket: 1004, category: 'WITHDRAWAL', profit: -50, time: 1_700_250_000 }
];

const baseOptions = {
  filter: 'All',
  selectedSymbol: 'ALL',
  search: '',
  period: 'ALL',
  selectedMonthIndex: 0,
  selectedYear: 2023
};

describe('joinJournalRows', () => {
  it('appends the 4 cash rows to the 10 trades under All + ALL', () => {
    const rows = joinJournalRows(trades, cashFlow, baseOptions);

    expect(rows).toHaveLength(14);
    expect(rows.filter((row) => row.kind === 'CASH')).toHaveLength(4);
  });

  it('never lets a cash row reach the trading aggregates', () => {
    const stats = computeJournalStats(trades);

    expect(stats.totals.trades).toBe(10);
    expect(stats.totals.wins).toBe(9);
    expect(stats.totals.losses).toBe(1);
    expect(stats.totals.net_profit).toBe(65);
    expect(calculateCashFlow(cashFlow)).toEqual({
      deposits: 1000,
      withdrawals: 500,
      netFunding: 500
    });
  });

  it('hides cash rows under a trade source or symbol filter', () => {
    // The hook hands in already-filtered trades; this function only decides
    // whether the cash stream belongs beside them.
    const eaTrades = trades.filter((trade) => trade.magic > 0);
    const manualTrades = trades.filter((trade) => trade.magic === 0);
    const goldTrades = trades.filter((trade) => trade.symbol === 'XAUUSD');

    expect(joinJournalRows(eaTrades, cashFlow, { ...baseOptions, filter: 'EA' })).toHaveLength(6);
    expect(joinJournalRows(manualTrades, cashFlow, { ...baseOptions, filter: 'Manual' })).toHaveLength(4);
    expect(joinJournalRows(goldTrades, cashFlow, { ...baseOptions, selectedSymbol: 'XAUUSD' })).toHaveLength(5);
  });

  it('blanks symbol, volume, price and magic on a cash row and keeps the signed amount', () => {
    const rows = joinJournalRows([], cashFlow, baseOptions);
    const withdrawal = rows.find((row) => row.ticket === 1002);

    expect(withdrawal.symbol).toBe('');
    expect(withdrawal.volume).toBe(0);
    expect(withdrawal.close_price).toBe(0);
    expect(withdrawal.magic).toBe(0);
    expect(withdrawal.close_time).toBe(1_700_050_000);
    expect(withdrawal.profit).toBe(-300);
  });

  it('sorts both streams together by close time, newest first', () => {
    const rows = joinJournalRows(trades, cashFlow, baseOptions);
    const times = rows.map((row) => row.close_time);

    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(rows[0].ticket).toBe(9009);
    expect(rows[rows.length - 1].ticket).toBe(1001);
  });

  it('matches a cash row by category or ticket in the search box', () => {
    expect(joinJournalRows([], cashFlow, { ...baseOptions, search: 'withdraw' })).toHaveLength(3);
    expect(joinJournalRows([], cashFlow, { ...baseOptions, search: '1001' })).toHaveLength(1);
  });

  it('limits cash rows to the selected month in MONTH mode', () => {
    const november = joinJournalRows(trades, cashFlow, {
      ...baseOptions,
      period: 'MONTH',
      selectedMonthIndex: 10,
      selectedYear: 2023
    });
    const october = joinJournalRows(trades, cashFlow, {
      ...baseOptions,
      period: 'MONTH',
      selectedMonthIndex: 9,
      selectedYear: 2023
    });

    expect(november.filter((row) => row.kind === 'CASH')).toHaveLength(4);
    expect(october.filter((row) => row.kind === 'CASH')).toHaveLength(0);
  });
});
