// Journal data + derived state (ticket 006-04). Collapses the five fetch
// effects into one hook: single history/stats polling with visibility and
// in-flight guards, plus the filter/search/month derivations the table needs.
//
// Analytics math is NOT here: MONTH stats come from domain/analytics.js and
// every other range from the backend via api.getJournalStats.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { computeJournalStats } from '../../domain/analytics';
import { buildDayBuckets } from './dayBuckets';

const PAGE_SIZE = 20;
const HISTORY_LIMIT = 2000;

const sourceOf = (trade) => ((trade.magic || 0) > 0 ? 'EA' : 'Manual');
const matchesSymbol = (trade, symbol) =>
  symbol === 'ALL' || (trade.symbol || '').toUpperCase() === symbol.toUpperCase();

export function useJournalData({ activeTab, closedTradesCount, bridgeStatus, hasConnection, period, month }) {
  const [historyData, setHistoryData] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [windowNowSec, setWindowNowSec] = useState(null);
  const [page, setPage] = useState(1);
  // Filter/search/symbol state lives here (ticket 006-04 item 3) so the
  // component stays presentational and the account-switch reset is local.
  const [filter, setFilter] = useState('All');
  const [selectedSymbol, setSelectedSymbol] = useState('ALL');
  const [search, setSearch] = useState('');

  const activeAccountNumber = bridgeStatus?.metrics?.account_number || null;
  const isConnected = bridgeStatus?.is_connected ?? false;
  const canFetch = Boolean(hasConnection || isConnected);
  const prevAccountRef = useRef(activeAccountNumber);
  const historyInFlightRef = useRef(false);
  const statsInFlightRef = useRef(false);
  const ticksRef = useRef(0);

  const fetchHistory = useCallback(async () => {
    if (!hasConnection && !isConnected) return;
    if (document.hidden || historyInFlightRef.current) return;
    historyInFlightRef.current = true;
    // Stamp "now" even when the request fails: buildDayBuckets needs a reference
    // timestamp for the 1M/3M/1Y windows, and 0 would drop every trade.
    setWindowNowSec(Math.floor(Date.now() / 1000));
    try {
      const data = await api.getTradeHistory(HISTORY_LIMIT);
      // Never show another MT5 account's history.
      if (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber) {
        setHistoryData(data);
        setHistoryError(false);
      }
    } catch {
      setHistoryError(true);
    } finally {
      historyInFlightRef.current = false;
    }
  }, [hasConnection, isConnected, activeAccountNumber]);

  const statsSource = filter === 'EA' ? 'ea' : filter === 'Manual' ? 'manual' : 'all';

  const fetchStats = useCallback(async () => {
    if (period === 'MONTH' || (!hasConnection && !isConnected)) return;
    if (document.hidden || statsInFlightRef.current) return;
    statsInFlightRef.current = true;
    try {
      const data = await api.getJournalStats(period, statsSource, selectedSymbol);
      // Same guard as history: never show stats from another MT5 account.
      if (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber) {
        setStats(data);
        setStatsError(false);
      }
    } catch {
      setStatsError(true);
    } finally {
      statsInFlightRef.current = false;
    }
  }, [period, statsSource, selectedSymbol, hasConnection, isConnected, activeAccountNumber]);

  // Keep the latest fetchers reachable from the interval without re-keying it.
  const fetchHistoryRef = useRef(fetchHistory);
  const fetchStatsRef = useRef(fetchStats);
  useEffect(() => {
    fetchHistoryRef.current = fetchHistory;
    fetchStatsRef.current = fetchStats;
  }, [fetchHistory, fetchStats]);

  // Switching MT5 account wipes everything that belonged to the previous one.
  useEffect(() => {
    if (activeAccountNumber && prevAccountRef.current && prevAccountRef.current !== activeAccountNumber) {
      setHistoryData(null);
      setStats(null);
      setStatsError(false);
      setHistoryError(false);
      setSelectedSymbol('ALL');
      setPage(1);
    }
    prevAccountRef.current = activeAccountNumber;
  }, [activeAccountNumber]);

  // Refetch immediately whenever the query identity changes (tab, account, period,
  // filter, symbol, closed-trade count). This replaces the two original reactive
  // effects, which refetched on exactly these keys.
  // The kickoff is deferred by a tick so the effect body never calls setState
  // synchronously during commit; it still runs before paint.
  useEffect(() => {
    if (activeTab && activeTab !== 'journal') return undefined;
    if (!canFetch) return undefined;
    const kickoff = setTimeout(() => {
      void fetchHistory();
      void fetchStats();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [activeTab, canFetch, closedTradesCount, activeAccountNumber, period, statsSource, selectedSymbol, fetchHistory, fetchStats]);

  // Background polling while the journal tab is actually visible. Keyed only on
  // the tab, so a re-key above does NOT restart the interval and the 80s stats
  // cadence survives. `ticks` lives in a ref for the same reason.
  useEffect(() => {
    if (activeTab !== 'journal') return undefined;
    if (!canFetch) return undefined;

    const timer = setInterval(() => {
      ticksRef.current += 1;
      void fetchHistoryRef.current();
      if (ticksRef.current % 4 === 0) void fetchStatsRef.current();
    }, 20000);

    return () => clearInterval(timer);
  }, [activeTab, canFetch]);

  // ------------------------------------------------------------------ derived
  const { selectedMonthIndex, selectedYear, selectedMonth } = month;
  const monthLocale = month.locale;
  const trades = useMemo(() => historyData?.trades || [], [historyData]);

  const tradedSymbols = useMemo(() => {
    const counts = {};
    trades.forEach((trade) => {
      if (!trade.symbol) return;
      const symbol = trade.symbol.toUpperCase();
      counts[symbol] = (counts[symbol] || 0) + 1;
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }, [trades]);

  const symbolTrades = useMemo(
    () => (selectedSymbol === 'ALL' ? trades : trades.filter((trade) => matchesSymbol(trade, selectedSymbol))),
    [trades, selectedSymbol]
  );

  const symbolFallbackPnl = useMemo(() => {
    if (selectedSymbol === 'ALL') return historyData?.net_pnl ?? 0;
    return symbolTrades.reduce((acc, trade) => acc + (trade.profit || 0), 0);
  }, [selectedSymbol, symbolTrades, historyData]);

  const dailyPnlMap = useMemo(() => {
    const map = {};
    trades.forEach((trade) => {
      if (!trade.close_time || !matchesSymbol(trade, selectedSymbol)) return;
      const date = new Date(trade.close_time * 1000);
      if (date.getMonth() === selectedMonthIndex && date.getFullYear() === selectedYear) {
        const day = date.getDate();
        map[day] = (map[day] || 0) + trade.profit;
      }
    });
    return map;
  }, [trades, selectedSymbol, selectedMonthIndex, selectedYear]);

  const monthTrades = useMemo(() => {
    return trades.filter((trade) => {
      if (!trade.close_time) return false;
      const date = new Date(trade.close_time * 1000);
      const inMonth = date.getMonth() === selectedMonthIndex && date.getFullYear() === selectedYear;
      if (!inMonth) return false;
      const matchesFilter = filter === 'All' || sourceOf(trade) === filter;
      return matchesFilter && matchesSymbol(trade, selectedSymbol);
    });
  }, [trades, selectedMonthIndex, selectedYear, filter, selectedSymbol]);

  const monthStats = useMemo(() => {
    if (period !== 'MONTH') return null;
    return computeJournalStats(monthTrades);
  }, [period, monthTrades]);

  const activeStats = period === 'MONTH' ? (monthStats || stats) : stats;
  const totals = activeStats?.totals;
  const netPnl = totals?.net_profit ?? (period === 'MONTH' ? 0 : symbolFallbackPnl);
  const winRate = totals?.win_rate
    ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.win_rate ?? 0) : 0));
  const profitFactor = totals
    ? totals.profit_factor
    : (period === 'MONTH' ? null : (selectedSymbol === 'ALL' ? historyData?.profit_factor : null));
  const totalTrades = totals?.trades
    ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.total_trades ?? 0) : symbolTrades.length));
  const winningTrades = totals?.wins
    ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.winning_trades ?? 0) : 0));
  const losingTrades = totals?.losses
    ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.losing_trades ?? 0) : 0));

  const filteredTrades = useMemo(() => {
    const needle = search.toLowerCase();
    return trades.filter((trade) => {
      const source = sourceOf(trade);
      const matchesFilter = filter === 'All' || source === filter;
      if (!matchesFilter || !matchesSymbol(trade, selectedSymbol)) return false;
      const matchesSearch =
        (trade.symbol || '').toLowerCase().includes(needle) ||
        source.toLowerCase().includes(needle) ||
        String(trade.ticket).includes(search);
      if (!matchesSearch) return false;

      if (period === 'MONTH') {
        if (!trade.close_time) return false;
        const date = new Date(trade.close_time * 1000);
        return date.getMonth() === selectedMonthIndex && date.getFullYear() === selectedYear;
      }
      return true;
    });
  }, [trades, filter, selectedSymbol, search, period, selectedMonthIndex, selectedYear]);

  // Reset to the first page whenever the filter identity changes.
  const filterKey = `${filter}|${selectedSymbol}|${search}|${period}|${selectedMonth}`;
  const [prevFilterKey, setPrevFilterKey] = useState('');
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.ceil(filteredTrades.length / PAGE_SIZE) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredTrades.slice(start, start + PAGE_SIZE);
  }, [filteredTrades, currentPage]);

  const dayBuckets = useMemo(
    () => buildDayBuckets(trades, {
      period,
      filter,
      selectedSymbol,
      monthTrades,
      nowSec: windowNowSec ?? 0,
      locale: monthLocale
    }),
    [period, monthTrades, trades, filter, selectedSymbol, monthLocale, windowNowSec]
  );

  const isHistoryLoading = !historyData && !historyError && canFetch;
  const isStatsLoading = period === 'MONTH' ? isHistoryLoading : (!stats && !statsError && canFetch);

  return {
    activeAccountNumber,
    filter,
    setFilter,
    selectedSymbol,
    setSelectedSymbol,
    search,
    setSearch,
    trades,
    tradedSymbols,
    filteredTrades,
    paginatedTrades,
    totalPages,
    currentPage,
    pageSize: PAGE_SIZE,
    setPage,
    dayBuckets,
    activeStats,
    netPnl,
    winRate,
    profitFactor,
    totalTrades,
    winningTrades,
    losingTrades,
    dailyPnlMap,
    isHistoryLoading,
    isStatsLoading,
    fetchHistory,
    fetchStats
  };
}
