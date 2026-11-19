import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { journalWindow } from './journalPeriod';
import { joinJournalRows, loadJournalTradePages } from './journalRows';

const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 1000;
const ROWS_REFRESH_MS = 20000;
const STATS_REFRESH_MS = 80000;
const EMPTY_CASH_FLOW = { deposits: 0, withdrawals: 0, netFunding: 0 };

const rollingMinute = () => Math.floor(Date.now() / 60000) * 60;

// Keying the result keeps the previous period invisible while the next request
// is loading. Cleanup prevents a late response from publishing after a change.
function useJournalQuery(key, request, enabled, refreshMs, revision) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let inFlight = false;

    const refresh = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const value = await request();
        if (!disposed) setResult({ key, value, error: false });
      } catch {
        if (!disposed) setResult((previous) => ({
          key,
          value: previous?.key === key ? previous.value : null,
          error: true
        }));
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const timer = setInterval(refresh, refreshMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [key, request, enabled, refreshMs, revision]);

  const current = enabled && result?.key === key ? result : null;
  return {
    value: current?.value ?? null,
    error: current?.error ?? false,
    loading: enabled && !current
  };
}

export function useJournalData({
  activeTab, closedTradesCount, bridgeStatus, hasConnection, connectionId, period, month, calendarMonth
}) {
  const [filter, setFilter] = useState('All');
  const [selectedSymbol, setSelectedSymbol] = useState('ALL');
  const [search, setSearch] = useState('');
  const [nowSec, setNowSec] = useState(rollingMinute);
  const [pageSelection, setPageSelection] = useState(null);
  const enabled = (!activeTab || activeTab === 'journal') && Boolean(hasConnection && connectionId);
  const rolling = period !== 'ALL' && period !== 'MONTH';

  useEffect(() => {
    if (!enabled || !rolling) return undefined;
    const updateClock = () => {
      if (!document.hidden) setNowSec(rollingMinute());
    };
    updateClock();
    const timer = setInterval(updateClock, ROWS_REFRESH_MS);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, [enabled, rolling]);

  const source = { All: 'all', Manual: 'manual', EA: 'ea' }[filter];
  const year = period === 'MONTH' ? month.selectedYear : null;
  const monthIndex = period === 'MONTH' ? month.selectedMonthIndex : null;
  const reference = rolling ? nowSec : null;
  const globalQuery = useMemo(() => ({
    ...journalWindow(period, year, monthIndex, reference),
    range: period,
    source,
    symbol: selectedSymbol,
    connectionId
  }), [period, year, monthIndex, reference, source, selectedSymbol, connectionId]);

  const statsKey = JSON.stringify([connectionId, period, year, monthIndex, source, selectedSymbol]);
  const normalizedSearch = search.trim();
  const filterKey = JSON.stringify([statsKey, normalizedSearch]);
  const page = pageSelection?.key === filterKey ? pageSelection.page : 1;
  const setPage = useCallback((nextPage) => {
    setPageSelection({ key: filterKey, page: nextPage });
  }, [filterKey]);

  const rowsRequest = useCallback(async () => {
    const data = await api.getJournalRows({
      ...globalQuery, search: normalizedSearch, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE
    });
    return { data, page };
  }, [globalQuery, normalizedSearch, page]);
  const statsRequest = useCallback(() => api.getJournalStats(globalQuery), [globalQuery]);
  const { selectedYear: calendarYear, selectedMonthIndex: calendarIndex } = calendarMonth;
  const calendarKey = JSON.stringify([connectionId, calendarYear, calendarIndex, source, selectedSymbol]);
  const calendarRequest = useCallback(() => api.getJournalStats({
    ...journalWindow('MONTH', calendarYear, calendarIndex),
    range: 'MONTH',
    source,
    symbol: selectedSymbol,
    includeDaily: true,
    connectionId
  }), [calendarYear, calendarIndex, source, selectedSymbol, connectionId]);

  const history = useJournalQuery(filterKey, rowsRequest, enabled, ROWS_REFRESH_MS, closedTradesCount);
  const stats = useJournalQuery(statsKey, statsRequest, enabled, STATS_REFRESH_MS, closedTradesCount);
  const calendar = useJournalQuery(calendarKey, calendarRequest, enabled, STATS_REFRESH_MS, closedTradesCount);

  const historyData = history.value?.data;
  const currentRows = history.value?.page === page ? historyData : null;
  const totalRows = historyData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const needsValidPage = history.value?.page === page && page > totalPages;
  if (pageSelection?.key !== filterKey || needsValidPage) {
    setPageSelection({ key: filterKey, page: needsValidPage ? totalPages : 1 });
  }

  const exportTrades = useCallback(() => (
    loadJournalTradePages((offset) => api.getJournalRows({
      ...globalQuery,
      search: normalizedSearch,
      limit: EXPORT_PAGE_SIZE,
      offset,
      tradesOnly: true
    }))
  ), [globalQuery, normalizedSearch]);

  const { totals, cash_flow: cashFlow } = stats.value ?? {};
  const symbolRows = historyData?.symbols ?? [];
  const calendarDailyPnl = Object.fromEntries(
    Object.entries(calendar.value?.daily_pnl ?? {}).map(([date, pnl]) => [Number(date.slice(-2)), pnl])
  );

  return {
    activeAccountNumber: bridgeStatus?.metrics?.account_number ?? null,
    filter,
    setFilter,
    selectedSymbol,
    setSelectedSymbol,
    search,
    setSearch,
    tradedSymbols: symbolRows.map(({ symbol }) => symbol),
    symbolCounts: Object.fromEntries(symbolRows.map(({ symbol, count }) => [symbol, count])),
    symbolTradeCount: symbolRows.reduce((total, { count }) => total + count, 0),
    totalRows,
    paginatedRows: joinJournalRows(currentRows?.trades ?? [], currentRows?.cash_flow ?? []),
    totalPages,
    currentPage: page,
    pageSize: PAGE_SIZE,
    setPage,
    canExportTrades: (historyData?.trade_total ?? 0) > 0,
    exportTrades,
    activeStats: stats.value,
    netPnl: totals?.net_profit ?? 0,
    winRate: totals?.win_rate ?? 0,
    profitFactor: totals?.profit_factor ?? null,
    totalTrades: totals?.trades ?? 0,
    winningTrades: totals?.wins ?? 0,
    losingTrades: totals?.losses ?? 0,
    cashFlowStats: cashFlow ? {
      deposits: cashFlow.deposits,
      withdrawals: cashFlow.withdrawals,
      netFunding: cashFlow.net_funding
    } : EMPTY_CASH_FLOW,
    calendarDailyPnl,
    calendarLoading: calendar.loading,
    calendarError: calendar.error,
    isHistoryLoading: enabled && !history.error && (history.loading || history.value?.page !== page || needsValidPage),
    historyError: history.error,
    isStatsLoading: stats.loading,
    statsError: stats.error
  };
}
