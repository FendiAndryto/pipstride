// Merge the two already filtered streams from the same server page for display.
const cashRowOf = (item) => ({
  ...item,
  kind: 'CASH',
  close_time: item.time,
  symbol: '',
  volume: 0,
  close_price: 0,
  magic: 0
});

export function joinJournalRows(trades, cashFlow) {
  return [...trades, ...cashFlow.map(cashRowOf)].sort(
    (a, b) => (b.close_time ?? 0) - (a.close_time ?? 0)
  );
}

// Offset pagination is shared with the table. If the number of rows or a page
// boundary shifts mid-export, fail visibly so the user can retry.
export async function loadJournalTradePages(loadPage) {
  const trades = [];
  const tickets = new Set();
  let total;
  do {
    const data = await loadPage(trades.length);
    if (!data) {
      if (total === undefined) return [];
      throw new Error('Journal history changed during export');
    }
    total ??= data.total;
    if (data.total !== total || (!data.trades.length && trades.length < total)) {
      throw new Error('Journal history changed during export');
    }
    for (const trade of data.trades) {
      if (tickets.has(trade.ticket)) throw new Error('Journal page shifted during export');
      tickets.add(trade.ticket);
      trades.push(trade);
    }
  } while (trades.length < total);
  if (trades.length !== total) throw new Error('Journal history changed during export');
  return trades;
}
