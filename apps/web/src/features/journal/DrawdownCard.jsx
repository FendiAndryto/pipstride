// Drawdown card for the Journal screen (ticket 09-02). Drawdown is a
// performance metric, so it sits beside realized P/L and profit factor rather
// than on the Profile screen.
//
// Read-only (ADR 0004): two gauges, no actions, no mutations. Every number comes
// from `/bridge/risk`; when the endpoint has not answered the card says so
// instead of rendering a derived 0.00%.

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency } from '../../domain/format';
import { drawdownTone, drawdownView } from '../../domain/pnl';

const gaugeTrackStyle = {
  background: '#0a1419',
  height: '8px',
  borderRadius: '99px',
  overflow: 'hidden',
  border: '1px solid var(--line)'
};

// Known anchor sources, mirroring `daily_anchor_source` in the API. A source the
// frontend does not recognise is dropped instead of leaking a raw i18n key.
const ANCHOR_SOURCE_KEYS = {
  snapshot_exact: 'journal_drawdown_source_snapshot_exact',
  snapshot_rollforward: 'journal_drawdown_source_snapshot_rollforward',
  session_start: 'journal_drawdown_source_session_start',
  deposit_reconstruction: 'journal_drawdown_source_deposit_reconstruction',
  current_fallback: 'journal_drawdown_source_current_fallback'
};

function Gauge({ label, value, limit, used, alert, tone, subline, id }) {
  const { t } = useLanguage();
  const shown = value === null ? '—' : `${value.toFixed(2)}%`;
  const limitText = limit === null ? '—' : t('journal_drawdown_limit', { pct: limit.toFixed(1) });

  return (
    <div id={id}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <div className="tiny" style={{ color: 'var(--muted)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </div>
        <div className="tiny" style={{ color: 'var(--muted)', fontSize: '9.5px' }}>{limitText}</div>
      </div>

      <div className={`metric ${alert ? 'negative' : ''}`} style={{ marginTop: '2px' }}>
        {shown}
      </div>

      <div style={{ ...gaugeTrackStyle, marginTop: '6px', marginBottom: '6px' }}>
        <div
          style={{
            width: `${used}%`,
            height: '100%',
            background: tone,
            borderRadius: '99px',
            transition: 'width 0.4s ease'
          }}
        />
      </div>

      <div className="tiny" style={{ color: 'var(--muted)', fontSize: '10px', lineHeight: 1.4 }}>{subline}</div>
    </div>
  );
}

export default function DrawdownCard({ bridgeStatus, riskStatus }) {
  const { t, locale } = useLanguage();
  const view = drawdownView(riskStatus);
  const currency = bridgeStatus?.metrics?.currency || 'USD';

  const heading = (
    <div className="cardhead">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldCheck size={18} style={{ color: view.dailyAlert || view.overallAlert ? 'var(--amber)' : 'var(--g)' }} />
        <h3>{t('journal_drawdown_title')}</h3>
      </div>
      {(view.dailyAlert || view.overallAlert) && (
        <span className="tag" style={{ fontSize: '9px', color: 'var(--red)' }}>
          {t('journal_drawdown_alert')}
        </span>
      )}
    </div>
  );

  if (!view.available) {
    return (
      <div className="card" style={{ marginBottom: '16px' }} id="journal-drawdown-card">
        {heading}
        <p className="sub" style={{ fontSize: '11.5px', margin: 0, lineHeight: 1.5 }}>
          {t('journal_drawdown_unavailable')}
        </p>
      </div>
    );
  }

  const overallSub = [
    view.overall === null ? null : t('journal_drawdown_current', { pct: view.overall.toFixed(2) }),
    view.peakEquity === null ? null : t('journal_drawdown_peak', { amount: formatCurrency(view.peakEquity, currency) })
  ]
    .filter(Boolean)
    .join(' • ');

  const anchorTime =
    view.dailyAnchorAt === null
      ? null
      : new Date(view.dailyAnchorAt * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const anchorSourceKey = ANCHOR_SOURCE_KEYS[view.dailyAnchorSource];
  const anchorSource = anchorSourceKey ? t(anchorSourceKey) : null;
  const dailySub = [
    view.daily === null ? null : t('journal_drawdown_current', { pct: view.daily.toFixed(2) }),
    anchorTime && anchorSource
      ? t('journal_drawdown_anchor', { time: anchorTime, source: anchorSource })
      : anchorTime
        ? t('journal_drawdown_anchor_time', { time: anchorTime })
        : anchorSource
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="card" style={{ marginBottom: '16px' }} id="journal-drawdown-card">
      {heading}

      <div className="grid-cards-responsive-2col" style={{ gap: '18px' }}>
        <Gauge
          id="journal-drawdown-overall"
          label={t('journal_drawdown_overall')}
          value={view.maxOverall}
          limit={view.overallLimit}
          used={view.overallUsed}
          alert={view.overallAlert}
          tone={drawdownTone(view.overallUsed, view.overallAlert)}
          subline={overallSub || t('journal_drawdown_no_peak')}
        />
        <Gauge
          id="journal-drawdown-daily"
          label={t('journal_drawdown_daily')}
          value={view.dailyMax}
          limit={view.dailyLimit}
          used={view.dailyUsed}
          alert={view.dailyAlert}
          tone={drawdownTone(view.dailyUsed, view.dailyAlert)}
          subline={dailySub || t('journal_drawdown_no_anchor')}
        />
      </div>

      <div
        style={{
          marginTop: '14px',
          paddingTop: '10px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          fontSize: '10.5px',
          color: 'var(--muted)'
        }}
      >
        <span>
          {t('journal_drawdown_vs_deposit', {
            amount:
              bridgeStatus?.initial_deposit === null || bridgeStatus?.initial_deposit === undefined
                ? '—'
                : formatCurrency(bridgeStatus.initial_deposit, currency)
          })}
        </span>
        <span>{t('journal_drawdown_passive')}</span>
      </div>
    </div>
  );
}
