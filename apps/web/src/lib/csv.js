// CSV export (IO concern, ticket 006-04). Moved out of the component so the
// journal feature only decides *what* to export, not how a file is written.

const HEADERS = [
  'Ticket',
  'Symbol',
  'Type',
  'Volume',
  'Open Price',
  'Close Price',
  'Net PnL',
  'Close Time',
  'Magic'
];

/**
 * Download the given trades as CSV.
 * Returns false when there is nothing to export (caller shows its own message).
 */
export function exportTradesCsv(trades, { symbol = 'ALL' } = {}) {
  if (!Array.isArray(trades) || trades.length === 0 || typeof document === 'undefined') {
    return false;
  }

  const rows = trades.map((trade) => [
    trade.ticket,
    trade.symbol,
    trade.type,
    trade.volume,
    trade.open_price,
    trade.close_price,
    trade.profit,
    trade.close_time ? new Date(trade.close_time * 1000).toISOString() : '',
    trade.magic
  ]);

  const filename = symbol === 'ALL'
    ? `MT5_Trade_Journal_${Date.now()}.csv`
    : `MT5_Trade_Journal_${symbol}_${Date.now()}.csv`;

  const csvContent = [HEADERS.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
