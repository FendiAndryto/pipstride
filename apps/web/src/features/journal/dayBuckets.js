// Per-day aggregation for the journal's weekday chart (ticket 006-04).
// Pure function: given trades and a locale it returns the same bucket shape the
// backend's `by_weekday` uses, so JournalAnalytics renders either source.

import { winRate, profitFactor } from '../../domain/analytics';

const DAY_SECONDS = 86400;

/**
 * @param {Array} trades     all trades of the active account
 * @param {object} options
 * @param {string} options.period         '1M' | '3M' | '1Y' | 'ALL' | 'MONTH'
 * @param {string} options.filter         'All' | 'Manual' | 'EA'
 * @param {string} options.selectedSymbol symbol filter or 'ALL'
 * @param {Array}  options.monthTrades    pre-filtered trades for MONTH
 * @param {number} options.nowSec         timestamp captured at the last refresh
 * @param {string} options.locale         BCP-47 locale for the bucket label
 */
export function buildDayBuckets(trades, { period, filter, selectedSymbol, monthTrades, nowSec, locale }) {
  const sourceOf = (trade) => ((trade.magic || 0) > 0 ? 'EA' : 'Manual');
  const matchesSymbol = (trade) =>
    selectedSymbol === 'ALL' || (trade.symbol || '').toUpperCase() === selectedSymbol.toUpperCase();

  const relevant = period === 'MONTH'
    ? monthTrades
    : trades.filter((trade) => {
      if (!trade.close_time) return false;
      if (filter !== 'All' && sourceOf(trade) !== filter) return false;
      if (!matchesSymbol(trade)) return false;
      if (period === '1M') return trade.close_time >= nowSec - 30 * DAY_SECONDS;
      if (period === '3M') return trade.close_time >= nowSec - 90 * DAY_SECONDS;
      if (period === '1Y') return trade.close_time >= nowSec - 365 * DAY_SECONDS;
      return true;
    });

  const dayMap = {};
  relevant.forEach((trade) => {
    if (!trade.close_time) return;
    const date = new Date(trade.close_time * 1000);
    const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!dayMap[isoDate]) {
      dayMap[isoDate] = {
        key: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date),
        timestamp: trade.close_time,
        trades: 0,
        wins: 0,
        losses: 0,
        net_profit: 0,
        gross_profit: 0,
        gross_loss: 0
      };
    }
    const bucket = dayMap[isoDate];
    bucket.trades += 1;
    const profit = trade.profit || 0;
    bucket.net_profit += profit;
    if (profit > 0) {
      bucket.wins += 1;
      bucket.gross_profit += profit;
    } else if (profit < 0) {
      bucket.losses += 1;
      bucket.gross_loss += Math.abs(profit);
    }
  });

  return Object.values(dayMap)
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((bucket) => ({
      key: bucket.key,
      trades: bucket.trades,
      wins: bucket.wins,
      losses: bucket.losses,
      net_profit: Math.round(bucket.net_profit * 100) / 100,
      // Shared domain formulas (ADR 0009): same rounding and null semantics as
      // the backend's `_bucket`, so a day bucket and a `by_weekday` bucket of
      // the same trades are indistinguishable.
      win_rate: winRate(bucket.wins, bucket.trades),
      profit_factor: profitFactor(bucket.gross_profit, -bucket.gross_loss)
    }));
}
