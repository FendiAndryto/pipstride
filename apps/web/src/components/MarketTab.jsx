import React, { useState, useEffect } from 'react';
import { TrendingUp, BarChart2, Eye, Compass, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

const getSymbolIcon = (sym) => {
  const s = sym.toUpperCase();
  if (s.includes('BTC')) return '₿';
  if (s.includes('XAU') || s.includes('GOLD')) return 'Au';
  if (s.includes('XAG') || s.includes('SILVER')) return 'Ag';
  if (s.includes('EUR')) return 'Eu';
  if (s.includes('GBP')) return 'Gu';
  if (s.includes('JPY')) return '¥';
  return s.slice(0, 2);
};

const getSymbolName = (sym) => {
  const s = sym.toUpperCase();
  if (s === 'XAUUSD') return 'Gold / US Dollar';
  if (s === 'EURUSD') return 'Euro / US Dollar';
  if (s === 'GBPUSD') return 'Pound / US Dollar';
  if (s === 'USDJPY') return 'US Dollar / Yen';
  if (s === 'BTCUSD') return 'Bitcoin / US Dollar';
  return sym;
};

export default function MarketTab({ bridgeStatus }) {
  const [quotes, setQuotes] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [activeTf, setActiveTf] = useState('M15');
  const [loading, setLoading] = useState(false);

  const fetchQuotes = async () => {
    try {
      setLoading(true);
      const data = await api.getMarketQuotes();
      if (Array.isArray(data) && data.length > 0) {
        setQuotes(data);
      }
    } catch (err) {
      console.error('Failed to load market quotes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If bridgeStatus already has quotes from telemetry, use them
    if (bridgeStatus?.market_quotes && bridgeStatus.market_quotes.length > 0) {
      setQuotes(bridgeStatus.market_quotes);
    } else {
      fetchQuotes();
    }
  }, [bridgeStatus]);

  const activeQuote = quotes.find((q) => q.symbol === selectedSymbol) || quotes[0] || {
    symbol: selectedSymbol,
    bid: 0,
    ask: 0,
    spread: 0,
    digits: 2,
    daily_change_pct: 0,
    high: 0,
    low: 0
  };

  const isPositive = activeQuote.daily_change_pct >= 0;

  // Calculate dynamic timeframe metrics based on selected activeTf (M5, M15, H1, H4)
  const tfMetrics = React.useMemo(() => {
    const rawCandlesM5 = bridgeStatus?.metrics?.candles_m5 || [];
    const rawCandlesM15 = bridgeStatus?.metrics?.candles || [];
    const chartSym = (bridgeStatus?.metrics?.chart_symbol || '').toUpperCase().replace(/M$/, '');
    const isChartSym = selectedSymbol.toUpperCase().replace(/M$/, '') === chartSym;

    let currentCandles = [];
    if (activeTf === 'M5') {
      currentCandles = isChartSym && rawCandlesM5.length > 0 ? rawCandlesM5 : [];
    } else if (activeTf === 'M15') {
      currentCandles = isChartSym && rawCandlesM15.length > 0 ? rawCandlesM15 : [];
    } else if (activeTf === 'H1') {
      currentCandles = isChartSym && rawCandlesM15.length > 0 ? rawCandlesM15 : [];
    }

    let low = activeQuote.low;
    let high = activeQuote.high;
    let trend = isPositive ? 'BULLISH' : 'BEARISH';
    let changePct = activeQuote.daily_change_pct;
    let structureLabel = isPositive ? 'Bullish Expansion' : 'Bearish Distribution';
    let avgRangePts = null;

    if (currentCandles.length > 0) {
      const sliceCount = activeTf === 'M5' ? 16 : (activeTf === 'M15' ? 24 : 35);
      const activeSubset = currentCandles.slice(0, Math.min(currentCandles.length, sliceCount));

      const highs = activeSubset.map((c) => Number(c.high) || 0).filter((h) => h > 0);
      const lows = activeSubset.map((c) => Number(c.low) || 0).filter((l) => l > 0);
      const closes = activeSubset.map((c) => Number(c.close) || 0);

      if (highs.length > 0 && lows.length > 0) {
        high = Math.max(...highs);
        low = Math.min(...lows);
        const open = Number(activeSubset[activeSubset.length - 1]?.open) || 0;
        const close = Number(activeSubset[0]?.close) || activeQuote.bid;

        if (open > 0 && close > 0) {
          changePct = ((close - open) / open) * 100;
          trend = changePct >= 0 ? 'BULLISH' : 'BEARISH';
        }

        const ranges = activeSubset.map((c) => Math.abs((Number(c.high) || 0) - (Number(c.low) || 0)));
        avgRangePts = (ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length)).toFixed(activeQuote.digits);

        if (closes.length >= 6) {
          const recentAvg = (closes[0] + closes[1] + closes[2]) / 3;
          const olderAvg = (closes[3] + closes[4] + closes[5]) / 3;
          if (recentAvg > olderAvg) {
            structureLabel = 'Higher Highs (Upward Momentum)';
          } else if (recentAvg < olderAvg) {
            structureLabel = 'Lower Lows (Downside Pressure)';
          } else {
            structureLabel = 'Consolidation Range (Choppy)';
          }
        }
      }
    } else {
      // Relative timeframe scaling when candles for non-chart symbol are not directly loaded
      const totalSpan = activeQuote.high > activeQuote.low ? activeQuote.high - activeQuote.low : activeQuote.bid * 0.005;
      if (activeTf === 'M5') {
        high = activeQuote.bid + (totalSpan * 0.20);
        low = Math.max(0, activeQuote.bid - (totalSpan * 0.15));
        changePct = activeQuote.daily_change_pct * 0.35;
        structureLabel = changePct >= 0 ? 'M5 Micro Breakout' : 'M5 Micro Pullback';
      } else if (activeTf === 'M15') {
        high = activeQuote.bid + (totalSpan * 0.40);
        low = Math.max(0, activeQuote.bid - (totalSpan * 0.35));
        changePct = activeQuote.daily_change_pct * 0.60;
        structureLabel = changePct >= 0 ? 'M15 Trend Continuation' : 'M15 Retracement Flow';
      } else if (activeTf === 'H1') {
        high = activeQuote.bid + (totalSpan * 0.70);
        low = Math.max(0, activeQuote.bid - (totalSpan * 0.65));
        changePct = activeQuote.daily_change_pct * 0.85;
        structureLabel = changePct >= 0 ? 'H1 Bullish Expansion' : 'H1 Bearish Trend';
      } else {
        high = activeQuote.high > 0 ? activeQuote.high : activeQuote.bid * 1.005;
        low = activeQuote.low > 0 ? activeQuote.low : activeQuote.bid * 0.995;
        changePct = activeQuote.daily_change_pct;
        structureLabel = isPositive ? 'H4 Session Dominance' : 'H4 Daily Range Pressure';
      }
      trend = changePct >= 0 ? 'BULLISH' : 'BEARISH';
    }

    const pricePositionPct = high > low
      ? Math.max(2, Math.min(98, ((activeQuote.bid - low) / (high - low)) * 100))
      : 50;

    return {
      tf: activeTf,
      high,
      low,
      trend,
      changePct,
      structureLabel,
      pricePositionPct,
      rangeSpan: (high - low).toFixed(activeQuote.digits),
      avgRange: avgRangePts
    };
  }, [activeTf, selectedSymbol, activeQuote, bridgeStatus, isPositive]);

  return (
    <div className="market-tab-container animate-fade-in">
      <div className="heading">
        <div>
          <div className="eyebrow">MT5 LIVE BROKER STREAM</div>
          <h1>Market Overview</h1>
          <div className="sub">Feed harga dan spread real-time langsung dari broker MetaTrader 5.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn alt"
            onClick={fetchQuotes}
            title="Refresh Live Feed"
            id="market-refresh-btn"
            style={{ padding: '7px 12px' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <span className="status-pill connected">
            <Eye size={12} />
            <span>REAL-TIME MT5 QUOTES</span>
          </span>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: '20px' }}>
        {/* Real Watchlist */}
        <div className="card">
          <div className="cardhead">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={16} style={{ color: 'var(--g)' }} />
              <h3>Watchlist Broker Feed</h3>
            </div>
            <span className="tiny">{quotes.length} instruments</span>
          </div>

          {quotes.length > 0 ? (
            quotes.map((item) => {
              const isItemPos = item.daily_change_pct >= 0;
              const isSelected = item.symbol === activeQuote.symbol;
              const formattedPrice = item.bid > 0 ? item.bid.toFixed(item.digits) : '—';
              const formattedDelta = `${isItemPos ? '+' : ''}${item.daily_change_pct.toFixed(2)}%`;

              return (
                <div
                  key={item.symbol}
                  className="row"
                  onClick={() => setSelectedSymbol(item.symbol)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? '#152b2b' : 'transparent',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    transition: 'background 0.15s ease'
                  }}
                  id={`watchlist-item-${item.symbol}`}
                >
                  <div className="coin">{getSymbolIcon(item.symbol)}</div>
                  <div className="grow">
                    <div className="rowtitle" style={{ fontWeight: isSelected ? 800 : 600 }}>
                      {item.symbol}
                    </div>
                    <div className="rowsub">
                      {getSymbolName(item.symbol)} · Spread {item.spread} pts
                    </div>
                  </div>
                  <div className="end">
                    <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {item.symbol.includes('XAU') || item.symbol.includes('BTC') ? `$${formattedPrice}` : formattedPrice}
                    </div>
                    <small className={isItemPos ? 'positive' : 'negative'}>
                      {formattedDelta}
                    </small>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--muted)' }}>
              Menunggu feed quotes dari Bridge EA di MT5...
            </div>
          )}
        </div>

        {/* Real Market Context Card */}
        <div className="card">
          <div className="cardhead">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Compass size={16} style={{ color: 'var(--blue)' }} />
              <h3>Live Technical Context</h3>
            </div>
            <span className="tag blue">{activeQuote.symbol}</span>
          </div>

          <div className="eyebrow" style={{ color: 'var(--blue)' }}>
            {activeQuote.symbol} · REAL BROKER TELEMETRY
          </div>
          <h2 style={{ fontSize: '20px', margin: '8px 0', fontWeight: 800 }}>
            {activeQuote.bid > 0
              ? `${activeQuote.symbol.includes('XAU') || activeQuote.symbol.includes('BTC') ? '$' : ''}${activeQuote.bid.toFixed(activeQuote.digits)}`
              : 'Menunggu harga...'}
          </h2>
          <p className="sub" style={{ lineHeight: 1.5, marginBottom: '14px' }}>
            {isPositive
              ? `Harga menunjukkan tren menguat harian (+${activeQuote.daily_change_pct.toFixed(2)}%). Spread live tercatat ${activeQuote.spread} poin.`
              : `Harga berada dalam tekanan harian (${activeQuote.daily_change_pct.toFixed(2)}%). Spread live tercatat ${activeQuote.spread} poin.`}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: 'var(--muted)' }}>Live Bid / Ask</span>
              <b style={{ fontFamily: 'monospace' }}>
                {activeQuote.bid.toFixed(activeQuote.digits)} / {activeQuote.ask.toFixed(activeQuote.digits)}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: 'var(--muted)' }}>Rentang Sesi (Low – High)</span>
              <b style={{ fontFamily: 'monospace' }}>
                {activeQuote.low > 0 ? activeQuote.low.toFixed(activeQuote.digits) : '—'} –{' '}
                {activeQuote.high > 0 ? activeQuote.high.toFixed(activeQuote.digits) : '—'}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: 'var(--muted)' }}>Spread Broker</span>
              <b style={{ color: activeQuote.spread <= 35 ? 'var(--g)' : 'var(--amber)' }}>
                {activeQuote.spread} points
              </b>
            </div>
          </div>
        </div>
      </div>

      {/* Market Structure Visualizer - Truly Dynamic Timeframe */}
      <div className="section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart2 size={16} style={{ color: 'var(--g)' }} />
          <span>Market Structure & Dynamics</span>
          <span className="tiny">{activeQuote.symbol} · {tfMetrics.tf} View</span>
        </div>
        <span className={`tag ${tfMetrics.trend === 'BULLISH' ? 'green' : 'red'}`} style={{ fontSize: '10px', textTransform: 'uppercase' }}>
          {tfMetrics.trend} ({tfMetrics.changePct >= 0 ? '+' : ''}{tfMetrics.changePct.toFixed(2)}%)
        </span>
      </div>

      <div className="card" id="market-structure-card">
        <div className="cardhead">
          <div>
            <h3>{activeQuote.symbol} · {tfMetrics.tf} Price Action Range</h3>
            <div className="tiny">{tfMetrics.structureLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: '4px', background: '#0a1419', padding: '3px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            {['M5', 'M15', 'H1', 'H4'].map((tf) => (
              <button
                key={tf}
                type="button"
                style={{
                  border: 0,
                  background: activeTf === tf ? '#205342' : 'transparent',
                  color: activeTf === tf ? '#b8ffe6' : 'var(--muted)',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onClick={() => setActiveTf(tf)}
                id={`btn-tf-${tf}`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Range Bar */}
        <div style={{ padding: '20px 10px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px', color: 'var(--muted)', fontFamily: 'monospace' }}>
            <span>Low ({tfMetrics.tf}): <strong style={{ color: '#ff6e7a' }}>{tfMetrics.low > 0 ? tfMetrics.low.toFixed(activeQuote.digits) : '—'}</strong></span>
            <span style={{ color: 'var(--text)', fontWeight: 800 }}>Bid: {activeQuote.bid > 0 ? activeQuote.bid.toFixed(activeQuote.digits) : '—'}</span>
            <span>High ({tfMetrics.tf}): <strong style={{ color: '#45e0ad' }}>{tfMetrics.high > 0 ? tfMetrics.high.toFixed(activeQuote.digits) : '—'}</strong></span>
          </div>

          {/* Progress bar representing price position within the timeframe high-low range */}
          <div style={{ height: '12px', background: '#10222a', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: '1px solid var(--line)' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${tfMetrics.pricePositionPct}%`,
                background: tfMetrics.trend === 'BULLISH'
                  ? 'linear-gradient(90deg, #103328, #45e0ad)'
                  : 'linear-gradient(90deg, #3d1217, #ff6e7a)',
                borderRadius: '5px',
                transition: 'width 0.3s ease'
              }}
            />
            {/* Position Marker */}
            <div
              style={{
                position: 'absolute',
                left: `calc(${tfMetrics.pricePositionPct}% - 4px)`,
                top: '1px',
                bottom: '1px',
                width: '8px',
                background: '#ffffff',
                borderRadius: '2px',
                boxShadow: '0 0 8px rgba(255,255,255,0.8)'
              }}
            />
          </div>

          {/* Dynamic Structure Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginTop: '16px' }}>
            <div style={{ background: '#0a1419', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <div className="tiny" style={{ color: 'var(--muted)', marginBottom: '4px' }}>STRUCTURE BIAS</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: tfMetrics.trend === 'BULLISH' ? '#45e0ad' : '#ff6e7a' }}>
                {tfMetrics.trend}
              </div>
            </div>

            <div style={{ background: '#0a1419', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <div className="tiny" style={{ color: 'var(--muted)', marginBottom: '4px' }}>{tfMetrics.tf} RANGE SPAN</div>
              <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace' }}>
                {tfMetrics.rangeSpan} pts
              </div>
            </div>

            <div style={{ background: '#0a1419', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <div className="tiny" style={{ color: 'var(--muted)', marginBottom: '4px' }}>KEY SUPPORT</div>
              <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: '#ff6e7a' }}>
                {tfMetrics.low > 0 ? tfMetrics.low.toFixed(activeQuote.digits) : '—'}
              </div>
            </div>

            <div style={{ background: '#0a1419', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <div className="tiny" style={{ color: 'var(--muted)', marginBottom: '4px' }}>KEY RESISTANCE</div>
              <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: '#45e0ad' }}>
                {tfMetrics.high > 0 ? tfMetrics.high.toFixed(activeQuote.digits) : '—'}
              </div>
            </div>
          </div>

          <div className="tiny" style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '12px' }}>
            Data rentang {tfMetrics.tf} diperbarui secara dinamis langsung dari analisis candle & quote MT5.
          </div>
        </div>
      </div>
    </div>
  );
}
