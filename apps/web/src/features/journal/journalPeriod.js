const RANGE_DAYS = { '1M': 30, '3M': 90, '1Y': 365 };
const SECONDS_PER_DAY = 86400;

export function journalWindow(period, year, monthIndex, nowSec) {
  if (period === 'MONTH') {
    const first = Date.UTC(year, monthIndex, 1);
    const next = Date.UTC(year, monthIndex + 1, 1);
    return { start: first / 1000, end: next / 1000 };
  }
  const days = RANGE_DAYS[period];
  return days ? { start: nowSec - days * SECONDS_PER_DAY } : {};
}

