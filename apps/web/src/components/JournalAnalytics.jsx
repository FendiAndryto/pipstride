import React from 'react';
import { Activity, BarChart3, Gauge, TrendingDown, TrendingUp } from 'lucide-react';

const money = (value) => {
  const numeric = Number(value) || 0;
  return `${numeric >= 0 ? '+' : '−'}$${Math.abs(numeric).toFixed(2)}`;
};

const ratio = (value, suffix = '') =>
  value === null || value === undefined ? '∞' : `${value.toFixed(2)}${suffix}`;

const holdTime = (minutes) => {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} j`;
  return `${(minutes / 1440).toFixed(1)} d`;
};

function MetricTile({ label, value, tone, hint, id }) {
  const color = tone === 'positive' ? 'var(--g)' : tone === 'negative' ? 'var(--red)' : 'inherit';
  return (
    <div className="card" id={id} style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: '15px', fontWeight: 800, color }}>{value}</div>
      <div className="label" style={{ fontSize: '10px' }}>{label}</div>
      {hint ? (
        <div className="tiny" style={{ fontSize: '9.5px', color: 'var(--muted)', marginTop: '2px' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function BucketBars({ title, subtitle, buckets, icon: Icon }) {
  if (!buckets.length) {
    return null;
  }
  const max = Math.max(...buckets.map((bucket) => Math.abs(bucket.net_profit)), 1);

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
        <Icon size={14} style={{ color: 'var(--g)' }} />
        <span style={{ fontSize: '12px', fontWeight: 700 }}>{title}</span>
        {subtitle ? <span className="tiny">{subtitle}</span> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {buckets.map((bucket) => {
          const positive = bucket.net_profit >= 0;
          return (
            <div key={bucket.key} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div
                style={{ display: 'grid', gridTemplateColumns: '34px 1fr 82px', gap: '8px', alignItems: 'center' }}
              >
                <span className="tiny" style={{ fontFamily: 'monospace', color: '#c9d8dc' }}>
                  {bucket.key}
                </span>
                <div
                  style={{
                    height: '7px',
                    borderRadius: '4px',
                    background: '#142229',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max(3, (Math.abs(bucket.net_profit) / max) * 100)}%`,
                      background: positive ? 'var(--g)' : 'var(--red)',
                      opacity: 0.85
                    }}
                  />
                </div>
                <span
                  className="tiny"
                  style={{
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    color: positive ? 'var(--g)' : 'var(--red)'
                  }}
                >
                  {money(bucket.net_profit)}
                </span>
              </div>
              <span className="tiny" style={{ fontSize: '9px', color: 'var(--muted)', marginLeft: '42px' }}>
                {bucket.trades} trade · {bucket.win_rate.toFixed(0)}% win · PF {ratio(bucket.profit_factor)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function JournalAnalytics({ stats, loading, periodLabel }) {
  const totals = stats?.totals;
  const hasTrades = Boolean(totals && totals.trades > 0);

  if (loading && !stats) {
    return (
      <div className="card tiny" style={{ padding: '18px', textAlign: 'center' }}>
        Menghitung statistik jurnal...
      </div>
    );
  }

  if (!hasTrades) {
    return (
      <div className="card" style={{ padding: '18px 20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <BarChart3 size={16} style={{ color: 'var(--g)' }} />
          <span style={{ fontSize: '13px', fontWeight: 700 }}>Belum ada data untuk dianalisis</span>
        </div>
        <p className="sub" style={{ fontSize: '11.5px', lineHeight: 1.5, margin: 0 }}>
          Statistik dihitung dari transaksi tertutup pada periode {periodLabel}. Pilih periode yang lebih panjang atau
          tunggu transaksi berikutnya tersinkron dari MT5.
        </p>
      </div>
    );
  }

  const netTone = totals.net_profit >= 0 ? 'positive' : 'negative';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
      <div className="grid-cards-responsive-2col four-cols-desktop">
        <MetricTile
          id="journal-metric-expectancy"
          label="Expectancy / Trade"
          value={money(totals.expectancy)}
          tone={totals.expectancy >= 0 ? 'positive' : 'negative'}
          hint={`${totals.trades} trade · ${periodLabel}`}
        />
        <MetricTile
          id="journal-metric-avg-win"
          label="Rata-rata Win"
          value={money(totals.avg_win)}
          tone="positive"
          hint={`${totals.wins} trade menang`}
        />
        <MetricTile
          id="journal-metric-avg-loss"
          label="Rata-rata Loss"
          value={money(totals.avg_loss)}
          tone="negative"
          hint={`${totals.losses} trade kalah`}
        />
        <MetricTile
          id="journal-metric-payoff"
          label="Payoff Ratio"
          value={ratio(totals.payoff_ratio)}
          hint="Avg win ÷ |avg loss|"
        />
        <MetricTile
          id="journal-metric-streak-win"
          label="Win Streak Terpanjang"
          value={`${totals.max_win_streak ?? 0}x`}
          tone="positive"
          hint={`Loss streak ${totals.max_loss_streak ?? 0}x`}
        />
        <MetricTile
          id="journal-metric-hold"
          label="Rata-rata Holding"
          value={holdTime(totals.avg_hold_minutes)}
          hint={`Volume ${Number(totals.total_volume ?? 0).toFixed(2)} lot`}
        />
        <MetricTile
          id="journal-metric-best"
          label="Best Trade"
          value={money(totals.best_trade ?? 0)}
          tone="positive"
        />
        <MetricTile
          id="journal-metric-worst"
          label="Worst Trade"
          value={money(totals.worst_trade ?? 0)}
          tone="negative"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <Gauge size={14} style={{ color: 'var(--g)' }} />
            <span style={{ fontSize: '12px', fontWeight: 700 }}>Performa per Simbol</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>SIMBOL</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>TRADE</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>WIN</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>PF</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px', textAlign: 'right' }}>
                    NET P/L
                  </th>
                </tr>
              </thead>
              <tbody>
                {(stats.by_symbol || []).map((bucket) => (
                  <tr key={bucket.key} style={{ borderBottom: '1px solid #1c2b33' }}>
                    <td style={{ padding: '8px 6px', fontWeight: 700 }}>{bucket.key}</td>
                    <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{bucket.trades}</td>
                    <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{bucket.win_rate.toFixed(1)}%</td>
                    <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{ratio(bucket.profit_factor)}</td>
                    <td
                      style={{
                        padding: '8px 6px',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: bucket.net_profit >= 0 ? 'var(--g)' : 'var(--red)'
                      }}
                    >
                      {money(bucket.net_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <Activity size={14} style={{ color: 'var(--g)' }} />
            <span style={{ fontSize: '12px', fontWeight: 700 }}>Long vs Short</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(stats.by_direction || []).map((bucket) => {
              const positive = bucket.net_profit >= 0;
              return (
                <div
                  key={bucket.key}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    background: '#0b151b'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontWeight: 700 }}>
                      {bucket.key === 'SELL' ? (
                        <TrendingDown size={13} style={{ color: 'var(--red)' }} />
                      ) : (
                        <TrendingUp size={13} style={{ color: 'var(--g)' }} />
                      )}
                      {bucket.key === 'SELL' ? 'Short (SELL)' : 'Long (BUY)'}
                    </span>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        fontSize: '12px',
                        color: positive ? 'var(--g)' : 'var(--red)'
                      }}
                    >
                      {money(bucket.net_profit)}
                    </span>
                  </div>
                  <div className="tiny" style={{ marginTop: '3px', color: 'var(--muted)' }}>
                    {bucket.trades} trade · win {(bucket.win_rate ?? 0).toFixed(1)}% · PF {ratio(bucket.profit_factor)}
                  </div>
                </div>
              );
            })}
            {(stats.by_direction || []).length === 0 ? (
              <span className="tiny">Belum ada data arah trade.</span>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        <BucketBars
          title="Performa per Hari"
          subtitle="waktu server broker"
          buckets={stats.by_weekday || []}
          icon={BarChart3}
        />
        <BucketBars
          title="Performa per Jam"
          subtitle="waktu server broker"
          buckets={stats.by_hour || []}
          icon={BarChart3}
        />
      </div>

      <div className="tiny" style={{ color: 'var(--muted)', fontSize: '10px' }}>
        Semua metrik dihitung dari transaksi tertutup yang tersimpan (bukan estimasi). Net P/L periode:{' '}
        <span style={{ color: netTone === 'positive' ? 'var(--g)' : 'var(--red)' }}>{money(totals.net_profit)}</span> dari{' '}
        {totals.trades} trade, {totals.breakeven} breakeven.
      </div>
    </div>
  );
}
