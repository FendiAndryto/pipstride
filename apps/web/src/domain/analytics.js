// Journal analytics for periods the backend does not serve.
//
// This is a deliberate mirror of services/api/app/domain/metrics.py (Fase 005):
// same formulas, same rounding, same bucketing, same null semantics. The
// backend computes 1M/3M/1Y/ALL from Postgres; this module exists so the MONTH
// calendar window frontend keeps one definition instead of a second dialect.
//
// If both copies must ever change, change them together (ADR 0009 §2).
//
// Rows are duck-typed on trade attributes: `profit`, `symbol`, `direction`,
// `type`, `volume`, `magic`, `open_time`, `close_time` (unix seconds).

const round2 = (value) => Math.round(value * 100) / 100;
const round1 = (value) => Math.round(value * 10) / 10;

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));

export const winRate = (wins, total) => (total ? round2((wins / total) * 100) : 0);

/** Gross profit over |gross loss|; null when there is no loss at all (never 0). */
export const profitFactor = (grossProfit, grossLoss) =>
  Math.abs(grossLoss) > 0 ? round2(grossProfit / Math.abs(grossLoss)) : null;

const sum = (values) => values.reduce((acc, value) => acc + value, 0);
const profitsOf = (rows) => rows.map((row) => row.profit ?? 0);

/** Close time in unix seconds, falling back to open time (mirrors backend). */
const closeSeconds = (row) => row.close_time ?? row.open_time ?? null;

/** Hold duration in minutes; null when either endpoint is missing/decreasing. */
function holdMinutes(row) {
  const opened = row.open_time;
  const closed = closeSeconds(row);
  if (opened === undefined || opened === null || closed === undefined || closed === null) {
    return null;
  }
  const minutes = (closed - opened) / 60;
  return minutes >= 0 ? minutes : null;
}

const weekdayKey = (row) => {
  const seconds = closeSeconds(row);
  if (seconds === undefined || seconds === null) return null;
  // getUTCDay() is Sunday-first; Python .weekday() is Monday-first.
  return WEEKDAY_LABELS[(new Date(seconds * 1000).getUTCDay() + 6) % 7];
};

const hourKey = (row) => {
  const seconds = closeSeconds(row);
  if (seconds === undefined || seconds === null) return null;
  return String(new Date(seconds * 1000).getUTCHours()).padStart(2, '0');
};

const symbolKey = (row) => {
  const symbol = (row.symbol || '').trim().toUpperCase();
  return symbol || null;
};

const sourceKey = (row) => ((row.magic || 0) > 0 ? 'EA' : 'Manual');

const directionKey = (row) => {
  const direction = String(row.direction ?? row.type ?? '').trim().toUpperCase();
  if (direction.includes('SELL')) return 'SELL';
  if (direction.includes('BUY')) return 'BUY';
  return null;
};

function bucket(key, rows) {
  const profits = profitsOf(rows);
  const wins = profits.filter((p) => p > 0);
  const losses = profits.filter((p) => p < 0);
  const grossProfit = sum(wins);
  const grossLoss = sum(losses);
  return {
    key,
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: winRate(wins.length, rows.length),
    net_profit: round2(grossProfit + grossLoss),
    profit_factor: profitFactor(grossProfit, grossLoss)
  };
}

function bucketize(rows, keyOf, order) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let keys;
  if (order) {
    keys = [...order.filter((key) => groups.has(key))];
    keys.push(...[...groups.keys()].filter((key) => !order.includes(key)).sort(compareKeys));
  } else {
    // Symbol-like order: biggest net loss first, ties by key (backend _bucketize).
    keys = [...groups.keys()].sort((a, b) => {
      const netA = sum(profitsOf(groups.get(a)));
      const netB = sum(profitsOf(groups.get(b)));
      return (netB - netA) || compareKeys(a, b);
    });
  }
  return keys.map((key) => bucket(key, groups.get(key)));
}

function compareKeys(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function computeTotals(rows) {
  const profits = profitsOf(rows);
  const wins = profits.filter((p) => p > 0);
  const losses = profits.filter((p) => p < 0);
  const total = rows.length;
  const grossProfit = sum(wins);
  const grossLoss = sum(losses); // negative, exactly like the backend

  const holds = rows.map(holdMinutes).filter((value) => value !== null);

  // Streaks: rebuilt on close order; a breakeven trade (profit === 0) resets both.
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;
  const ordered = [...rows].sort(
    (a, b) => (closeSeconds(a) ?? -Infinity) - (closeSeconds(b) ?? -Infinity)
  );
  for (const row of ordered) {
    const profit = row.profit ?? 0;
    if (profit > 0) {
      currentWin += 1;
      currentLoss = 0;
    } else if (profit < 0) {
      currentLoss += 1;
      currentWin = 0;
    } else {
      currentWin = 0;
      currentLoss = 0;
    }
    if (currentWin > maxWinStreak) maxWinStreak = currentWin;
    if (currentLoss > maxLossStreak) maxLossStreak = currentLoss;
  }

  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0;

  return {
    trades: total,
    wins: wins.length,
    losses: losses.length,
    breakeven: total - wins.length - losses.length,
    win_rate: winRate(wins.length, total),
    net_profit: round2(grossProfit + grossLoss),
    gross_profit: round2(grossProfit),
    gross_loss: round2(grossLoss),
    profit_factor: profitFactor(grossProfit, grossLoss),
    expectancy: total ? round2((grossProfit + grossLoss) / total) : 0,
    avg_win: round2(avgWin),
    avg_loss: round2(avgLoss),
    payoff_ratio: avgLoss ? round2(avgWin / Math.abs(avgLoss)) : null,
    best_trade: profits.length ? round2(Math.max(...profits)) : 0,
    worst_trade: profits.length ? round2(Math.min(...profits)) : 0,
    max_win_streak: maxWinStreak,
    max_loss_streak: maxLossStreak,
    avg_hold_minutes: holds.length ? round1(sum(holds) / holds.length) : null,
    total_volume: round2(sum(rows.map((row) => row.volume ?? 0)))
  };
}

/**
 * Stats payload shaped like `GET /api/v1/journal/stats`:
 * { totals, by_symbol, by_weekday, by_hour, by_direction, by_source }.
 */
export function computeJournalStats(rows) {
  return {
    totals: computeTotals(rows),
    by_symbol: bucketize(rows, symbolKey),
    by_weekday: bucketize(rows, weekdayKey, WEEKDAY_LABELS),
    by_hour: bucketize(rows, hourKey, HOUR_LABELS),
    by_direction: bucketize(rows, directionKey, ['BUY', 'SELL']),
    by_source: bucketize(rows, sourceKey, ['EA', 'Manual'])
  };
}
