import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  BookOpen,
  Calendar,
  ArrowUpRight,
  Layers,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { api } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import JournalAnalytics from './JournalAnalytics';

const PERIODS = [
  { value: '1M', label: 'journal_period_1m' },
  { value: '3M', label: 'journal_period_3m' },
  { value: '1Y', label: 'journal_period_1y' },
  { value: 'ALL', label: 'journal_period_all' },
  { value: 'MONTH', label: 'journal_period_month' }
];

const PERIOD_LABELS = {
  '1M': 'journal_period_label_1m',
  '3M': 'journal_period_label_3m',
  '1Y': 'journal_period_label_1y',
  ALL: 'journal_period_label_all',
  MONTH: 'journal_period_label_month'
};

const getCurrentYearMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const CURRENT_YEAR = new Date().getFullYear();

const formatCurrency = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '$0.00';
  const prefix = val >= 0 ? '+' : '−';
  return `${prefix}$${Math.abs(val).toFixed(2)}`;
};

export default function JournalTab({
  activeTab,
  closedTradesCount,
  bridgeStatus,
  hasConnection = false
}) {
  const { t, locale } = useLanguage();
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('All');
  const [selectedSymbol, setSelectedSymbol] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [period, setPeriod] = useState('1M');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const activeAccountNumber = bridgeStatus?.metrics?.account_number || null;
  const isConnected = bridgeStatus?.is_connected ?? false;
  const prevAccountRef = useRef(activeAccountNumber);
  const historyInFlightRef = useRef(false);
  const statsInFlightRef = useRef(false);

  const isHistoryLoading = loading || (!historyData && !historyError && (hasConnection || isConnected));
  const isStatsLoading = statsLoading || (period === 'MONTH' ? isHistoryLoading : (!stats && !statsError && (hasConnection || isConnected)));

  const fetchHistory = useCallback(async () => {
    if (!hasConnection && !isConnected) {
      setLoading(false);
      return;
    }
    if (document.hidden || historyInFlightRef.current) return;
    historyInFlightRef.current = true;
    try {
      const data = await api.getTradeHistory();
      // Ensure incoming history belongs to currently connected MT5 account
      if (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber) {
        setHistoryData(data);
        setHistoryError(false);
      }
    } catch {
      setHistoryError(true);
    } finally {
      setLoading(false);
      historyInFlightRef.current = false;
    }
  }, [hasConnection, isConnected, activeAccountNumber]);

  const statsSource = filter === 'EA' ? 'ea' : filter === 'Manual' ? 'manual' : 'all';

  const fetchStats = useCallback(async (isManual = false) => {
    if (period === 'MONTH' || (!hasConnection && !isConnected)) {
      setStatsLoading(false);
      return;
    }
    if (document.hidden || statsInFlightRef.current) return;
    statsInFlightRef.current = true;
    if (isManual) setStatsLoading(true);
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
      setStatsLoading(false);
      statsInFlightRef.current = false;
    }
  }, [period, statsSource, selectedSymbol, hasConnection, isConnected, activeAccountNumber]);

  // 100% Automatic Sync: Immediately wipe previous account history when switching MT5 account
  useEffect(() => {
    if (activeAccountNumber && prevAccountRef.current && prevAccountRef.current !== activeAccountNumber) {
      setHistoryData(null);
      setStats(null);
      setSelectedSymbol('ALL');
      setStatsError(false);
      setHistoryError(false);
    }
    prevAccountRef.current = activeAccountNumber;
  }, [activeAccountNumber]);

  // Reactive fetch stats when period, source, or symbol filter changes, trades update, or tab becomes active
  useEffect(() => {
    if (activeTab === 'journal' || !activeTab) {
      if (period !== 'MONTH' && (hasConnection || isConnected)) {
        let active = true;
        api.getJournalStats(period, statsSource, selectedSymbol)
          .then((data) => {
            if (active && (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber)) {
              setStats(data);
              setStatsError(false);
            }
          })
          .catch(() => {
            if (active) setStatsError(true);
          })
          .finally(() => {
            if (active) setStatsLoading(false);
          });
        return () => {
          active = false;
        };
      }
    }
  }, [activeTab, period, statsSource, selectedSymbol, closedTradesCount, activeAccountNumber, hasConnection, isConnected]);

  // Reactive fetch trade history when tab becomes active, account changes, or closed trade count updates
  useEffect(() => {
    if (activeTab === 'journal' || !activeTab) {
      if (hasConnection || isConnected) {
        let active = true;
        api.getTradeHistory()
          .then((data) => {
            if (active && (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber)) {
              setHistoryData(data);
              setHistoryError(false);
            }
          })
          .catch(() => {
            if (active) setHistoryError(true);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
        return () => {
          active = false;
        };
      }
    }
  }, [activeTab, closedTradesCount, activeAccountNumber, hasConnection, isConnected]);

  // Synchronized background sync while actively viewing Journal tab:
  // History every 4s, heavier stats aggregates every 16s (every 4th tick)
  useEffect(() => {
    if (activeTab !== 'journal') return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      void fetchHistory();
      if (ticks % 4 === 0) {
        void fetchStats();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [activeTab, fetchHistory, fetchStats]);

  const monthInputRef = useRef(null);

  const isCurrentOrFutureMonth = useMemo(() => {
    return (selectedMonth || '') >= getCurrentYearMonth();
  }, [selectedMonth]);

  const handleMonthDisplayClick = (e) => {
    if (e?.target === monthInputRef.current) return;
    const input = monthInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        // Fallback below
      }
    }
    input.focus();
    input.click();
  };

  const { selectedYear, selectedMonthIndex, daysInMonth, monthName } = useMemo(() => {
    const parts = (selectedMonth || '').split('-');
    const year = parseInt(parts[0], 10) || CURRENT_YEAR;
    const monthIdx = (parseInt(parts[1], 10) || 1) - 1;
    const days = new Date(year, monthIdx + 1, 0).getDate();
    const name = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, monthIdx, 1));
    return { selectedYear: year, selectedMonthIndex: monthIdx, daysInMonth: days, monthName: name };
  }, [selectedMonth, locale]);

  const handlePrevMonth = () => {
    let y = selectedYear;
    let m = selectedMonthIndex - 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    const formatted = `${y}-${String(m + 1).padStart(2, '0')}`;
    setSelectedMonth(formatted);
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    if (isCurrentOrFutureMonth) return;

    let y = selectedYear;
    let m = selectedMonthIndex + 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    const formatted = `${y}-${String(m + 1).padStart(2, '0')}`;
    setSelectedMonth(formatted);
    setSelectedDate(null);
  };

  const trades = useMemo(() => historyData?.trades || [], [historyData]);

  const tradedSymbols = useMemo(() => {
    const counts = {};
    trades.forEach((t) => {
      if (t.symbol) {
        const s = t.symbol.toUpperCase();
        counts[s] = (counts[s] || 0) + 1;
      }
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }, [trades]);

  const symbolTrades = useMemo(() => {
    if (selectedSymbol === 'ALL') return trades;
    return trades.filter((t) => t.symbol?.toUpperCase() === selectedSymbol.toUpperCase());
  }, [trades, selectedSymbol]);

  const symbolFallbackPnl = useMemo(() => {
    if (selectedSymbol === 'ALL') return historyData?.net_pnl ?? 0;
    return symbolTrades.reduce((acc, t) => acc + (t.profit || 0), 0);
  }, [selectedSymbol, symbolTrades, historyData]);

  const dailyPnlMap = useMemo(() => {
    const map = {};
    trades.forEach((t) => {
      if (t.close_time) {
        const matchesSymbol = selectedSymbol === 'ALL' || t.symbol?.toUpperCase() === selectedSymbol.toUpperCase();
        if (!matchesSymbol) return;
        const d = new Date(t.close_time * 1000);
        if (d.getMonth() === selectedMonthIndex && d.getFullYear() === selectedYear) {
          const dayNum = d.getDate();
          map[dayNum] = (map[dayNum] || 0) + t.profit;
        }
      }
    });
    return map;
  }, [trades, selectedMonthIndex, selectedYear, selectedSymbol]);

  const monthTrades = useMemo(() => {
    return trades.filter((t) => {
      if (!t.close_time) return false;
      const d = new Date(t.close_time * 1000);
      const inMonth = d.getMonth() === selectedMonthIndex && d.getFullYear() === selectedYear;
      if (!inMonth) return false;
      const isEa = t.magic > 0;
      const source = isEa ? 'EA' : 'Manual';
      const matchesFilter = filter === 'All' || source === filter;
      const matchesSymbol = selectedSymbol === 'ALL' || t.symbol?.toUpperCase() === selectedSymbol.toUpperCase();
      return matchesFilter && matchesSymbol;
    });
  }, [trades, selectedMonthIndex, selectedYear, filter, selectedSymbol]);

  const monthStats = useMemo(() => {
    if (period !== 'MONTH') return null;
    const count = monthTrades.length;
    const wins = monthTrades.filter((t) => t.profit > 0);
    const losses = monthTrades.filter((t) => t.profit < 0);
    const net = monthTrades.reduce((acc, t) => acc + (t.profit || 0), 0);
    const grossProfit = wins.reduce((acc, t) => acc + (t.profit || 0), 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + (t.profit || 0), 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
    const wr = count > 0 ? (wins.length / count) * 100 : 0;
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const payoff = avgLoss > 0 ? avgWin / avgLoss : null;
    const expectancy = count > 0 ? net / count : 0;

    const profits = monthTrades.map((t) => t.profit || 0);
    const bestTrade = profits.length > 0 ? Math.max(...profits) : 0;
    const worstTrade = profits.length > 0 ? Math.min(...profits) : 0;

    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let curWin = 0;
    let curLoss = 0;
    let totalVolume = 0;
    let totalHoldMinutes = 0;
    let holdCount = 0;

    const sorted = [...monthTrades].sort((a, b) => (a.close_time || 0) - (b.close_time || 0));
    sorted.forEach((t) => {
      totalVolume += t.volume || 0;
      if (t.profit > 0) {
        curWin += 1;
        curLoss = 0;
        if (curWin > maxWinStreak) maxWinStreak = curWin;
      } else if (t.profit < 0) {
        curLoss += 1;
        curWin = 0;
        if (curLoss > maxLossStreak) maxLossStreak = curLoss;
      }
      if (t.close_time && t.open_time && t.close_time > t.open_time) {
        totalHoldMinutes += (t.close_time - t.open_time) / 60;
        holdCount += 1;
      }
    });

    const avgHold = holdCount > 0 ? totalHoldMinutes / holdCount : 0;

    const symbolMap = {};
    monthTrades.forEach((t) => {
      const sym = t.symbol || 'OTHER';
      if (!symbolMap[sym]) {
        symbolMap[sym] = { key: sym, trades: 0, wins: 0, losses: 0, net_profit: 0, gross_profit: 0, gross_loss: 0 };
      }
      const s = symbolMap[sym];
      s.trades += 1;
      s.net_profit += t.profit || 0;
      if (t.profit > 0) {
        s.wins += 1;
        s.gross_profit += t.profit;
      } else if (t.profit < 0) {
        s.losses += 1;
        s.gross_loss += Math.abs(t.profit);
      }
    });

    const bySymbol = Object.values(symbolMap).map((s) => ({
      ...s,
      win_rate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
      profit_factor: s.gross_loss > 0 ? s.gross_profit / s.gross_loss : (s.gross_profit > 0 ? null : 0)
    }));

    const dirMap = {
      BUY: { key: 'BUY', trades: 0, net_profit: 0, gross_profit: 0, gross_loss: 0, wins: 0 },
      SELL: { key: 'SELL', trades: 0, net_profit: 0, gross_profit: 0, gross_loss: 0, wins: 0 }
    };
    monthTrades.forEach((t) => {
      const dir = (t.type || t.direction || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
      dirMap[dir].trades += 1;
      const prof = t.profit || 0;
      dirMap[dir].net_profit += prof;
      if (prof > 0) {
        dirMap[dir].wins += 1;
        dirMap[dir].gross_profit += prof;
      } else if (prof < 0) {
        dirMap[dir].gross_loss += Math.abs(prof);
      }
    });

    const byDirection = Object.values(dirMap).map((d) => ({
      ...d,
      win_rate: d.trades > 0 ? (d.wins / d.trades) * 100 : 0,
      profit_factor: d.gross_loss > 0 ? d.gross_profit / d.gross_loss : (d.gross_profit > 0 ? null : 0)
    }));

    return {
      totals: {
        trades: count,
        wins: wins.length,
        losses: losses.length,
        net_profit: net,
        gross_profit: grossProfit,
        gross_loss: grossLoss,
        profit_factor: pf,
        win_rate: wr,
        avg_win: avgWin,
        avg_loss: avgLoss,
        payoff_ratio: payoff,
        expectancy: expectancy,
        max_win_streak: maxWinStreak,
        max_loss_streak: maxLossStreak,
        total_volume: totalVolume,
        best_trade: bestTrade,
        worst_trade: worstTrade,
        avg_hold_minutes: avgHold
      },
      by_symbol: bySymbol,
      by_direction: byDirection
    };
  }, [period, monthTrades]);

  const activeStats = period === 'MONTH' ? (monthStats || stats) : stats;
  const totals = activeStats?.totals;
  const netPnl = totals?.net_profit ?? (period === 'MONTH' ? 0 : symbolFallbackPnl);
  const winRate = totals?.win_rate ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.win_rate ?? 0) : 0));
  const profitFactor = totals ? totals.profit_factor : (period === 'MONTH' ? null : (selectedSymbol === 'ALL' ? historyData?.profit_factor : null));
  const totalTrades = totals?.trades ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.total_trades ?? 0) : symbolTrades.length));
  const winningTrades = totals?.wins ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.winning_trades ?? 0) : 0));
  const losingTrades = totals?.losses ?? (period === 'MONTH' ? 0 : (selectedSymbol === 'ALL' ? (historyData?.losing_trades ?? 0) : 0));
  const basePeriodLabel = period === 'MONTH' ? t('journal_month_prefix', { month: monthName }) : t(PERIOD_LABELS[period]);
  const periodLabel = selectedSymbol === 'ALL' ? basePeriodLabel : `${selectedSymbol} • ${basePeriodLabel}`;

  const filteredTrades = trades.filter((t) => {
    const isEa = t.magic > 0;
    const source = isEa ? 'EA' : 'Manual';
    const matchesFilter = filter === 'All' || source === filter;
    const matchesSymbol = selectedSymbol === 'ALL' || t.symbol?.toUpperCase() === selectedSymbol.toUpperCase();
    const matchesSearch =
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      source.toLowerCase().includes(search.toLowerCase()) ||
      String(t.ticket).includes(search);

    let matchesMonth = true;
    if (period === 'MONTH') {
      if (t.close_time) {
        const d = new Date(t.close_time * 1000);
        matchesMonth = d.getMonth() === selectedMonthIndex && d.getFullYear() === selectedYear;
      } else {
        matchesMonth = false;
      }
    }
    return matchesFilter && matchesSymbol && matchesSearch && matchesMonth;
  });

  const [page, setPage] = useState(1);
  const [prevFilterKey, setPrevFilterKey] = useState('');
  const filterKey = `${filter}|${selectedSymbol}|${search}|${period}|${selectedMonth}`;
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageSize = 20;
  const totalPages = Math.ceil(filteredTrades.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTrades.slice(start, start + pageSize);
  }, [filteredTrades, currentPage, pageSize]);

  const dayBuckets = useMemo(() => {
    const nowSec = Math.floor(new Date().getTime() / 1000);
    const relevantTrades = period === 'MONTH' ? monthTrades : trades.filter((t) => {
      if (!t.close_time) return false;
      const isEa = t.magic > 0;
      const source = isEa ? 'EA' : 'Manual';
      const matchesFilter = filter === 'All' || source === filter;
      const matchesSymbol = selectedSymbol === 'ALL' || t.symbol?.toUpperCase() === selectedSymbol.toUpperCase();
      if (!matchesFilter || !matchesSymbol) return false;

      if (period === '1M') return t.close_time >= (nowSec - 30 * 86400);
      if (period === '3M') return t.close_time >= (nowSec - 90 * 86400);
      if (period === '1Y') return t.close_time >= (nowSec - 365 * 86400);
      return true;
    });

    const dayMap = {};
    relevantTrades.forEach((t) => {
      if (!t.close_time) return;
      const d = new Date(t.close_time * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayNum = String(d.getDate()).padStart(2, '0');
      const isoDate = `${y}-${m}-${dayNum}`;

      if (!dayMap[isoDate]) {
        const formattedLabel = new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short'
        }).format(d);

        dayMap[isoDate] = {
          key: formattedLabel,
          timestamp: t.close_time,
          trades: 0,
          wins: 0,
          losses: 0,
          net_profit: 0,
          gross_profit: 0,
          gross_loss: 0
        };
      }

      const item = dayMap[isoDate];
      item.trades += 1;
      const prof = t.profit || 0;
      item.net_profit += prof;
      if (prof > 0) {
        item.wins += 1;
        item.gross_profit += prof;
      } else if (prof < 0) {
        item.losses += 1;
        item.gross_loss += Math.abs(prof);
      }
    });

    return Object.values(dayMap)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((d) => ({
        key: d.key,
        trades: d.trades,
        wins: d.wins,
        losses: d.losses,
        net_profit: Math.round(d.net_profit * 100) / 100,
        win_rate: d.trades > 0 ? (d.wins / d.trades) * 100 : 0,
        profit_factor: d.gross_loss > 0 ? d.gross_profit / d.gross_loss : (d.gross_profit > 0 ? null : 0)
      }));
  }, [period, monthTrades, trades, filter, selectedSymbol, locale]);

  const handleExportCSV = () => {
    const tradesToExport = filteredTrades.length > 0 ? filteredTrades : trades;
    if (tradesToExport.length === 0) {
      alert(t('journal_export_empty'));
      return;
    }

    const headers = ['Ticket', 'Symbol', 'Type', 'Volume', 'Open Price', 'Close Price', 'Net PnL', 'Close Time', 'Magic'];
    const rows = tradesToExport.map((t) => [
      t.ticket,
      t.symbol,
      t.type,
      t.volume,
      t.open_price,
      t.close_price,
      t.profit,
      t.close_time ? new Date(t.close_time * 1000).toISOString() : '',
      t.magic
    ]);

    const filename = selectedSymbol === 'ALL'
      ? `MT5_Trade_Journal_${Date.now()}.csv`
      : `MT5_Trade_Journal_${selectedSymbol}_${Date.now()}.csv`;

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="journal-tab-container animate-fade-in">
      <div className="heading">
        <div>
          <div className="eyebrow">{t('journal_eyebrow')}</div>
          <h1>{t('journal_title')}</h1>
          <div className="sub">
            {t('journal_sub')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn"
            onClick={handleExportCSV}
            id="journal-export-btn"
            style={{ padding: '8px 14px' }}
          >
            <ArrowUpRight size={14} />
            <span>{t('journal_export')}</span>
          </button>
        </div>
      </div>

      {/* Segmented Period Filter Bar with Month Stepper */}
      <div className="journal-period-bar">
        <div className="journal-period-segmented" role="tablist" aria-label={t('journal_filter_aria')}>
          {PERIODS.map((option) => {
            const isActive = period === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`journal-period-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setPeriod(option.value);
                  if (option.value === 'MONTH') {
                    setSelectedDate(null);
                  }
                }}
                id={`journal-period-${option.value.toLowerCase()}`}
              >
                {option.value === 'MONTH' && <Calendar size={12} />}
                <span>{t(option.label)}</span>
              </button>
            );
          })}
        </div>

        {period === 'MONTH' && (
          <div className="journal-month-stepper animate-fade-in" id="journal-month-stepper">
            <button
              type="button"
              className="journal-stepper-btn"
              onClick={handlePrevMonth}
              title={t('journal_prev_month')}
              id="journal-prev-month-btn"
            >
              <ChevronLeft size={15} />
            </button>

            <div
              className="journal-month-display"
              onClick={handleMonthDisplayClick}
              title={t('journal_pick_month')}
            >
              <Calendar size={13} style={{ color: 'var(--g)' }} />
              <span style={{ textTransform: 'capitalize' }}>{monthName}</span>
              <input
                ref={monthInputRef}
                type="month"
                value={selectedMonth}
                max={getCurrentYearMonth()}
                aria-label={t('journal_select_month')}
                onChange={(e) => {
                  if (e.target.value) {
                    const maxYM = getCurrentYearMonth();
                    const targetVal = e.target.value > maxYM ? maxYM : e.target.value;
                    setSelectedMonth(targetVal);
                    setSelectedDate(null);
                  }
                }}
                className="journal-month-input-overlay"
                id="journal-month-input"
              />
            </div>

            <button
              type="button"
              className="journal-stepper-btn"
              onClick={handleNextMonth}
              disabled={isCurrentOrFutureMonth}
              title={t('journal_next_month')}
              id="journal-next-month-btn"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Dynamic Traded Symbols Filter Bar */}
      {tradedSymbols.length > 0 && (
        <div className="journal-symbol-bar animate-fade-in" role="tablist" aria-label={t('journal_filter_symbol_aria')}>
          <div className="journal-symbol-chips">
            <button
              type="button"
              role="tab"
              aria-selected={selectedSymbol === 'ALL'}
              className={`journal-symbol-chip ${selectedSymbol === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedSymbol('ALL')}
              id="journal-symbol-all"
            >
              <span>{t('journal_symbol_all')}</span>
              <span className="journal-symbol-count">{trades.length}</span>
            </button>
            {tradedSymbols.map((sym) => {
              const count = trades.filter((t) => t.symbol?.toUpperCase() === sym).length;
              const isActive = selectedSymbol === sym;
              return (
                <button
                  key={sym}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`journal-symbol-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedSymbol(sym)}
                  id={`journal-symbol-${sym.toLowerCase()}`}
                >
                  <span>{sym}</span>
                  <span className="journal-symbol-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Real KPIs Grid */}
      <div className="grid-cards-responsive-2col four-cols-desktop">
        <div className="card" id="journal-kpi-net-pnl">
          <div className={`metric ${netPnl >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(netPnl)}
          </div>
          <div className="label">{t('journal_realized_pnl')}</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-win-rate">
          <div className="metric">{winRate.toFixed(1)}%</div>
          <div className="label">{t('journal_win_rate_detail', { wins: winningTrades, losses: losingTrades })}</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-profit-factor">
          <div className="metric">
            {profitFactor === null || profitFactor === undefined ? '∞' : Number(profitFactor).toFixed(2)}
          </div>
          <div className="label">{t('journal_profit_factor')}</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {profitFactor === null ? t('journal_no_loss_trades') : periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-total-trades">
          <div className="metric">{totalTrades}</div>
          <div className="label">{t('journal_total_deals')}</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {periodLabel}
          </div>
        </div>
      </div>

      <JournalAnalytics
        stats={{
          ...activeStats,
          by_weekday: dayBuckets.length > 0 ? dayBuckets : (activeStats?.by_weekday || [])
        }}
        loading={isStatsLoading}
        periodLabel={periodLabel}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
      />


      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', padding: '4px 0 12px' }}>
        {['All', 'Manual', 'EA'].map((f) => (
          <button
            key={f}
            type="button"
            className={`btn ${filter === f ? '' : 'alt'}`}
            style={{ fontSize: '11px', padding: '7px 14px' }}
            onClick={() => setFilter(f)}
          >
            {f === 'All' ? t('journal_filter_all') : f === 'EA' ? t('journal_filter_ea') : t('journal_filter_manual')}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '14px' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('journal_search_ph')}
          style={{
            width: '100%',
            background: '#0b151b',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            padding: '10px 14px',
            borderRadius: '10px',
            outline: 'none',
            fontSize: '12px'
          }}
          id="journal-search-input"
        />
      </div>

      {/* Trade History Table */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen size={16} style={{ color: 'var(--g)' }} />
            <h3>{t('journal_history_title')}</h3>
          </div>
          <span className="tiny">{t('journal_records', { count: filteredTrades.length })}</span>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '440px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0e181e', zIndex: 2 }}>
              <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_ticket')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_symbol')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_direction')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_lot')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_exit')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_source')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_close_time')}</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textAlign: 'right' }}>{t('journal_th_realized')}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrades.map((tradeItem) => {
                const isEa = tradeItem.magic > 0;
                const source = isEa ? 'EA' : 'Manual';
                const closeDateStr = tradeItem.close_time
                  ? new Date(tradeItem.close_time * 1000).toLocaleString(locale, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : '—';

                return (
                  <tr key={tradeItem.ticket} style={{ borderBottom: '1px solid #1c2b33' }}>
                    <td style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '11px', fontFamily: 'monospace' }}>
                      #{tradeItem.ticket}
                    </td>
                    <td style={{ padding: '12px 8px', fontWeight: 800 }}>{tradeItem.symbol}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className={`tag ${tradeItem.type === 'SELL' ? 'red' : ''}`}>
                        {tradeItem.type}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>
                      {tradeItem.volume.toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>
                      {tradeItem.close_price.toFixed(tradeItem.symbol.includes('JPY') ? 3 : tradeItem.symbol.includes('XAU') ? 2 : 5)}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className={`tag ${isEa ? 'blue' : ''}`}>
                        {source}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '11px' }}>
                      {closeDateStr}
                    </td>
                    <td
                      style={{
                        padding: '12px 8px',
                        textAlign: 'right',
                        fontWeight: 800,
                        color: tradeItem.profit >= 0 ? 'var(--g)' : 'var(--red)'
                      }}
                    >
                      {tradeItem.profit >= 0 ? '+' : '−'}${Math.abs(tradeItem.profit).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              {filteredTrades.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '36px 8px', textAlign: 'center', color: 'var(--muted)' }}>
                    <Layers size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#c9d8dc' }}>
                      {isHistoryLoading
                        ? t('journal_loading_history')
                        : activeAccountNumber
                        ? t('journal_empty_account', { account: activeAccountNumber })
                        : t('journal_empty')}
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '4px' }}>
                      {activeAccountNumber
                        ? t('journal_empty_desc_account', { account: activeAccountNumber })
                        : t('journal_empty_desc')}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '12px',
              marginTop: '10px',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              fontSize: '11px',
              color: 'var(--muted)'
            }}
          >
            <span>
              {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredTrades.length)} / {filteredTrades.length}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn alt"
                style={{ padding: '4px 10px', fontSize: '11px', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                &larr;
              </button>
              <span style={{ padding: '0 6px', fontWeight: 700, color: '#e6f1f2' }}>
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="btn alt"
                style={{ padding: '4px 10px', fontSize: '11px', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Real Trading Calendar */}
      <div className="section" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <Calendar size={16} style={{ color: 'var(--g)' }} />
        <span>{t('journal_calendar')}</span>
        <span className="tiny" style={{ textTransform: 'capitalize' }}>{monthName}</span>
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px' }}>
          {['journal_weekday_mon', 'journal_weekday_tue', 'journal_weekday_wed', 'journal_weekday_thu', 'journal_weekday_fri', 'journal_weekday_sat', 'journal_weekday_sun'].map((day, idx) => (
            <div key={idx} className="tiny" style={{ textAlign: 'center', padding: '4px', fontWeight: 700 }}>
              {t(day)}
            </div>
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const dayPnl = dailyPnlMap[d];
            const hasTrades = dayPnl !== undefined;
            const isLoss = hasTrades && dayPnl < 0;
            const isWin = hasTrades && dayPnl > 0;
            const bg = isLoss ? '#48242a' : isWin ? '#164236' : '#142229';
            const color = isLoss ? '#ff9ba5' : isWin ? '#7ce8be' : '#8fa2a8';
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                style={{
                  border: selectedDate === d ? '1px solid var(--g)' : '1px solid #23373f',
                  borderRadius: '8px',
                  padding: '6px 2px',
                  background: bg,
                  color: color,
                  fontSize: '9.5px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  minWidth: 0,
                  overflow: 'hidden'
                }}
              >
                <span>{d}</span>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '8.5px',
                    fontWeight: hasTrades ? 700 : 400
                  }}
                >
                  {hasTrades ? (dayPnl >= 0 ? `+$${dayPnl.toFixed(0)}` : `−$${Math.abs(dayPnl).toFixed(0)}`) : '·'}
                </span>
              </button>
            );
          })}
        </div>
        {selectedDate && (
          <div className="tiny" style={{ marginTop: '12px', color: 'var(--g)' }}>
            {t('journal_day_detail', {
              day: selectedDate,
              month: monthName,
              pnl: dailyPnlMap[selectedDate] !== undefined ? `$${dailyPnlMap[selectedDate].toFixed(2)}` : t('journal_no_closed_trade')
            })}
          </div>
        )}
      </div>
    </div>
  );
}
