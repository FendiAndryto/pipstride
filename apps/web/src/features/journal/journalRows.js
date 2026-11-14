// Render-only union of the two journal streams (ticket 013-03).
//
// Trading rows and cash rows stay separate everywhere else: `trades` feeds every
// metric formula and the CSV export, `cash_flow` only feeds these rows and the
// cash KPI cards. The join happens here, once, so the table can show a deposit
// without any aggregate ever seeing it.
//
// Pure: no React, no fetch. `filteredTrades` is the already-filtered trade list
// (the hook owns that rule); this function only decides which cash rows belong
// beside them and merges the two by close time.

export const inMonth = (seconds, monthIndex, year) => {
  if (!seconds) return false;
  const date = new Date(seconds * 1000);
  return date.getMonth() === monthIndex && date.getFullYear() === year;
};

// A balance deal rendered through the same table. It has no symbol, volume or
// exit price, so those fields are blanked here instead of being invented in
// the JSX (SPEC-007 D4).
export const cashRowOf = (item) => ({
  ...item,
  kind: 'CASH',
  close_time: item.time,
  symbol: '',
  volume: 0,
  close_price: 0,
  magic: 0
});

export function joinJournalRows(
  filteredTrades,
  cashFlow,
  { filter, selectedSymbol, search, period, selectedMonthIndex, selectedYear }
) {
  const needle = (search || '').toLowerCase();
  const cashMatches = (row) => {
    const category = (row.category || '').toLowerCase();
    const matchesSearch = category.includes(needle) || String(row.ticket).includes(search);
    if (!matchesSearch) return false;
    if (period === 'MONTH') {
      return inMonth(row.close_time, selectedMonthIndex, selectedYear);
    }
    return true;
  };

  // "EA"/"Manual" are trade sources and a symbol chip is a trading filter; a
  // balance deal belongs to neither, so cash rows only appear under All+ALL.
  const showCash = filter === 'All' && selectedSymbol === 'ALL';
  const cashRows = showCash ? (cashFlow || []).map(cashRowOf).filter(cashMatches) : [];

  return [...filteredTrades, ...cashRows].sort((a, b) => (b.close_time || 0) - (a.close_time || 0));
}
