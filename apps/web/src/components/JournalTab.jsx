import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BookOpen,
  Calendar,
  ArrowUpRight,
  RefreshCw,
  Layers,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { api } from '../services/api';
import JournalAnalytics from './JournalAnalytics';

const PERIODS = [
  { value: '1M', label: '30 Hari' },
  { value: '3M', label: '90 Hari' },
  { value: '1Y', label: '1 Tahun' },
  { value: 'ALL', label: 'Semua' },
  { value: 'MONTH', label: 'Per Bulan' }
];

const PERIOD_LABELS = {
  '1M': '30 hari terakhir',
  '3M': '90 hari terakhir',
  '1Y': '1 tahun terakhir',
  ALL: 'semua waktu',
  MONTH: 'pilihan bulan'
};

const CURRENT_YEAR = new Date().getFullYear();

const formatCurrency = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '$0.00';
  const prefix = val >= 0 ? '+' : '−';
  return `${prefix}$${Math.abs(val).toFixed(2)}`;
};

export default function JournalTab({ activeTab, closedTradesCount, onNavigateAI, bridgeStatus }) {
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState('1M');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const activeAccountNumber = bridgeStatus?.metrics?.account_number || null;
  const activeServer = bridgeStatus?.metrics?.server || null;
  const isConnected = bridgeStatus?.is_connected ?? false;
  const prevAccountRef = useRef(activeAccountNumber);

  const initialDeposit = bridgeStatus?.initial_deposit ?? bridgeStatus?.metrics?.initial_deposit ?? null;
  const isDepositOverridden = bridgeStatus?.is_deposit_overridden ?? false;
  const equity = bridgeStatus?.metrics?.equity ?? null;
  const allTimePnl = bridgeStatus?.all_time_pnl !== undefined && bridgeStatus?.all_time_pnl !== null
    ? bridgeStatus.all_time_pnl
    : (equity !== null && initialDeposit !== null ? equity - initialDeposit : null);
  const allTimePnlPercent = bridgeStatus?.all_time_pnl_percent !== undefined && bridgeStatus?.all_time_pnl_percent !== null
    ? bridgeStatus.all_time_pnl_percent
    : (initialDeposit > 0 && allTimePnl !== null ? (allTimePnl / initialDeposit) * 100 : null);

  const fetchHistory = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.getTradeHistory();
      // Ensure incoming history belongs to currently connected MT5 account
      if (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber) {
        setHistoryData(data);
      }
    } catch (err) {
      console.error('Failed to load trade history:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const statsSource = filter === 'EA' ? 'ea' : filter === 'Manual' ? 'manual' : 'all';

  const fetchStats = async () => {
    if (period === 'MONTH') {
      setStatsLoading(false);
      return;
    }
    try {
      const data = await api.getJournalStats(period, statsSource);
      // Same guard as history: never show stats from another MT5 account.
      if (!activeAccountNumber || !data?.account_number || data.account_number === activeAccountNumber) {
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load journal statistics:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // 100% Automatic Sync: Immediately wipe previous account history when switching MT5 account
  useEffect(() => {
    if (activeAccountNumber && prevAccountRef.current && prevAccountRef.current !== activeAccountNumber) {
      setHistoryData(null);
      setStats(null);
      setLoading(true);
      setStatsLoading(true);
      fetchHistory();
      fetchStats();
    }
    prevAccountRef.current = activeAccountNumber;
  }, [activeAccountNumber]);

  // Stats follow the selected period, source filter, and incoming trade count.
  useEffect(() => {
    if (activeTab === 'journal' || !activeTab) {
      setStatsLoading(true);
      fetchStats();
    }
  }, [activeTab, period, statsSource, closedTradesCount, activeAccountNumber]);

  // Journal aggregates are heavier than the trade list, so refresh them slower.
  useEffect(() => {
    if (activeTab !== 'journal') return;
    const timer = setInterval(() => {
      fetchStats();
    }, 15000);
    return () => clearInterval(timer);
  }, [activeTab, period, statsSource, activeAccountNumber]);

  // Immediate reactive fetch when Journal tab becomes active or closed trades change
  useEffect(() => {
    if (activeTab === 'journal' || !activeTab) {
      fetchHistory();
    }
  }, [activeTab, closedTradesCount]);

  // Periodic real-time background sync while actively viewing Journal tab
  useEffect(() => {
    if (activeTab !== 'journal') return;
    const timer = setInterval(() => {
      fetchHistory();
    }, 4000);
    return () => clearInterval(timer);
  }, [activeTab, activeAccountNumber]);

  const handleRefresh = () => {
    fetchHistory(true);
    fetchStats();
  };

  const { selectedYear, selectedMonthIndex, daysInMonth, monthName } = useMemo(() => {
    const parts = (selectedMonth || '').split('-');
    const year = parseInt(parts[0], 10) || CURRENT_YEAR;
    const monthIdx = (parseInt(parts[1], 10) || 1) - 1;
    const days = new Date(year, monthIdx + 1, 0).getDate();
    const name = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(year, monthIdx, 1));
    return { selectedYear: year, selectedMonthIndex: monthIdx, daysInMonth: days, monthName: name };
  }, [selectedMonth]);

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

  const dailyPnlMap = useMemo(() => {
    const map = {};
    trades.forEach((t) => {
      if (t.close_time) {
        const d = new Date(t.close_time * 1000);
        if (d.getMonth() === selectedMonthIndex && d.getFullYear() === selectedYear) {
          const dayNum = d.getDate();
          map[dayNum] = (map[dayNum] || 0) + t.profit;
        }
      }
    });
    return map;
  }, [trades, selectedMonthIndex, selectedYear]);

  const monthTrades = useMemo(() => {
    return trades.filter((t) => {
      if (!t.close_time) return false;
      const d = new Date(t.close_time * 1000);
      const inMonth = d.getMonth() === selectedMonthIndex && d.getFullYear() === selectedYear;
      if (!inMonth) return false;
      const isEa = t.magic > 0;
      const source = isEa ? 'EA' : 'Manual';
      return filter === 'All' || source === filter;
    });
  }, [trades, selectedMonthIndex, selectedYear, filter]);

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
  const netPnl = totals?.net_profit ?? (period === 'MONTH' ? 0 : (historyData?.net_pnl ?? 0));
  const winRate = totals?.win_rate ?? (period === 'MONTH' ? 0 : (historyData?.win_rate ?? 0));
  const profitFactor = totals ? totals.profit_factor : (period === 'MONTH' ? null : historyData?.profit_factor);
  const totalTrades = totals?.trades ?? (period === 'MONTH' ? 0 : (historyData?.total_trades ?? 0));
  const winningTrades = totals?.wins ?? (period === 'MONTH' ? 0 : (historyData?.winning_trades ?? 0));
  const losingTrades = totals?.losses ?? (period === 'MONTH' ? 0 : (historyData?.losing_trades ?? 0));
  const periodLabel = period === 'MONTH' ? `Bulan ${monthName}` : PERIOD_LABELS[period];

  const filteredTrades = trades.filter((t) => {
    const isEa = t.magic > 0;
    const source = isEa ? 'EA' : 'Manual';
    const matchesFilter = filter === 'All' || source === filter;
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
    return matchesFilter && matchesSearch && matchesMonth;
  });

  const handleExportCSV = () => {
    if (trades.length === 0) {
      alert('Belum ada riwayat transaksi MT5 untuk diekspor.');
      return;
    }

    const headers = ['Ticket', 'Symbol', 'Type', 'Volume', 'Open Price', 'Close Price', 'Net PnL', 'Close Time', 'Magic'];
    const rows = trades.map((t) => [
      t.ticket,
      t.symbol,
      t.type,
      t.volume,
      t.open_price,
      t.close_price,
      t.profit,
      new Date(t.close_time * 1000).toISOString(),
      t.magic
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `MT5_Trade_Journal_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="journal-tab-container animate-fade-in">
      <div className="heading">
        <div>
          <div className="eyebrow">MT5 REAL TRADING JOURNAL</div>
          <h1>Trading Journal</h1>
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>Riwayat transaksi objektif tersinkronisasi langsung dari akun MetaTrader 5.</span>
            {activeAccountNumber ? (
              <span
                style={{
                  background: isConnected ? 'rgba(7, 188, 12, 0.12)' : 'rgba(235, 87, 87, 0.12)',
                  color: isConnected ? 'var(--g)' : 'var(--red)',
                  border: `1px solid ${isConnected ? 'rgba(7, 188, 12, 0.3)' : 'rgba(235, 87, 87, 0.3)'}`,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
                id="journal-active-account-badge"
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isConnected ? 'var(--g)' : 'var(--red)',
                    display: 'inline-block'
                  }}
                />
                Akun #{activeAccountNumber} {activeServer ? `(${activeServer})` : ''}
              </span>
            ) : (
              <span
                style={{
                  background: 'rgba(255, 184, 0, 0.12)',
                  color: '#ffb800',
                  border: '1px solid rgba(255, 184, 0, 0.3)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600
                }}
                id="journal-standby-badge"
              >
                MT5 Standby (Belum Terhubung)
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '8px',
              background: '#0a1419',
              border: '1px solid var(--line)',
              fontSize: '11px',
              color: 'var(--muted)'
            }}
            id="journal-autosync-indicator"
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isConnected ? '#45e0ad' : '#ff5b6b',
                boxShadow: isConnected ? '0 0 8px #45e0ad' : 'none'
              }}
            />
            <span style={{ color: '#c9d8dc', fontWeight: 600 }}>Otomatis Sinkron</span>
          </div>
          <button
            type="button"
            className="btn alt"
            onClick={handleRefresh}
            title="Refresh dan Sinkronkan Riwayat MT5"
            id="journal-refresh-btn"
            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span className="desktop-only-inline">Refresh</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleExportCSV}
            id="journal-export-btn"
            style={{ padding: '8px 14px' }}
          >
            <ArrowUpRight size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Segmented Period Filter Bar with Month Stepper */}
      <div className="journal-period-bar">
        <div className="journal-period-segmented" role="tablist" aria-label="Filter Periode Jurnal">
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
                <span>{option.label}</span>
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
              title="Bulan sebelumnya"
              id="journal-prev-month-btn"
            >
              <ChevronLeft size={15} />
            </button>

            <div className="journal-month-display" title="Klik untuk pilih bulan spesifik">
              <Calendar size={13} style={{ color: 'var(--g)' }} />
              <span style={{ textTransform: 'capitalize' }}>{monthName}</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedMonth(e.target.value);
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
              title="Bulan berikutnya"
              id="journal-next-month-btn"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Real KPIs Grid */}
      <div className="grid-cards-responsive-2col five-cols-desktop">
        <div className="card" id="journal-kpi-net-pnl">
          <div className={`metric ${netPnl >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(netPnl)}
          </div>
          <div className="label">Realized Closed P/L</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-deposit-return">
          <div className={`metric ${(allTimePnl ?? netPnl) >= 0 ? 'positive' : 'negative'}`}>
            {allTimePnl !== null ? `${allTimePnl >= 0 ? '+' : '−'}$${Math.abs(allTimePnl).toFixed(2)}` : formatCurrency(netPnl)}
          </div>
          <div className="label">
            All-Time Growth {allTimePnlPercent !== null ? `(${allTimePnlPercent >= 0 ? '+' : ''}${allTimePnlPercent.toFixed(1)}%)` : ''}
          </div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {initialDeposit ? `Saldo Awal: $${initialDeposit.toFixed(2)} ${isDepositOverridden ? '(Manual)' : '(MT5)'}` : 'Baseline saldo MT5'}
          </div>
        </div>
        <div className="card" id="journal-kpi-win-rate">
          <div className="metric">{winRate.toFixed(1)}%</div>
          <div className="label">Win Rate ({winningTrades}W / {losingTrades}L)</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-profit-factor">
          <div className="metric">
            {profitFactor === null || profitFactor === undefined ? '∞' : Number(profitFactor).toFixed(2)}
          </div>
          <div className="label">Profit Factor</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {profitFactor === null ? 'tanpa trade loss' : periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-total-trades">
          <div className="metric">{totalTrades}</div>
          <div className="label">Total Closed Deals</div>
          <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
            {periodLabel}
          </div>
        </div>
      </div>

      <JournalAnalytics stats={activeStats} loading={statsLoading} periodLabel={periodLabel} />


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
            {f === 'All' ? 'Semua Transaksi' : f === 'EA' ? 'Robot / EA' : 'Manual Trader'}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '14px' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari simbol, ticket, atau sumber (cth: XAUUSD, EA, #12345)..."
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
            <h3>Riwayat Transaksi Real MT5</h3>
          </div>
          <span className="tiny">{filteredTrades.length} records</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>TICKET</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>INSTRUMEN</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>ARAH</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>LOT</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>HARGA EXIT</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>SUMBER</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>WAKTU TUTUP</th>
                <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textAlign: 'right' }}>REALIZED P/L</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t) => {
                const isEa = t.magic > 0;
                const source = isEa ? 'EA' : 'Manual';
                const closeDateStr = t.close_time
                  ? new Date(t.close_time * 1000).toLocaleString('id-ID', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : '—';

                return (
                  <tr key={t.ticket} style={{ borderBottom: '1px solid #1c2b33' }}>
                    <td style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '11px', fontFamily: 'monospace' }}>
                      #{t.ticket}
                    </td>
                    <td style={{ padding: '12px 8px', fontWeight: 800 }}>{t.symbol}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className={`tag ${t.type === 'SELL' ? 'red' : ''}`}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>
                      {t.volume.toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>
                      {t.close_price.toFixed(t.symbol.includes('JPY') ? 3 : t.symbol.includes('XAU') ? 2 : 5)}
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
                        color: t.profit >= 0 ? 'var(--g)' : 'var(--red)'
                      }}
                    >
                      {t.profit >= 0 ? '+' : '−'}${Math.abs(t.profit).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              {filteredTrades.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '36px 8px', textAlign: 'center', color: 'var(--muted)' }}>
                    <Layers size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#c9d8dc' }}>
                      {loading
                        ? 'Memuat riwayat transaksi dari MT5...'
                        : activeAccountNumber
                        ? `Belum Ada Transaksi Tertutup di Akun #${activeAccountNumber}`
                        : 'Belum Ada Transaksi Tertutup'}
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '4px' }}>
                      {activeAccountNumber
                        ? `Akun MT5 #${activeAccountNumber} aktif terhubung. Transaksi deals tertutup dari akun ini akan otomatis tercatat di sini.`
                        : 'Transaksi yang dieksekusi dan ditutup pada MetaTrader 5 akan otomatis tersinkronisasi di sini secara real-time.'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real Trading Calendar */}
      <div className="section" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <Calendar size={16} style={{ color: 'var(--g)' }} />
        <span>Trading Calendar</span>
        <span className="tiny" style={{ textTransform: 'capitalize' }}>{monthName}</span>
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px' }}>
          {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day, idx) => (
            <div key={idx} className="tiny" style={{ textAlign: 'center', padding: '4px', fontWeight: 700 }}>
              {day}
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
                  padding: '7px 2px',
                  background: bg,
                  color: color,
                  fontSize: '9.5px',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                {d}
                <br />
                {hasTrades ? (dayPnl >= 0 ? `+$${dayPnl.toFixed(0)}` : `−$${Math.abs(dayPnl).toFixed(0)}`) : '·'}
              </button>
            );
          })}
        </div>
        {selectedDate && (
          <div className="tiny" style={{ marginTop: '12px', color: 'var(--g)' }}>
            Tanggal {selectedDate} {monthName}: Realized P/L {dailyPnlMap[selectedDate] !== undefined ? `$${dailyPnlMap[selectedDate].toFixed(2)}` : '$0.00 (tidak ada closed trade)'}.
          </div>
        )}
      </div>

      {/* AI Pattern Review Card */}
      <div className="card">
        <div className="eyebrow">OBJECTIVE PERFORMANCE AUDIT</div>
        <h3 style={{ margin: '8px 0', fontSize: '14px' }}>Real-time Risk & Discipline Tracking</h3>
        <p className="sub" style={{ lineHeight: 1.5 }}>
          Jurnal ini merefleksikan seluruh transaksi akun MT5 secara langsung tanpa interpolasi atau data buatan.
          Gunakan metrik Win Rate dan Profit Factor untuk mengevaluasi konsistensi eksekusi sebelum meningkatkan ukuran lot.
        </p>
        {onNavigateAI && (
          <button
            type="button"
            className="btn alt"
            style={{ marginTop: '12px' }}
            onClick={onNavigateAI}
            id="journal-ai-coach-btn"
          >
            Review Strategi dengan AI Coach →
          </button>
        )}
      </div>
    </div>
  );
}
