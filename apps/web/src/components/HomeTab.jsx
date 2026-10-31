import React, { useState, useEffect, useRef } from 'react';
import {
  DollarSign,
  Activity,
  TrendingUp,
  TrendingDown,
  Layers
} from 'lucide-react';
import { api } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import RichText from './RichText';

const formatCurrency = (val, currency = 'USD') => {
  if (val === null || val === undefined || isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

export default function HomeTab({
  bridgeStatus,
  riskStatus,
  hasConnection = false,
  onNavigateMarket,
  onOpenConnect
}) {
  const { t } = useLanguage();
  const [chartRange, setChartRange] = useState('Month');
  const [equityCurveData, setEquityCurveData] = useState(null);
  const [historyData, setHistoryData] = useState(null);

  // State value stays the API contract ('Day'|'Week'|'Month'); only the label is translated.
  const rangeLabel = chartRange === 'Day'
    ? t('home_range_day')
    : chartRange === 'Week'
      ? t('home_range_week')
      : t('home_range_month');

  const handleRangeChange = (rng) => {
    setChartRange(rng);
    // Instant fetch for the selected range without waiting for polling tick
    api.getEquityCurve(rng).then((curve) => {
      if (curve) setEquityCurveData(curve);
    }).catch(() => {});
  };

  const metrics = bridgeStatus?.metrics || {};
  const isConnected = bridgeStatus?.is_connected || false;
  const currency = metrics.currency || 'USD';
  const balance = metrics.balance ?? 0;
  const equity = metrics.equity ?? 0;
  const positions = bridgeStatus?.positions || metrics.positions || [];
  const openPositionsCount = positions.length > 0 ? positions.length : (metrics.open_positions ?? 0);
  const calculatedFloatingPnl = positions.reduce((acc, p) => acc + (p.pnl !== undefined ? p.pnl : (p.profit ?? 0)), 0);
  const floatingPnl = positions.length > 0 ? calculatedFloatingPnl : (metrics.floating_pnl ?? 0);
  const marketQuotes = bridgeStatus?.market_quotes || [];

  // Active account number tracking for instant automatic synchronization
  const currentAccountNumber = metrics.account_number || null;
  const prevAccountNumberRef = useRef(currentAccountNumber);
  const fetchInFlightRef = useRef(false);

  // Initial Balance Benchmark & All-Time Performance Calculations
  const initialDeposit = bridgeStatus?.initial_deposit ?? metrics.initial_deposit ?? balance;
  const isDepositOverridden = bridgeStatus?.is_deposit_overridden ?? false;
  const settledPnl = bridgeStatus?.settled_pnl !== undefined && bridgeStatus?.settled_pnl !== null
    ? bridgeStatus.settled_pnl
    : (balance - initialDeposit);
  const settledPnlPercent = bridgeStatus?.settled_pnl_percent !== undefined && bridgeStatus?.settled_pnl_percent !== null
    ? bridgeStatus.settled_pnl_percent
    : (initialDeposit > 0 ? ((balance - initialDeposit) / initialDeposit) * 100 : 0);
  const allTimePnl = bridgeStatus?.all_time_pnl !== undefined && bridgeStatus?.all_time_pnl !== null
    ? bridgeStatus.all_time_pnl
    : (equity - initialDeposit);
  const allTimePnlPercent = bridgeStatus?.all_time_pnl_percent !== undefined && bridgeStatus?.all_time_pnl_percent !== null
    ? bridgeStatus.all_time_pnl_percent
    : (initialDeposit > 0 ? ((equity - initialDeposit) / initialDeposit) * 100 : 0);

  // 100% Automatic Sync: Immediately clear old account curve and history when MT5 account switches
  useEffect(() => {
    if (currentAccountNumber && prevAccountNumberRef.current && prevAccountNumberRef.current !== currentAccountNumber) {
      setEquityCurveData(null);
      setHistoryData(null);
    }
    prevAccountNumberRef.current = currentAccountNumber;
  }, [currentAccountNumber]);

  // Reactive automatic data fetch for active account
  useEffect(() => {
    if (!hasConnection || !isConnected) return;

    let isMounted = true;
    const fetchData = async () => {
      if (document.hidden || fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      try {
        const [curve, history] = await Promise.all([
          api.getEquityCurve(chartRange).catch(() => null),
          api.getTradeHistory().catch(() => null)
        ]);
        if (!isMounted) return;
        // Verify account number to prevent race conditions or cross-account data bleeding
        if (curve) {
          if (!currentAccountNumber || !curve.account_number || curve.account_number === currentAccountNumber) {
            setEquityCurveData(curve);
          }
        }
        if (history) {
          if (!currentAccountNumber || !history.account_number || history.account_number === currentAccountNumber) {
            setHistoryData(history);
          }
        }
      } catch {
        // Ignore transient error
      } finally {
        fetchInFlightRef.current = false;
      }
    };

    fetchData();

    // Auto-sync polling every 5s to keep performance curve up to date
    const syncInterval = setInterval(() => {
      if (isMounted) fetchData();
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(syncInterval);
    };
  }, [hasConnection, isConnected, currentAccountNumber, chartRange, bridgeStatus?.closed_trades_count]);

  return (
    <div className="home-tab-container animate-fade-in">
      {/* Heading */}
      <div className="heading">
        <div>
          <div className="eyebrow">{t('home_eyebrow')}</div>
          <h1>{t('home_greeting')}</h1>
          <div className="sub">{t('home_banner_sub')}</div>
        </div>
      </div>

      {/* First-run connection prompt */}
      {!hasConnection && (
        <div
          className="card"
          style={{
            marginBottom: '16px',
            border: '1px solid rgba(69, 224, 173, 0.35)',
            background: 'rgba(69, 224, 173, 0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: '13px' }}>{t('home_no_account_title')}</div>
            <div className="sub" style={{ fontSize: '11.5px' }}>
              <RichText text={t('home_no_account_desc')} />
            </div>
          </div>
          {onOpenConnect && (
            <button type="button" className="btn" onClick={onOpenConnect} id="home-connect-mt5-btn">
              {t('home_connect_mt5')}
            </button>
          )}
        </div>
      )}

      {/* KPIs Grid */}
      <div className="grid kpis">
        {/* Total Balance Card with Initial Deposit & Settled P/L */}
        <div className="card" id="home-kpi-balance">
          <div className="cardhead">
            <span className="label">{t('home_kpi_balance')}</span>
            <span className="icon-box">
              <DollarSign size={16} />
            </span>
          </div>
          <div className="metric">{formatCurrency(balance, currency)}</div>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
            <div style={{ color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('home_initial_balance')}</span>
              <span style={{ fontWeight: 600, color: '#e6f1f2' }}>
                {formatCurrency(initialDeposit, currency)}
                <small style={{ marginLeft: '4px', fontSize: '9px', color: isDepositOverridden ? 'var(--amber)' : 'var(--muted)' }}>
                  {isDepositOverridden ? t('home_manual') : t('home_from_mt5')}
                </small>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span style={{ color: 'var(--muted)' }}>{t('home_all_time_pl')}</span>
              <span style={{ color: settledPnl >= 0 ? 'var(--g)' : 'var(--red)' }}>
                {settledPnl >= 0 ? '+' : ''}{formatCurrency(settledPnl, currency)} ({settledPnlPercent >= 0 ? '+' : ''}{settledPnlPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Account Equity Card with Real-time P/L vs Deposit & Floating Risk */}
        <div className="card" id="home-kpi-equity">
          <div className="cardhead">
            <span className="label">{t('home_kpi_equity')}</span>
            <span className="icon-box">
              <Activity size={16} />
            </span>
          </div>
          <div className="metric">{formatCurrency(equity, currency)}</div>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span style={{ color: 'var(--muted)' }}>{t('home_realized_vs_initial')}</span>
              <span style={{ color: allTimePnl >= 0 ? 'var(--g)' : 'var(--red)' }}>
                {allTimePnl >= 0 ? '+' : ''}{formatCurrency(allTimePnl, currency)} ({allTimePnlPercent >= 0 ? '+' : ''}{allTimePnlPercent.toFixed(1)}%)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
              <span style={{ color: 'var(--muted)' }}>{t('home_floating_risk')}</span>
              <span style={{ color: floatingPnl >= 0 ? 'var(--g)' : 'var(--red)', fontWeight: 600 }}>
                {floatingPnl >= 0 ? '+' : ''}{formatCurrency(floatingPnl, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Floating P/L */}
        <div className="card" id="home-kpi-today-pnl">
          <div className="cardhead">
            <span className="label">{t('home_kpi_floating_pnl')}</span>
            <span className="icon-box">
              {floatingPnl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            </span>
          </div>
          <div className={`metric ${floatingPnl >= 0 ? 'positive' : 'negative'}`}>
            {floatingPnl >= 0 ? '+' : ''}{formatCurrency(floatingPnl, currency)}
          </div>
          <div className="delta">
            {openPositionsCount > 0 ? t('home_active_position_count', { count: openPositionsCount }) : t('home_zero_risk')}
          </div>
        </div>

        {/* Open Positions */}
        <div className="card" id="home-kpi-positions">
          <div className="cardhead">
            <span className="label">{t('home_kpi_positions')}</span>
            <span className="icon-box">
              <Layers size={16} />
            </span>
          </div>
          <div className="metric">
            {openPositionsCount.toString().padStart(2, '0')}{' '}
            <span className="sub" style={{ fontSize: '12px' }}>{t('home_position_unit')}</span>
          </div>
          <div className="delta" style={{ color: isConnected ? 'var(--g)' : 'var(--red)' }}>
            {isConnected ? t('home_bridge_synced') : t('home_bridge_offline')}
          </div>
        </div>
      </div>

      {/* Grid Two (Side-by-Side Above Fold): Account Performance (Kiri) & Active Trades (Kanan) */}
      <div className="grid two" style={{ marginBottom: '20px', alignItems: 'stretch' }}>
        {/* Real Performance Chart (Kolom Kiri) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div className="cardhead">
            <div>
              <h3>{t('home_performance_title')}</h3>
              <div className="tiny">{t('home_performance_sub', { range: rangeLabel })}</div>
            </div>
            <div style={{ display: 'flex', gap: '3px', background: '#0a1419', padding: '3px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              {['Day', 'Week', 'Month'].map((rng) => (
                <button
                  key={rng}
                  type="button"
                  style={{
                    border: 0,
                    background: chartRange === rng ? '#205342' : 'transparent',
                    color: chartRange === rng ? '#b8ffe6' : 'var(--muted)',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '5px 9px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                  onClick={() => handleRangeChange(rng)}
                  id={`chart-filter-${rng.toLowerCase()}-btn`}
                >
                  {t(`home_range_${rng.toLowerCase()}`)}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const isCurveActive = Boolean(
              equityCurveData &&
              (!currentAccountNumber || !equityCurveData.account_number || equityCurveData.account_number === currentAccountNumber)
            );
            const activeCurve = isCurveActive ? equityCurveData : null;
            const startVal = activeCurve?.starting_equity ?? activeCurve?.initial_deposit ?? initialDeposit;
            const currentVal = activeCurve?.current_equity ?? equity;
            const netVal = currentVal - startVal;
            const isNetPositive = netVal >= 0;
            const strokeColor = isNetPositive ? '#45e0ad' : '#ff5b6b';
            const gradientId = isNetPositive ? 'pipstride-area-pos' : 'pipstride-area-neg';

            // Build points: prefer activeCurve points, fallback to reconstructed curve from historyData and initialDeposit
            let points = activeCurve?.points || [];
            if (points.length === 0 && historyData?.trades && historyData.trades.length > 0) {
              let run = startVal;
              const sorted = [...historyData.trades].sort((a, b) => (a.close_time || 0) - (b.close_time || 0));
              points = [
                { timestamp: (sorted[0].close_time || 0) - 300, equity: startVal, balance: startVal },
                ...sorted.map((t) => {
                  run = Math.round((run + (t.profit || 0)) * 100) / 100;
                  return { timestamp: t.close_time || 0, equity: run, balance: run };
                }),
                { timestamp: Math.floor(Date.now() / 1000), equity: currentVal, balance: balance }
              ];
            }

            let pathD = '';
            let areaD = '';

            if (points.length >= 2) {
              const equities = points.map((p) => p.equity);
              let minEq = Math.min(startVal, ...equities);
              let maxEq = Math.max(startVal, ...equities);
              if (maxEq - minEq < 1.0) {
                maxEq += 5.0;
                minEq -= 5.0;
              }
              const pad = Math.max((maxEq - minEq) * 0.08, 2.0);
              const yMin = minEq - pad;
              const yMax = maxEq + pad;

              const coords = points.map((p, idx) => {
                const x = Math.round((idx / (points.length - 1)) * 600);
                const y = Math.round(155 - ((p.equity - yMin) / (yMax - yMin)) * 120);
                return `${x},${y}`;
              });
              pathD = `M ${coords.join(' L ')}`;
              areaD = `${pathD} L 600,180 L 0,180 Z`;
            } else {
              // Steady baseline at initial deposit to current equity
              pathD = 'M 0,120 L 600,75';
              areaD = 'M 0,120 L 600,75 L 600,180 L 0,180 Z';
            }

            return (
              <>
                <svg className="chart" viewBox="0 0 600 180" preserveAspectRatio="none" style={{ width: '100%', height: '175px', display: 'block', margin: '4px 0' }}>
                  <defs>
                    <linearGradient id="pipstride-area-pos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#45e0ad" stopOpacity="0.30" />
                      <stop offset="1" stopColor="#45e0ad" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="pipstride-area-neg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#ff5b6b" stopOpacity="0.30" />
                      <stop offset="1" stopColor="#ff5b6b" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <g stroke="#1e343d" strokeDasharray="4 7">
                    <path d="M0 35H600M0 75H600M0 115H600M0 155H600" />
                  </g>
                  <path d={areaD} fill={`url(#${gradientId})`} />
                  <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />
                </svg>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '9.5px', marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
                  <span>{t('home_curve_start', { range: rangeLabel })} {formatCurrency(startVal, currency)}</span>
                  <span>{t('home_equity_real')} {formatCurrency(currentVal, currency)}</span>
                  <span style={{ fontWeight: 700, color: isNetPositive ? 'var(--g)' : 'var(--red)' }}>
                    {t('home_net')} {isNetPositive ? '+' : ''}{formatCurrency(netVal, currency)}
                  </span>
                </div>
              </>
            );
          })()}
        </div>

        {/* Active Trades Card (Kolom Kanan) - Langsung terlihat tanpa scroll */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="cardhead">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={16} style={{ color: 'var(--g)' }} />
              <div>
                <h3 style={{ margin: 0, fontSize: '13px' }}>{t('home_active_trades')}</h3>
                <div className="tiny">{t('home_running_on_mt5', { count: positions.length })}</div>
              </div>
            </div>
            <span className="tag" style={{ fontSize: '9px', background: 'rgba(69, 224, 173, 0.1)', color: 'var(--g)' }}>
              {t('home_full_auto')}
            </span>
          </div>

          <div style={{ flex: 1, maxHeight: '215px', overflowY: 'auto', paddingRight: '4px' }}>
            {positions.length > 0 ? (
              positions.map((pos) => {
                const isBuy = String(pos.type || '').toUpperCase() === 'BUY' || pos.type === 0;
                const profit = pos.pnl !== undefined ? pos.pnl : (pos.profit ?? 0);
                return (
                  <div key={pos.ticket} className="row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="coin" style={{ fontSize: '11px', width: '30px', height: '30px' }}>
                      {pos.symbol?.slice(0, 2).toUpperCase() || 'FX'}
                    </div>
                    <div className="grow">
                      <div className="rowtitle" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <span>{pos.symbol}</span>
                        <span className={`tag ${!isBuy ? 'red' : ''}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                          {isBuy ? 'BUY' : 'SELL'}
                        </span>
                        <span className="tiny" style={{ color: 'var(--muted)', fontSize: '10px' }}>
                          #{pos.ticket}
                        </span>
                      </div>
                      <div className="rowsub" style={{ fontSize: '10.5px' }}>
                        {pos.volume} lot · Entry @ {pos.open_price}
                        {pos.current_price ? ` · Now ${pos.current_price}` : ''}
                      </div>
                    </div>
                    <div className="end" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: profit >= 0 ? 'var(--g)' : 'var(--red)', fontWeight: 800, fontSize: '12px' }}>
                          {profit >= 0 ? '+' : ''}{formatCurrency(profit, currency)}
                        </div>
                        <small style={{ fontSize: '9px', color: 'var(--muted)' }}>{t('home_floating')}</small>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: '12px', marginBottom: '8px' }}>{t('home_no_positions_title')}</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{t('home_no_positions_desc')}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Real Live Market Brief Card (Pindah ke Bawah Grid Two) */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={16} style={{ color: 'var(--cyan)' }} />
            <h3 style={{ margin: 0, fontSize: '13px' }}>{t('home_live_feed')}</h3>
            <span className="tag blue" style={{ fontSize: '9px' }}>{t('home_mt5_telemetry')}</span>
          </div>
          {onNavigateMarket && (
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={onNavigateMarket}
              id="home-open-market-btn"
            >
              <span>{t('home_overview_all', { count: marketQuotes.length })}</span>
            </button>
          )}
        </div>

        {marketQuotes.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '10px' }}>
            {marketQuotes.slice(0, 4).map((q) => {
              const isPos = q.daily_change_pct >= 0;
              const isCrypto = q.symbol.includes('BTC');
              const isGold = q.symbol.includes('XAU');
              const icon = isCrypto ? '₿' : isGold ? 'Au' : q.symbol.slice(0, 2);
              const priceStr = q.bid > 0 ? (isCrypto || isGold ? `$${q.bid.toFixed(q.digits)}` : q.bid.toFixed(q.digits)) : '—';

              return (
                <div key={q.symbol} style={{ background: '#0a1419', border: '1px solid var(--line)', borderRadius: '10px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="coin" style={{ fontSize: '11px', width: '32px', height: '32px' }}>{icon}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: '12px' }}>{q.symbol}</div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{t('home_spread_pts', { spread: q.spread })}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', fontFamily: 'monospace' }}>{priceStr}</div>
                    <small className={isPos ? 'positive' : 'negative'} style={{ fontSize: '10px', fontWeight: 600 }}>
                      {isPos ? '+' : ''}{q.daily_change_pct.toFixed(2)}%
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            {t('market_waiting_feed')}
          </div>
        )}
      </div>

      {/* Performance Snapshot */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('home_snapshot')}
      </div>
      {(() => {
        const isHistoryActive = Boolean(
          historyData &&
          (!currentAccountNumber || !historyData.account_number || historyData.account_number === currentAccountNumber)
        );
        const activeHistory = isHistoryActive ? historyData : null;

        return (
          <div className="grid three">
            <div className="card">
              <div className="metric">
                {activeHistory && activeHistory.total_trades > 0
                  ? `${activeHistory.win_rate.toFixed(1)}%`
                  : '0.0%'}
              </div>
              <div className="label">{t('home_win_rate')}</div>
              <div className="tiny">
                {activeHistory && activeHistory.total_trades > 0
                  ? t('home_trades_breakdown', { total: activeHistory.total_trades, wins: activeHistory.winning_trades, losses: activeHistory.losing_trades })
                  : t('home_no_trades_yet')}
              </div>
            </div>
            <div className="card">
              <div className="metric">
                {activeHistory && activeHistory.total_trades > 0
                  ? (activeHistory.profit_factor > 0 ? activeHistory.profit_factor.toFixed(2) : (activeHistory.gross_loss === 0 ? '∞' : '0.00'))
                  : '0.00'}
              </div>
              <div className="label">{t('journal_profit_factor')}</div>
              <div className="tiny">
                {activeHistory && activeHistory.total_trades > 0
                  ? `${t('home_gross')} +$${activeHistory.gross_profit?.toFixed(2) ?? '0.00'} / -$${activeHistory.gross_loss?.toFixed(2) ?? '0.00'}`
                  : t('home_gross_ratio')}
              </div>
            </div>
            <div className="card">
              {(() => {
                const ddPct = riskStatus?.daily_drawdown_percent ?? (
                  balance > 0 && equity < balance ? ((balance - equity) / balance) * 100 : 0
                );
                const isNegative = ddPct > 0;
                return (
                  <>
                    <div className={`metric ${isNegative ? 'negative' : ''}`}>
                      {isNegative ? `−${ddPct.toFixed(2)}%` : '0.0%'}
                    </div>
                    <div className="label">{t('home_daily_dd')}</div>
                    <div className="tiny" style={{ color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' }}>
                      {t('home_daily_dd_desc', { pct: ddPct.toFixed(2) })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
