import React from 'react';
import { Activity, BarChart3, Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const money = (value) => {
  const numeric = Number(value) || 0;
  return `${numeric >= 0 ? '+' : '−'}$${Math.abs(numeric).toFixed(2)}`;
};

const ratio = (value, suffix = '') =>
  value === null || value === undefined ? '∞' : `${value.toFixed(2)}${suffix}`;

const holdTime = (minutes, t) => {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} ${t('ja_minutes')}`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} ${t('ja_hours')}`;
  return `${(minutes / 1440).toFixed(1)} ${t('ja_days')}`;
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
  const { t } = useLanguage();
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
                {t('ja_bucket_detail', { count: bucket.trades, win: bucket.win_rate.toFixed(0), pf: ratio(bucket.profit_factor) })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function JournalAnalytics({ stats, loading, periodLabel }) {
  const { t } = useLanguage();
  const totals = stats?.totals;
  const hasTrades = Boolean(totals && totals.trades > 0);

  if (loading && !stats) {
    return (
      <div className="card tiny" style={{ padding: '18px', textAlign: 'center' }}>
        {t('ja_calculating')}
      </div>
    );
  }

  if (!hasTrades) {
    return (
      <div className="card" style={{ padding: '18px 20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <BarChart3 size={16} style={{ color: 'var(--g)' }} />
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{t('ja_no_data')}</span>
        </div>
        <p className="sub" style={{ fontSize: '11.5px', lineHeight: 1.5, margin: 0 }}>
          {t('ja_no_data_desc', { period: periodLabel })}
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
          label={t('ja_expectancy')}
          value={money(totals.expectancy)}
          tone={totals.expectancy >= 0 ? 'positive' : 'negative'}
          hint={t('ja_trades_period', { count: totals.trades, period: periodLabel })}
        />
        <MetricTile
          id="journal-metric-avg-win"
          label={t('ja_avg_win')}
          value={money(totals.avg_win)}
          tone="positive"
          hint={t('ja_trades_won', { count: totals.wins })}
        />
        <MetricTile
          id="journal-metric-avg-loss"
          label={t('ja_avg_loss')}
          value={money(totals.avg_loss)}
          tone="negative"
          hint={t('ja_trades_lost', { count: totals.losses })}
        />
        <MetricTile
          id="journal-metric-payoff"
          label={t('ja_payoff')}
          value={ratio(totals.payoff_ratio)}
          hint={t('ja_payoff_hint')}
        />
        <MetricTile
          id="journal-metric-streak-win"
          label={t('ja_win_streak')}
          value={`${totals.max_win_streak ?? 0}x`}
          tone="positive"
          hint={t('ja_loss_streak', { count: totals.max_loss_streak ?? 0 })}
        />
        <MetricTile
          id="journal-metric-hold"
          label={t('ja_avg_hold')}
          value={holdTime(totals.avg_hold_minutes, t)}
          hint={t('ja_volume', { vol: Number(totals.total_volume ?? 0).toFixed(2) })}
        />
        <MetricTile
          id="journal-metric-best"
          label={t('ja_best_trade')}
          value={money(totals.best_trade ?? 0)}
          tone="positive"
        />
        <MetricTile
          id="journal-metric-worst"
          label={t('ja_worst_trade')}
          value={money(totals.worst_trade ?? 0)}
          tone="negative"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <Gauge size={14} style={{ color: 'var(--g)' }} />
            <span style={{ fontSize: '12px', fontWeight: 700 }}>{t('ja_by_symbol')}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>{t('ja_th_symbol')}</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>{t('ja_th_trades')}</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>{t('ja_th_win')}</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px' }}>{t('ja_th_pf')}</th>
                  <th style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: '9.5px', textAlign: 'right' }}>
                    {t('ja_th_net')}
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
            <span style={{ fontSize: '12px', fontWeight: 700 }}>{t('ja_long_short')}</span>
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
                      {bucket.key === 'SELL' ? t('ja_short') : t('ja_long')}
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
                    {t('ja_trade_win_pf', { count: bucket.trades, win: (bucket.win_rate ?? 0).toFixed(1), pf: ratio(bucket.profit_factor) })}
                  </div>
                </div>
              );
            })}
            {(stats.by_direction || []).length === 0 ? (
              <span className="tiny">{t('ja_no_direction')}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '16px' }}>
        <BucketBars
          title={t('ja_by_weekday')}
          subtitle={t('ja_broker_time')}
          buckets={stats.by_weekday || []}
          icon={BarChart3}
        />
        <BucketBars
          title={t('ja_by_hour')}
          subtitle={t('ja_broker_time')}
          buckets={stats.by_hour || []}
          icon={BarChart3}
        />
      </div>

      <div className="tiny" style={{ color: 'var(--muted)', fontSize: '10px' }}>
        {t('ja_footnote')}{' '}
        <span style={{ color: netTone === 'positive' ? 'var(--g)' : 'var(--red)' }}>{money(totals.net_profit)}</span>{' '}
        {t('ja_footnote_rest', { count: totals.trades, breakeven: totals.breakeven })}
      </div>
    </div>
  );
}
