import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Calendar, ArrowUpRight, RefreshCw, Layers } from 'lucide-react';
import { api } from '../services/api';
import JournalAnalytics from './JournalAnalytics';

const PERIODS = [
  { value: '1M', label: '1 Bulan' },
  { value: '3M', label: '3 Bulan' },
  { value: '1Y', label: '1 Tahun' },
  { value: 'ALL', label: 'Semua' }
];

const PERIOD_LABELS = { '1M': '30 hari terakhir', '3M': '90 hari terakhir', '1Y': '1 tahun terakhir', ALL: 'semua waktu' };

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

  const trades = historyData?.trades || [];
  const totals = stats?.totals;
  const netPnl = totals?.net_profit ?? historyData?.net_pnl ?? 0;
  const winRate = totals?.win_rate ?? historyData?.win_rate ?? 0;
  const profitFactor = totals ? totals.profit_factor : historyData?.profit_factor;
  const totalTrades = totals?.trades ?? historyData?.total_trades ?? 0;
  const winningTrades = totals?.wins ?? historyData?.winning_trades ?? 0;
  const losingTrades = totals?.losses ?? historyData?.losing_trades ?? 0;
  const periodLabel = PERIOD_LABELS[period];

  const filteredTrades = trades.filter((t) => {
    const isEa = t.magic > 0;
    const source = isEa ? 'EA' : 'Manual';
    const matchesFilter = filter === 'All' || source === filter;
    const matchesSearch =
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      source.toLowerCase().includes(search.toLowerCase()) ||
      String(t.ticket).includes(search);
    return matchesFilter && matchesSearch;
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

  // Group real trades by day of current month for calendar
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date());

  const dailyPnlMap = {};
  trades.forEach((t) => {
    if (t.close_time) {
      const d = new Date(t.close_time * 1000);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const dayNum = d.getDate();
        dailyPnlMap[dayNum] = (dailyPnlMap[dayNum] || 0) + t.profit;
      }
    }
  });

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

      {/* Period selector drives every statistic below */}
      <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span className="tiny" style={{ color: 'var(--muted)', fontWeight: 600, marginRight: '2px' }}>
          PERIODE
        </span>
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`btn ${period === option.value ? '' : 'alt'}`}
            style={{ fontSize: '11px', padding: '6px 13px' }}
            onClick={() => setPeriod(option.value)}
            id={`journal-period-${option.value.toLowerCase()}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Real KPIs Grid */}
      <div className="grid kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
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

      <JournalAnalytics stats={stats} loading={statsLoading} periodLabel={periodLabel} />


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
        <span className="tiny">{monthName} {currentYear}</span>
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
